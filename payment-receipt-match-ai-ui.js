const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Mount once on the existing toolbar. Rendering/navigation never requests AI. */
export function createPaymentReceiptMatchAiController({ container, getReceipt, getHeaders = () => ({}),
  fetchImpl = (...args) => fetch(...args), onSelectCandidate = () => {}, onNotice = () => {} } = {}) {
  if (!container?.addEventListener || typeof getReceipt !== 'function') throw new Error('智能推荐工具栏配置无效。');
  const states = new Map();
  let disposed = false;
  const current = (id, state) => !disposed && states.get(id) === state && getReceipt(id)?.updatedAt === state.updatedAt;

  function render(receipt) {
    if (!receipt?.id || !receipt.updatedAt || ['duplicate', 'error'].includes(receipt.matchStatus)) return '';
    let state = states.get(receipt.id);
    if (state && state.updatedAt !== receipt.updatedAt) {
      state.controller?.abort(); states.delete(receipt.id); state = null;
    }
    return `<section class="payment-receipt-match-ai" data-receipt-match-ai="${escape(receipt.id)}" aria-label="项目对应智能推荐">
      <button type="button" class="text-button" data-match-ai-action="toggle" aria-expanded="${Boolean(state?.expanded)}">智能推荐${state?.expanded ? ' ▴' : ' ▾'}</button>
      <div data-match-ai-content ${state?.expanded ? '' : 'hidden'} aria-live="polite">${content(state)}</div>
    </section>`;
  }
  function sync(id) {
    for (const section of container.querySelectorAll?.('[data-receipt-match-ai]') || []) {
      if (section.dataset.receiptMatchAi !== id) continue;
      const state = states.get(id), body = section.querySelector('[data-match-ai-content]');
      const toggle = section.querySelector('[data-match-ai-action="toggle"]');
      if (body) { body.hidden = !state?.expanded; body.innerHTML = content(state); }
      if (toggle) { toggle.setAttribute('aria-expanded', String(Boolean(state?.expanded))); toggle.textContent = state?.expanded ? '智能推荐 ▴' : '智能推荐 ▾'; }
    }
  }
  async function request(id, state) {
    if (state.controller || !current(id, state)) return;
    const controller = new AbortController();
    state.controller = controller; state.status = 'loading'; state.error = ''; sync(id);
    try {
      const response = await fetchImpl(`./api/payment-receipts/${encodeURIComponent(id)}/match-review`, {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...getHeaders() }, body: JSON.stringify({ expectedUpdatedAt: state.updatedAt }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!current(id, state)) return;
      if (!response.ok) throw new Error(String(payload.error || '智能推荐暂时不可用，请稍后重试。').slice(0, 400));
      if (payload.receiptId !== id || payload.expectedUpdatedAt !== state.updatedAt || !Array.isArray(payload.recommendations)
          || payload.recommendations.length > 3 || !Array.isArray(payload.warnings)) throw new Error('推荐结果不完整，请重试。');
      state.result = payload; state.status = 'ready';
    } catch (error) {
      if (!current(id, state)) return;
      state.status = 'error'; state.result = null;
      state.error = error?.name === 'AbortError' ? '智能推荐已中断，请重试。' : error.message || '智能推荐暂时不可用。';
    } finally {
      if (current(id, state)) { state.controller = null; sync(id); }
    }
  }
  async function click(event) {
    const button = event.target?.closest?.('[data-match-ai-action]');
    const section = button?.closest?.('[data-receipt-match-ai]');
    if (!button || !section || !container.contains(section)) return;
    const id = section.dataset.receiptMatchAi, receipt = getReceipt(id);
    if (!receipt || !receipt.updatedAt) return;
    let state = states.get(id);
    if (!state || state.updatedAt !== receipt.updatedAt) {
      state?.controller?.abort();
      state = { updatedAt: receipt.updatedAt, expanded: false, status: 'idle', result: null, controller: null, error: '' };
      states.set(id, state);
    }
    if (button.dataset.matchAiAction === 'toggle') {
      state.expanded = !state.expanded; sync(id);
      if (state.expanded && state.status === 'idle') await request(id, state);
    } else if (button.dataset.matchAiAction === 'retry') {
      await request(id, state);
    } else if (button.dataset.matchAiAction === 'select') {
      if (!current(id, state) || state.status !== 'ready') return;
      const candidate = state.result.recommendations[Number(button.dataset.matchAiIndex)];
      if (!candidate?.projectId || !candidate?.trancheId) return;
      try {
        const selected = await onSelectCandidate({ receiptId: id, projectId: candidate.projectId, trancheId: candidate.trancheId,
          expectedUpdatedAt: state.updatedAt, inputFingerprint: state.result.inputFingerprint });
        if (selected !== false) onNotice('已选入对应栏，请核对后点击“确认对应”。');
      } catch { onNotice('项目资料已变化，请刷新后重新选择。'); }
    }
  }
  function clear() { const ids = [...states.keys()]; for (const state of states.values()) state.controller?.abort(); states.clear(); for (const id of ids) sync(id); }
  container.addEventListener('click', click);
  return { render, sync, clear, dispose() { disposed = true; clear(); container.removeEventListener('click', click); } };
}

function content(state) {
  if (!state || state.status === 'idle') return '';
  if (state.status === 'loading') return '<p class="payment-receipt-meta" role="status">正在核对候选项目…</p>';
  if (state.status === 'error') return `<p class="payment-receipt-error">${escape(state.error)}</p><button type="button" class="text-button" data-match-ai-action="retry">重试推荐</button>`;
  const result = state.result;
  return `<p class="payment-receipt-meta">以下仅为核对建议，选择后仍需人工确认对应。</p>
    ${(result?.recommendations || []).map((item, index) => `<article class="payment-receipt-match-ai-item">
      <strong>${escape(item.shortName || '待核对品种')}</strong><span class="payment-receipt-meta">${escape(item.paymentDate || '')} · ${item.paymentCompleted ? '已缴款' : '未缴款'}</span>
      <p>${escape(item.reason)}</p>
      <ul>${(Array.isArray(item.evidence) ? item.evidence : []).slice(0, 6).map(evidence => `<li>单据${escape(evidence.receiptLabel)}「${escape(evidence.receiptQuote)}」 · 项目${escape(evidence.candidateLabel)}「${escape(evidence.candidateQuote)}」</li>`).join('')}</ul>
      <button type="button" class="button subtle" data-match-ai-action="select" data-match-ai-index="${index}">选入对应栏</button>
    </article>`).join('')}
    ${!result?.recommendations?.length ? '<p class="payment-receipt-meta">暂无足够可靠的推荐，可继续手动核对。</p>' : ''}
    ${(result?.warnings || []).slice(0, 8).map(value => `<p class="payment-receipt-name-warning">${escape(value)}</p>`).join('')}`;
}
