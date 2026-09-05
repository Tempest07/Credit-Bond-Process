// Read before the body is rendered so returning visitors do not see the wrong UI.
(() => {
  const key = "bond-centre-ui-beta";
  let enabled = false;
  try { enabled = localStorage.getItem(key) === "true"; } catch { /* Default to the classic UI. */ }
  document.documentElement.dataset.ui = enabled ? "beta" : "legacy";
  document.querySelectorAll("link[data-ui-beta]").forEach(link => {
    link.media = enabled ? "all" : "not all";
  });
})();
