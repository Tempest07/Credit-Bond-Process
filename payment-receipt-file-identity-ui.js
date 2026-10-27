const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const abortError = () => Object.assign(new Error('已取消整份文件复核。'), { name: 'AbortError' });
const failure = message => Object.assign(new Error(message), { publicMessage: message });

/** A file review adopts clear readings, with one cloud-backed undo for the run. */
export function createPaymentReceiptFileIdentityReview({ container, getContext, getHeaders = () => ({}),
  onResult = () => {}, onUndo = () => {}, onStateChange = () => {}, onNotice = () => {}, fetchImpl = (...args) => fetch(...args),
  reviewIdFactory = () => crypto.randomUUID(),
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
    const complete = state?.message === '整份文件复核完成。';
    let message = busy ? state.mode === 'undo' ? '撤销中…' : state.total ? `复核 ${state.completed}/${state.total}` : '准备中…'
      : complete ? state.updated ? `已更新 ${state.updated} 条` : '无需更新' : state?.message || '';
    if (complete && state.manual) message += ` · 待核对 ${state.manual} 条`;
    return `<button type="button" class="button subtle" aria-label="${busy ? state.mode==='undo'?'正在撤销更新':'停止复核' : '复核整份文件简称'}" data-file-identity-action="${busy ? 'cancel' : 'review'}" ${busy&&state.mode==='undo'||!busy&&getContext()?.blocked?'disabled':''}>${busy ? state.mode==='undo'?'撤销中…':'停止' : '整份复核'}</button>
      <span class="payment-receipt-file-identity-status" role="status" aria-live="polite">${escape(message)}</span>
      ${state?.undoFileReviewId?`<button type="button" class="button subtle payment-receipt-identity-undo" aria-label="撤销本次更新" data-file-identity-action="undo" ${busy||getContext()?.blocked?'disabled':''}>撤销</button>`:''}`;
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
    state.controller.abort(); state.busy = false; state.message = '已暂停，已完成的更新保留，可撤销。';
    if (notify) sync(state.fileId);
  }
  function render(receipt) {
    if (active && (active.fileId !== receipt?.fileId || !current(active))) cancel({ notify: false });
    if (!receipt?.fileId || disposed) return '';
    return `<div class="payment-receipt-file-identity" data-file-identity="${escape(receipt.fileId)}">${controls(states.get(receipt.fileId))}</div>`;
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
    const previousUndo=states.get(fileId)?.undoFileReviewId||'';
    const fileReviewId=reviewIdFactory();
    if(typeof fileReviewId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(fileReviewId))throw new Error('文件复核编号无效。');
    const state = { fileId,fileReviewId,undoFileReviewId:previousUndo,generation: ++generation, controller: new AbortController(), busy: true,mode:'review',
      total: 0, completed: 0, updated: 0, unchanged:0, manual: 0, message: '', fileUpdatedAt: '' };
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
        let payload = await requestJson(`./api/payment-receipts/${encodeURIComponent(receipt.id)}/identity-review`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...getHeaders() },
          body: JSON.stringify({ action: 'preview', reuse: true }),
        }, state.controller.signal);
        if (!current(state)) return;
        const proposal = payload?.proposal || payload?.identityReview || payload?.receipt?.identityReview;
        if (!['verified', 'unavailable', 'conflict'].includes(proposal?.status)
          || proposal.status === 'verified' && (typeof payload.reviewId !== 'string' || !payload.reviewId)
          || payload.receipt && payload.receipt.id !== receipt.id) throw failure('复核结果不完整，本次已暂停，请稍后继续。');
        let stage='preview';
        if(proposal.status==='verified'&&payload.receipt?.identityReview?.status==='verified'){
          state.unchanged++;stage='retained';
        }else if(proposal.status==='verified'){
          // Keep the run id before sending: a cancelled response may still have
          // committed. Undo also closes this run against any late applications.
          const priorUndo=state.undoFileReviewId;state.undoFileReviewId=fileReviewId;
          try{
            payload=await requestJson(`./api/payment-receipts/${encodeURIComponent(receipt.id)}/identity-review`,{
              method:'POST',headers:{'Content-Type':'application/json',...getHeaders()},body:JSON.stringify({action:'apply',reviewId:payload.reviewId,fileReviewId}),
            },state.controller.signal);
            if(!current(state))return;
            if(typeof payload.changed!=='boolean'||payload.receipt?.id!==receipt.id||payload.receipt.identityReview?.status!=='verified')throw failure('更新结果不完整，请刷新核对或撤销本次更新。');
            if(payload.changed)state.updated++;
            else{state.unchanged++;if(!state.updated)state.undoFileReviewId=priorUndo;}
            stage='apply';
          }catch(error){
            if(!current(state))return;
            if(![404,409].includes(error.status))throw error;
            state.manual++;if(!state.updated)state.undoFileReviewId=priorUndo;
            payload={proposal:{status:'conflict',name:'',reason:'source_changed'}};
          }
        }else state.manual++;
        onResult({ fileId, fileUpdatedAt: state.fileUpdatedAt, receiptId: receipt.id, payload,stage });
        if (!current(state)) return;
        state.completed++;
        sync(fileId);
        if (proposal.reason === 'ai_unavailable') throw failure('简称复核暂时不可用，本次已暂停，请稍后继续。');
      }
      state.message = '整份文件复核完成。';
      onNotice(state.manual ? `已更新 ${state.updated} 条 · 待核对 ${state.manual} 条` : state.updated ? `已更新 ${state.updated} 条简称` : '简称无变化');
    } catch (error) {
      if (current(state)) state.message = error?.name === 'AbortError' ? '已暂停，已完成的更新保留，可撤销。'
        : error?.name === 'TimeoutError' ? '复核请求超时，本次已暂停，请稍后继续。'
          : error?.publicMessage || '整份文件复核暂时不可用，请稍后继续。';
    } finally {
      if (active === state) { state.busy = false; active = null; sync(fileId); }
    }
  }
  async function undo(fileId=getContext()?.fileId){
    if(disposed||active?.busy||getContext()?.fileId!==fileId||getContext()?.blocked)return;
    const previous=states.get(fileId);if(!previous?.undoFileReviewId)return;
    const fileReviewId=previous.undoFileReviewId;
    const state={...previous,generation:++generation,controller:new AbortController(),busy:true,mode:'undo',fileUpdatedAt:getContext()?.fileUpdatedAt||previous.fileUpdatedAt};
    states.set(fileId,state);active=state;sync(fileId);
    try{
      const payload=await requestJson(`./api/payment-receipt-files/${encodeURIComponent(fileId)}/identity-review-undo`,{
        method:'POST',headers:{'Content-Type':'application/json',...getHeaders()},body:JSON.stringify({fileReviewId}),
      },state.controller.signal);
      if(!current(state))return;
      if(!Array.isArray(payload.receipts)||!Number.isInteger(payload.restoredCount)||!Number.isInteger(payload.skippedCount))throw failure('撤销结果不完整，请刷新核对。');
      onUndo({fileId,payload});state.undoFileReviewId='';state.undone=true;
      state.message=`已撤销 ${payload.restoredCount} 条更新${payload.skippedCount?`；${payload.skippedCount} 条已有后续修改，已保留`:''}。`;
      onNotice(state.message);
    }catch(error){if(current(state))state.message=error.publicMessage||'撤销暂未完成，请稍后重试。';}
    finally{if(active===state){state.busy=false;active=null;sync(fileId);}}
  }
  function click(event) {
    const button = event.target?.closest?.('[data-file-identity-action]');
    const section = button?.closest?.('[data-file-identity]');
    if (!button || !section || !container.contains(section)) return;
    const fileId = section.dataset.fileIdentity;
    if (getContext()?.fileId !== fileId) return;
    if (button.dataset.fileIdentityAction === 'cancel') cancel();
    else if (button.dataset.fileIdentityAction === 'review') void review(fileId);
    else if (button.dataset.fileIdentityAction === 'undo') void undo(fileId);
  }
  function clear() { cancel({ notify: false }); states.clear(); }
  container.addEventListener('click', click);
  return { render, sync, review, undo, cancel, clear, isBusy: fileId => Boolean(active?.busy && active.fileId === fileId),
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
