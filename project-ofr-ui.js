import { projectOfrCandidates, ofrYieldFromValuation } from './project-ofr.js?v=20261028v540';

const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const keyOf = (projectId, trancheId) => JSON.stringify([projectId, trancheId]);
const rate = value => Number.isFinite(value) ? `${Number(value.toFixed(4))}%` : '';

export function createProjectOfrActions({container, getProject, loadOffers, addOffer, beforeAdd, onToast = () => {}}) {
  if (!container) return { render() {}, reset() {}, invalidate() {} };
  const saved = new Map(), confirmations = new Map(), busy = new Set(), errors = new Map();
  const writeVersions = new Map();
  let activeId = '', loadedId = '', generation = 0, statusGeneration = 0;
  function reset() { generation++; statusGeneration++; activeId = ''; loadedId = ''; saved.clear(); confirmations.clear(); busy.clear(); errors.clear(); writeVersions.clear(); container.hidden = true; container.replaceChildren(); }
  function invalidate() { statusGeneration++; loadedId = ''; saved.clear(); }
  function rememberInputs() {
    for (const row of container.querySelectorAll('[data-ofr-tranche]')) {
      const details = confirmations.get(keyOf(activeId, row.dataset.ofrTranche));
      if (!details) continue;
      const input = row.querySelector('[data-ofr-valuation]'), select = row.querySelector('[data-ofr-branch]');
      if (input) details.valuationText = input.value;
      if (select) details.branchTitle = select.value;
    }
  }
  function render(project) {
    rememberInputs();
    activeId = project?.id || '';
    const candidates = projectOfrCandidates(project || {});
    container.hidden = !candidates.length;
    if (!candidates.length) { container.replaceChildren(); return; }
    container.innerHTML = candidates.map(item => {
      const tranche = item.tranche || item;
      const trancheId = tranche.id || item.trancheId;
      const key = keyOf(project.id, trancheId), transfer = saved.get(key), confirm = confirmations.get(key), working = busy.has(key);
      const initial = typeof tranche.initialMarketValuation === 'number' ? tranche.initialMarketValuation : null;
      const yieldValue = Number.isFinite(initial) ? ofrYieldFromValuation(initial) : null;
      return `<div class="project-ofr-item" data-ofr-tranche="${escape(trancheId)}"><div class="project-ofr-heading">
        <div class="project-ofr-identity"><strong>${escape(tranche.shortName || project.shortName)}</strong>
          <span class="project-ofr-price">${transfer ? Number.isFinite(transfer.ofrYield) ? `${rate(transfer.ofrYield)} OFR` : '清单已有 OFR' : Number.isFinite(yieldValue) ? `${rate(yieldValue)} OFR` : '核对建项估值后挂卖'}</span></div>
        <button class="button subtle" type="button" data-ofr-add ${working || transfer ? 'disabled' : ''}>${working ? '正在加入…' : transfer ? '已加入 OFR' : '加入 OFR 挂卖'}</button></div>
        ${confirm ? `<div class="project-ofr-confirm"><p class="project-ofr-message">${escape(confirm.message)}</p>
          ${confirm.requiredFields.includes('valuation') ? `<label>建项时估值（%）<input data-ofr-valuation type="number" step="0.0001" min="0.0501" max="100" value="${escape(confirm.valuationText || '')}" placeholder="核对后填写建项时的估值"></label>` : ''}
          ${confirm.requiredFields.includes('branch') ? `<label>挂卖分行<select data-ofr-branch><option value="">请选择分行</option>${confirm.branches.map(title => `<option value="${escape(title)}" ${confirm.branchTitle === title ? 'selected' : ''}>${escape(title)}</option>`).join('')}</select></label>` : ''}
          <p class="project-ofr-price" data-ofr-preview></p><div class="project-ofr-confirm-actions"><button class="button primary" type="button" data-ofr-confirm ${working ? 'disabled' : ''}>确认并加入 OFR</button><button class="button subtle" type="button" data-ofr-cancel ${working ? 'disabled' : ''}>取消</button></div></div>` : ''}
        ${errors.has(key) ? `<p class="project-ofr-message" role="status">${escape(errors.get(key))}</p>` : ''}</div>`;
    }).join('');
    if (loadedId !== project.id) {
      loadedId = project.id;
      const token = generation, statusToken = statusGeneration, writeVersion = writeVersions.get(project.id) || 0;
      void loadOffers().then(payload => {
        if (token !== generation || statusToken !== statusGeneration || writeVersion !== (writeVersions.get(project.id) || 0)) return;
        for (const key of saved.keys()) if (JSON.parse(key)[0] === project.id) saved.delete(key);
        for (const transfer of payload.transfers || []) if (transfer.projectId === project.id && transfer.present !== false) saved.set(keyOf(transfer.projectId, transfer.trancheId), transfer);
        if (activeId === project.id) render(getProject() || project);
      }).catch(() => { if (token === generation && statusToken === statusGeneration) loadedId = ''; });
    }
  }
  async function submit(trancheId, confirmed) {
    const project = getProject();
    if (!project || project.id !== activeId) return;
    const key = keyOf(project.id, trancheId), token = generation;
    if (busy.has(key) || saved.has(key)) return;
    const row = [...container.querySelectorAll('[data-ofr-tranche]')].find(element => element.dataset.ofrTranche === trancheId);
    const options = {projectId: project.id, trancheId};
    if (confirmed) {
      rememberInputs();
      const details = confirmations.get(key);
      const valuation = row?.querySelector('[data-ofr-valuation]');
      if (details?.requiredFields.includes('valuation')) {
        const value = valuation?.value.trim();
        if (!value || !Number.isFinite(Number(value)) || Number(value) <= .05 || Number(value) > 100) { errors.set(key, '请填写有效的建项估值，须大于 0.05%。'); render(project); return; }
        options.confirmedValuation = Number(value);
      }
      if (details?.valuationText && Number.isFinite(Number(details.valuationText))) options.confirmedValuation = Number(details.valuationText);
      if (details?.branchTitle) options.branchTitle = details.branchTitle;
      if (details?.requiredFields.includes('branch')) {
        options.branchTitle = row?.querySelector('[data-ofr-branch]')?.value || '';
        if (!options.branchTitle) { errors.set(key, '请选择挂卖分行。'); render(project); return; }
      }
    }
    busy.add(key); errors.delete(key); render(project);
    try {
      await beforeAdd();
      if (token !== generation) return;
      const result = await addOffer(options);
      if (token !== generation) return;
      writeVersions.set(project.id, (writeVersions.get(project.id) || 0) + 1);
      const transfer = result.transfer || {projectId: project.id, trancheId, ofrYield: result.ofrYield};
      saved.set(key, transfer); confirmations.delete(key);
      onToast(result.alreadyExists ? '清单中已有这只券的 OFR，原报价保留。' : `已加入 OFR 挂卖${Number.isFinite(transfer.ofrYield) ? ` · ${rate(transfer.ofrYield)}` : ''}，下次进入清单查看。`);
    } catch (error) {
      if (token !== generation) return;
      if (error.code === 'confirmation_required') confirmations.set(key, {...confirmations.get(key),requiredFields:error.requiredFields || [],branches:error.branches || [],message:error.message});
      else errors.set(key, error.message || '加入失败，请重试。');
    } finally {
      if (token === generation) { busy.delete(key); if (activeId === project.id) render(getProject() || project); }
    }
  }
  container.addEventListener('click', event => {
    const row = event.target.closest('[data-ofr-tranche]'); if (!row) return;
    if (event.target.closest('[data-ofr-add]')) void submit(row.dataset.ofrTranche, false);
    if (event.target.closest('[data-ofr-confirm]')) void submit(row.dataset.ofrTranche, true);
    if (event.target.closest('[data-ofr-cancel]')) { const project=getProject(); confirmations.delete(keyOf(project.id,row.dataset.ofrTranche)); errors.delete(keyOf(project.id,row.dataset.ofrTranche)); render(project); }
  });
  container.addEventListener('input', event => {
    event.stopPropagation();
    if (!event.target.matches('[data-ofr-valuation]')) return;
    const preview = event.target.closest('[data-ofr-tranche]').querySelector('[data-ofr-preview]');
    const value = event.target.value.trim(), next = value ? ofrYieldFromValuation(Number(value)) : null;
    preview.textContent = Number.isFinite(next) ? `挂卖收益率 ${rate(next)} OFR` : '';
  });
  container.addEventListener('change', event => { event.stopPropagation(); rememberInputs(); });
  return {render, reset, invalidate};
}
