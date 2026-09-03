// Explicit live acceptance: uses the same authenticated endpoint, never writes a project.
// Local: npm run prepare:local; npx wrangler pages dev . --port 8791 --ai AI
// Then: node tools/eval-issuance-recognition.mjs [case-id ...]
import assert from "node:assert/strict";
import { semanticCases } from "../tests/fixtures/issuance-semantic-cases.js";

const selected = new Set(process.argv.slice(2));
const cases = selected.size ? semanticCases.filter((item) => selected.has(item.id)) : semanticCases;
if (!cases.length) throw new Error("Unknown case ID");
const base = process.env.ISSUANCE_EVAL_URL || "http://127.0.0.1:8791";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Live evaluation is limited to the local, cloud-AI-backed preview; do not send test writes to production.");
let passed = 0;
for (const sample of cases) {
  const start = Date.now();
  const response = await fetch(`${base}/api/issuance-results/recognize`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(100000),
    body: JSON.stringify({ text: sample.text, noticeDate: sample.noticeDate, tranches: sample.tranches }),
  });
  const result = await response.json();
  try {
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.canApply, !sample.blocked, JSON.stringify(result.errors));
    assert.equal(result.items.length, sample.expected.length);
    sample.expected.forEach((expected, index) => {
      const actual = result.items.find((item) => item.trancheId === sample.tranches[index].id);
      assert.ok(actual, `Missing tranche ${index}`);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${sample.id} tranche ${index} ${key}`);
    });
    passed += 1;
    console.log(JSON.stringify({ case: sample.id, passed: true, elapsedMs: Date.now() - start, attempts: result.attempts, warnings: result.warnings }));
  } catch (error) {
    process.exitCode = 1;
    console.log(JSON.stringify({ case: sample.id, passed: false, elapsedMs: Date.now() - start, reason: error.message, result }));
  }
}
console.log(JSON.stringify({ passed, total: cases.length }));
