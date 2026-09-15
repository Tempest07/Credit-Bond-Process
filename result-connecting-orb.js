import { MODE_DRAWS, resolvePreset } from "./vendor/thinking-orbs/engine.es.js?v=0.3.1";

// Use the library's native engine: the app does not need a React runtime.
export function createResultConnectingOrb(canvas) {
  const context = canvas.getContext("2d");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const { mode, speed, opts } = resolvePreset("connecting", 20);
  let active = false;
  let visible = true;
  let frame = 0;
  let observer = null;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const draw = (time) => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(20 * ratio)) canvas.width = canvas.height = Math.round(20 * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, 20, 20);
    MODE_DRAWS[mode](context, 20, time, true, opts);
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
