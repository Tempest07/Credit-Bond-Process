import {
  normalizeStateSaveMeta,
  statePayloadEquals,
  summarizeStateChange,
} from "../../state-history.js";
import { readUserAppState } from "./_auth.js";

const SNAPSHOT_RETENTION = 50;

export async function ensureStateVersionSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_app_state_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      revision INTEGER,
      base_revision INTEGER,
      data TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      status TEXT NOT NULL,
      save_reason TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '',
      client_label TEXT NOT NULL DEFAULT '',
      restored_from_snapshot_id TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      byte_size INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, revision)
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_user_app_state_snapshots_user_saved
    ON user_app_state_snapshots(user_id, saved_at DESC)
  `).run();
  await db.prepare(`
    INSERT OR IGNORE INTO user_app_state_snapshots (
      id, user_id, revision, base_revision, data, saved_at, status, save_reason,
      client_id, client_label, summary_json, byte_size
    )
    SELECT
      user_id || ':revision:' || revision,
      user_id,
      revision,
      CASE WHEN revision > 0 THEN revision - 1 ELSE NULL END,
      data,
      updated_at,
      'accepted',
      'migration',
      '',
      '历史云端状态',
      '{"total":0,"collections":{},"settings":[]}',
      length(CAST(data AS BLOB))
    FROM user_app_state
  `).run();
}

export async function saveStateVersion(db, userId, options = {}) {
  const current = await readUserAppState(db, userId);
  const expectedRevision = Number(options.expectedRevision);
  const data = options.data;
  const meta = normalizeStateSaveMeta(options.meta, "autosave");

  if (statePayloadEquals(current.data, data)) {
    return {
      status: "unchanged",
      data: current.data,
      revision: current.revision,
      updatedAt: current.updatedAt,
      snapshot: null,
    };
  }

  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
    const snapshot = options.preserveConflict === false
      ? null
      : await saveConflictSnapshot(db, userId, {
        data,
        baseRevision: Number.isInteger(expectedRevision) ? expectedRevision : null,
        currentData: current.data,
        meta,
      });
    return {
      status: "conflict",
      revision: current.revision,
      updatedAt: current.updatedAt,
      snapshot,
    };
  }

  const updatedAt = new Date().toISOString();
  const nextData = { ...data, updatedAt };
  const serialized = JSON.stringify(nextData);
  const revision = current.revision + 1;
  const snapshotId = crypto.randomUUID();
  const summary = summarizeStateChange(current.data, nextData);
  const summaryJson = JSON.stringify(summary);
  const restoredFromSnapshotId = cleanId(options.restoredFromSnapshotId);

  const statements = [
    db.prepare(`
      UPDATE user_app_state
      SET data = ?1, updated_at = ?2, revision = ?3
      WHERE user_id = ?4 AND revision = ?5
    `).bind(serialized, updatedAt, revision, userId, expectedRevision),
    db.prepare(`
      INSERT INTO user_app_state_snapshots (
        id, user_id, revision, base_revision, data, saved_at, status, save_reason,
        client_id, client_label, restored_from_snapshot_id, summary_json, byte_size
      )
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'accepted', ?7, ?8, ?9, ?10, ?11, ?12
      WHERE changes() = 1
        AND EXISTS (
        SELECT 1 FROM user_app_state
        WHERE user_id = ?2 AND revision = ?3 AND updated_at = ?6 AND data = ?5
      )
    `).bind(
      snapshotId,
      userId,
      revision,
      expectedRevision,
      serialized,
      updatedAt,
      meta.source,
      meta.clientId,
      meta.clientLabel,
      restoredFromSnapshotId || null,
      summaryJson,
      new TextEncoder().encode(serialized).byteLength,
    ),
  ];
  if (options.mirrorLegacy) {
    statements.push(db.prepare(`
      INSERT INTO app_state (id, data, updated_at)
      SELECT 1, ?1, ?2
      WHERE changes() = 1
        AND EXISTS (
        SELECT 1 FROM user_app_state
        WHERE user_id = ?3 AND revision = ?4 AND updated_at = ?2 AND data = ?1
      )
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).bind(serialized, updatedAt, userId, revision));
  }
  const results = await db.batch(statements);

  const stateChanges = resultChanges(results[0]);
  const snapshotChanges = resultChanges(results[1]);
  const legacyChanges = options.mirrorLegacy ? resultChanges(results[2]) : 1;
  if (stateChanges !== 1 || snapshotChanges !== 1 || legacyChanges !== 1) {
    const latest = await readUserAppState(db, userId);
    const snapshot = options.preserveConflict === false
      ? null
      : await saveConflictSnapshot(db, userId, {
        data,
        baseRevision: expectedRevision,
        currentData: latest.data,
        meta,
      });
    return {
      status: "conflict",
      revision: latest.revision,
      updatedAt: latest.updatedAt,
      snapshot,
    };
  }

  await pruneSnapshots(db, userId);
  return {
    status: "accepted",
    data: nextData,
    revision,
    updatedAt,
    snapshot: {
      id: snapshotId,
      revision,
      baseRevision: expectedRevision,
      savedAt: updatedAt,
      status: "accepted",
      saveReason: meta.source,
      clientId: meta.clientId,
      clientLabel: meta.clientLabel,
      restoredFromSnapshotId: restoredFromSnapshotId || null,
      summary,
    },
  };
}

export async function listStateSnapshots(db, userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, SNAPSHOT_RETENTION));
  const result = await db.prepare(`
    SELECT
      id, revision, base_revision, saved_at, status, save_reason,
      client_id, client_label, restored_from_snapshot_id, summary_json, byte_size
    FROM user_app_state_snapshots
    WHERE user_id = ?1
    ORDER BY saved_at DESC, rowid DESC
    LIMIT ?2
  `).bind(userId, safeLimit).all();
  return (result.results || []).map(snapshotMetadata);
}

export async function readStateSnapshot(db, userId, snapshotId) {
  const row = await db.prepare(`
    SELECT
      id, revision, base_revision, data, saved_at, status, save_reason,
      client_id, client_label, restored_from_snapshot_id, summary_json, byte_size
    FROM user_app_state_snapshots
    WHERE user_id = ?1 AND id = ?2
  `).bind(userId, cleanId(snapshotId)).first();
  if (!row) return null;
  return {
    ...snapshotMetadata(row),
    data: JSON.parse(row.data),
  };
}

async function saveConflictSnapshot(db, userId, options) {
  const savedAt = new Date().toISOString();
  const serialized = JSON.stringify(options.data);
  const summary = summarizeStateChange(options.currentData, options.data);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO user_app_state_snapshots (
      id, user_id, revision, base_revision, data, saved_at, status, save_reason,
      client_id, client_label, summary_json, byte_size
    )
    VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'conflict', ?6, ?7, ?8, ?9, ?10)
  `).bind(
    id,
    userId,
    Number.isInteger(options.baseRevision) ? options.baseRevision : null,
    serialized,
    savedAt,
    options.meta.source,
    options.meta.clientId,
    options.meta.clientLabel,
    JSON.stringify(summary),
    new TextEncoder().encode(serialized).byteLength,
  ).run();
  await pruneSnapshots(db, userId);
  return {
    id,
    revision: null,
    baseRevision: Number.isInteger(options.baseRevision) ? options.baseRevision : null,
    savedAt,
    status: "conflict",
    saveReason: options.meta.source,
    clientId: options.meta.clientId,
    clientLabel: options.meta.clientLabel,
    restoredFromSnapshotId: null,
    summary,
  };
}

async function pruneSnapshots(db, userId) {
  await db.prepare(`
    DELETE FROM user_app_state_snapshots
    WHERE user_id = ?1
      AND id NOT IN (
        SELECT id FROM user_app_state_snapshots
        WHERE user_id = ?1
        ORDER BY saved_at DESC, rowid DESC
        LIMIT ?2
      )
  `).bind(userId, SNAPSHOT_RETENTION).run();
}

function snapshotMetadata(row) {
  return {
    id: row.id,
    revision: row.revision === null || row.revision === undefined ? null : Number(row.revision),
    baseRevision: row.base_revision === null || row.base_revision === undefined ? null : Number(row.base_revision),
    savedAt: row.saved_at,
    status: row.status,
    saveReason: row.save_reason,
    clientId: row.client_id || "",
    clientLabel: row.client_label || "",
    restoredFromSnapshotId: row.restored_from_snapshot_id || null,
    summary: parseJson(row.summary_json, {}),
    byteSize: Number(row.byte_size || 0),
  };
}

function resultChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function cleanId(value) {
  return String(value || "").trim().slice(0, 160);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
