// Move the existing controls instead of rebuilding forms: drafts and listeners survive switches.
(() => {
  const $ = selector => document.querySelector(selector);
  const root = document.documentElement;
  const sidebar = $(".sidebar");
  const topbar = $(".topbar");
  const brand = sidebar.querySelector(".brand");
  const betaBrand = brand.innerHTML;
  const build = $('meta[name="application-build-version"]').content;
  const legacyBrand = `<span class="brand-mark">T7</span><span class="brand-copy"><strong>Tempest07</strong><small class="brand-product">Bond Centre <span class="brand-version" title="内部构建 ${build}">v${build}</span></small></span>`;
  const nodes = {
    actions: $(".top-actions"), screenshot: $("#projectScreenshotTool"), sync: $(".sidebar-card"),
    search: $("#projectSearch"), mail: $("#mailPanel"), output: $("#mailOutputPanel"),
    todos: $('.view[data-view="ledger"]>.ledger-todo-zone'),
    title: $(".project-ledger-title"), head: $(".project-ledger-toolbar>.panel-head"),
    filters: $(".project-list-tools"),
  };
  const homes = Object.values(nodes).map(node => {
    const marker = document.createComment("ui-layout-home");
    node.before(marker);
    return { node, marker };
  });
  const control = $("#uiBetaControl");
  const toggle = $("#uiBetaToggle");
  const commandTitle = $("#ledgerCommandTitle");
  const reminderHeading = $(".reminder-hero-copy h2");
  const betaReminderHeading = reminderHeading.innerHTML;
  const newProject = $("#newProjectButton");
  const betaNewProject = newProject.innerHTML;
  const focusHead = $(".reminder-focus-head>div");
  const nextAction = document.createElement("span");
  nextAction.textContent = "Next action";

  function applyMode(enabled, notify = true) {
    const focused = document.activeElement;
    const scroll = { left: window.scrollX, top: window.scrollY };
    root.dataset.ui = enabled ? "beta" : "legacy";
    const thinking = $(".connection-thinking");
    if (enabled && !thinking.firstElementChild) {
      thinking.append($("#connectionThinkingTemplate").content.cloneNode(true));
    }
    document.querySelectorAll("link[data-ui-beta]").forEach(link => { link.media = enabled ? "all" : "not all"; });
    $("#workspaceTools").open = false;
    // Android keeps its native shell controls; these nodes are also used by that shell.
    homes.forEach(({node, marker}) => marker.before(node));
    sidebar.classList.toggle("site-header", enabled);
    brand.innerHTML = enabled ? betaBrand : legacyBrand;
    if (!enabled) {
      sidebar.append(nodes.screenshot, nodes.sync);
      topbar.insertBefore(nodes.actions, $("#androidMoreButton"));
      nodes.filters.prepend(nodes.search);
      $(".ledger-command-heading").append(nodes.mail);
      $(".ledger-command-bottom").before(nodes.output);
      $('.view[data-view="ledger"]>.ledger-grid').before(nodes.todos);
      nodes.head.prepend(nodes.title);
      $(".project-ledger-toolbar").before(nodes.head, nodes.filters);
    }
    commandTitle.textContent = enabled ? "搜索与筛选项目" : "项目指挥台";
    commandTitle.classList.toggle("visually-hidden", enabled);
    nodes.search.placeholder = enabled ? "搜索债券、主体或联动分行" : "搜索简称、主体、联动分行或主承";
    reminderHeading.innerHTML = enabled ? betaReminderHeading : "把注意力留给<br><em>最重要的下一步</em>";
    newProject.innerHTML = enabled ? betaNewProject : "新增项目";
    if (enabled) nextAction.remove(); else focusHead.prepend(nextAction);
    const android = root.classList.contains("android-app");
    if (android) {
      $("#androidScreenshotMount").append(nodes.screenshot);
      $("#androidDataActionsMount").append(nodes.actions);
    }
    if (android) topbar.insertBefore(control, $("#androidMoreButton"));
    else if (enabled) sidebar.append(control);
    else nodes.actions.append(control);
    toggle.setAttribute("aria-checked", String(enabled));
    toggle.title = enabled ? "关闭新版网页 UI，恢复旧版" : "开启新版网页 UI";
    if (notify) document.dispatchEvent(new CustomEvent("bond-ui-change", { detail: { enabled } }));
    else {
      $("#pageTitle").textContent = enabled ? "Bond Centre" : "项目中心";
      $("#projectWorkspace").inert = enabled;
    }
    requestAnimationFrame(() => {
      if (focused?.isConnected && focused.getClientRects().length) focused.focus({ preventScroll: true });
      window.scrollTo({ ...scroll, behavior: "instant" });
    });
  }
  toggle.addEventListener("click", () => {
    const enabled = root.dataset.ui !== "beta";
    try { localStorage.setItem("bond-centre-ui-beta", String(enabled)); } catch { /* The selection still works for this page. */ }
    applyMode(enabled);
  });
  applyMode(root.dataset.ui === "beta", false);
})();

// Presentation only: the cloud gate remains the authority for readiness and errors.
(() => {
  const root = document.documentElement;
  const main = document.querySelector(".main");
  const gate = document.querySelector("#cloudGate");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let snapshot = null;
  let overlay = null;
  let animations = [];
  let timers = [];

  function cancelEntrance() {
    timers.forEach(clearTimeout);
    timers = [];
    animations.forEach(animation => animation.cancel());
    animations = [];
    overlay?.remove();
    overlay = null;
    main.classList.remove("connection-entering", "connection-entry-content");
  }

  function captureConnection() {
    snapshot = null;
    if (root.dataset.ui !== "beta" || gate.hidden
      || !gate.matches(".cloud-gate-connecting, .cloud-gate-success")) return;
    const art = gate.querySelector(".connection-thinking");
    const box = art.getBoundingClientRect();
    if (box.width && box.height) snapshot = { art, box, success: gate.classList.contains("cloud-gate-success") };
  }

  function enterWorkspace(source) {
    const title = document.querySelector("#pageTitle");
    const target = title.getBoundingClientRect();
    if (!target.width || !target.height || reducedMotion.matches) return;
    const font = getComputedStyle(title);
    const letters = Array.from(title.textContent);
    const step = Math.min(70, 750 / Math.max(letters.length, 1));
    const successHold = source.success ? 0 : 850;
    const moveAt = successHold + 200 + letters.length * step + 180;
    const endAt = moveAt + 800;
    const startX = source.box.left + source.box.width / 2;
    const startY = source.box.top + source.box.height * (277.6 / 512);
    const offsetX = startX - (target.left + target.width / 2);
    const offsetY = startY - (target.top + target.height / 2);

    overlay = document.createElement("div");
    overlay.className = "connection-entry-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const art = source.art.cloneNode(true);
    // Freeze each layer at its current position before leaving the loading layout.
    source.art.querySelectorAll("g[class], rect[class]").forEach((node, index) => {
      const copy = art.querySelectorAll("g[class], rect[class]")[index];
      const style = getComputedStyle(node);
      copy.style.transform = style.transform;
      copy.style.opacity = style.opacity;
    });
    art.className = "connection-entry-art";
    Object.assign(art.style, { left: `${source.box.left}px`, top: `${source.box.top}px`, width: `${source.box.width}px`, height: `${source.box.height}px` });
    const typed = document.createElement("div");
    typed.className = "connection-entry-title";
    Object.assign(typed.style, {
      left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`,
      fontFamily: font.fontFamily, fontSize: font.fontSize, fontWeight: font.fontWeight,
      fontStyle: font.fontStyle, lineHeight: font.lineHeight, letterSpacing: font.letterSpacing,
      textAlign: font.textAlign, color: font.color, webkitTextStroke: font.webkitTextStroke,
      whiteSpace: target.height <= parseFloat(font.lineHeight) * 1.2 ? "nowrap" : "normal",
    });
    letters.forEach((letter, index) => {
      const span = document.createElement("span");
      span.textContent = letter;
      typed.append(span);
      animations.push(span.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 1, delay: successHold + 200 + index * step, easing: "steps(1, end)", fill: "both",
      }));
    });
    overlay.append(art, typed);
    if (successHold) {
      const status = document.createElement("div");
      status.className = "connection-entry-status";
      status.textContent = "Connected";
      Object.assign(status.style, { left: `${startX}px`, top: `${source.box.bottom + 12}px` });
      overlay.append(status);
      animations.push(status.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, delay: successHold, fill: "both" }));
    }
    main.classList.add("connection-entering");
    document.body.append(overlay);
    animations.push(art.animate([{ opacity: 1, filter: "grayscale(1) contrast(1.45) blur(0px)", transform: "scale(1)" },
      { opacity: 0, filter: "grayscale(1) contrast(1.45) blur(4px)", transform: "scale(.9)" }],
    { duration: 450, delay: successHold, easing: "ease", fill: "both" }));
    const centered = `translate(${offsetX}px, ${offsetY}px) scale(.9)`;
    animations.push(typed.animate([
      { transform: centered, offset: 0 },
      { transform: centered, offset: moveAt / endAt, easing: "cubic-bezier(.4,0,.2,1)" },
      { transform: "translate(0, 0) scale(1)", offset: 1 },
    ], { duration: endAt, fill: "both" }));
    timers.push(setTimeout(() => main.classList.add("connection-entry-content"), endAt - 220));
    timers.push(setTimeout(cancelEntrance, endAt));
  }

  document.addEventListener("bond-cloud-gate-change", event => {
    const { locked, state } = event.detail;
    if (locked) {
      cancelEntrance();
      captureConnection();
    } else {
      const source = snapshot;
      snapshot = null;
      if (source && state === "success" && root.dataset.ui === "beta") {
        cancelEntrance();
        enterWorkspace(source);
      }
    }
  });
  document.addEventListener("bond-ui-change", () => {
    cancelEntrance();
    captureConnection();
  });
  // User actions or layout changes end this optional visual transition immediately.
  document.addEventListener("pointerdown", cancelEntrance, { capture: true });
  document.addEventListener("keydown", cancelEntrance, { capture: true });
  window.addEventListener("resize", cancelEntrance);
  window.addEventListener("hashchange", cancelEntrance);
  reducedMotion.addEventListener("change", cancelEntrance);
})();
