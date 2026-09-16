const FLUID_EASING = "cubic-bezier(.22, 1, .36, 1)";

export function queueMorphFrame(rect, radius, shadow) {
  return {
    left: `${rect.left}px`, top: `${rect.top}px`, right: "auto",
    width: `${rect.width}px`, height: `${rect.height}px`,
    borderRadius: radius, boxShadow: shadow, maxHeight: "none",
  };
}

// Animate the surface's real dimensions. Contents keep their final width and are
// revealed inside its overflow clip, so text never stretches with the capsule.
export function createQueuePanelMorph(panel, toggle) {
  const view = panel.ownerDocument?.defaultView;
  const reduced = view?.matchMedia("(prefers-reduced-motion: reduce)");
  let opened = !panel.hidden;
  let flight = null;
  let animations = [];
  let generation = 0;
  let anchorSurface = null;

  function positionPanel() {
    if (!view || view.getComputedStyle(panel).position !== "fixed") return;
    const button = toggle.getBoundingClientRect();
    const visible = button.bottom > 0 && button.top < view.innerHeight;
    // Follow the actual header layout (including wrapping and browser zoom).
    // Reserve a gap below the capsule instead of using a fixed page offset.
    const top = visible ? Math.max(12, button.bottom + 12) : 12;
    panel.style.setProperty("--queue-panel-top", `${top}px`);
  }

  function cancel() {
    generation++;
    animations.forEach(animation => animation.cancel());
    animations = [];
    flight = null;
    anchorSurface?.remove();
    anchorSurface = null;
    panel.classList?.remove("is-morphing");
    panel.style?.removeProperty("--queue-content-width");
  }

  function settle() {
    cancel();
    positionPanel();
    panel.hidden = !opened;
    panel.inert = !opened;
    toggle.setAttribute("aria-expanded", String(opened));
  }

  function setOpen(next, refresh = false) {
    if (next === opened && !refresh) return;
    const wasHidden = panel.hidden;
    const current = !wasHidden && view ? panel.getBoundingClientRect() : null;
    const currentStyle = current ? view.getComputedStyle(panel) : null;
    const previousRadius = currentStyle?.borderRadius;
    const previousShadow = currentStyle?.boxShadow;
    const children = panel.children ? [...panel.children] : [];
    const opacities = children.map(child => wasHidden ? 0 : Number(view?.getComputedStyle(child).opacity ?? 1));
    const transforms = children.map(child => wasHidden ? "translateY(5px)" : view?.getComputedStyle(child).transform || "none");
    opened = next;
    cancel();
    positionPanel();
    toggle.setAttribute("aria-expanded", String(opened));
    panel.inert = !opened;

    if (!view || !panel.animate || reduced.matches || view.getComputedStyle(panel).position !== "fixed") {
      settle();
      return;
    }

    panel.hidden = false;
    const destination = panel.getBoundingClientRect();
    const style = view.getComputedStyle(panel);
    const button = toggle.getBoundingClientRect();
    const buttonVisible = button.bottom > 0 && button.top < view.innerHeight && button.right > 0 && button.left < view.innerWidth;
    // When scrolled away from the header, emerge from a compact capsule at the
    // viewport edge instead of travelling through off-screen document space.
    const capsule = buttonVisible ? button : {
      left: Math.max(12, destination.right - button.width), top: 12,
      width: button.width, height: button.height,
    };
    const capsuleRadius = `${capsule.height / 2}px`;
    const start = current
      ? queueMorphFrame(current, previousRadius, previousShadow)
      : queueMorphFrame(capsule, capsuleRadius, "0 0 0 rgba(0,0,0,0)");
    const end = opened
      ? queueMorphFrame(destination, style.borderRadius, style.boxShadow)
      : queueMorphFrame(capsule, capsuleRadius, "0 0 0 rgba(0,0,0,0)");
    const duration = opened ? 480 : 400;
    const token = generation;
    if (buttonVisible) {
      // Keep the capsule label above the travelling surface. Never fade the
      // real button: its text and hit target remain stable through reversals.
      anchorSurface = toggle.cloneNode(true);
      anchorSurface.removeAttribute("id");
      anchorSurface.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
      anchorSurface.setAttribute("aria-hidden", "true");
      anchorSurface.tabIndex = -1;
      anchorSurface.inert = true;
      const anchorStyle = view.getComputedStyle(toggle);
      Object.assign(anchorSurface.style, {
        position: "fixed", zIndex: "1501", pointerEvents: "none", margin: "0",
        left: `${button.left}px`, top: `${button.top}px`,
        width: `${button.width}px`, height: `${button.height}px`, boxSizing: "border-box",
        font: anchorStyle.font, color: anchorStyle.color, background: anchorStyle.background,
        border: anchorStyle.border, borderRadius: anchorStyle.borderRadius,
        padding: anchorStyle.padding, gap: anchorStyle.gap, letterSpacing: anchorStyle.letterSpacing,
        opacity: "1",
      });
      panel.ownerDocument.body.append(anchorSurface);
    }
    panel.style.setProperty("--queue-content-width", `${destination.width - 2}px`);
    panel.classList.add("is-morphing");
    flight = panel.animate([start, end], { duration, easing: FLUID_EASING, fill: "both" });
    animations.push(flight);
    children.forEach((child, index) => {
      const frames = opened
        ? [{ opacity: opacities[index], transform: transforms[index] },
          { opacity: opacities[index], transform: transforms[index], offset: .16 },
          { opacity: 1, transform: "translateY(0)", offset: .8 },
          { opacity: 1, transform: "translateY(0)" }]
        : [{ opacity: opacities[index] }, { opacity: 0, offset: .26 }, { opacity: 0 }];
      animations.push(child.animate(frames, { duration, easing: "ease-out", fill: "both" }));
    });
    flight.finished.then(() => {
      if (token === generation) settle();
    }, () => { /* A reversal or resize replaces the old animation. */ });
  }

  const reposition = () => { if (flight) settle(); else if (opened) positionPanel(); };
  view?.addEventListener("resize", reposition);
  view?.addEventListener("scroll", reposition, { passive: true });
  reduced?.addEventListener("change", () => { if (flight) settle(); });
  return {
    setOpen,
    toggle: () => setOpen(!opened),
    refresh: () => { if (flight && opened) setOpen(true, true); else if (opened) positionPanel(); },
  };
}
