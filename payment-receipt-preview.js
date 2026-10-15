const PDFJS_BASE = new URL("./vendor/pdfjs/", import.meta.url);
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
  const open = element("a", "button subtle payment-receipt-pdf-open", "新页打开");
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
    item.pdf = null;
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
    if (!width || (!force && item.renderedWidth === width && item.renderedPage === item.pageNumber)) return;
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
      state("", "ready");
    } catch {
      disposeCanvas(canvas);
      if (active(item) && item.renderVersion === version) {
        item.pendingCanvas = null;
        item.renderTask = null;
        state("原件预览失败，请重试或在新页打开。", "error");
      }
    }
  }

  function clear() {
    release(current);
    current = null;
    viewport.replaceChildren();
    toolbar.hidden = true;
    open.removeAttribute("href");
    updatePager();
    state("选择一张缴款单查看原件", "empty");
  }

  async function load(item) {
    try {
      const response = await fetchPdf(item.href, {
        credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store",
        signal: item.controller.signal,
      });
      if (!active(item)) return;
      if (!response.ok) throw new Error("PDF request failed");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!active(item)) return;
      const pdfjs = await getPdfJs();
      if (!active(item)) return;
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
      item.pageNumber = Math.max(1, Math.min(pdf.numPages, item.pageNumber));
      updatePager(item);
      await render(item);
    } catch {
      if (active(item)) state("原件预览失败，请重试或在新页打开。", "error");
    }
  }

  function show({ url, label = "缴款单原件", initialPage = 1 } = {}, force = false) {
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
      return current.promise;
    }
    clear();
    const item = {
      href, label: String(label || "缴款单原件"),
      pageNumber: Math.max(1, Math.trunc(Number(initialPage)) || 1),
      controller: new AbortController(), renderVersion: 0,
    };
    current = item;
    toolbar.hidden = false;
    open.href = href;
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
    void render(current);
  }

  function resize() { return current?.pdf ? render(current) : Promise.resolve(); }
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
    if (current) void show({ url: current.href, label: current.label, initialPage: current.pageNumber }, true);
  });
  if (window.ResizeObserver) new window.ResizeObserver(() => { void resize(); }).observe(viewport);
  else window.addEventListener?.("resize", () => { void resize(); });
  clear();
  return { show, clear, resize };
}
