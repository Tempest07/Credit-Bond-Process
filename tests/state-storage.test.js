import assert from "node:assert/strict";
import test from "node:test";
import { prepareStoredState, readStoredState, readStoredStateRow, StateStorageError } from "../state-storage.js";

function chunkDb(storage) {
  const db = { rows: storage.chunks.map((chunk_data, chunk_index) => ({ chunk_index, chunk_data })),
    prepare(sql) { return { bind() { return this; }, async all() {
      assert.match(sql, /FROM app_state_chunks/);
      return { results: db.rows };
    } }; },
  };
  return db;
}

test("old JSON remains directly readable and small writes keep their exact bytes", async () => {
  const serialized = '{ "issuers": [], "projects": [{"id":"p","targetQuoteNote":"原备注"}] }';
  const storage = await prepareStoredState(serialized);
  assert.equal(storage.serialized, serialized);
  assert.deepEqual(storage.chunks, []);
  assert.deepEqual(await readStoredState(null, serialized), JSON.parse(serialized));
});

test("large Unicode JSON crosses chunk boundaries without changing any content", async () => {
  const data = { issuers: [], projects: [{ id: "unicode", sourceText: "汉😀\ufeff".repeat(400_000), targetQuoteNote: "\n  手工备注\n" }] };
  const serialized = JSON.stringify(data);
  const storage = await prepareStoredState(serialized);
  assert.ok(storage.chunks.length > 2);
  assert.equal(storage.chunks.join(""), serialized);
  assert.ok(storage.chunks.every(chunk => Buffer.byteLength(chunk) <= 1_000_000));
  assert.equal(storage.byteSize, Buffer.byteLength(serialized));
  const db = chunkDb(storage);
  assert.deepEqual(await readStoredState(db, storage.serialized), data);
});

test("missing, reordered, altered, or unknown-version chunks fail closed", async () => {
  const storage = await prepareStoredState(JSON.stringify({ issuers: [], projects: [{ text: "文".repeat(400_000) }] }));
  for (const mutate of [rows => rows.pop(), rows => rows.reverse(), rows => { rows[0].chunk_data += "x"; }]) {
    const db = chunkDb(storage); mutate(db.rows);
    await assert.rejects(readStoredState(db, storage.serialized), StateStorageError);
  }
  const bad = JSON.parse(storage.serialized); bad.$bondCentreStateChunks = 2;
  await assert.rejects(readStoredState(chunkDb(storage), JSON.stringify(bad)), StateStorageError);
});

test("manifest whitespace and key order are accepted, but business payloads cannot use its reserved key", async () => {
  const storage = await prepareStoredState(JSON.stringify({ issuers: [], projects: [{ text: "x".repeat(600_000) }] }));
  const manifest = JSON.parse(storage.serialized);
  const rearranged = JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse()), null, 2);
  assert.deepEqual(await readStoredState(chunkDb(storage), rearranged), { issuers: [], projects: [{ text: "x".repeat(600_000) }] });
  await assert.rejects(prepareStoredState(JSON.stringify({ issuers: [], $bondCentreStateChunks: 1 })), StateStorageError);
});

test("a manifest reader re-reads root metadata and chunks together after a concurrent save", async () => {
  const old = await prepareStoredState(JSON.stringify({ issuers: [], projects: [{ text: "x".repeat(600_000) }] }));
  const latest = { issuers: [], projects: [{ id: "new", targetQuoteNote: "保留" }] };
  let calls = 0;
  const db = { prepare(sql) { return { bind() { return this; }, async first() {
    calls++; return { data: old.serialized, revision: 1 };
  }, async all() {
    calls++; assert.match(sql, /LEFT JOIN app_state_chunks/);
    return { results: [{ data: JSON.stringify(latest), revision: 2, chunk_index: null, chunk_data: null }] };
  } }; } };
  const row = await readStoredStateRow(db, "current", ["admin"]);
  assert.equal(calls, 2);
  assert.equal(row.revision, 2);
  assert.deepEqual(row.data, latest);
});
