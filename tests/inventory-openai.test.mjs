import test from "node:test";
import assert from "node:assert/strict";
import { planInventoryQuestion } from "../tools/inventory-openai.mjs";

const dates = ["2026-04-30", "2026-04-15", "2026-04-30"];
const base = { question: "最新测试库存，甲分行按发行人分有多少？", dates, apiKey: "unit-test-only" };
const outcome = changes => ({ kind: "plan", reason: "none", changes });
const message = obj => ({ status: "completed", output: [
  { type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] },
] });
const respond = obj => async () => Response.json(message(obj));

test("one server-side call plans a Chinese query without disclosing unrelated context", async () => {
  let count = 0;
  const result = await planInventoryQuestion({ ...base, dates: [...dates].reverse(),
    previousPlan: { date: "2026-04-30", group: "none", metric: "principal", filters: {}, ledgerRows: ["private-row-probe"] },
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Authorization, "Bearer unit-test-only");
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(!options.body.includes("private-row-probe"));
      assert.ok(!options.body.includes("unit-test-only"));
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-6.1-terra");
      assert.equal(body.reasoning.effort, "high");
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.type, "json_schema");
      assert.deepEqual(JSON.parse(body.input).recentSnapshotDates, ["2026-04-15", "2026-04-30"]);
      return Response.json(message(outcome([{ field: "group", value: "issuer" }, { field: "branch", value: "甲分行" }])));
    } });
  assert.equal(count, 1);
  assert.deepEqual(result.plan, { date: "2026-04-30", metric: "principal", group: "issuer",
    filters: { issuer: null, branch: "甲分行", portfolio: null, account: null, code: null, marketType: null, scope: null, holdingStatus: null } });
});

test("follow-ups change or remove only requested conditions and preserve previous plan", async () => {
  const first = await planInventoryQuestion({ ...base, fetchImpl: respond(outcome([
    { field: "date", value: "2026-04-15" }, { field: "group", value: "issuer" },
    { field: "branch", value: "甲分行" }, { field: "scope", value: "表内" },
    { field: "holdingStatus", value: "存续" },
  ])) });
  const second = await planInventoryQuestion({ ...base, previousPlan: first.plan, question: "含委外，再按交易组合分",
    effort: "medium", fetchImpl: async (_, { body }) => {
      assert.equal(JSON.parse(body).reasoning.effort, "medium");
      return Response.json(message(outcome([{ field: "scope", value: null }, { field: "group", value: "portfolio" }])));
    } });
  assert.equal(second.plan.filters.scope, null);
  assert.equal(second.plan.filters.branch, "甲分行");
  assert.equal(second.plan.filters.holdingStatus, "存续");
  assert.equal(second.plan.date, "2026-04-15");
  assert.equal(second.plan.group, "portfolio");
  assert.equal(first.plan.filters.scope, "表内");
  const latest = await planInventoryQuestion({ ...base, previousPlan: second.plan,
    fetchImpl: respond(outcome([{ field: "date", value: "latest" }, { field: "metric", value: "securities" }])) });
  assert.equal(latest.plan.date, "2026-04-30");
  assert.equal(latest.plan.metric, "securities");
});

test("missing dates and unsupported finance questions produce clarification, never numeric results", async () => {
  const missing = await planInventoryQuestion({ ...base, fetchImpl: respond(outcome([{ field: "date", value: "2025-11-12" }])) });
  assert.match(missing.clarification, /2025-11-12/);
  assert.equal(missing.plan, undefined);
  for (const [reason, pattern] of [["transactions", /交易流水/], ["market", /市场数据/], ["comparison", /快照/]]) {
    const reply = await planInventoryQuestion({ ...base, fetchImpl: respond({ kind: "clarification", reason, changes: [] }) });
    assert.match(reply.clarification, pattern);
  }
  const empty = await planInventoryQuestion({ ...base, dates: [], fetchImpl() { assert.fail("must not call upstream"); } });
  assert.match(empty.clarification, /上传/);
});

test("invalid settings, stale context and a missing dedicated key never reach the upstream API", async () => {
  for (const [input, status] of [[{ question: " " }, 400], [{ question: "x".repeat(1201) }, 400],
    [{ effort: "unknown" }, 400], [{ dates: ["2025-02-30"] }, 400], [{ apiKey: "" }, 503],
    [{ previousPlan: { date: "2026-04-01", group: "none", metric: "principal" } }, 409]]) {
    await assert.rejects(planInventoryQuestion({ ...base, ...input, fetchImpl() { assert.fail("must not call upstream"); } }),
      error => error.status === status);
  }
});

test("untrusted output cannot inject SQL, arbitrary enums, duplicate operations or enormous literals", async () => {
  const invalid = [
    outcome([{ field: "sql", value: "SELECT * FROM positions" }]),
    outcome([{ field: "metric", value: "cashflow" }]),
    outcome([{ field: "holdingStatus", value: "法律上仍存续" }]),
    outcome([{ field: "scope", value: "x".repeat(161) }]),
    outcome([{ field: "group", value: "issuer" }, { field: "group", value: "none" }]),
    { kind: "clarification", reason: "__proto__", changes: [] },
  ];
  for (const obj of invalid) {
    await assert.rejects(planInventoryQuestion({ ...base, fetchImpl: respond(obj) }), error => error.status === 502);
  }
});

test("provider failures or refusals do not expose wire payload, model name, credentials or hallucinated answers", async () => {
  for (const [upstream, status] of [[400, 502], [401, 503], [403, 503], [404, 503], [429, 429], [500, 502]]) {
    const fetchImpl = async () => new Response('gpt-6.1-terra private upstream body', { status: upstream });
    await assert.rejects(planInventoryQuestion({ ...base, fetchImpl }), e => e.status === status && !/terra|private|unit-test/.test(e.message));
  }
  await assert.rejects(planInventoryQuestion({ ...base, fetchImpl: async () => Response.json({status:"incomplete"}) }), {status:502});
  await assert.rejects(planInventoryQuestion({ ...base, fetchImpl: async () => { throw new Error("unit-test-only"); } }),
    e => e.status === 502 && !e.message.includes("unit-test-only"));
  const refusal = await planInventoryQuestion({ ...base, fetchImpl: async () => Response.json({
    status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "upstream-specific-message" }] }],
  }) });
  assert.ok(refusal.clarification && !refusal.clarification.includes("upstream-specific-message"));
});
