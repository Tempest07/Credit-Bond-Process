import assert from "node:assert/strict";
import test from "node:test";
import { readStateBodyText, StateCapacityError } from "../functions/api/_state-capacity.js";

test("bounded state body decoding preserves Unicode split across network chunks", async () => {
  const text = '{"value":"汉😀"}';
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const request = new Request("https://example.com/api/state", { method: "PUT", body, duplex: "half" });
  assert.equal(await readStateBodyText(request), text);
});

test("oversized streaming bodies are cancelled before JSON parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(5_100_001));
    controller.enqueue(new Uint8Array(5_100_001));
  }, cancel() { cancelled = true; } });
  const request = new Request("https://example.com/api/state", { method: "PUT", body, duplex: "half" });
  await assert.rejects(readStateBodyText(request), StateCapacityError);
  assert.equal(cancelled, true);
});
