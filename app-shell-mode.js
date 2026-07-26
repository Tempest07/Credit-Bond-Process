(() => {
  const isAndroidApp = navigator.userAgent.includes("Tempest07Android/");
  const isLocalAndroidPreview = new URLSearchParams(location.search).get("app-shell") === "android"
    && ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  if (isAndroidApp || isLocalAndroidPreview) {
    document.documentElement.classList.add("android-app");
  }
  if (isLocalAndroidPreview) {
    document.documentElement.classList.add("android-app-preview");
  }
})();
