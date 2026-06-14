import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run seed:local -- path/to/credit-bond-data.json");
  process.exit(1);
}

const sourcePath = resolve(process.cwd(), inputPath);
const sqlPath = resolve(rootDir, ".local", "seed-local-state.sql");

function normalizeState(raw) {
  const data = raw?.data?.issuers ? raw.data : raw;
  if (!data || typeof data !== "object" || !Array.isArray(data.issuers)) {
    throw new Error("JSON must be a database export with an issuers array, or an API response with data.issuers.");
  }
  return {
    version: 3,
    issuers: data.issuers,
    projects: Array.isArray(data.projects) ? data.projects : [],
    protocolTransfers: Array.isArray(data.protocolTransfers) ? data.protocolTransfers : [],
    secondaryTrades: Array.isArray(data.secondaryTrades) ? data.secondaryTrades : [],
    ftpCurve: data.ftpCurve || {},
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
  };
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

async function main() {
  const raw = JSON.parse(await readFile(sourcePath, "utf8"));
  const state = normalizeState(raw);
  const json = JSON.stringify(state);
  const updatedAt = new Date().toISOString();
  const sql = `CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO app_state (id, data, updated_at)
VALUES (1, '${sqlString(json)}', '${sqlString(updatedAt)}')
ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;
`;

  await mkdir(dirname(sqlPath), { recursive: true });
  await writeFile(sqlPath, sql, "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    ".wrangler/state",
    "--file",
    sqlPath,
    "--yes",
  ];
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);

  console.log(`Seeded local D1 from ${sourcePath}`);
  console.log(`Records: issuers=${state.issuers.length}, projects=${state.projects.length}, protocolTransfers=${state.protocolTransfers.length}, secondaryTrades=${state.secondaryTrades.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
