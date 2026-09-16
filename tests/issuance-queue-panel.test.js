import assert from "node:assert/strict";
import test from "node:test";
import { queuePanelView, createIssuanceQueuePanel } from "../issuance-queue-panel.js";
import { createSequentialIssuanceQueue } from "../issuance-queue.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const task = (id, status) => ({ id, status, payload: { projectName: `项目${id}` } });
function element() {
  return { hidden: false, innerHTML: "", textContent: "", dataset: {}, handlers: {}, attributes: {},
    addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
  };
}
function fixture() {
  const elements = Object.fromEntries(["panel", "list", "toggle", "minimize", "summary", "count"].map(name => [name, element()]));
  const list = elements.list;
  list.children = [];
  list.insertBefore = (node, before) => {
    if (list.children.includes(node)) node.remove();
    list.children.splice(before ? list.children.indexOf(before) : list.children.length, 0, node);
    node.remove = () => { list.children.splice(list.children.indexOf(node), 1); };
  };
  Object.defineProperty(list, "lastElementChild", { get: () => list.children.at(-1) });
  list.ownerDocument = { createElement: () => ({
    content: { children: [] },
    set innerHTML(html) {
      this.content.children = (html.match(/<button\b[\s\S]*?<\/button>|<p\b[\s\S]*?<\/p>/g) || []).map(markup => {
        const classes = new Set();
        return { outerHTML: markup, dataset: { reviewIssuanceTask: markup.match(/data-review-issuance-task="([^"]*)"/)?.[1], status: markup.match(/data-status="([^"]*)"/)?.[1] },
          classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
      });
    },
  }) };
  elements.panel.hidden = true;
  const reviewed = [];
  const controller = createIssuanceQueuePanel({ ...elements, onReview: id => reviewed.push(id) });
  return { ...elements, controller, reviewed };
}

test("shows every queued task, completion and failure without truncating the queue", () => {
  const view = queuePanelView([task("1", "processing"), task("2", "queued"), task("3", "queued"), task("4", "ready"), task("5", "review"), task("6", "error")]);
  assert.equal(view.count, 6);
  assert.equal(view.running, 3);
  assert.equal(view.review, 2);
  assert.equal(view.errors, 1);
  assert.match(view.html, /等待第 1 位/);
  assert.match(view.html, /等待第 2 位/);
  assert.equal((view.html.match(/disabled/g) || []).length, 3);
  assert.match(view.html, /queue-error-mark/);
  assert.match(view.html, /queue-error-dot/);
  const unsafe = task('" onclick="bad', "ready");
  unsafe.payload.projectName = "<img src=x onerror=bad>";
  assert.doesNotMatch(queuePanelView([unsafe]).html, /<img|id="" onclick/);
});

test("completion animation runs for each new result without replaying unchanged rows", () => {
  const ui = fixture();
  ui.controller.render([task("a", "processing"), task("b", "queued")]);
  ui.controller.render([task("a", "ready"), task("b", "processing")]);
  const completed = ui.list.children[0];
  assert.equal(completed.classList.contains("queue-completion-enter"), true);
  ui.list.handlers.animationend({ animationName: "queueCompletionRipple", target: { closest: () => completed } });
  assert.equal(completed.classList.contains("queue-completion-enter"), false);
  ui.controller.render([task("a", "ready"), task("b", "error")]);
  assert.equal(ui.list.children[0], completed);
  assert.equal(completed.classList.contains("queue-completion-enter"), false);
  const failed = ui.list.children[1];
  assert.equal(failed.classList.contains("queue-completion-enter"), true);
  ui.controller.render([task("a", "ready"), task("b", "error"), task("c", "queued")]);
  assert.equal(ui.list.children[1], failed, "ongoing ripple is not interrupted by another submission");
  ui.controller.render([task("b", "error"), task("c", "queued")]);
  assert.equal(ui.list.children[0], failed);
});

test("minimizing keeps a running task alive, completion updates the badge without reopening", async () => {
  const ui = fixture();
  let finish;
  const worker = new Promise(resolve => { finish = resolve; });
  let queue;
  queue = createSequentialIssuanceQueue(() => worker, () => ui.controller.render(queue.list()));
  const queued = queue.enqueue({ projectName: "测试项目" });
  ui.controller.open();
  await new Promise(resolve => setTimeout(resolve, 0));
  ui.minimize.handlers.click();
  assert.equal(ui.panel.hidden, true);
  assert.equal(queue.get(queued.id).status, "processing");
  finish({ canApply: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ui.panel.hidden, true);
  assert.equal(ui.toggle.dataset.attention, "true");
  assert.match(ui.summary.textContent, /1 项待复核/);
  ui.toggle.handlers.click();
  assert.equal(ui.panel.hidden, false);
  ui.list.handlers.click({ target: { closest: () => ({ disabled: false, dataset: { reviewIssuanceTask: queued.id } }) } });
  assert.deepEqual(ui.reviewed, [queued.id]);
  assert.equal(ui.panel.hidden, true);
  assert.equal(queue.get(queued.id).status, "ready");
  queue.remove(queued.id);
  ui.controller.render(queue.list());
  assert.equal(ui.count.hidden, true);
  assert.equal(ui.toggle.dataset.attention, "false");
});

test("submitting recognition opens the queue instead of a toast, and review routes to the matching project", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const extract = (name, next) => app.slice(app.indexOf(`function ${name}(`), app.indexOf(next, app.indexOf(`function ${name}(`)));
  const calls = [];
  let queued;
  const context = vm.createContext({
    state: { projects: [{ id: "project-b", shortName: "乙项目" }] },
    resetIssuanceReview() {}, issuanceReviewSnapshot: () => ({ projectId: "project-b" }),
    validateRecognitionRequest: () => ({ text: "发行结果", noticeDate: "2026-09-16" }),
    activeIssuanceQueueTaskId: "", ISSUANCE_QUEUE_STATUS: { QUEUED: "queued", PROCESSING: "processing" },
    issuanceRecognitionQueue: { list: () => [], enqueue(payload) { queued = { id: "task-b", payload }; return queued; }, get: () => queued },
    closeResultEntryPanel: () => calls.push("close-entry"),
    issuanceQueuePanel: { open: () => calls.push("open-queue") },
    showToast: message => calls.push(["toast", message]),
    renderIssuanceQueueNotifications() {},
    openLedgerProject: id => calls.push(["project", id]),
    requestAnimationFrame: fn => fn(),
    openResultEntryPanel: (review, id) => calls.push(["review", review, id]),
  });
  vm.runInContext(extract("queueIssuanceResultRecognition", "async function requestQueuedIssuanceRecognition") + '\nqueueIssuanceResultRecognition();', context);
  assert.deepEqual(calls, ["close-entry", "open-queue"]);
  vm.runInContext(extract("openIssuanceQueueTask", "function updateProjectResultQueueState") + '\nopenIssuanceQueueTask("task-b");', context);
  assert.deepEqual(calls.slice(-2), [["project", "project-b"], ["review", true, "task-b"]]);
});
