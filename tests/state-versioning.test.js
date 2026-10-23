import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ensureStateVersionSchema,
  listStateSnapshots,
  pruneStateSnapshots,
  readStateSnapshot,
  saveStateVersion,
} from "../functions/api/_state-versioning.js";
import { prepareStoredState, readStoredStateRow, stateChunkStatements } from "../state-storage.js";

function database(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(`CREATE TABLE user_app_state (
    user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
  )`);
  const db = {
    sql,
    prepare(query) {
      const make = bindings => ({
        bind: (...values) => make(values),
        execute() {
          const statement = sql.prepare(query);
          if (statement.columns().length) {
            return { results: statement.all(...bindings).map(row => ({ ...row })), meta: { changes: 0 } };
          }
          return { results: [], meta: { changes: Number(statement.run(...bindings).changes) } };
        },
        async run() { return this.execute(); },
        async all() { return this.execute(); },
        async first() { return this.execute().results[0] || null; },
      });
      return make([]);
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.execute());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
}

function insertSnapshot(db, { userId = "admin", id, revision, savedAt, data, status = "accepted" }) {
  db.sql.prepare(`INSERT INTO user_app_state_snapshots (
    id, user_id, revision, base_revision, data, saved_at, status, save_reason
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'autosave')`).run(
    id, userId, revision, revision === null ? 7 : revision - 1, data, savedAt, status,
  );
}

test("fifty snapshots shrink to the latest ten while every remaining current, legacy and other-user reference stays readable", async t => {
  const db = database(t);
  await ensureStateVersionSchema(db);
  const versions = [];
  for (let index = 1; index <= 50; index++) {
    const data = { projects: [{ id: `p-${index}`, targetQuoteNote: `原备注 ${index}`, sourceText: "文".repeat(175_000) }] };
    const storage = await prepareStoredState(JSON.stringify(data));
    assert.ok(storage.chunks.length > 0);
    await db.batch(stateChunkStatements(db, storage));
    versions.push({ data, storage });
    insertSnapshot(db, {
      id: `v-${index}`, revision: index, data: storage.serialized,
      savedAt: new Date(Date.parse("2026-10-23T00:00:00Z") + Math.floor(index / 2) * 1000).toISOString(),
    });
  }
  const currentAt = "2026-10-23T06:00:00.000Z";
  db.sql.prepare("INSERT INTO user_app_state VALUES (?, ?, ?, ?)").run("admin", versions[0].storage.serialized, currentAt, 1947);
  db.sql.prepare("INSERT INTO app_state VALUES (1, ?, ?)").run(versions[1].storage.serialized, currentAt);
  insertSnapshot(db, { userId: "other", id: "other-shared", revision: 1, data: versions[2].storage.serialized, savedAt: currentAt });
  const otherCurrent = await prepareStoredState(JSON.stringify({ projects: [{ id: "other", sourceText: "另".repeat(175_000) }] }));
  await db.batch(stateChunkStatements(db, otherCurrent));
  db.sql.prepare("INSERT INTO user_app_state VALUES (?, ?, ?, ?)").run("other", otherCurrent.serialized, currentAt, 8);
  const currentBefore = db.sql.prepare("SELECT * FROM user_app_state ORDER BY user_id").all();
  const legacyBefore = db.sql.prepare("SELECT * FROM app_state").all();

  await pruneStateSnapshots(db, "admin");
  await ensureStateVersionSchema(db);

  const expected = Array.from({ length: 10 }, (_, index) => `v-${50 - index}`);
  assert.deepEqual((await listStateSnapshots(db, "admin")).map(item => item.id), expected);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM user_app_state_snapshots WHERE user_id = 'admin'").get().n, 10);
  assert.deepEqual(db.sql.prepare("SELECT * FROM user_app_state ORDER BY user_id").all(), currentBefore);
  assert.deepEqual(db.sql.prepare("SELECT * FROM app_state").all(), legacyBefore);
  assert.deepEqual((await readStoredStateRow(db, "current", ["admin"])).data, versions[0].data);
  assert.deepEqual((await readStoredStateRow(db, "legacy")).data, versions[1].data);
  assert.deepEqual((await readStateSnapshot(db, "other", "other-shared")).data, versions[2].data);
  assert.deepEqual((await readStoredStateRow(db, "current", ["other"])).data, JSON.parse(otherCurrent.chunks.join("")));
  for (let index = 41; index <= 50; index++) {
    assert.deepEqual((await readStateSnapshot(db, "admin", `v-${index}`)).data, versions[index - 1].data);
  }
  assert.equal(await readStateSnapshot(db, "admin", "v-40"), null);
  const remainingIds = db.sql.prepare("SELECT DISTINCT storage_id FROM app_state_chunks").all().map(row => row.storage_id).sort();
  assert.deepEqual(remainingIds, [
    ...versions.slice(0, 3), ...versions.slice(40), { storage: otherCurrent },
  ].map(item => item.storage.chunkId).sort());
});

test("history defaults and caps to ten with stable saved-time and insertion-order sorting", async t => {
  const db = database(t);
  await ensureStateVersionSchema(db);
  for (let index = 1; index <= 14; index++) {
    insertSnapshot(db, { id: `v-${index}`, revision: index, data: "{}", savedAt: "2026-10-23T00:00:00.000Z" });
  }
  for (const limit of [undefined, null, "", "invalid", 0, 50, Infinity]) {
    assert.deepEqual((await listStateSnapshots(db, "admin", limit)).map(item => item.id),
      Array.from({ length: 10 }, (_, index) => `v-${14 - index}`));
  }
  assert.equal((await listStateSnapshots(db, "admin", 3.9)).length, 3);
  assert.equal((await listStateSnapshots(db, "admin", -5)).length, 1);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM user_app_state_snapshots").get().n, 14, "listing itself does not prune history");
});

test("accepted and conflict saves share the ten-snapshot budget without replacing the current state on conflict", async t => {
  const db = database(t);
  await ensureStateVersionSchema(db);
  const initial = { projects: [{ id: "p", targetQuoteNote: "保留备注", bidActions: [{ type: "参团+投标" }] }], updatedAt: "2026-10-23T00:00:00Z" };
  db.sql.prepare("INSERT INTO user_app_state VALUES (?, ?, ?, ?)").run("admin", JSON.stringify(initial), initial.updatedAt, 20);
  for (let index = 1; index <= 10; index++) {
    insertSnapshot(db, { id: `old-${index}`, revision: index, data: "{}", savedAt: `2026-10-22T00:00:${String(index).padStart(2, "0")}Z` });
  }

  const accepted = await saveStateVersion(db, "admin", {
    expectedRevision: 20, data: { ...initial, issuers: [{ id: "issuer" }] }, mirrorLegacy: true,
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.revision, 21);
  assert.equal((await listStateSnapshots(db, "admin")).length, 10);
  assert.equal(await readStateSnapshot(db, "admin", "old-1"), null);
  const currentBeforeConflict = db.sql.prepare("SELECT * FROM user_app_state").all();
  const legacyBeforeConflict = db.sql.prepare("SELECT * FROM app_state").all();
  const conflictData = { ...initial, projects: [{ ...initial.projects[0], sourceText: "冲突原文".repeat(50_000) }] };

  const conflict = await saveStateVersion(db, "admin", { expectedRevision: 20, data: conflictData, mirrorLegacy: true });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.revision, 21);
  assert.equal((await listStateSnapshots(db, "admin")).length, 10);
  assert.equal(await readStateSnapshot(db, "admin", "old-2"), null);
  assert.deepEqual((await readStateSnapshot(db, "admin", conflict.snapshot.id)).data, conflictData);
  assert.deepEqual((await readStateSnapshot(db, "admin", accepted.snapshot.id)).data, accepted.data);
  assert.deepEqual(db.sql.prepare("SELECT * FROM user_app_state").all(), currentBeforeConflict);
  assert.deepEqual(db.sql.prepare("SELECT * FROM app_state").all(), legacyBeforeConflict);
  assert.deepEqual((await readStoredStateRow(db, "current", ["admin"])).data.projects, initial.projects);
});

test("migration seeds an empty history once and does not resurrect a current revision displaced by newer conflict snapshots", async t => {
  const db = database(t);
  const original = { projects: [{ id: "p", targetQuoteNote: "保持原文" }] };
  db.sql.prepare("INSERT INTO user_app_state VALUES (?, ?, ?, ?)").run("admin", JSON.stringify(original), "2026-10-20T00:00:00Z", 7);
  const otherOriginal = { projects: [{ id: "other", targetQuoteNote: "另一用户原文" }] };
  db.sql.prepare("INSERT INTO user_app_state VALUES (?, ?, ?, ?)").run("other", JSON.stringify(otherOriginal), "2026-10-21T00:00:00Z", 9);
  await ensureStateVersionSchema(db);
  assert.deepEqual((await readStateSnapshot(db, "admin", "admin:revision:7")).data, original);
  assert.deepEqual((await readStateSnapshot(db, "other", "other:revision:9")).data, otherOriginal);
  for (let index = 1; index <= 10; index++) {
    insertSnapshot(db, { id: `conflict-${index}`, revision: null, status: "conflict", data: JSON.stringify({ ...original, client: index }),
      savedAt: `2026-10-23T00:00:${String(index).padStart(2, "0")}Z` });
  }
  await pruneStateSnapshots(db, "admin");
  assert.equal(await readStateSnapshot(db, "admin", "admin:revision:7"), null);
  await ensureStateVersionSchema(db);
  await ensureStateVersionSchema(db);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM user_app_state_snapshots WHERE user_id = 'admin'").get().n, 10);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM user_app_state_snapshots WHERE user_id = 'other'").get().n, 1);
  assert.equal(await readStateSnapshot(db, "admin", "admin:revision:7"), null);
  assert.deepEqual((await readStateSnapshot(db, "other", "other:revision:9")).data, otherOriginal);
  const current = await readStoredStateRow(db, "current", ["admin"]);
  assert.deepEqual(current.data, original);
  assert.equal(current.revision, 7);
  assert.equal(current.updated_at, "2026-10-20T00:00:00Z");
});
