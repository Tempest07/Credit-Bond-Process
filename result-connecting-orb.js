import { MODE_FRAMES, paintFrame, resolvePreset } from "./vendor/thinking-orbs/engine.es.js?v=0.3.1";

// Use the library's native engine: the app does not need a React runtime.
export function createResultConnectingOrb(canvas) {
  const context = canvas.getContext("2d");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const { mode, speed, opts } = resolvePreset("connecting", 20);
  const size = 28;
  // The inline preset has too few neighbours for a legible network on black.
  // Keep upstream motion and geometry, with a denser, higher-contrast rendering.
  const connectingOpts = { ...opts, nodeN: 12, thr: 1.15 };
  let active = false;
  let visible = true;
  let frame = 0;
  let observer = null;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const draw = (time) => {
    const ratio = Math.max(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size * ratio)) canvas.width = canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    const scene = MODE_FRAMES[mode](size, time, connectingOpts);
    for (const line of scene.lines) {
      line.white = 0.12;
      line.a = Math.min(0.75, 0.3 + line.a * 0.8);
      line.w = Math.max(0.8, line.w);
    }
    for (const dot of scene.dots) dot.white = Math.min(0.25, dot.white);
    paintFrame(context, scene, true);
  };
  const tick = () => {
    frame = 0;
    if (!active || !visible || document.hidden || motion.matches) return;
    draw(performance.now() / 1000 * speed);
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    stop();
    if (!active || !context) return;
    if (motion.matches) draw(0.6);
    else if (visible && !document.hidden) {
      draw(performance.now() / 1000 * speed);
      frame = requestAnimationFrame(tick);
    }
  };
  return {
    setActive(value) {
      value = Boolean(value);
      if (value === active) return;
      active = value;
      canvas.hidden = !active;
      if (active) {
        visible = true;
        document.addEventListener("visibilitychange", sync);
        motion.addEventListener("change", sync);
        if (typeof IntersectionObserver !== "undefined") {
          observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
          observer.observe(canvas);
        }
      } else {
        observer?.disconnect();
        observer = null;
        document.removeEventListener("visibilitychange", sync);
        motion.removeEventListener("change", sync);
      }
      sync();
    },
    destroy() { this.setActive(false); },
  };
}
