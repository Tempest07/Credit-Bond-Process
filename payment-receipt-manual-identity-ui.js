const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stopped = () => Object.assign(new Error('简称编辑已取消。'), { name: 'AbortError' });

/** Saves separate manual name evidence; raw OCR and project correspondence remain server-owned. */
export function createPaymentReceiptManualIdentityEdit({ container, getReceipt, isBlocked = () => false, getHeaders = () => ({}),
  onSaved = () => {}, onStateChange = () => {}, onNotice = () => {}, fetchImpl = (...args) => fetch(...args), requestTimeoutMs = 30000 } = {}) {
  if (!container?.addEventListener || typeof getReceipt !== 'function') throw new Error('人工简称编辑入口配置无效。');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120000) throw new Error('编辑超时配置无效。');
  const states = new Map();
  let selectedId = '', disposed = false;
  const current = (id, state) => !disposed && selectedId === id && states.get(id) === state
    && getReceipt(id)?.fileId === state.fileId && getReceipt(id)?.updatedAt === state.updatedAt
    && getReceipt(id)?.fileUpdatedAt === state.fileUpdatedAt
    && String(getReceipt(id)?.identityReview?.reviewId || '') === state.identityReviewId;

  function cancel(id = selectedId, notify = true) {
    const state = states.get(id); if (!state) return;
    state.controller?.abort(); states.delete(id);
    if (notify) sync(id);
  }
  function select(id) {
    if (selectedId && selectedId !== id) cancel(selectedId, false);
    selectedId = id || '';
    const state = states.get(selectedId);
    if (state && !current(selectedId, state)) cancel(selectedId, false);
  }
  function content(receipt) {
    const state = states.get(receipt.id), blocked = isBlocked(receipt.fileId);
    if (!state?.editing) return `<button type="button" class="button subtle" aria-label="人工修改简称" data-manual-identity-action="edit" ${blocked ? 'disabled' : ''}>修改</button>`;
    return `<span class="payment-receipt-manual-identity-editor"><input type="text" class="payment-receipt-manual-identity-input" data-manual-identity-name aria-label="债券简称" maxlength="100" autocomplete="off" value="${escape(state.name)}" ${state.saving ? 'disabled' : ''}>
      <button type="button" class="button primary" data-manual-identity-action="save" ${state.saving || blocked ? 'disabled' : ''}>${state.saving ? '保存中…' : '保存'}</button>
      <button type="button" class="button subtle" data-manual-identity-action="cancel">取消</button>
      <span class="payment-receipt-identity-error" data-manual-identity-error role="status" aria-live="polite">${escape(state.error)}</span></span>`;
  }
  function render(receipt) {
    if (disposed) return '';
    select(receipt?.id || '');
    if (!receipt?.id || !receipt.fileId || !receipt.updatedAt) return '';
    return `<span class="payment-receipt-manual-identity" data-manual-identity="${escape(receipt.id)}">${content(receipt)}</span>`;
  }
  function sync(id = selectedId) {
    if (disposed) return;
    select(id);
    const receipt = getReceipt(selectedId);
    if (receipt) {
      for (const element of container.querySelectorAll?.('[data-manual-identity]') || []) {
        if (element.dataset.manualIdentity === receipt.id) element.innerHTML = content(receipt);
      }
      onStateChange(receipt.id);
    }
  }
  function focus(id) {
    for (const element of container.querySelectorAll?.('[data-manual-identity]') || []) {
      if (element.dataset.manualIdentity !== id) continue;
      const input = element.querySelector?.('[data-manual-identity-name]'); input?.focus?.(); input?.select?.();
    }
  }
  function edit(id = selectedId) {
    const receipt = getReceipt(id);
    if (disposed || selectedId !== id || !receipt?.fileId || !receipt.updatedAt || isBlocked(receipt.fileId)) return;
    if (states.get(id)?.saving) return;
    states.set(id, { fileId: receipt.fileId, updatedAt: receipt.updatedAt, fileUpdatedAt: receipt.fileUpdatedAt,
      identityReviewId: String(receipt.identityReview?.reviewId || ''), name: String(receipt.identityReview?.name || receipt.bondShortName || ''),
      editing: true, saving: false, error: '', controller: null });
    sync(id); focus(id);
  }
  async function save(id = selectedId) {
    const state = states.get(id);
    if (!state?.editing || state.saving || !current(id, state) || isBlocked(state.fileId)) return;
    const name = state.name.trim();
    if (!name || name.length > 100 || /[\r\n]/.test(name)) { state.error = '请输入不超过 100 字的债券简称。'; sync(id); focus(id); return; }
    const controller = new AbortController();
    state.controller = controller; state.saving = true; state.error = ''; sync(id);
    let timer, rejectStopped;
    const deadline = new Promise((_, reject) => { rejectStopped = reject; });
    const onAbort = () => rejectStopped(stopped());
    controller.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { rejectStopped(Object.assign(new Error('保存超时，请稍后重试。'), { name: 'TimeoutError' })); controller.abort(); }, requestTimeoutMs);
    try {
      const { response, payload } = await Promise.race([(async () => {
        const response = await fetchImpl(`./api/payment-receipts/${encodeURIComponent(id)}/identity-review`, {
          method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({ action: 'manual', name, expectedUpdatedAt: state.updatedAt,
            expectedFileUpdatedAt: state.fileUpdatedAt, expectedIdentityReviewId: state.identityReviewId }),
        });
        return { response, payload: await response.json().catch(() => ({})) };
      })(), deadline]);
      if (!current(id, state)) return;
      if (!response.ok) throw Object.assign(new Error('manual-save-failed'), {
        publicMessage: String(payload.error || '保存失败，请稍后重试。').slice(0, 300), status: response.status });
      const identity = payload.identityReview || payload.receipt?.identityReview;
      if (payload.receipt?.id !== id || identity?.status !== 'verified' || identity?.source !== 'manual'
        || typeof identity.name !== 'string' || !identity.name.trim()) throw new Error('manual-save-invalid');
      state.saving = false; state.editing = false; state.controller = null;
      onSaved({ receiptId: id, payload });
      if (selectedId === id) onNotice('已保存人工简称。');
    } catch (error) {
      if (!current(id, state)) return;
      state.error = error?.name === 'TimeoutError' ? '保存超时，请稍后重试。'
        : error?.name === 'AbortError' ? '保存已中断，请重试。' : error.publicMessage || '保存失败，请稍后重试。';
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      if (states.get(id) === state) {
        state.saving = false; state.controller = null;
        if (current(id, state)) sync(id); else cancel(id, false);
      }
    }
  }
  function target(event) {
    const element = event.target?.closest?.('[data-manual-identity]');
    if (!element || !container.contains(element)) return null;
    const id = element.dataset.manualIdentity; return id === selectedId ? { id, element } : null;
  }
  function click(event) {
    const action = event.target?.closest?.('[data-manual-identity-action]')?.dataset.manualIdentityAction;
    const value = target(event); if (!value || !action) return;
    if (action === 'edit') edit(value.id);
    else if (action === 'save') void save(value.id);
    else if (action === 'cancel') cancel(value.id);
  }
  function input(event) {
    if (!event.target?.matches?.('[data-manual-identity-name]')) return;
    const value = target(event), state = value && states.get(value.id);
    if (!state?.editing || state.saving || !current(value.id, state)) return;
    state.name = event.target.value; state.error = '';
    const error = value.element.querySelector?.('[data-manual-identity-error]'); if (error) error.textContent = '';
  }
  function keydown(event) {
    if (!event.target?.matches?.('[data-manual-identity-name]') || event.isComposing || event.keyCode === 229) return;
    const value = target(event); if (!value || !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') void save(value.id); else cancel(value.id);
  }
  function clear() { for (const id of states.keys()) cancel(id, false); states.clear(); selectedId = ''; }
  container.addEventListener('click', click); container.addEventListener('input', input); container.addEventListener('keydown', keydown);
  return { render, sync, edit, save, cancel, clear,
    isBusy: fileId => [...states.values()].some(state => state.fileId === fileId && state.saving),
    isEditing: fileId => [...states.values()].some(state => state.fileId === fileId && state.editing),
    dispose() { clear(); disposed = true; container.removeEventListener('click', click); container.removeEventListener('input', input); container.removeEventListener('keydown', keydown); } };
}
