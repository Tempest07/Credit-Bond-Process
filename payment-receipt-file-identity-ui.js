const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const abortError = () => Object.assign(new Error('已取消整份文件复核。'), { name: 'AbortError' });
const failure = message => Object.assign(new Error(message), { publicMessage: message });

/** Review is explicit, sequential, and suggestion-only. Verified reuse is held by the server. */
export function createPaymentReceiptFileIdentityReview({ container, getContext, getHeaders = () => ({}),
  onResult = () => {}, onStateChange = () => {}, onNotice = () => {}, fetchImpl = (...args) => fetch(...args),
  requestTimeoutMs = 95000 } = {}) {
  if (!container?.addEventListener || typeof getContext !== 'function') throw new Error('整份文件复核入口配置无效。');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120000) throw new Error('复核超时配置无效。');
  const states = new Map();
  let active = null, generation = 0, disposed = false;
  const current = state => !disposed && active === state && state.generation === generation
    && getContext()?.fileId === state.fileId
    && (!getContext()?.fileUpdatedAt || !state.fileUpdatedAt || getContext().fileUpdatedAt === state.fileUpdatedAt);

  function controls(state) {
    const busy = state?.busy;
    let message = '';
    if (state?.total) message = `已复核 ${state.completed}/${state.total} 条 · ${state.verified} 条可核对 · ${state.manual} 条需人工核对`;
    else if (busy) message = '正在读取整份文件的单据…';
    if (state?.message) message += `${message ? '。' : ''}${state.message}`;
    return `<button type="button" class="button subtle" data-file-identity-action="${busy ? 'cancel' : 'review'}" ${!busy && getContext()?.blocked ? 'disabled' : ''}>${busy ? '取消复核' : '复核整份文件简称'}</button><span class="payment-receipt-meta" role="status" aria-live="polite">${escape(message)}</span>`;
  }
  function sync(fileId = getContext()?.fileId) {
    if (active && !current(active)) cancel({ notify: false });
    if (!fileId) return;
    for (const element of container.querySelectorAll?.('[data-file-identity]') || []) {
      if (element.dataset.fileIdentity === fileId) element.innerHTML = controls(states.get(fileId));
    }
    onStateChange(fileId);
  }
  function cancel({ notify = true } = {}) {
    const state = active;
    generation++; active = null;
    if (!state) return;
    state.controller.abort(); state.busy = false; state.message = '已暂停，已完成的复核建议保留。';
    if (notify) sync(state.fileId);
  }
  function render(receipt) {
    if (active && (active.fileId !== receipt?.fileId || !current(active))) cancel({ notify: false });
    if (!receipt?.fileId || disposed) return '';
    return `<span class="payment-receipt-file-identity" data-file-identity="${escape(receipt.fileId)}">${controls(states.get(receipt.fileId))}</span>`;
  }

  async function requestJson(url, init, signal) {
    if (signal.aborted) throw abortError();
    const controller = new AbortController();
    let rejectStopped, timer;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const onAbort = () => { controller.abort(); rejectStopped(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort(); rejectStopped(Object.assign(new Error('复核请求超时，本次已暂停，请稍后继续。'), { name: 'TimeoutError' }));
    }, requestTimeoutMs);
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal, credentials: 'same-origin' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(failure(httpMessage(response.status)), { status: response.status });
        return payload;
      })(), stopped]);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  }

  async function review(fileId = getContext()?.fileId) {
    if (active && !current(active)) cancel({ notify: false });
    if (disposed || !fileId || getContext()?.fileId !== fileId || active?.busy) return;
    if (getContext()?.blocked) { onNotice('请先完成当前简称复核或编辑。'); return; }
    const state = { fileId, generation: ++generation, controller: new AbortController(), busy: true,
      total: 0, completed: 0, verified: 0, manual: 0, message: '', fileUpdatedAt: '' };
    states.set(fileId, state); active = state; sync(fileId);
    try {
      const pages = await requestJson(`./api/payment-receipt-files/${encodeURIComponent(fileId)}/pages`,
        { method: 'GET', cache: 'no-store', headers: getHeaders() }, state.controller.signal);
      if (!current(state)) return;
      const rows = pages?.receipts;
      if (pages?.file?.id !== fileId || !pages.file.updatedAt || !['processed', 'review'].includes(pages.file.processingStatus)
        || !Array.isArray(rows) || rows.length > 60 || rows.some(row => typeof row?.id !== 'string' || !row.id || row.id.length > 200)
        || new Set(rows.map(row => row.id)).size !== rows.length) throw failure('文件单据列表已变化，请刷新后重新复核。');
      state.fileUpdatedAt = pages.file.updatedAt; state.total = rows.length; sync(fileId);
      if (!current(state)) return;
      if (!rows.length) { state.message = '当前文件没有可复核的单据。'; return; }
      for (const receipt of rows) {
        if (!current(state)) return;
        const payload = await requestJson(`./api/payment-receipts/${encodeURIComponent(receipt.id)}/identity-review`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({ action: 'preview', reuse: true }),
        }, state.controller.signal);
        if (!current(state)) return;
        const proposal = payload?.proposal || payload?.identityReview || payload?.receipt?.identityReview;
        if (!['verified', 'unavailable', 'conflict'].includes(proposal?.status)
          || proposal.status === 'verified' && (typeof payload.reviewId !== 'string' || !payload.reviewId)
          || payload.receipt && payload.receipt.id !== receipt.id) throw failure('复核结果不完整，本次已暂停，请稍后继续。');
        onResult({ fileId, fileUpdatedAt: state.fileUpdatedAt, receiptId: receipt.id, payload });
        if (!current(state)) return;
        state.completed++; if (proposal.status === 'verified') state.verified++; else state.manual++;
        sync(fileId);
        if (proposal.reason === 'ai_unavailable') throw failure('简称复核暂时不可用，本次已暂停，请稍后继续。');
      }
      state.message = '整份文件复核完成，建议仍需逐条核对后采用。';
      onNotice('整份文件简称复核完成，请核对后采用建议。');
    } catch (error) {
      if (current(state)) state.message = error?.name === 'AbortError' ? '已暂停，已完成的复核建议保留。'
        : error?.name === 'TimeoutError' ? '复核请求超时，本次已暂停，请稍后继续。'
          : error?.publicMessage || '整份文件复核暂时不可用，请稍后继续。';
    } finally {
      if (active === state) { state.busy = false; active = null; sync(fileId); }
    }
  }
  function click(event) {
    const button = event.target?.closest?.('[data-file-identity-action]');
    const section = button?.closest?.('[data-file-identity]');
    if (!button || !section || !container.contains(section)) return;
    const fileId = section.dataset.fileIdentity;
    if (getContext()?.fileId !== fileId) return;
    if (button.dataset.fileIdentityAction === 'cancel') cancel();
    else if (button.dataset.fileIdentityAction === 'review') void review(fileId);
  }
  function clear() { cancel({ notify: false }); states.clear(); }
  container.addEventListener('click', click);
  return { render, sync, review, cancel, clear, isBusy: fileId => Boolean(active?.busy && active.fileId === fileId),
    dispose() { clear(); disposed = true; container.removeEventListener('click', click); } };
}

function httpMessage(status) {
  if (status === 401) return '登录已失效，本次复核已暂停，请重新登录。';
  if (status === 403) return '本次复核已暂停，请刷新后重试。';
  if (status === 429) return '复核请求过于频繁，本次已暂停，请稍后继续。';
  if ([408, 504].includes(status)) return '复核请求超时，本次已暂停，请稍后继续。';
  if ([404, 409].includes(status)) return '文件或单据状态已变化，本次已暂停，请刷新后重试。';
  return '简称复核暂时不可用，本次已暂停，请稍后继续。';
}
