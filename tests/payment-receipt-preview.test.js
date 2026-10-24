import assert from "node:assert/strict";
import test from "node:test";
import { createPaymentReceiptPreview } from "../payment-receipt-preview.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

class Element {
  constructor(tag, document) {
    this.tagName = tag;
    this.ownerDocument = document;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.clientWidth = 640;
  }
  append(...nodes) { nodes.forEach((node) => { node.remove(); node.parent = this; this.children.push(node); }); }
  replaceChildren(...nodes) { this.children.forEach((node) => { node.parent = null; }); this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; if (name === "href") delete this.href; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  getContext() { return {}; }
  find(className) { return this.className?.split(" ").includes(className) ? this : this.children.map((child) => child.find(className)).find(Boolean); }
  click() { if (!this.disabled) this.handlers.click?.({}); }
}

function fixture(options = {}) {
  const document = { baseURI: "http://localhost:8814/", defaultView: {
    devicePixelRatio: 2,
    getComputedStyle: () => ({ paddingLeft: "20px", paddingRight: "20px" }),
    URL: options.objectUrls,
    Blob: options.objectUrls ? Blob : undefined,
  } };
  document.createElement = (tag) => new Element(tag, document);
  const container = document.createElement("div");
  const requests = [];
  const documents = [];
  const renders = [];
  const pageRequests = [];
  const pdfJs = { getDocument(parameters) {
    const pdf = {
      numPages: options.numPages || 3,
      async getPage(number) {
        pageRequests.push(number);
        if (options.getPage) return options.getPage(number, pdf);
        return {
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render(parameters) {
            const task = options.render ? options.render(parameters) : { promise: Promise.resolve(), cancel() {} };
            renders.push({ ...parameters, task });
            return task;
          },
        };
      },
    };
    const loading = { promise: Promise.resolve(pdf), destroy() { this.destroyed = true; } };
    documents.push({ parameters, loading, pdf });
    return loading;
  } };
  const fetch = (url, init) => {
    requests.push({ url, init });
    return options.fetch ? options.fetch(url, init) : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(5) });
  };
  const controller = createPaymentReceiptPreview(container, { fetch, loadPdfJs: options.loadPdfJs || (async () => pdfJs) });
  return { container, controller, requests, documents, renders, pageRequests, pdfJs,
    node: (suffix) => container.find(`payment-receipt-pdf${suffix ? `-${suffix}` : ""}`) };
}

test("renders an authenticated same-origin PDF at the initial page and clamps pagination", async () => {
  const ui = fixture();
  assert.equal(ui.node("status").textContent, "选择一张缴款单查看原件");
  await ui.controller.show({ url: "./api/payment-receipts/one/source", label: '<原件 "一">', initialPage: 2 });
  assert.equal(ui.requests[0].url, "http://localhost:8814/api/payment-receipts/one/source");
  assert.equal(ui.requests[0].init.credentials, "same-origin");
  assert.equal(ui.requests[0].init.mode, "same-origin");
  assert.equal(ui.requests[0].init.redirect, "error");
  assert.equal(ui.documents[0].parameters.isEvalSupported, false);
  assert.deepEqual(ui.pageRequests, [2]);
  assert.equal(ui.node("page-input").value, "2");
  assert.equal(ui.node("page-count").textContent, "/ 3");
  assert.equal(ui.node("canvas").attributes["aria-label"], '<原件 "一">，第 2 页，共 3 页');
  assert.equal(ui.node("canvas").width, 1200);
  assert.equal(ui.node("canvas").style.width, "600px");
  ui.node("next").click();
  await tick();
  assert.equal(ui.node("next").disabled, true);
  assert.equal(ui.node("page-input").value, "3");
  ui.node("page-input").value = "-12";
  ui.node("page-input").handlers.change();
  await tick();
  assert.equal(ui.node("page-input").value, "1");
  assert.equal(ui.node("previous").disabled, true);
  assert.equal(ui.node("open").rel, "noopener noreferrer");
  assert.equal(ui.node("open").textContent, "打开原件");
});

test("does not fetch or reset pagination when the same source is shown again", async () => {
  const response = deferred();
  const ui = fixture({ fetch: () => response.promise });
  const first = ui.controller.show({ url: "./api/source", initialPage: 2 });
  const repeated = ui.controller.show({ url: "http://localhost:8814/api/source#page=1" });
  assert.equal(first, repeated);
  assert.equal(ui.requests.length, 1);
  response.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  await first;
  await ui.controller.show({ url: "./api/source" });
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.node("page-input").value, "2");
});

test("a switched source aborts its request and a late response cannot overwrite the current PDF", async () => {
  const old = deferred();
  const ui = fixture({ fetch: (url) => url.endsWith("old") ? old.promise : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }) });
  const stale = ui.controller.show({ url: "./api/old" });
  await ui.controller.show({ url: "./api/new", label: "新原件" });
  assert.equal(ui.requests[0].init.signal.aborted, true);
  old.resolve({ ok: true, arrayBuffer: async () => { throw new Error("stale response must not be read"); } });
  await stale;
  assert.equal(ui.documents.length, 1);
  assert.match(ui.node("canvas").attributes["aria-label"], /^新原件/);
  const canvas = ui.node("canvas");
  ui.controller.clear();
  assert.equal(ui.requests[1].init.signal.aborted, true);
  assert.equal(ui.documents[0].loading.destroyed, true);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  assert.equal(ui.node("canvas"), undefined);
  assert.equal(ui.node("toolbar").hidden, true);
});

test("clearing while PDF.js loads prevents a late library result from starting a document", async () => {
  const library = deferred();
  const ui = fixture({ loadPdfJs: () => library.promise });
  const loading = ui.controller.show({ url: "./api/one" });
  await tick();
  ui.controller.clear();
  library.resolve({ getDocument: () => { throw new Error("must not load after clear"); } });
  await loading;
  assert.equal(ui.node().dataset.state, "empty");
  assert.equal(ui.node("canvas"), undefined);
});

test("fetch failure has a working retry and keeps the original source link available", async () => {
  let attempts = 0;
  const ui = fixture({ fetch: async () => {
    attempts += 1;
    return attempts === 1 ? { ok: false } : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  } });
  await ui.controller.show({ url: "./api/one" });
  assert.equal(ui.node().dataset.state, "error");
  assert.equal(ui.node("retry").hidden, false);
  assert.equal(ui.node("open").href, "http://localhost:8814/api/one#page=1");
  ui.node("retry").click();
  await tick();
  assert.equal(attempts, 2);
  assert.equal(ui.node().dataset.state, "ready");
  assert.equal(ui.node("retry").hidden, true);
});

test("resizing rerenders only when width changes and releases the replaced canvas", async () => {
  const ui = fixture();
  await ui.controller.show({ url: "./api/one" });
  const original = ui.node("canvas");
  await ui.controller.resize();
  assert.equal(ui.renders.length, 1);
  ui.node("viewport").clientWidth = 440;
  await ui.controller.resize();
  assert.equal(ui.renders.length, 2);
  assert.equal(ui.node("canvas").style.width, "400px");
  assert.equal(ui.node("canvas").width, 800);
  assert.equal(original.width, 0);
  assert.equal(original.parent, null);
  assert.equal(ui.requests.length, 1);
});

test("rapid page changes cancel old renders and prevent an obsolete canvas from appearing", async () => {
  const tasks = [];
  const ui = fixture({ render: () => {
    const pending = deferred();
    const task = { promise: pending.promise, cancel() { this.cancelled = true; }, pending };
    tasks.push(task);
    return task;
  } });
  const first = ui.controller.show({ url: "./api/one" });
  await tick();
  ui.node("next").click();
  await tick();
  assert.equal(tasks[0].cancelled, true);
  tasks[1].pending.resolve();
  await tick();
  assert.match(ui.node("canvas").attributes["aria-label"], /第 2 页/);
  const latest = ui.node("canvas");
  tasks[0].pending.resolve();
  await first;
  assert.equal(ui.node("canvas"), latest);
  assert.equal(ui.node().dataset.state, "ready");
});

test("a page render failure can be retried and its previous PDF task is released", async () => {
  let attempts = 0;
  const ui = fixture({ render: () => ({
    promise: ++attempts === 1 ? Promise.reject(new Error("render failed")) : Promise.resolve(),
    cancel() {},
  }) });
  await ui.controller.show({ url: "./api/one" });
  assert.equal(ui.node().dataset.state, "error");
  assert.equal(ui.node("canvas"), undefined);
  ui.node("retry").click();
  await tick();
  assert.equal(ui.documents[0].loading.destroyed, true);
  assert.equal(ui.node().dataset.state, "ready");
  assert.equal(ui.node("page-input").value, "1");
});

test("clearing an unfinished render cancels its task and a late completion keeps the empty state", async () => {
  const pending = deferred();
  const task = { promise: pending.promise, cancel() { this.cancelled = true; } };
  const ui = fixture({ render: () => task });
  const loading = ui.controller.show({ url: "./api/one" });
  await tick();
  const canvas = ui.renders[0].canvas;
  ui.controller.clear();
  assert.equal(task.cancelled, true);
  assert.equal(canvas.width, 0);
  assert.equal(ui.documents[0].loading.destroyed, true);
  pending.resolve();
  await loading;
  assert.equal(ui.node().dataset.state, "empty");
  assert.equal(ui.node("canvas"), undefined);
});

test("rejects external, credential-bearing and executable URLs before fetching", async () => {
  const ui = fixture();
  for (const url of ["https://example.com/one.pdf", "javascript:alert(1)", "data:application/pdf;base64,AA", "http://user:pass@localhost:8814/api/one"]) {
    await ui.controller.show({ url });
    assert.equal(ui.node().dataset.state, "invalid");
    assert.equal(ui.node("open").href, undefined);
  }
  assert.equal(ui.requests.length, 0);
  await ui.controller.show({ url: "" });
  assert.equal(ui.node().dataset.state, "empty");
});

test("loads PDF.js in parallel with the authenticated download", async () => {
  const library = deferred(), response = deferred();
  let libraryStarted = false, bodyRead = false;
  const ui = fixture({ fetch: () => response.promise, loadPdfJs: () => {
    libraryStarted = true;
    return library.promise;
  } });
  const loading = ui.controller.show({ url: "./api/one" });
  await tick();
  assert.equal(libraryStarted, true);
  response.resolve({ ok: true, arrayBuffer: async () => { bodyRead = true; return new ArrayBuffer(1); } });
  await tick();
  assert.equal(bodyRead, true);
  assert.equal(ui.documents.length, 0);
  library.resolve(ui.pdfJs);
  await loading;
  assert.equal(ui.node().dataset.state, "ready");
});

test("receipts sharing an original reuse its PDF and select each receipt's own source page", async () => {
  const ui = fixture();
  const source = "./api/payment-receipt-files/shared/file";
  await ui.controller.show({ url: source, selectionKey: "receipt:a", initialPage: 2 });
  ui.node("next").click();
  await tick();
  await ui.controller.show({ url: source, selectionKey: "receipt:b", initialPage: 1 });
  assert.equal(ui.node("page-input").value, "1");
  ui.node("next").click();
  await tick();
  await ui.controller.show({ url: source, selectionKey: "receipt:b", initialPage: 1 });
  assert.equal(ui.node("page-input").value, "2", "rerendering one receipt preserves manual pagination");
  await ui.controller.show({ url: source, selectionKey: "receipt:a", initialPage: 2 });
  assert.equal(ui.node("page-input").value, "2");
  assert.deepEqual(ui.pageRequests, [2, 3, 1, 2]);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.documents.length, 1);
  assert.equal(ui.node("open").href, "http://localhost:8814/api/payment-receipt-files/shared/file#page=2");
});

test("switching receipts while their shared source downloads uses the latest requested page", async () => {
  const response = deferred();
  const ui = fixture({ fetch: () => response.promise });
  const first = ui.controller.show({ url: "./api/shared", selectionKey: "a", initialPage: 1 });
  const second = ui.controller.show({ url: "./api/shared", selectionKey: "b", initialPage: 3 });
  assert.equal(first, second);
  assert.equal(ui.node("open").href, "http://localhost:8814/api/shared#page=3");
  response.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  await second;
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.pageRequests, [3]);
});

test("an updated source-page hint for the same receipt is applied without resetting unchanged manual pagination", async () => {
  const ui = fixture();
  const source = { url: "./api/shared", selectionKey: "receipt:a", initialPage: 1 };
  await ui.controller.show(source);
  ui.node("next").click();
  await tick();
  await ui.controller.show(source);
  assert.equal(ui.node("page-input").value, "2");
  ui.controller.hide();
  await ui.controller.show({ ...source, initialPage: 3 });
  assert.equal(ui.node("page-input").value, "3");
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.pageRequests, [1, 2, 3]);
});

test("retry preserves a manually selected page when the receipt's unchanged descriptor is shown again", async () => {
  let attempts = 0;
  const ui = fixture({ render: () => ({
    promise: ++attempts === 2 ? Promise.reject(Error('page failed')) : Promise.resolve(), cancel() {},
  }) });
  const source = { url: "./api/shared", selectionKey: "receipt:a", initialPage: 1 };
  await ui.controller.show(source);
  ui.node("next").click();
  await tick();
  assert.equal(ui.node().dataset.state, "error");
  ui.node("retry").click();
  await tick();
  await ui.controller.show(source);
  assert.equal(ui.node("page-input").value, "2");
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.documents[0].loading.destroyed, true);
});

test("hiding and revisiting nearby originals reuses parsed PDFs and rendered pages", async () => {
  const ui = fixture();
  await ui.controller.show({ url: "./api/a", selectionKey: "a", initialPage: 2 });
  const canvasA = ui.node("canvas");
  ui.controller.hide();
  assert.equal(ui.node("canvas"), undefined);
  assert.equal(ui.documents[0].loading.destroyed, undefined);
  await ui.controller.show({ url: "./api/a", selectionKey: "a", initialPage: 2 });
  assert.equal(ui.node("canvas"), canvasA);
  assert.equal(ui.node("page-input").value, "2");
  await ui.controller.show({ url: "./api/b", selectionKey: "b" });
  await ui.controller.show({ url: "./api/a", selectionKey: "a", initialPage: 2 });
  assert.equal(ui.node("canvas"), canvasA);
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.documents.length, 2);
  assert.equal(ui.renders.length, 2);
  ui.controller.clear();
  assert.ok(ui.documents.every(({ loading }) => loading.destroyed));
  assert.equal(canvasA.width, 0);
  assert.equal(ui.node("open").href, undefined);
});

test("evicts least recently used originals after two documents", async () => {
  const ui = fixture();
  for (const name of ["a", "b", "c"]) await ui.controller.show({ url: "./api/" + name });
  assert.equal(ui.documents[0].loading.destroyed, true);
  assert.equal(ui.documents[1].loading.destroyed, undefined);
  assert.equal(ui.documents[2].loading.destroyed, undefined);
  await ui.controller.show({ url: "./api/a" });
  assert.equal(ui.requests.length, 4);
  assert.equal(ui.documents[1].loading.destroyed, true);
  assert.equal(ui.documents.filter(({ loading }) => !loading.destroyed).length, 2);
});

test("the original-byte cache is bounded and does not retain oversized documents on hide", async () => {
  const ui = fixture({ fetch: async url => ({ ok: true, arrayBuffer: async () => new ArrayBuffer((url.endsWith("large") ? 33 : 17) * 1024 * 1024) }) });
  await ui.controller.show({ url: "./api/a" });
  await ui.controller.show({ url: "./api/b" });
  assert.equal(ui.documents[0].loading.destroyed, true, "34 MiB must not remain in the 32 MiB cache");
  await ui.controller.show({ url: "./api/large" });
  assert.equal(ui.documents[1].loading.destroyed, true);
  assert.equal(ui.node().dataset.state, "ready", "a large active original can still be read");
  ui.controller.hide();
  assert.equal(ui.documents[2].loading.destroyed, true);
});

test("new-page links reuse private in-memory originals, retain the page and revoke on eviction or clear", async () => {
  const blobs = [], revoked = [];
  const ui = fixture({ objectUrls: {
    createObjectURL(blob) { blobs.push(blob); return `blob:http://localhost:8814/pdf-${blobs.length}`; },
    revokeObjectURL(value) { revoked.push(value); },
  } });
  await ui.controller.show({ url: "./api/a", initialPage: 2 });
  assert.equal(blobs[0].type, "application/pdf");
  assert.equal(blobs[0].size, 5);
  assert.equal(ui.node("open").href, "blob:http://localhost:8814/pdf-1#page=2");
  ui.node("next").click();
  await tick();
  assert.equal(ui.node("open").href, "blob:http://localhost:8814/pdf-1#page=3");
  await ui.controller.show({ url: "./api/b" });
  await ui.controller.show({ url: "./api/c" });
  assert.deepEqual(revoked, ["blob:http://localhost:8814/pdf-1"]);
  ui.controller.clear();
  assert.deepEqual(new Set(revoked), new Set(["blob:http://localhost:8814/pdf-1", "blob:http://localhost:8814/pdf-2", "blob:http://localhost:8814/pdf-3"]));
  assert.equal(ui.node("open").href, undefined);
});

test("hide cancels an unfinished original rather than keeping a background download", async () => {
  const response = deferred();
  const ui = fixture({ fetch: () => response.promise });
  const pending = ui.controller.show({ url: "./api/a" });
  ui.controller.hide();
  assert.equal(ui.requests[0].init.signal.aborted, true);
  response.resolve({ ok: true, arrayBuffer: async () => { throw Error("late source must not be read"); } });
  await pending;
  assert.equal(ui.documents.length, 0);
  assert.equal(ui.node().dataset.state, "empty");
});
