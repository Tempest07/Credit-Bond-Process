import assert from 'node:assert/strict';
import test from 'node:test';
import { createHoverIntent } from '../todo-hover-intent.js';

function fixture() {
 let now = 0, sequence = 0;
 const timers = new Map(), fired = [];
 const intent = createHoverIntent(id => fired.push(id), {
   schedule(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
   cancel(id) { timers.delete(id); },
 });
 return { intent, fired, advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } } };
}

test('crossing the left card while moving never steals expansion from the right card', () => {
 const f = fixture();
 f.intent.move('left', 100, 100); f.advance(40);
 f.intent.move('left', 180, 100); f.advance(40);
 f.intent.move('left', 260, 100); f.advance(40);
 assert.deepEqual(f.fired, []);
 f.intent.cancel(); f.intent.move('right', 600, 100); f.advance(59);
 assert.deepEqual(f.fired, []);
 f.advance(1); assert.deepEqual(f.fired, ['right']);
});
test('small pointer jitter does not indefinitely postpone an intentional hover', () => {
 const f = fixture();
 f.intent.move('right', 600, 100); f.advance(30);
 f.intent.move('right', 601, 101); f.advance(30);
 assert.deepEqual(f.fired, ['right']);
});
test('leaving a card cancels its pending intent', () => {
 const f = fixture();
 f.intent.move('left', 100, 100); f.advance(50); f.intent.cancel(); f.advance(1000);
 assert.deepEqual(f.fired, []);
});
