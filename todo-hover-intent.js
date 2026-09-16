export function createHoverIntent(onIntent, { delay = 60, tolerance = 3, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let candidate = null, timer;
  function reset() { cancel(timer); candidate = null; }
  return {
    move(id, x, y) {
      if (candidate?.id === id && Math.hypot(x - candidate.x, y - candidate.y) <= tolerance) return;
      reset();
      const next = { id, x, y };
      candidate = next;
      timer = schedule(() => {
        if (candidate !== next) return;
        candidate = null;
        onIntent(id);
      }, delay);
    },
    cancel: reset,
  };
}
