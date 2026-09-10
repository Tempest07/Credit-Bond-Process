const API = './api/valuation/';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rate = value => typeof value === 'number' ? `${value.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')}%` : '—';
let target = {}, key = '', run = null, pending = false, status = null, message = '', generation = 0, visible = false;
let history = { runs: [], experiences: [] };
const drafts = new Map();
const box = () => document.getElementById('experimentalValuationAssist');
document.addEventListener('click', event => {
  if (event.target.closest('#openExperimentalValuation')) {
    visible = true;
    render();
    request('status').then(p=>{status=p;render();}).catch(e=>{message=e.message;render();});
  }
});
async function request(path, body) {
  const r = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  let p;
  try { p = await r.json(); } catch { throw new Error('估值服务尚未启动，请使用 实验估值服务'); }
  if (!r.ok || p.ok === false) throw new Error(p.error || '估值请求失败');
  return p;
}
export function resetModelValuationAssist() { generation++; visible=false; key=''; target={}; run=null; message=''; if(box()) box().hidden=true; }
export function updateModelValuationAssist(project = {}, issuer = {}) {
  const next = { issuerName: issuer?.legalName || project?.issuerName || '', ...Object.fromEntries(['societyCode','shortName','fullName','durationText','offeringType','venue','hiddenRating'].map(k => [k,project?.[k] || ''])) };
  const nextKey = JSON.stringify(next);
  if (key === nextKey) return;
  key = nextKey; target = next; run = null; generation++; message='';
  render();
  if (!status) request('status').then(p => {status=p; render();}).catch(e => {message=e.message; render();});
}
function table(evidence, result) {
  const selected = new Map((result.comparables || []).map(c => [c.securityId,c]));
  const excluded = new Map((result.excluded || []).map(c => [c.securityId,c.reason]));
  return `<div class="va-table"><table><thead><tr><th>可比券</th><th>期限</th><th>估值</th><th>调整</th><th>权重</th></tr></thead><tbody>${evidence.candidates.map(c => {
    const s = selected.get(c.securityId);
    return `<tr><td>${escape(c.shortName)}<span>${escape(c.source)} · ${escape(c.yieldBasis)} · ${escape(c.valuationDate)}</span></td><td>${Number(c.years).toFixed(2)}Y</td><td>${rate(c.rate)}</td><td>${s ? `期限 ${s.tenorAdjustmentBp.toFixed(2)} bp<br>市场 ${s.marketAdjustmentBp.toFixed(2)} bp` : '未采用'}</td><td>${s ? `${(s.weight*100).toFixed(1)}%` : '—'}</td></tr>${s || excluded.has(c.securityId) ? `<tr class="va-reason"><td colspan="5">${escape(s?.rationale || excluded.get(c.securityId))}${s ? ` · 折算 ${rate(s.adjustedYield)}` : ''}</td></tr>` : ''}`;
  }).join('')}</tbody></table></div>`;
}
function resultCard(r) {
  const e = run.evidence, t = e.targets[r.targetIndex];
  const draft = drafts.get(`${run.id}:${r.targetIndex}`);
  const offering = {public:'公募',private:'私募'}[e.target.offeringType] || '发行方式待确认';
  return `<article class="va-card"><div class="va-color"><div class="va-hero"><div><div>${escape(t.durationText)} ${r.comparables.length && r.comparables.every(c=>c.tenorBasis?.method==='none') && r.comparables.some(c=>Math.abs((e.candidates.find(b=>b.securityId===c.securityId)?.years ?? t.years)-t.years)>1e-8) ? '未调整期限参考' : '参考估值'}</div><strong class="va-rate">${r.center === null ? '暂无可靠建议' : rate(r.center)}</strong></div><div class="va-range"><span>参考区间</span><strong>${r.low === null ? '依据不足，未给区间' : `${rate(r.low)} — ${rate(r.high)}`}</strong></div></div><div class="va-profile"><span>${escape(e.target.profile?.bondClass || '')} · ${escape(e.target.venue || e.target.profile?.market)} · ${offering}</span><span>模型研判</span></div></div>
    <div class="va-summary">采用 ${r.comparables.length} 只 / ${e.candidates.length} 只可用券<span>${e.sample ? '演示数据' : escape(e.source)} · ${escape(e.valuationDate || '无可用日期')}</span></div>
    ${(e.warnings || []).length ? `<div class="va-notice">${e.warnings.map(escape).join('；')}</div>` : ''}<details><summary>可比券</summary>${table(e,r)}${e.excluded.length ? `<div class="va-text">${e.excluded.map(c => `${escape(c.shortName)}：${escape(c.reason)}`).join('<br>')}</div>` : ''}</details>
    <details><summary>定价依据与调整</summary><div class="va-text"><ul>${r.reasons.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>${r.comparables.map(c=>`<div class="va-adjust">${escape(e.candidates.find(b=>b.securityId===c.securityId)?.shortName)}：期限 ${c.tenorAdjustmentBp.toFixed(2)} bp，市场 ${c.marketAdjustmentBp.toFixed(2)} bp${adjustmentEvidenceText(c,e,t)}</div>`).join('')}${r.limitations.length ? `<ul>${r.limitations.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>`:''}<div>${run.result.promptVersion === 'valuation-evidence-1' ? '已核验调整证据与计算；选券判断仍需复核，范围仅表示采用券的折算分歧。' : '历史结果仅核验引用和算术，未通过新版证据核验。'}</div></div></details>
    <details><summary>人工修正与学习</summary><div class="va-text va-feedback" data-target="${r.targetIndex}"><label>我的参考估值（%）<input data-field="yield" type="number" step="0.0001" min="0.0001" max="50" value="${escape(draft?.finalYield ?? r.center ?? '')}" ${pending?'disabled':''}></label><label>修正理由<textarea data-field="reason" rows="2" maxlength="2000" ${pending?'disabled':''} placeholder="说明选券或调整原因，模型会提出待确认经验">${escape(draft?.reason || '')}</textarea></label><button type="button" data-action="feedback" data-index="${r.targetIndex}" ${pending?'disabled':''}>保存修正</button></div></details></article>`;
}
function adjustmentEvidenceText(c,e,t) {
  const original=e.candidates.find(b=>b.securityId===c.securityId), basis=c.tenorBasis;
  if (!basis || !original) return '';
  if (basis.method==='none') return `<div>未做期限折算：原券 ${original.years.toFixed(2)}Y，目标 ${t.years.toFixed(2)}Y</div>`;
  if (basis.method==='curve') return `<div>${escape(e.curve?.name)} · ${escape(e.curve?.date)}：${[original.years,t.years].map(y=>`${y.toFixed(2)}Y ${rate(e.curve?.nodes.find(n=>Math.abs(n.years-y)<1e-8)?.rate)}`).join(' → ')}</div>`;
  return `<div>期限斜率依据：${basis.securityIds.map(id=>{const b=e.candidates.find(b=>b.securityId===id);return b ? `${escape(b.shortName)} ${b.years.toFixed(2)}Y ${rate(b.rate)}` : escape(id);}).join('；')}</div>`;
}
function render() {
  const el = box(); if (!el) return;
  if (!visible) {el.hidden=true; return;}
  el.hidden=false; el.classList.add('va-assistant');
  const canAnalyze = Boolean(target.issuerName && target.shortName && target.durationText && status?.dmConfigured && status?.models?.length);
  el.innerHTML=`<div class="va-header"><strong>实验性估值助手</strong><span>gpt-oss 20B · 试用</span></div><div class="va-actions"><label>研判模型 <select id="vaModel" ${pending?'disabled':''}>${(status?.models || []).map(m=>`<option ${m.name===status?.defaultModel?'selected':''} value="${escape(m.name)}">${escape(m.name)}</option>`).join('')}</select></label><button type="button" data-action="analyze" ${pending||!canAnalyze?'disabled':''}>${pending?'正在处理…':'生成估值'}</button><button type="button" data-action="history" ${pending?'disabled':''}>记录与经验</button></div>
  ${!status?.dmConfigured ? '<div class="va-notice">实验服务尚未连接，原估值助手可继续使用。</div>' : ''}
  ${status?.dmConfigured && !status?.models?.length ? '<div class="va-notice">本地模型未就绪，请启动模型服务后重新打开助手。</div>' : ''}
  <div class="va-message" role="status" aria-live="polite">${escape(message)}</div>
  ${run ? `<div class="va-run-meta">${escape(run.evidence.target.shortName)} · ${escape(run.model)} · ${escape(new Date(run.createdAt).toLocaleString('zh-CN'))}${run.evidence.sample?' · 演示':''}</div>${run.status==='complete' ? run.result.output.results.map(resultCard).join('') : `<div class="va-notice">${escape(run.error || '记录未完成')}</div>`}<details><summary>本次采用的经验（${run.learning.experiences.length}）</summary><div class="va-text">${run.learning.experiences.map(e=>`<p>${escape(e.text)}</p>`).join('') || '未采用历史经验'}${run.learning.reviewRequired ? `<div>有 ${run.learning.reviewRequired} 条旧经验待复核，本次未采用。</div>` : ''}<div>经验范围：同主体、品种、市场、发行方式及期限结构。</div></div></details>`:''}
  <div id="vaHistory"></div>`;
  el.onclick = onClick;
}
function renderHistory() {
  const area = document.getElementById('vaHistory'); if (!area) return;
  area.innerHTML=`<details open><summary>估值记录</summary><div class="va-text">${history.runs.map(r=>`<button type="button" class="va-history-row" data-action="load" data-id="${r.id}">${escape(r.shortName)} · ${escape(r.status)}${r.sample?' · 演示':''} · ${escape(new Date(r.createdAt).toLocaleString('zh-CN'))}</button>`).join('') || '暂无记录'}</div></details><details open><summary>待确认与已保存经验</summary><div class="va-text">${history.experiences.map(e=>`<div class="va-experience" data-id="${e.id}"><div>${escape(e.issuerName)}${e.sample?' · 演示':''} · ${e.status==='confirmed' && e.learningVersion!==2 ? '旧经验待复核（暂不采用）' : {pending:'待确认',confirmed:'已确认',disabled:'已停用'}[e.status]}</div>${e.feedbackReason ? `<div>原始反馈：${escape(e.feedbackReason)}</div>` : ''}<textarea rows="3" maxlength="1000" ${pending?'disabled':''}>${escape(e.text)}</textarea><div class="va-actions"><button type="button" data-action="confirm" data-id="${e.id}" ${pending?'disabled':''}>${e.status==='confirmed'?'保存修改并确认':'确认采用'}</button><button type="button" data-action="disable" data-id="${e.id}" ${pending||e.status==='disabled'?'disabled':''}>${e.status==='pending'?'不采用':'停用'}</button></div></div>`).join('') || '暂无经验'}</div></details>`;
}
async function onClick(event) {
  const button=event.target.closest('button[data-action]'); if (!button || pending) return;
  const action=button.dataset.action;
  if (['history','load','confirm','disable'].includes(action)) {
    button.disabled=true;
    try {
      if (action==='load') { const loadGeneration=++generation; const loaded=(await request(`runs/${button.dataset.id}`)).run; if(generation!==loadGeneration || !visible) return; run=loaded; message='已打开历史记录'; render(); return; }
      if (action==='confirm'||action==='disable') {
        const item=history.experiences.find(e=>e.id===button.dataset.id);
        const text=button.closest('.va-experience').querySelector('textarea').value;
        await request('experience',{id:item.id, revision:item.revision,text,status:action==='confirm'?'confirmed':'disabled'});
      }
      history=await request('history'); renderHistory();
    } catch(e) { message=e.message; render(); } finally {button.disabled=false;}
    return;
  }
  const model=document.getElementById('vaModel')?.value;
  const currentGeneration=generation;
  let payload;
  if (action==='feedback') {
    const form=button.closest('.va-feedback');
    payload={runId:run.id,targetIndex:Number(button.dataset.index),finalYield:Number(form.querySelector('[data-field="yield"]').value),reason:form.querySelector('textarea').value};
    drafts.set(`${run.id}:${payload.targetIndex}`,payload);
  } else payload={sample:action==='sample',target,model};
  pending=true; message=action==='feedback'?'保存修正并生成待确认经验…':'正在读取材料并调用本地模型，结果会进行引用和算术核验…'; render();
  try {
    const p=await request(action==='feedback'?'feedback':'analyze',payload);
    if (generation!==currentGeneration) {message='原输入的处理已完成并保存，请在记录中查看；当前输入需要重新估值。';}
    else if (action==='feedback') {message=p.proposalError || (p.experience?'修正已保存，请核对并确认经验。':'修正已保存。');}
    else {run=p.run; message=`研判完成 · ${run.result.attempts} 次调用 · 采用 ${run.learning.experiences.length} 条已确认经验`;}
  } catch(e) {message=e.message;} finally {pending=false;render();}
  if(action==='feedback') {try {history=await request('history');renderHistory();}catch{}}
}
