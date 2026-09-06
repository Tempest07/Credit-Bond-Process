// The matching stylesheet links before this classic script finish loading first.
// Disable beta styles for classic users before the parser can render the body.
(() => {
  const key = "bond-centre-ui-beta";
  let enabled = false;
  try { enabled = localStorage.getItem(key) === "true"; } catch { /* Default to the classic UI. */ }
  document.documentElement.dataset.ui = enabled ? "beta" : "legacy";
  document.querySelectorAll("link[data-ui-beta]").forEach(link => {
    link.media = enabled ? "all" : "not all";
  });
})();
