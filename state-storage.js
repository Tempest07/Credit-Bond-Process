const CHUNK_BYTES = 1_000_000;
const INLINE_BYTES = 512_000;
const MAX_STORED_BYTES = 10_000_000;
const MANIFEST_KEY = "$bondCentreStateChunks";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class StateStorageError extends Error {
  constructor(message = "资料库分块校验失败，请保留本机副本并重试") {
    super(message);
    this.name = "StateStorageError";
  }
}

export async function ensureStateChunksSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_state_chunks (
    storage_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (storage_id, chunk_index)
  )`).run();
}

function manifestFrom(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, MANIFEST_KEY)) return null;
  if (Object.keys(value).length !== 5 || value[MANIFEST_KEY] !== 1
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id || "")
    || !Number.isInteger(value.chunks) || value.chunks < 1 || value.chunks > Math.ceil(MAX_STORED_BYTES / CHUNK_BYTES) + 1
    || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_STORED_BYTES
    || !/^[a-f0-9]{64}$/.test(value.sha256 || "")) throw new StateStorageError();
  return value;
}

async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareStoredState(serialized) {
  if (serialized.includes(`"${MANIFEST_KEY}"`) && Object.hasOwn(JSON.parse(serialized), MANIFEST_KEY)) {
    throw new StateStorageError("资料库包含存储保留字段，无法保存");
  }
  const bytes = encoder.encode(serialized);
  if (bytes.byteLength > MAX_STORED_BYTES) throw new StateStorageError("资料库超过单次保存容量，请保留本机副本并联系管理员");
  if (bytes.byteLength <= INLINE_BYTES) return { serialized, chunkId: null, chunks: [], byteSize: bytes.byteLength };
  const chunks = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + CHUNK_BYTES, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  const chunkId = crypto.randomUUID();
  const manifest = { [MANIFEST_KEY]: 1, id: chunkId, chunks: chunks.length, bytes: bytes.length, sha256: await sha256(bytes) };
  return { serialized: JSON.stringify(manifest), chunkId, chunks, byteSize: bytes.length };
}

async function decodeChunks(manifest, rows) {
  if (rows.length !== manifest.chunks) throw new StateStorageError();
  let bytes = 0;
  const parts = rows.map((row, index) => {
    if (row.chunk_index !== index || typeof row.chunk_data !== "string") throw new StateStorageError();
    const size = encoder.encode(row.chunk_data).byteLength;
    if (size > CHUNK_BYTES) throw new StateStorageError();
    bytes += size;
    if (bytes > manifest.bytes) throw new StateStorageError();
    return row.chunk_data;
  });
  const serialized = parts.join("");
  if (bytes !== manifest.bytes || await sha256(encoder.encode(serialized)) !== manifest.sha256) throw new StateStorageError();
  return JSON.parse(serialized);
}

export async function readStoredState(db, serialized) {
  const parsed = JSON.parse(serialized);
  const manifest = manifestFrom(parsed);
  if (!manifest) return parsed;
  const result = await db.prepare(`SELECT chunk_index, data AS chunk_data FROM app_state_chunks
    WHERE storage_id = ?1 ORDER BY chunk_index`).bind(manifest.id).all();
  return decodeChunks(manifest, result.results || []);
}

const ROOTS = {
  current: { table: "user_app_state", where: "s.user_id = ?1", header: "SELECT data, updated_at, revision FROM user_app_state WHERE user_id = ?1" },
  legacy: { table: "app_state", where: "s.id = 1", header: "SELECT data, updated_at FROM app_state WHERE id = 1" },
  snapshot: { table: "user_app_state_snapshots", where: "s.user_id = ?1 AND s.id = ?2", header: "SELECT * FROM user_app_state_snapshots WHERE user_id = ?1 AND id = ?2" },
};

const storageIdSql = column => `CASE WHEN json_valid(${column}) THEN
  CASE WHEN json_type(${column}, '$."${MANIFEST_KEY}"') IS NOT NULL
    THEN json_extract(${column}, '$.id') END END`;

export async function readStoredStateRow(db, kind, params = []) {
  const root = ROOTS[kind];
  if (!root) throw new Error("Unknown state storage root");
  const row = await db.prepare(root.header).bind(...params).first();
  if (!row?.data) return null;
  const parsed = JSON.parse(row.data);
  if (!manifestFrom(parsed)) return { ...row, rawData: row.data, data: parsed };
  // Re-read the root and its immutable chunks in one SQL statement. Snapshot
  // pruning or concurrent saves cannot retire chunks between these two reads.
  const result = await db.prepare(`SELECT s.*, c.chunk_index, c.data AS chunk_data
    FROM ${root.table} s LEFT JOIN app_state_chunks c ON c.storage_id = ${storageIdSql("s.data")}
    WHERE ${root.where} ORDER BY c.chunk_index`).bind(...params).all();
  const rows = result.results || [];
  if (!rows.length) {
    if (kind === "snapshot") return null;
    throw new StateStorageError();
  }
  const { chunk_index, chunk_data, ...current } = rows[0];
  const value = JSON.parse(current.data);
  const manifest = manifestFrom(value);
  return { ...current, rawData: current.data, data: manifest ? await decodeChunks(manifest, rows) : value };
}

export function stateChunkStatements(db, storage, guard = null) {
  return storage.chunks.map((data, index) => guard
    ? db.prepare(`INSERT INTO app_state_chunks (storage_id, chunk_index, data)
        SELECT ?1, ?2, ?3 WHERE changes() = 1 AND EXISTS (
          SELECT 1 FROM user_app_state WHERE user_id = ?4 AND revision = ?5 AND data = ?6
        )`).bind(storage.chunkId, index, data, guard.userId, guard.revision, storage.serialized)
    : db.prepare(`INSERT INTO app_state_chunks (storage_id, chunk_index, data) VALUES (?1, ?2, ?3)`)
      .bind(storage.chunkId, index, data));
}

export async function pruneStateChunks(db) {
  // Every writer creates a fresh storage id and publishes its references and
  // chunks in one transaction, so referenced or in-flight roots cannot be lost.
  const reference = table => `SELECT ${storageIdSql("data")} AS storage_id FROM ${table}`;
  await db.prepare(`DELETE FROM app_state_chunks WHERE NOT EXISTS (
    SELECT 1 FROM (${reference("user_app_state")} UNION ALL ${reference("user_app_state_snapshots")} UNION ALL ${reference("app_state")}) refs
    WHERE refs.storage_id = app_state_chunks.storage_id
  )`).run();
}
