import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BorderBeam } from "border-beam";

const search = document.querySelector("label.ledger-search");

function SearchBeam() {
  const content = useRef(null);
  const [enabled, setEnabled] = useState(document.documentElement.dataset.ui === "beta");
  const [radius, setRadius] = useState(24);

  useLayoutEffect(() => {
    // Keep the original input, its event listeners, and ui-mode's home marker intact.
    content.current.append(search);
    const measure = () => setRadius(parseFloat(getComputedStyle(search).borderTopLeftRadius) || 24);
    const observer = new ResizeObserver(measure);
    observer.observe(search);
    measure();
    const onModeChange = event => {
      setEnabled(event.detail.enabled);
      measure();
    };
    document.addEventListener("bond-ui-change", onModeChange);
    return () => {
      observer.disconnect();
      document.removeEventListener("bond-ui-change", onModeChange);
    };
  }, []);

  return <BorderBeam size="pulse-outside" colorVariant="ocean" strength={0.85}
    theme="light" active={enabled} borderRadius={radius} className="ledger-search-beam">
    <div ref={content} />
  </BorderBeam>;
}

if (search) {
  const mount = document.createElement("div");
  mount.className = "ledger-search-beam-root";
  search.before(mount);
  createRoot(mount).render(<SearchBeam />);
}
