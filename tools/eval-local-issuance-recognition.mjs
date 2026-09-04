import assert from "node:assert/strict";
import { semanticCases } from "../tests/fixtures/issuance-semantic-cases.js";
import { LOCAL_ISSUANCE_PROMPT_REVISION, localOllamaConfig, recognizeIssuanceWithLocalOllama } from "./local-issuance-ollama.mjs";

const selected = new Set(process.argv.slice(2));
const cases = selected.size ? semanticCases.filter((item) => selected.has(item.id)) : semanticCases;
if (!cases.length) throw new Error("Unknown case ID");

const config = localOllamaConfig();
await requireInstalledModel(config);
let passed = 0;
for (const sample of cases) {
  const started = Date.now();
  let result;
  try {
    result = await recognizeIssuanceWithLocalOllama({ text: sample.text, noticeDate: sample.noticeDate, tranches: sample.tranches }, { config });
    assert.equal(result.canApply, !sample.blocked, JSON.stringify(result.errors));
    assert.equal(result.items.length, sample.expected.length);
    sample.expected.forEach((expected, index) => {
      const actual = result.items.find((item) => item.trancheId === sample.tranches[index].id);
      assert.ok(actual, `Missing tranche ${index}`);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${sample.id} tranche ${index} ${key}`);
    });
    passed += 1;
    console.log(JSON.stringify({ case: sample.id, passed: true, elapsedMs: Date.now() - started, attempts: result.attempts, calls: result.calls, warnings: result.warnings }));
  } catch (error) {
    process.exitCode = 1;
    console.log(JSON.stringify({ case: sample.id, passed: false, elapsedMs: Date.now() - started, reason: error.message, result }));
  }
}
console.log(JSON.stringify({ provider: "local-ollama", model: config.model, promptRevision: LOCAL_ISSUANCE_PROMPT_REVISION, passed, total: cases.length }));

async function requireInstalledModel(config) {
  const response = await fetch(new URL("/api/tags", config.url), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Local Ollama health check failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.models?.some((item) => item.name === config.model || item.model === config.model)) {
    throw new Error(`Local model ${config.model} is not installed. Run: ollama pull ${config.model}`);
  }
}
