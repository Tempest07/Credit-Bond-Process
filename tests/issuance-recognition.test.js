import assert from "node:assert/strict";
import test from "node:test";
import { ISSUANCE_FIELDS, createIssuanceReviewSession, resolveNoticeDate, validateRecognitionRequest, validateSemanticResult } from "../issuance-recognition.js";
import { applySemanticIssuanceResult, normalizeProjectRecord } from "../lifecycle.js";
import { onRequestPost } from "../functions/api/issuance-results/recognize.js";
import { ISSUANCE_MODEL, issuanceModelInput, readIssuanceModelOutput } from "../functions/api/_issuance-model.js";

const text = "26测试MTN001A，代码102600001，3年，实际发行5亿元，票面1.59%，全场3.86倍，边际2.86倍，2026年9月3日缴款。";
const request = { text, noticeDate: "2026-09-02", tranches: [{ id: "a", shortName: "26测试MTN001A", securityCode: "", durationText: "3Y" }] };
function extracted() {
  const fields = Object.fromEntries(Object.keys(ISSUANCE_FIELDS).map((key) => [key, { raw: null, evidence: "" }]));
  const values = { securityCode: ["102600001", "代码102600001"], durationText: ["3年", "3年"], issueScale: ["5亿元", "实际发行5亿元"], couponRate: ["1.59%", "票面1.59%"], fullMarketMultiple: ["3.86倍", "全场3.86倍"], marginalMultiple: ["2.86倍", "边际2.86倍"], paymentDate: ["2026年9月3日", "2026年9月3日缴款"] };
  for (const [key, [raw, evidence]] of Object.entries(values)) fields[key] = { raw, evidence };
  return { sharedEvidence: [], items: [{ shortName: request.tranches[0].shortName, sourceText: text, outcome: "issued", outcomeEvidence: "", dateAmbiguous: false, fields }] };
}
const result = () => validateSemanticResult(request, extracted());
const modelResponse = (value = extracted()) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
const context = (body = request, env = {}, url = "http://localhost/api/issuance-results/recognize", headers = {}) => ({ request: new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), env });

test("validates model fields, source evidence, dates and tranche identity", () => {
  const parsed = result();
  assert.equal(parsed.canApply, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.items[0].trancheId, "a");
  assert.equal(parsed.items[0].couponRate, 1.59);
  assert.equal(parsed.items[0].issueScale, 5);
  assert.equal(parsed.items[0].paymentDate, "2026-09-03");
});

test("rejects fabricated quotes, partial numeric tokens and missing coupon", () => {
  for (const cell of [{ raw: "9.99%", evidence: "票面9.99%" }, { raw: "1", evidence: "票面1.59%" }, { raw: null, evidence: "" }]) {
    const model = extracted(); model.items[0].fields.couponRate = cell;
    const parsed = validateSemanticResult(request, model);
    assert.equal(parsed.canApply, false);
    assert.equal(parsed.items[0].couponRate, null);
  }
});

test("rejects duplicate identities, unknown bonds and existing code conflicts", () => {
  const duplicated = extracted(); duplicated.items.push(structuredClone(duplicated.items[0]));
  assert.equal(validateSemanticResult(request, duplicated).canApply, false);
  const unknown = extracted(); unknown.items[0].shortName = "26其他MTN001A";
  assert.equal(validateSemanticResult(request, unknown).canApply, false);
  const conflict = { ...request, tranches: [{ ...request.tranches[0], securityCode: "102600002" }] };
  assert.equal(validateSemanticResult(conflict, extracted()).canApply, false);
});

test("does not accept other-tranche evidence as a private field", () => {
  const extra = "26测试MTN001B票面2.3%。";
  const input = { ...request, text: text + extra, tranches: [...request.tranches, { id: "b", shortName: "26测试MTN001B" }] };
  const model = extracted(); model.items[0].sourceText += extra;
  model.items[0].fields.couponRate = { raw: "2.3%", evidence: extra };
  assert.equal(validateSemanticResult(input, model).canApply, false);
});

test("shared footer can supply the same date, but not invented evidence", () => {
  const input = { ...request, text: text + "明天缴款。" };
  const model = extracted(); model.sharedEvidence = ["明天缴款。"];
  model.items[0].fields.paymentDate = { raw: "明天", evidence: "明天缴款" };
  assert.equal(validateSemanticResult(input, model).items[0].paymentDate, "2026-09-03");
  model.sharedEvidence = ["后天缴款"];
  assert.equal(validateSemanticResult(input, model).canApply, false);
});

test("relative dates use the notice date, never the machine clock", () => {
  assert.equal(resolveNoticeDate("明天", "2026-12-31"), "2027-01-01");
  assert.equal(resolveNoticeDate("明天缴款", "2026-09-03"), "2026-09-04");
  assert.equal(resolveNoticeDate("周一", "2026-09-04"), "2026-09-07");
  assert.equal(resolveNoticeDate("下周一缴款", "2026-09-04"), "2026-09-07");
  assert.equal(resolveNoticeDate("8月5日", "2026-08-01"), "2026-08-05");
  assert.throws(() => resolveNoticeDate("明天", ""));
  assert.throws(() => resolveNoticeDate("2026年2月30日", "2026-09-02"));
  assert.throws(() => resolveNoticeDate("1月2日", "2026-12-31"));
});

test("recovers one explicit weekday payment phrase when the model omits the field", () => {
  for (const [phrase, noticeDate, expected] of [
    ["周一缴款", "2026-09-04", "2026-09-07"],
    ["下周一缴款", "2026-09-04", "2026-09-07"],
    ["明天缴款", "2026-09-03", "2026-09-04"],
  ]) {
    const input = { ...request, noticeDate, text: text.replace("2026年9月3日缴款", phrase) };
    const model = extracted();
    model.items[0].sourceText = input.text;
    model.items[0].fields.paymentDate = { raw: null, evidence: "" };
    const parsed = validateSemanticResult(input, model);
    assert.equal(parsed.canApply, true, parsed.errors.join("；"));
    assert.equal(parsed.items[0].paymentDate, expected);
    assert.match(parsed.items[0].evidence.paymentDate, /缴款/);
  }
});

test("does not guess between conflicting relative payment weekdays", () => {
  const input = { ...request, noticeDate: "2026-09-04", text: text.replace("2026年9月3日缴款", "A周一缴款，B周二缴款") };
  const model = extracted();
  model.items[0].sourceText = input.text;
  model.items[0].fields.paymentDate = { raw: null, evidence: "" };
  const parsed = validateSemanticResult(input, model);
  assert.equal(parsed.items[0].paymentDate, "");
  assert.match(parsed.warnings.join("；"), /未识别出明确缴款日/);
});

test("does not copy a tranche-scoped relative payment date to its sibling", () => {
  const dualRequest = validateRecognitionRequest({
    noticeDate: "2026-09-04",
    text: "26测试MTN001A，票面利率1.70%，周一缴款；26测试MTN001B，票面利率1.80%。",
    tranches: [
      { id: "a", shortName: "26测试MTN001A" },
      { id: "b", shortName: "26测试MTN001B" },
    ],
  });
  const item = (id, shortName, sourceText, couponRate) => ({
    id,
    shortName,
    sourceText,
    outcome: "issued",
    outcomeEvidence: "",
    fields: {
      securityCode: { raw: null, evidence: "" }, durationText: { raw: null, evidence: "" }, issueScale: { raw: null, evidence: "" },
      couponRate: { raw: couponRate, evidence: sourceText }, fullMarketMultiple: { raw: null, evidence: "" }, marginalMultiple: { raw: null, evidence: "" },
      paymentDate: { raw: null, evidence: "" }, startDate: { raw: null, evidence: "" },
    },
  });
  const parsed = validateSemanticResult(dualRequest, { items: [
    item("a", "26测试MTN001A", "26测试MTN001A，票面利率1.70%，周一缴款", "1.70%"),
    item("b", "26测试MTN001B", "26测试MTN001B，票面利率1.80%", "1.80%"),
  ], sharedEvidence: [] });
  assert.equal(parsed.items[0].paymentDate, "2026-09-07");
  assert.equal(parsed.items[1].paymentDate, "");
});

test("unit and Chinese-number conversion is deterministic, not done by the model", () => {
  const input = { ...request, text: text.replace("5亿元", "50000万元").replace("1.59%", "百分之一点七二").replace("3年", "三年") };
  const model = extracted(); model.items[0].sourceText = input.text;
  model.items[0].fields.issueScale = { raw: "50000万元", evidence: "实际发行50000万元" };
  model.items[0].fields.couponRate = { raw: "百分之一点七二", evidence: "票面百分之一点七二" };
  model.items[0].fields.durationText = { raw: "三年", evidence: "三年" };
  const parsed = validateSemanticResult(input, model);
  assert.equal(parsed.canApply, true, parsed.errors.join(";"));
  assert.equal(parsed.items[0].issueScale, 5);
  assert.equal(parsed.items[0].couponRate, 1.72);
  assert.equal(parsed.items[0].durationText, "3年");
});

test("rejects swapped rate/multiple units and manufactured cancellation", () => {
  const rate = extracted(); rate.items[0].fields.couponRate = { raw: "3.86倍", evidence: "全场3.86倍" };
  assert.equal(validateSemanticResult(request, rate).canApply, false);
  const multiple = extracted(); multiple.items[0].fields.fullMarketMultiple = { raw: "1.59%", evidence: "票面1.59%" };
  assert.equal(validateSemanticResult(request, multiple).canApply, false);
  const cancel = extracted(); cancel.items[0].outcome = "cancelled"; cancel.items[0].outcomeEvidence = "票面1.59%";
  for (const key of Object.keys(ISSUANCE_FIELDS)) cancel.items[0].fields[key] = { raw: null, evidence: "" };
  const parsed = validateSemanticResult(request, cancel);
  assert.equal(parsed.canApply, false);
  assert.throws(() => applySemanticIssuanceResult(project(), parsed, text));
  rate.items[0].fields.couponRate.raw = "3.86";
  assert.equal(validateSemanticResult(request, rate).canApply, false);
  multiple.items[0].fields.fullMarketMultiple.raw = "1.59";
  assert.equal(validateSemanticResult(request, multiple).canApply, false);
});

test("partial rollback cannot clear a tranche that still issues", () => {
  const input = { ...request, text: "26测试MTN001A：回拨1亿元至B，剩余4亿元正常发行，票面1.59%。" };
  const model = extracted(); const item = model.items[0];
  Object.assign(item, { sourceText: input.text, outcome: "reallocated", outcomeEvidence: "回拨1亿元至B" });
  for (const key of Object.keys(ISSUANCE_FIELDS)) item.fields[key] = { raw: null, evidence: "" };
  const parsed = validateSemanticResult(input, model);
  assert.equal(parsed.canApply, false);
  assert.throws(() => applySemanticIssuanceResult(project(), parsed, input.text));
});

test("a model cannot declare a B-only quote shared or hide B inside A's source", () => {
  const extra = "26测试MTN001B，票面2.30%。";
  const input = { ...request, text: text + extra, tranches: [...request.tranches, { id: "b", shortName: "26测试MTN001B" }] };
  const shared = extracted(); shared.sharedEvidence = [extra];
  shared.items[0].fields.couponRate = { raw: "2.30%", evidence: extra };
  assert.equal(validateSemanticResult(input, shared).canApply, false);
  shared.items[0].sourceText += extra; shared.items[0].fields.couponRate.evidence = "票面2.30%";
  assert.equal(validateSemanticResult(input, shared).canApply, false);
  input.tranches[1].shortName += "(科创债)";
  assert.equal(validateSemanticResult(input, shared).canApply, false);
  shared.items[0].sourceText = text;
  shared.items[0].fields.couponRate.evidence = extra;
  assert.equal(validateSemanticResult(input, shared).canApply, false);
});

test("a disclosed payment date cannot silently become the start date", () => {
  const model = extracted(); model.items[0].fields.startDate = { ...model.items[0].fields.paymentDate };
  assert.equal(validateSemanticResult(request, model).canApply, false);
});

function project() {
  return normalizeProjectRecord({ id: "project", shortName: "26测试MTN001A/B", cutoffAt: "2026-09-02T18:00", status: "已投标待结果",
    tranches: [{ id: "a", shortName: "26测试MTN001A", durationText: "3年", bidLevels: [{ bidRate: 1.56, bidAmount: .5 }], suggestedRatio: 10 }, { id: "b", shortName: "26测试MTN001B", durationText: "5年", winningRate: 2.1, winningAmountWan: 1200, paymentDate: "2026-09-08" }] });
}

test("strict application uses IDs and preserves unrecognized tranches and the original project", () => {
  const before = project(); const original = structuredClone(before);
  const applied = applySemanticIssuanceResult(before, result(), text);
  assert.deepEqual(before, original);
  assert.equal(applied.tranches[0].winningRate, 1.59);
  assert.equal(applied.tranches[0].winningAmountWan, 5000);
  assert.deepEqual(applied.tranches[1], before.tranches[1]);
  assert.equal(applied.resultAdvertisement, text);
  assert.throws(() => applySemanticIssuanceResult(before, { ...result(), canApply: false }, text));
  const stale = result(); stale.items[0].trancheId = "removed";
  assert.throws(() => applySemanticIssuanceResult(before, stale, text));
});

test("semantic results do not invent a payment date for winning projects", () => {
  const parsed = result(); parsed.items[0].paymentDate = "";
  const applied = applySemanticIssuanceResult(project(), parsed, text);
  assert.equal(applied.tranches[0].winningAmountWan, 5000);
  assert.equal(applied.tranches[0].paymentDate, "");
});

test("cancellation and rollback clear issuance data only for the affected tranche", () => {
  for (const outcome of ["cancelled", "reallocated"]) {
    const before = project(); Object.assign(before.tranches[0], { winningRate: 2, winningAmountWan: 5000, paymentDate: "2026-09-03", paymentCompleted: true });
    const parsed = result(); Object.assign(parsed.items[0], { outcome, allocationNote: outcome === "cancelled" ? "取消发行：本期取消发行" : "全部回拨：本品种转到B" });
    const applied = applySemanticIssuanceResult(before, parsed, text);
    assert.equal(applied.tranches[0].winningRate, null);
    assert.equal(applied.tranches[0].winningAmountWan, 0);
    assert.equal(applied.tranches[0].issueScale, null);
    assert.equal(applied.tranches[0].paymentDate, "");
    assert.equal(applied.tranches[0].paymentCompleted, false);
    assert.deepEqual(applied.tranches[1], before.tranches[1]);
  }
});

test("model request includes no bid positions, pricing, amounts won or ledger data", () => {
  const clean = validateRecognitionRequest({ ...request, secret: "do not send", tranches: [{ ...request.tranches[0], bidRate: 2, winningAmountWan: 5000 }] });
  assert.doesNotMatch(JSON.stringify(issuanceModelInput(clean)), /do not send|bidRate|winningAmountWan/);
  assert.equal(issuanceModelInput(clean).temperature, 0);
  assert.equal(issuanceModelInput(clean).response_format.type, "json_schema");
  assert.deepEqual(issuanceModelInput(clean).response_format.json_schema.schema.properties.items.items.properties.shortName.enum, ["", request.tranches[0].shortName]);
  assert.throws(() => validateRecognitionRequest({ ...request, text: "a".repeat(12001) }));
  assert.throws(() => validateRecognitionRequest({ ...request, tranches: [request.tranches[0], request.tranches[0]] }));
});

test("a forced candidate name cannot claim a different bond's unrecognized code", () => {
  const model = extracted();
  const otherText = text.replaceAll("26测试MTN001A", "26其他MTN003");
  model.items[0].sourceText = otherText;
  const parsed = validateSemanticResult({ ...request, text: otherText }, model);
  assert.equal(parsed.canApply, false);
  assert.equal(parsed.items.length, 0);
});

test("endpoint requires authentication before invoking the model", async () => {
  let calls = 0;
  const response = await onRequestPost(context(request, { AI: { run() { calls++; } } }, "https://test.pages.dev/api/issuance-results/recognize"));
  assert.equal(response.status, 401); assert.equal(calls, 0);
});

test("endpoint checks JSON, size and cross-site origin before charging an inference", async () => {
  let calls = 0; const env = { AI: { run() { calls++; } } };
  for (const [ctx, status] of [[context(request, env, undefined, { "Content-Type": "text/plain" }), 415], [context(request, env, undefined, { Origin: "https://evil.example" }), 403], [context({ ...request, text: "a".repeat(65001) }, env), 400]]) {
    assert.equal((await onRequestPost(ctx)).status, status);
  }
  assert.equal(calls, 0);
});

test("endpoint calls the real binding contract and returns validated evidence without writing DB", async () => {
  let calls = 0;
  const response = await onRequestPost(context(request, { AI: { async run(model, input, options) {
    calls++; assert.equal(model, ISSUANCE_MODEL); assert.ok(options.signal); assert.equal(input.stream, false); return modelResponse();
  } } }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
  const payload = await response.json();
  assert.equal(payload.canApply, true);
  assert.equal(payload.provider, "workers-ai");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unavailable service, invalid JSON and upstream failure never pretend regex is AI", async () => {
  assert.equal((await onRequestPost(context())).status, 503);
  for (const run of [async () => ({ choices: [{ message: { content: "not json" } }] }), async () => { throw new Error("sensitive upstream detail"); }]) {
    const response = await onRequestPost(context(request, { AI: { run } }));
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(await response.json()), /sensitive upstream detail/);
  }
  assert.throws(() => readIssuanceModelOutput({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }));
});

test("quote repair is bounded to one additional call and cannot bypass validation", async () => {
  for (const repaired of [true, false]) {
    let calls = 0;
    const bad = extracted(); bad.items[0].fields.securityCode.evidence = "102600001代码";
    const response = await onRequestPost(context(request, { AI: { async run(_model, input) {
      calls++;
      if (calls === 2) {
        assert.equal(input.messages.at(-2).role, "assistant");
        assert.match(input.messages.at(-1).content, /validationErrors/);
      }
      return modelResponse(repaired && calls === 2 ? extracted() : bad);
    } } }));
    const payload = await response.json();
    assert.equal(calls, 2);
    assert.equal(payload.attempts, 2);
    assert.equal(payload.canApply, repaired);
    if (!repaired) assert.throws(() => applySemanticIssuanceResult(project(), payload, text));
  }
});

test("missing notice date is a user decision, not a model repair", async () => {
  let calls = 0;
  const model = extracted(); model.items[0].sourceText += "明天缴款。";
  model.items[0].fields.paymentDate = { raw: "明天", evidence: "明天缴款。" };
  const response = await onRequestPost(context({ ...request, text: model.items[0].sourceText, noticeDate: "" }, { AI: { async run() { calls++; return modelResponse(model); } } }));
  assert.equal((await response.json()).canApply, false);
  assert.equal(calls, 1);
});

test("model timeout aborts in-flight inference and returns a safe error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal; let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const pending = onRequestPost(context(request, { AI: { run(_model, _input, options) { signal = options.signal; started(); return new Promise(() => {}); } } }));
  await ready; t.mock.timers.tick(90001);
  const response = await pending;
  assert.equal(response.status, 504); assert.equal(signal.aborted, true);
});

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test("preview is inert until confirmation, consumed once, and invalidated by edits or project changes", async () => {
  const session = createIssuanceReviewSession(); const snapshot = { projectId: "a", text };
  await session.recognize(snapshot, async () => result());
  assert.equal(session.take({ ...snapshot, text: "edited" }), null);
  assert.equal(session.take({ ...snapshot, projectId: "b" }), null);
  assert.ok(session.take(snapshot)); assert.equal(session.take(snapshot), null);
  await session.recognize(snapshot, async () => result()); session.invalidate();
  assert.equal(session.take(snapshot), null);
});

test("cancel and later requests suppress stale success and stale failure", async () => {
  const session = createIssuanceReviewSession(); const slow = deferred(); let signal;
  const pending = session.recognize({ projectId: "a" }, (input) => { signal = input; return slow.promise; });
  session.invalidate(); slow.resolve(result());
  assert.equal(await pending, null); assert.equal(signal.aborted, true);
  const first = deferred(); const old = session.recognize({ projectId: "a" }, () => first.promise);
  await session.recognize({ projectId: "b" }, async () => result());
  first.reject(new Error("late failure")); assert.equal(await old, null);
  assert.ok(session.take({ projectId: "b" }));
});
