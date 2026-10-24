const PDFJS_BASE = new URL("./vendor/pdfjs/", import.meta.url);
const MAX_CACHED_DOCUMENTS = 2;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;
let pdfJsPromise;

function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(new URL("pdf.min.mjs", PDFJS_BASE).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", PDFJS_BASE).href;
      return pdfjs;
    }).catch((error) => {
      pdfJsPromise = null;
      throw error;
    });
  }
  return pdfJsPromise;
}

// The optional runtime lets lifecycle and cancellation be tested without a browser
// or document contents. Normal callers only supply the container.
export function createPaymentReceiptPreview(container, runtime = {}) {
  const document = container.ownerDocument;
  const window = document.defaultView || globalThis;
  const fetchPdf = runtime.fetch || window.fetch.bind(window);
  const getPdfJs = runtime.loadPdfJs || loadPdfJs;
  const objectUrls = runtime.URL || window.URL;
  const BlobType = runtime.Blob || window.Blob;
  // Private documents remain in this reader only. No HTTP or persistent cache.
  const documents = new Map();
  let current = null;

  function element(tag, className, text = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function button(className, text) {
    const node = element("button", `button subtle ${className}`, text);
    node.type = "button";
    return node;
  }

  const root = element("div", "payment-receipt-pdf");
  const toolbar = element("div", "payment-receipt-pdf-toolbar");
  const pager = element("div", "payment-receipt-pdf-pager");
  const previous = button("payment-receipt-pdf-previous", "上一页");
  const next = button("payment-receipt-pdf-next", "下一页");
  const pageInput = element("input", "payment-receipt-pdf-page-input");
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.step = "1";
  pageInput.setAttribute("aria-label", "原件页码");
  const pageCount = element("span", "payment-receipt-pdf-page-count");
  const open = element("a", "button subtle payment-receipt-pdf-open", "打开原件");
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  const viewport = element("div", "payment-receipt-pdf-viewport");
  const status = element("p", "payment-receipt-pdf-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const retry = button("payment-receipt-pdf-retry", "重试");
  pager.append(previous, pageInput, pageCount, next);
  toolbar.append(pager, open);
  root.append(toolbar, status, retry, viewport);
  container.replaceChildren(root);

  function state(message, kind, busy = false) {
    root.dataset.state = kind;
    root.setAttribute("aria-busy", String(busy));
    status.textContent = message;
    status.hidden = !message;
    retry.hidden = kind !== "error" || !current;
  }

  function updatePager(item = current) {
    const total = item?.pdf?.numPages || 0;
    pager.hidden = !total;
    pageInput.value = String(item?.pageNumber || 1);
    pageInput.max = String(total || 1);
    pageCount.textContent = `/ ${total}`;
    previous.disabled = !total || item.pageNumber <= 1;
    next.disabled = !total || item.pageNumber >= total;
    if (item) open.href = originalUrl(item);
  }

  function originalUrl(item = current) {
    return item ? `${item.objectUrl || item.href}#page=${item.pageNumber}` : "";
  }

  function disposeCanvas(canvas) {
    if (!canvas) return;
    canvas.remove();
    canvas.width = 0;
    canvas.height = 0;
  }

  function cancelRender(item) {
    item.renderVersion += 1;
    item.renderTask?.cancel();
    item.renderTask = null;
    disposeCanvas(item.pendingCanvas);
    item.pendingCanvas = null;
  }

  function release(item) {
    if (!item || item.released) return;
    item.released = true;
    item.controller.abort();
    cancelRender(item);
    disposeCanvas(item.canvas);
    // LoadingTask.destroy also releases its PDFDocumentProxy and worker.
    const resource = item.loadingTask || item.pdf;
    try { Promise.resolve(resource?.destroy()).catch(() => {}); } catch { /* Already destroyed. */ }
    if (item.objectUrl) {
      objectUrls?.revokeObjectURL?.(item.objectUrl);
      item.objectUrl = null;
    }
    item.pdf = null;
  }

  function forget(item) {
    if (!item) return;
    if (documents.get(item.href) === item) documents.delete(item.href);
    release(item);
  }

  function trimCache() {
    const retained = () => [...documents.values(), ...(current && !documents.has(current.href) ? [current] : [])];
    while (retained().length > MAX_CACHED_DOCUMENTS || retained().reduce((sum, item) => sum + (item.byteLength || 0), 0) > MAX_CACHED_BYTES) {
      const victim = [...documents.values()].find((item) => item !== current);
      if (!victim) break; // A large current file is usable but is not retained on hide.
      forget(victim);
    }
  }

  function active(item) {
    return current === item && !item.released;
  }

  function availableWidth() {
    const style = window.getComputedStyle?.(viewport);
    const padding = (parseFloat(style?.paddingLeft) || 0) + (parseFloat(style?.paddingRight) || 0);
    return Math.max(0, Math.floor((viewport.clientWidth || container.clientWidth || 0) - padding));
  }

  async function render(item, force = false) {
    if (!active(item) || !item.pdf) return;
    const width = availableWidth();
    if (!width) return;
    if (!force && item.canvas && item.renderedWidth === width && item.renderedPage === item.pageNumber) {
      item.canvas.hidden = false;
      item.canvas.setAttribute("aria-label", `${item.label}，第 ${item.pageNumber} 页，共 ${item.pdf.numPages} 页`);
      if (viewport.firstChild !== item.canvas) viewport.replaceChildren(item.canvas);
      state("", "ready");
      return;
    }
    cancelRender(item);
    const version = item.renderVersion;
    const pageNumber = item.pageNumber;
    state(`正在加载第 ${pageNumber} 页…`, "loading", true);
    if (item.canvas) item.canvas.hidden = true;
    let canvas;
    try {
      const page = await item.pdf.getPage(pageNumber);
      if (!active(item) || item.renderVersion !== version) return;
      const natural = page.getViewport({ scale: 1 });
      const pageViewport = page.getViewport({ scale: width / natural.width });
      const pixelRatio = Math.min(Math.max(1, Number(window.devicePixelRatio) || 1), 2,
        Math.sqrt(16_000_000 / (pageViewport.width * pageViewport.height)));
      canvas = element("canvas", "payment-receipt-pdf-canvas");
      canvas.width = Math.ceil(pageViewport.width * pixelRatio);
      canvas.height = Math.ceil(pageViewport.height * pixelRatio);
      canvas.style.width = `${pageViewport.width}px`;
      canvas.style.height = `${pageViewport.height}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${item.label}，第 ${pageNumber} 页，共 ${item.pdf.numPages} 页`);
      item.pendingCanvas = canvas;
      item.renderTask = page.render({
        canvas,
        viewport: pageViewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      await item.renderTask.promise;
      if (!active(item) || item.renderVersion !== version) {
        disposeCanvas(canvas);
        return;
      }
      disposeCanvas(item.canvas);
      item.canvas = canvas;
      item.pendingCanvas = null;
      item.renderTask = null;
      item.renderedWidth = width;
      item.renderedPage = pageNumber;
      viewport.replaceChildren(canvas);
      item.failed = false;
      state("", "ready");
    } catch {
      disposeCanvas(canvas);
      if (active(item) && item.renderVersion === version) {
        item.pendingCanvas = null;
        item.renderTask = null;
        item.failed = true;
        documents.delete(item.href);
        state("原件预览失败，请重试或打开原件。", "error");
      }
    }
  }

  function hide() {
    const previous = current;
    current = null;
    if (previous) {
      cancelRender(previous);
      if (!previous.pdf || previous.failed) forget(previous);
      else previous.canvas?.remove();
    }
    viewport.replaceChildren();
    toolbar.hidden = true;
    open.removeAttribute("href");
    updatePager();
    state("选择一张缴款单查看原件", "empty");
    trimCache();
  }

  function clear() {
    const previous = current;
    current = null;
    forget(previous);
    for (const item of [...documents.values()]) forget(item);
    hide();
  }

  async function load(item) {
    try {
      // Load the renderer while the original downloads, rather than afterwards.
      const bytesPromise = (async () => {
        const response = await fetchPdf(item.href, {
          credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store",
          signal: item.controller.signal,
        });
        if (!active(item)) return null;
        if (!response.ok) throw new Error("PDF request failed");
        return new Uint8Array(await response.arrayBuffer());
      })();
      const [bytes, pdfjs] = await Promise.all([bytesPromise, Promise.resolve().then(getPdfJs)]);
      if (!active(item)) return;
      item.byteLength = bytes.byteLength;
      trimCache();
      if (typeof objectUrls?.createObjectURL === "function" && typeof BlobType === "function") {
        try { item.objectUrl = objectUrls.createObjectURL(new BlobType([bytes], { type: "application/pdf" })); } catch { /* Source URL remains available. */ }
      }
      updatePager(item);
      item.loadingTask = pdfjs.getDocument({
        data: bytes,
        cMapUrl: new URL("cmaps/", PDFJS_BASE).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("standard_fonts/", PDFJS_BASE).href,
        wasmUrl: new URL("wasm/", PDFJS_BASE).href,
        iccUrl: new URL("iccs/", PDFJS_BASE).href,
        isEvalSupported: false,
        verbosity: 0,
      });
      const pdf = await item.loadingTask.promise;
      if (!active(item)) return;
      item.pdf = pdf;
      documents.delete(item.href);
      documents.set(item.href, item);
      trimCache();
      item.pageNumber = Math.max(1, Math.min(pdf.numPages, item.pageNumber));
      updatePager(item);
      await render(item);
    } catch {
      if (active(item)) {
        item.failed = true;
        item.controller.abort();
        documents.delete(item.href);
        state("原件预览失败，请重试或打开原件。", "error");
      }
    }
  }

  function show(options = {}, force = false) {
    const { url, label = "缴款单原件", initialPage = 1, selectionKey = "" } = options;
    const initial = Number(initialPage);
    const requestedInitialPage = Number.isFinite(initial) ? Math.max(1, Math.trunc(initial)) : 1;
    const hasInitialPage = Object.hasOwn(options, "initialPage");
    if (!url) {
      clear();
      return Promise.resolve();
    }
    let href;
    try {
      const parsed = new URL(url, document.baseURI);
      const origin = new URL(document.baseURI).origin;
      if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("Invalid source origin");
      }
      parsed.hash = "";
      href = parsed.href;
    } catch {
      clear();
      state("无法预览此原件链接。", "invalid");
      return Promise.resolve();
    }
    if (!force && current?.href === href) {
      current.label = String(label || "缴款单原件");
      if (current.selectionKey !== selectionKey || hasInitialPage && current.requestedInitialPage !== requestedInitialPage) {
        current.selectionKey = selectionKey;
        current.requestedInitialPage = requestedInitialPage;
        current.pageNumber = requestedInitialPage;
        if (current.pdf) {
          current.pageNumber = Math.min(current.pdf.numPages, current.pageNumber);
          current.promise = render(current);
        }
        updatePager(current);
      }
      return current.promise;
    }
    hide();
    if (force) forget(documents.get(href));
    let item = documents.get(href);
    if (item) {
      documents.delete(href);
      documents.set(href, item);
      item.label = String(label || "缴款单原件");
      if (item.selectionKey !== selectionKey || hasInitialPage && item.requestedInitialPage !== requestedInitialPage) {
        item.pageNumber = Math.min(item.pdf.numPages, requestedInitialPage);
        item.requestedInitialPage = requestedInitialPage;
      }
      item.selectionKey = selectionKey;
      current = item;
      toolbar.hidden = false;
      updatePager(item);
      item.promise = render(item);
      return item.promise;
    }
    item = {
      href, label: String(label || "缴款单原件"),
      selectionKey, requestedInitialPage,
      pageNumber: requestedInitialPage,
      controller: new AbortController(), renderVersion: 0,
    };
    current = item;
    trimCache();
    toolbar.hidden = false;
    updatePager(item);
    state("正在加载原件…", "loading", true);
    item.promise = load(item);
    return item.promise;
  }

  function goToPage(value) {
    if (!current?.pdf) return;
    const number = Number(value);
    const page = Number.isFinite(number) ? Math.max(1, Math.min(current.pdf.numPages, Math.trunc(number))) : current.pageNumber;
    if (page === current.pageNumber) {
      updatePager();
      return;
    }
    current.pageNumber = page;
    updatePager();
    current.promise = render(current);
  }

  function resize() {
    if (!current?.pdf) return Promise.resolve();
    current.promise = render(current);
    return current.promise;
  }
  previous.addEventListener("click", () => goToPage((current?.pageNumber || 1) - 1));
  next.addEventListener("click", () => goToPage((current?.pageNumber || 1) + 1));
  pageInput.addEventListener("change", () => goToPage(pageInput.value));
  pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToPage(pageInput.value);
    }
  });
  retry.addEventListener("click", () => {
    if (!current) return;
    const requestedInitialPage = current.requestedInitialPage;
    void show({ url: current.href, label: current.label, initialPage: current.pageNumber, selectionKey: current.selectionKey }, true);
    // Retry the page the user was reading without changing the source-page hint.
    if (current) current.requestedInitialPage = requestedInitialPage;
  });
  if (window.ResizeObserver) new window.ResizeObserver(() => { void resize(); }).observe(viewport);
  else window.addEventListener?.("resize", () => { void resize(); });
  clear();
  return { show, hide, clear, resize };
}
