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
