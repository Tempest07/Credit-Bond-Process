const REBUILD_URL = './api/payment-receipt-rebuild';
const TERMINAL = new Set(['completed', 'completed_with_errors', 'complete', 'finished', 'failed', 'partial']);

export function receiptRebuildActive(job) {
  return Boolean(job?.id && (!TERMINAL.has(job.status) || job.finalized === false));
}

export function receiptRebuildProgress(job = {}) {
  const total = Math.max(0, Number(job.totalFiles) || 0);
  const complete = Math.max(0, Number(job.completedFiles) || 0);
  const failed = Math.max(0, Number(job.failedFiles) || 0);
  const pages = Math.max(0, Number(job.completedPages) || 0);
  const pageTotal = Math.max(0, Number(job.totalPages) || 0);
  const current = (job.files || []).find(file => ['processing', 'regrouping'].includes(file.status))
    || (job.files || []).find(file => ['received', 'queued', 'reprocess_requested'].includes(file.status));
  const active = receiptRebuildActive(job);
  const percent = total ? Math.min(active ? 99 : 100, Math.round((complete + failed) / total * 100)) : 0;
  const title = active ? `正在整理 ${complete + failed} / ${total} 份文件` : failed ? `已完成 · ${failed} 份需重试` : '整理完成';
  const counts = [Number.isFinite(Number(job.receiptCount)) ? `${job.receiptCount} 张单据` : '',
    Number.isFinite(Number(job.matchedCount)) ? `${job.matchedCount} 张已对应` : '',
    Number(job.reviewCount) ? `${job.reviewCount} 张待核对` : ''].filter(Boolean).join(' · ');
  return { active, percent, title, detail: job.finalizing ? '正在对应项目并整理重复件' : active
    ? [current?.filename, pageTotal ? `${pages} / ${pageTotal} 页` : pages ? `已读取 ${pages} 页` : '正在准备原件'].filter(Boolean).join(' · ')
    : counts, total, complete, failed };
}

// A single controller keeps selection and background progress separate from the
// PDF reader, so a progress tick never reconstructs the selected preview.
export function createPaymentReceiptWorkspace({ root, getReceipts, getVisibleReceipts,
  getSelectedReceipt, getHeaders, onMutation, onRefresh, onToast, fetch: fetcher = globalThis.fetch,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  const selected = new Set();
  let selecting = false, deleting = false, requesting = false, job = null, requestError = '';
  let deletingTotal = 0, deletingComplete = 0, rebuildController = null, deleteController = null;
  let timer = null, controller = null, generation = 0, lastCompleted = '', disposed = false;
  const query = selector => root?.querySelector(selector);
  const queryAll = selector => [...(root?.querySelectorAll(selector) || [])];
  const headers = () => ({ 'Content-Type': 'application/json', ...getHeaders?.() });

  function render() {
    const available = new Set((getReceipts?.() || []).map(receipt => receipt.id));
    for (const id of selected) if (!available.has(id)) selected.delete(id);
    root?.classList.toggle('is-receipt-selecting', selecting);
    const manage = query('[data-receipt-manage]');
    if (manage) { manage.textContent = selecting ? '完成' : '批量管理'; manage.setAttribute('aria-pressed', String(selecting)); }
    const selection = query('[data-receipt-selection-bar]');
    if (selection) selection.hidden = !selecting;
    const count = query('[data-receipt-selection-count]');
    if (count) count.textContent = deleting ? `正在删除 ${deletingComplete} / ${deletingTotal} 张…` : `已选 ${selected.size} 张`;
    for (const checkbox of queryAll('[data-receipt-select]')) {
      checkbox.checked = selected.has(checkbox.dataset.receiptSelect);
      checkbox.disabled = deleting;
    }
    for (const button of queryAll('[data-receipt-delete-selected], [data-receipt-clear-selection]')) button.disabled = deleting || requesting || !selected.size;
    const start = query('[data-receipt-rebuild-all]');
    if (start) { start.disabled = requesting || deleting || receiptRebuildActive(job); start.textContent = requesting ? '正在提交…' : receiptRebuildActive(job) ? '整理中…' : '重新整理全部'; }
    const panel = query('[data-receipt-job]');
    if (!panel) return;
    panel.hidden = !job && !requesting && !requestError;
    if (requesting || requestError) {
      panel.classList.toggle('is-running', requesting);
      panel.setAttribute('aria-busy', String(requesting));
      const title = query('[data-receipt-job-title]'); if (title) title.textContent = requesting ? '正在提交整理任务…' : '提交失败';
      const detail = query('[data-receipt-job-detail]'); if (detail) detail.textContent = requesting ? '正在准备原件' : requestError;
      const bar = query('[data-receipt-job-progress]'); if (bar) { bar.value = 0; bar.max = 100; }
      return;
    }
    if (!job) return;
    const progress = receiptRebuildProgress(job);
    panel.classList.toggle('is-running', progress.active);
    panel.setAttribute('aria-busy', String(progress.active));
    const title = query('[data-receipt-job-title]'); if (title) title.textContent = progress.title;
    const detail = query('[data-receipt-job-detail]'); if (detail) detail.textContent = progress.detail;
    const bar = query('[data-receipt-job-progress]'); if (bar) { bar.value = progress.percent; bar.max = 100; }
  }

  async function read(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function mutationRequest(url, input, request) {
    const timeout = setTimer(() => request.abort(), 30000);
    try {
      return await read(await fetcher(url, { method: 'POST', credentials: 'same-origin', headers: headers(),
        body: JSON.stringify(input), signal: request.signal }));
    } finally { clearTimer(timeout); }
  }

  function schedule() {
    clearTimer(timer);
    if (!disposed && receiptRebuildActive(job)) timer = setTimer(() => { void refreshJob(); }, 4000);
  }

  async function refreshJob() {
    if (disposed || controller) return;
    const version = generation;
    const request = controller = new AbortController();
    const timeout = setTimer(() => request.abort(), 20000);
    try {
      const payload = await read(await fetcher(REBUILD_URL + (job?.id ? `?id=${encodeURIComponent(job.id)}` : ''),
        { credentials: 'same-origin', cache: 'no-store', headers: getHeaders?.(), signal: request.signal }));
      if (disposed || version !== generation) return;
      job = payload.rebuild || null;
      requestError = '';
      render();
      const complete = job ? `${job.id}:${job.completedFiles}:${job.failedFiles}:${job.status}:${job.finalized ?? ''}` : '';
      if (lastCompleted && complete !== lastCompleted) void onRefresh?.();
      lastCompleted = complete;
    } catch (error) {
      if (!disposed && version === generation) {
        const detail = query('[data-receipt-job-detail]');
        if (detail && job) detail.textContent = '进度暂未更新，正在重连…';
      }
    } finally {
      clearTimer(timeout);
      if (controller === request) controller = null;
      if (version === generation) schedule();
    }
  }

  async function rebuild(input) {
    if (disposed || requesting || deleting) return;
    if (receiptRebuildActive(job)) { render(); onToast?.('正在整理中，请查看处理进度。'); return; }
    requesting = true; requestError = ''; render();
    const version = ++generation;
    controller?.abort(); controller = null;
    clearTimer(timer);
    const request = rebuildController = new AbortController();
    try {
      const payload = await mutationRequest(REBUILD_URL, input, request);
      if (disposed || version !== generation) return;
      job = payload.rebuild;
      lastCompleted = job ? `${job.id}:${job.completedFiles}:${job.failedFiles}:${job.status}:${job.finalized ?? ''}` : '';
      onToast?.('已开始整理，可继续查看项目。');
      void onRefresh?.();
    } catch (error) {
      if (!disposed && version === generation) {
        requestError = error.name === 'AbortError' ? '请求超时，请刷新查看任务状态。' : error.message;
        onToast?.(`提交失败：${requestError}`);
      }
    } finally {
      if (rebuildController === request) rebuildController = null;
      if (!disposed && version === generation) { requesting = false; render(); schedule(); }
    }
  }

  const rebuildAll = () => rebuild({ all: true });
  function rebuildFiles(fileIds) {
    const ids = [...new Set((Array.isArray(fileIds) ? fileIds : []).map(String).filter(Boolean))];
    if (!ids.length) return Promise.resolve();
    return rebuild({ fileIds: ids });
  }

  async function deleteReceipts(ids) {
    const receiptIds = [...new Set(ids)].filter(id => (getReceipts?.() || []).some(receipt => receipt.id === id));
    if (disposed || deleting || requesting || !receiptIds.length) return;
    // The user chooses the actual rows; the server never guesses duplicates.
    if (!globalThis.confirm(`删除选中的 ${receiptIds.length} 张缴款单？`)) return;
    deleting = true; deletingTotal = receiptIds.length; deletingComplete = 0; render();
    const version = generation;
    const request = deleteController = new AbortController();
    let removed = 0;
    try {
      for (let offset = 0; offset < receiptIds.length; offset += 100) {
        const payload = await mutationRequest('./api/payment-receipts/batch-delete', { receiptIds: receiptIds.slice(offset, offset + 100) }, request);
        if (disposed || version !== generation) return;
        const deleted = payload.receiptIds || [];
        deleted.forEach(id => selected.delete(id));
        removed += deleted.length;
        deletingComplete = removed;
        onMutation?.({ removedReceiptIds: deleted });
        render();
      }
      onToast?.(`已删除 ${removed} 张单据。`);
    } catch (error) {
      if (!disposed && version === generation) {
        onToast?.(`${removed ? `已删除 ${removed} 张；` : ''}删除失败：${error.name === 'AbortError' ? '请求超时，请刷新确认' : error.message}`);
        void onRefresh?.();
      }
    } finally {
      if (deleteController === request) deleteController = null;
      if (!disposed && version === generation) { deleting = false; render(); }
    }
  }

  function onClick(event) {
    if (event.target.closest('[data-receipt-manage]')) { selecting = !selecting; if (!selecting) selected.clear(); render(); }
    if (event.target.closest('[data-receipt-select-visible]')) { for (const receipt of getVisibleReceipts?.() || []) selected.add(receipt.id); render(); }
    if (event.target.closest('[data-receipt-select-file]')) {
      const fileId = getSelectedReceipt?.()?.fileId;
      for (const receipt of getReceipts?.() || []) if (fileId && receipt.fileId === fileId) selected.add(receipt.id);
      render();
    }
    if (event.target.closest('[data-receipt-clear-selection]')) { selected.clear(); render(); }
    if (event.target.closest('[data-receipt-delete-selected]')) void deleteReceipts([...selected]);
    if (event.target.closest('[data-receipt-rebuild-all]')) void rebuildAll();
  }
  function onChange(event) {
    const id = event.target.dataset?.receiptSelect;
    if (!id || deleting) return;
    if (event.target.checked) selected.add(id); else selected.delete(id);
    render();
  }
  root?.addEventListener('click', onClick);
  root?.addEventListener('change', onChange);
  return { render, refreshJob, rebuildAll, rebuildFiles, deleteReceipts,
    reset() { generation++; controller?.abort(); controller = null; rebuildController?.abort(); rebuildController = null; deleteController?.abort(); deleteController = null;
      clearTimer(timer); selected.clear(); selecting = false; deleting = false; requesting = false; job = null; requestError = ''; lastCompleted = ''; render(); },
    destroy() { disposed = true; generation++; controller?.abort(); rebuildController?.abort(); deleteController?.abort(); clearTimer(timer); root?.removeEventListener('click', onClick); root?.removeEventListener('change', onChange); },
  };
}
