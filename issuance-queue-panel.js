import { createQueuePanelMorph } from "./issuance-queue-morph.js?v=20260916-release-5200";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const finished = status => status === "ready" || status === "review";

export function queuePanelView(tasks) {
  let waiting = 0;
  const running = tasks.filter(task => ["queued", "processing"].includes(task.status)).length;
  const review = tasks.filter(task => finished(task.status)).length;
  const errors = tasks.filter(task => task.status === "error").length;
  const summary = [running && `${running} 项处理中`, review && `${review} 项待复核`, errors && `${errors} 项失败`].filter(Boolean).join(" · ") || "暂无识别任务";
  const html = tasks.map(task => {
    const complete = finished(task.status);
    const error = task.status === "error";
    const message = task.status === "queued" ? `排队中 · 等待第 ${++waiting} 位`
      : task.status === "processing" ? "正在识别"
      : task.status === "review" ? "识别完成 · 有字段需复核"
      : complete ? "识别完成 · 点击前往复核" : "识别失败 · 点击查看并重试";
    const icon = complete
      ? '<svg viewBox="0 0 32 32"><circle class="queue-check-ring" cx="16" cy="16" r="13"/><path class="queue-check-mark" d="m9 16 5 5 10-11"/></svg>'
      : error ? '<svg viewBox="0 0 32 32"><circle class="queue-check-ring" cx="16" cy="16" r="13"/><path class="queue-error-mark" d="M16 9v9"/><circle class="queue-error-dot" cx="16" cy="23" r="1"/></svg>'
      : task.status === "processing" ? '<svg class="queue-working" viewBox="0 0 32 32"><path d="M16 3a13 13 0 0 1 13 13M16 29A13 13 0 0 1 3 16"/></svg>'
      : '<span aria-hidden="true">···</span>';
    return `<button type="button" class="queue-task" data-status="${escapeHtml(task.status)}" data-review-issuance-task="${escapeHtml(task.id)}" ${!complete && !error ? "disabled" : ""}>
      <span class="queue-task-icon" aria-hidden="true">${icon}</span>
      <span class="queue-task-copy"><strong>${escapeHtml(task.payload.projectName)}</strong><span>${message}</span></span>
      ${complete || error ? '<span class="queue-task-arrow" aria-hidden="true">↗</span>' : ""}
    </button>`;
  }).join("") || '<p class="queue-panel-empty">暂无识别任务</p>';
  return { html, summary, count: tasks.length, review, errors, running };
}

export function createIssuanceQueuePanel({ panel, list, toggle, minimize, summary, count, onReview }) {
  let rows = new Map();
  let lastHtml = "";
  function renderRows(html) {
    if (html === lastHtml) return;
    lastHtml = html;
    const template = list.ownerDocument.createElement("template");
    template.innerHTML = html;
    const next = new Map();
    const nodes = [...template.content.children].map(candidate => {
      const id = candidate.dataset.reviewIssuanceTask || "empty";
      const markup = candidate.outerHTML;
      const previous = rows.get(id);
      const node = previous?.markup === markup ? previous.node : candidate;
      if (node !== previous?.node && ["ready", "review", "error"].includes(node.dataset.status)) {
        node.classList.add("queue-completion-enter");
      }
      next.set(id, { node, markup });
      return node;
    });
    // Leave unchanged rows attached: another task updating must not replay a
    // completed row's animation, reset keyboard focus, or interrupt its ripple.
    const retained = new Set(nodes);
    [...list.children].forEach(node => { if (!retained.has(node)) node.remove(); });
    nodes.forEach((node, index) => {
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
    });
    while (list.children.length > nodes.length) list.lastElementChild.remove();
    rows = next;
  }
  list.addEventListener("animationend", event => {
    if (event.animationName === "queueCompletionRipple") {
      event.target.closest(".queue-task")?.classList.remove("queue-completion-enter");
    }
  });
  const motion = createQueuePanelMorph(panel, toggle);
  const setOpen = motion.setOpen;
  toggle.addEventListener("click", motion.toggle);
  minimize.addEventListener("click", () => { setOpen(false); toggle.focus({ preventScroll: true }); });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { setOpen(false); toggle.focus({ preventScroll: true }); }
  });
  list.addEventListener("click", event => {
    const target = event.target.closest("[data-review-issuance-task]");
    if (!target || target.disabled) return;
    setOpen(false);
    onReview(target.dataset.reviewIssuanceTask);
  });
  return {
    open: () => setOpen(true),
    render(tasks) {
      const view = queuePanelView(tasks);
      renderRows(view.html);
      summary.textContent = view.summary;
      count.textContent = String(view.count);
      count.hidden = !view.count;
      toggle.dataset.attention = String(view.review + view.errors > 0);
      toggle.setAttribute("aria-label", `识别队列，${view.summary}`);
      motion.refresh();
      // Completion updates the badge; it must not undo the user's minimization.
    },
  };
}
