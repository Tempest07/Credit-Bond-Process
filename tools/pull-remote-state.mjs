import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.APP_PASSWORD;
const remoteUrl = process.env.REMOTE_STATE_URL || "https://tempest07.com/bond-centre/api/state";
const outputPath = resolve(rootDir, ".local", "remote-state.json");

async function main() {
  if (!password) {
    throw new Error("Please set APP_PASSWORD for this shell before running npm run pull:remote.");
  }

  const response = await fetch(remoteUrl, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${password}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Remote state request failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
  const data = payload?.data || payload;
  if (!data?.issuers) throw new Error("Remote response does not contain data.issuers.");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  const command = process.execPath;
  const result = spawnSync(command, ["tools/seed-local-d1.mjs", outputPath], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);

  console.log(`Pulled remote state from ${remoteUrl}`);
  console.log(`Local copy: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
