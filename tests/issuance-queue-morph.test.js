import test from "node:test";
import assert from "node:assert/strict";
import { createQueuePanelMorph, queueMorphFrame } from "../issuance-queue-morph.js";

function fixture({ reduced = false } = {}) {
  const animations = [];
  const surfaces = [];
  const listeners = {};
  const motionPreference = { matches: reduced, addEventListener(name, fn) { listeners[`motion:${name}`] = fn; } };
  const view = {
    innerHeight: 900, innerWidth: 1200,
    matchMedia: () => motionPreference,
    getComputedStyle: el => el.computed,
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  function element(rect) {
    return {
      rect, hidden: false, inert: false, attrs: {}, classes: new Set(),
      computed: { position: "fixed", borderRadius: "20px", boxShadow: "0 16px 55px #0000001a", opacity: "1" },
      style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } },
      classList: { add() {}, remove() {} },
      getBoundingClientRect() { return this.rect; },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      querySelectorAll() { return []; },
      cloneNode() { const clone = element(this.rect); clone.textContent = this.textContent; return clone; },
      remove() { const index = surfaces.indexOf(this); if (index >= 0) surfaces.splice(index, 1); },
      animate(frames, options) {
        let resolve, reject;
        const finished = new Promise((done, fail) => { resolve = done; reject = fail; });
        // Child animations are cancelled as a group too.
        finished.catch(() => {});
        const animation = { element: this, frames, options, finished, complete: resolve, cancel: () => reject(new Error("cancelled")) };
        animations.push(animation);
        return animation;
      },
    };
  }
  const panel = element({ left: 818, top: 90, width: 360, height: 260, right: 1178, bottom: 350 });
  const toggle = element({ left: 960, top: 25, width: 100, height: 36, right: 1060, bottom: 61 });
  toggle.textContent = "识别队列";
  panel.hidden = true;
  panel.ownerDocument = { defaultView: view, body: { append: node => surfaces.push(node) } };
  panel.children = [element({}), element({})];
  const motion = createQueuePanelMorph(panel, toggle);
  return { panel, toggle, motion, animations, listeners, surfaces };
}

test("morphs from the actual capsule bounds to panel dimensions with a damped curve", async () => {
  const ui = fixture();
  ui.motion.setOpen(true);
  const flight = ui.animations[0];
  assert.deepEqual(flight.frames[0], queueMorphFrame(ui.toggle.rect, "18px", "0 0 0 rgba(0,0,0,0)"));
  assert.equal(flight.frames[1].width, "360px");
  assert.equal(flight.frames[1].height, "260px");
  assert.equal(flight.options.easing, "cubic-bezier(.22, 1, .36, 1)");
  assert.equal(ui.panel.hidden, false);
  flight.complete(); await Promise.resolve();
  ui.motion.setOpen(false);
  const close = ui.animations[3];
  assert.equal(close.frames[1].width, "100px");
  assert.equal(ui.panel.hidden, false, "closing remains visible until the morph finishes");
  assert.equal(ui.panel.inert, true);
  close.complete(); await Promise.resolve();
  assert.equal(ui.panel.hidden, true);
});

test("rapid reversal resumes at the current bounds and stale completion cannot hide the reopened panel", async () => {
  const ui = fixture();
  ui.motion.setOpen(true);
  ui.panel.rect = { left: 900, top: 60, width: 210, height: 130, right: 1110, bottom: 190 };
  ui.motion.toggle();
  assert.equal(ui.animations[3].frames[0].width, "210px");
  ui.motion.toggle();
  ui.animations[0].complete(); ui.animations[3].complete();
  await Promise.resolve();
  assert.equal(ui.toggle.attrs["aria-expanded"], "true");
  assert.equal(ui.panel.hidden, false);
  ui.animations[6].complete(); await Promise.resolve();
  assert.equal(ui.panel.hidden, false);
  assert.equal(ui.panel.inert, false);
});

test("capsule text never fades or gets covered, and temporary surfaces are cleaned up", async () => {
  const ui = fixture();
  ui.motion.setOpen(true);
  assert.equal(ui.animations.some(animation => animation.element === ui.toggle), false);
  assert.equal(ui.surfaces.length, 1);
  assert.equal(ui.surfaces[0].textContent, "识别队列");
  assert.equal(ui.surfaces[0].style.opacity, "1");
  assert.equal(ui.surfaces[0].style.pointerEvents, "none");
  assert.equal(ui.surfaces[0].attrs["aria-hidden"], "true");
  ui.motion.toggle();
  assert.equal(ui.surfaces.length, 1, "a reversal replaces rather than stacks surfaces");
  ui.animations[3].complete(); await Promise.resolve();
  assert.equal(ui.panel.hidden, true);
  assert.equal(ui.surfaces.length, 0);
  assert.equal(ui.toggle.computed.opacity, "1");
  ui.motion.setOpen(true); ui.listeners.resize();
  assert.equal(ui.surfaces.length, 0);
});

test("reduced motion is immediate and a viewport change settles an active transition", () => {
  const reduced = fixture({ reduced: true });
  reduced.motion.setOpen(true);
  assert.equal(reduced.animations.length, 0);
  reduced.motion.toggle();
  assert.equal(reduced.panel.hidden, true);
  const ui = fixture();
  ui.motion.setOpen(true);
  ui.listeners.resize();
  assert.equal(ui.panel.hidden, false);
  ui.motion.setOpen(false);
  ui.listeners.scroll();
  assert.equal(ui.panel.hidden, true);
});

test("panel stays below the capsule after header wrapping, scrolling and reduced-motion opening", () => {
  const ui = fixture({ reduced: true });
  ui.toggle.rect = { ...ui.toggle.rect, top: 72, bottom: 108 };
  ui.motion.setOpen(true);
  assert.equal(ui.panel.style["--queue-panel-top"], "120px");
  ui.toggle.rect = { ...ui.toggle.rect, top: 110, bottom: 146 };
  ui.listeners.resize();
  assert.equal(ui.panel.style["--queue-panel-top"], "158px");
  ui.toggle.rect = { ...ui.toggle.rect, top: -50, bottom: -14 };
  ui.listeners.scroll();
  assert.equal(ui.panel.style["--queue-panel-top"], "12px");
  ui.toggle.rect = { ...ui.toggle.rect, top: 25, bottom: 61 };
  ui.listeners.scroll();
  assert.equal(ui.panel.style["--queue-panel-top"], "73px");
});
