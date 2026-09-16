import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { MODE_FRAMES, resolvePreset } from "../vendor/thinking-orbs/engine.es.js";

const source = await readFile(new URL("../result-connecting-orb.js", import.meta.url), "utf8");
test("vendored renderer is the installed upstream engine and selects connecting's inline preset", async () => {
  assert.equal((await readFile(new URL("../vendor/thinking-orbs/engine.es.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n"),
    (await readFile(new URL("../node_modules/thinking-orbs/dist/engine.es.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n"));
  assert.equal(resolvePreset("connecting", 20).mode, "web");
});

test("orb animates only while processing and visible, respects reduced motion and cleans up", () => {
  const raf = new Map(), events = new Map(), motionEvents = new Map(), draws = [];
  let id = 0, observer;
  const motion = {matches:false, addEventListener:(n,f)=>motionEvents.set(n,f),removeEventListener:n=>motionEvents.delete(n)};
  const doc = {hidden:false,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
  const canvas = {width:20,height:20,hidden:true,getContext:()=>({setTransform(){},clearRect(){}})};
  const context = vm.createContext({
    resolvePreset: (state,size)=>{assert.equal(state,"connecting");assert.equal(size,20);return {mode:"web",speed:1,opts:{}};},
    MODE_FRAMES:{web:(size,time,opts)=>{draws.push({size,time,opts});return {lines:[{white:0.42,a:0.05,w:0.6}],dots:[{white:0.55}]};}},
    paintFrame:(_ctx,scene,dark)=>{assert.equal(dark,true);assert.ok(scene.lines[0].a>=0.3);assert.ok(scene.lines[0].w>=0.8);assert.ok(scene.dots[0].white<=0.25);},
    document:doc,window:{devicePixelRatio:2},matchMedia:()=>motion,performance:{now:()=>1000},
    requestAnimationFrame:f=>{raf.set(++id,f);return id;},cancelAnimationFrame:n=>raf.delete(n),
    IntersectionObserver:class {constructor(cb){this.cb=cb;observer=this;}observe(){}disconnect(){this.disconnected=true;}},
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/m, "").replace("export function", "function"),context);
  const orb = context.createResultConnectingOrb(canvas);
  orb.setActive(true);
  assert.equal(canvas.hidden,false);
  assert.equal(canvas.width,56);
  assert.equal(draws.at(-1).size,28);
  for (let time = 0; time <= 30; time += 0.5) {
    const scene = MODE_FRAMES.web(28,time,draws.at(-1).opts);
    assert.ok(scene.lines.length >= 12, `connecting must retain visible links at ${time}s`);
  }
  context.window.devicePixelRatio=3;
  assert.equal(raf.size,1);
  orb.setActive(true);
  assert.equal(raf.size,1);
  observer.cb([{isIntersecting:false}]);
  assert.equal(raf.size,0);
  observer.cb([{isIntersecting:true}]);
  assert.equal(raf.size,1);
  assert.equal(canvas.width,84);
  doc.hidden=true;events.get("visibilitychange")();
  assert.equal(raf.size,0);
  doc.hidden=false;events.get("visibilitychange")();
  assert.equal(raf.size,1);
  motion.matches=true;motionEvents.get("change")();
  assert.equal(raf.size,0);
  assert.equal(draws.at(-1).time,0.6);
  orb.setActive(false);
  assert.equal(canvas.hidden,true);
  assert.equal(events.size,0);
  assert.equal(motionEvents.size,0);
  assert.equal(observer.disconnected,true);
  orb.destroy();
});
