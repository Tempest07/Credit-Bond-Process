import test from "node:test";
import assert from "node:assert/strict";
import { ratingsCurvesFallback } from "../functions/api/qb/ratings-curves.js";
import { calculateSuggestion } from "../core.js";

const BASE = "/dm-quant-func-service/api/v1/";
const company = `${BASE}company/rating/data`;
const bond = `${BASE}bond/rating/data`;
const implied = `${BASE}bond/analysis/implied-rating`;
const defaults = `${BASE}bond/default-rate/data`;
const curve = `${BASE}bond/yield-curve/data`;
function client(handler) {
  const calls = [];
  return { calls, today: "2026-10-22", fetchedAt: "2026-10-22T12:00:00.000Z", query: async (api, params) => { calls.push({ api, params }); return handler(api, params); } };
}
const external = (more = {}) => ({ institution_name: "测试发行人有限公司", institution_type: "发行人", rating_agcy_name: "中诚信国际", rating_date: "2026-10-20", rate: "AAA", outlook: "稳定", ...more });
const curveInput = (more = {}) => ({ dataSource: "18", curveName: "中债国开债收益率曲线", curveType: "1", curveTermList: ["1", "3"], startDate: "2026-10-20", endDate: "2026-10-22", ...more });
const dictionary = (more = {}) => ({ code: "CDC.CIB.FRB.CDB", curveName: "中债国开债收益率曲线", curvePeriodType: "到期", flag: 1, source: "CDC", sourceSub: 1, ...more });
const node = (more = {}) => ({ curveCoding: "CB001250", curvePeriodType: "到期", indexDesc: "中债国开债收益率曲线", period: "1Y", periodY: 1, yield: 1.354, date: "2026-10-22", src: "CDC", ...more });

test("QB ratings adapter declines unrelated APIs and leaves unsupported implied default rates empty", async () => {
  const qb = client(() => { throw new Error("must not query"); });
  assert.equal(await ratingsCurvesFallback(`${BASE}bond/basic-info/info`, {}, qb), null);
  assert.deepEqual(await ratingsCurvesFallback(defaults, { securityIdList: ["123456.IB"] }, qb), []);
  assert.equal(qb.calls.length, 0);
});

test("QB subject ratings retain exact issuer identity, real agency/date and exclude future or non-issuer scores", async () => {
  const qb = client(() => [external(), external({ rating_date: "2026-10-21", rate: "AA+" }),
    external({ institution_name: "测试发行人控股有限公司" }), external({ institution_type: "担保人" }),
    external({ rating_agcy_name: "YY评分" }), external({ rating_date: "2026-10-23" }), external({ rating_date: null })]);
  const result = await ratingsCurvesFallback(company, { comChiNameList: ["测试发行人有限公司"], societyCodeList: ["CREDIT1"] }, qb);
  assert.deepEqual(result.map(r => [r.rating, r.ratingDate]), [["AA+", "2026-10-21"], ["AAA", "2026-10-20"]]);
  assert.equal(result[0].societyCode, "CREDIT1");
  assert.equal(result[0]._qb.fieldMap.ratingInstitutionShortName, "rating_agcy_name");
  assert.equal(result[0]._qb.fetchedAt, qb.fetchedAt);
  assert.equal(qb.calls[0].params.institution_type, "ISR");
  assert.equal(qb.calls[0].params.rating_date_end, 20261022);
});

test("QB subject ratings do not invent issuer names from society codes", async () => {
  const qb = client(() => { throw new Error("must not perform unbounded issuer query"); });
  assert.deepEqual(await ratingsCurvesFallback(company, { societyCodeList: ["CREDIT1"] }, qb), []);
  assert.equal(qb.calls.length, 0);
});

test("QB historical subject ratings fetch remaining pages before choosing the latest row", async () => {
  const qb = client((api, params) => params.page === 1 ? Array.from({ length: 200 }, () => external({ rating_date: "2024-01-01" })) : [external({ rating_date: "2025-10-22" })]);
  const result = await ratingsCurvesFallback(company, { comChiNameList: ["测试发行人有限公司"], startDate: "2020-01-01", endDate: "2025-10-22" }, qb);
  assert.equal(result[0].ratingDate, "2025-10-22");
  assert.equal(qb.calls.length, 2);
  assert.equal(qb.calls[0].params.rating_date_end, 20251022);
});

test("QB subject pagination does not report an arbitrary truncated page as latest", async () => {
  const qb = client(() => Array.from({ length: 200 }, () => external()));
  assert.deepEqual(await ratingsCurvesFallback(company, { comChiNameList: ["测试发行人有限公司"] }, qb), []);
  assert.equal(qb.calls.length, 5);
});

test("QB bond ratings never substitute issuer ratings and reject another venue or future latest rating", async () => {
  const sample = { bond_code_par: "123456.SH", bond_short_name_cn: "26测试01", bond_ratingdate_latest: "2026-10-21", bond_ratinglevel_latest: "AA+", bond_rating_agcy: "联合资信", bond_ratingoutlook_latest: "稳定", issuer_ratinglevel_latest: "AAA" };
  const qb = client(() => [sample, { ...sample, bond_code_par: "123456.IB" }, { ...sample, bond_ratingdate_latest: "2026-10-23" }, { ...sample, bond_ratinglevel_latest: null }]);
  const result = await ratingsCurvesFallback(bond, { securityIdList: ["123456.SH"] }, qb);
  assert.equal(result.length, 1);
  assert.equal(result[0].rating, "AA+");
  assert.equal(result[0].securityId, "123456.SH");
  assert.equal(result[0]._qb.fieldMap.rating, "bond_ratinglevel_latest");
});

test("QB name-only bond rating lookup verifies the returned short name exactly", async () => {
  const qb = client(() => [{ bond_code_par: "123456.SH", bond_short_name_cn: "26测试02", bond_ratingdate_latest: "2026-10-21", bond_ratinglevel_latest: "AA", bond_rating_agcy: "联合资信" }]);
  assert.deepEqual(await ratingsCurvesFallback(bond, { secShortNameList: ["26测试01"] }, qb), []);
  assert.equal(qb.calls[0].params.bond_short_name_cn, "26测试01");
});

test("QB implied ratings use documented ChinaBond implied rating, preserving date, market and institution", async () => {
  const qb = client((api, params) => params.date === "2026-10-22" ? [] : [
    { sec_code: "123456.IB", sec_short_name: "26测试01", valuate_date: "2026-10-21T16:00:00Z", implied_rating: "AAA" },
    { sec_code: "123456.IB", sec_short_name: "26测试01", valuate_date: "2026-10-21", implied_rating: "AA+" },
    { sec_code: "123456.SH", valuate_date: "2026-10-21", implied_rating: "AAA" },
  ]);
  const result = await ratingsCurvesFallback(implied, { securityIdList: ["123456.IB"], startDate: "2026-10-20", endDate: "2026-10-22" }, qb);
  assert.equal(result.length, 1);
  assert.equal(result[0].cbImpliedRating, "AA+");
  assert.equal(result[0].ratingDate, "2026-10-21");
  assert.equal(result[0].csImpliedRating, undefined);
  assert.deepEqual(result[0]._qb.apiNames, ["cdcBondValuation"]);
  assert.equal(result[0]._qb.fieldMap.cbImpliedRating, "implied_rating");
});

test("QB implied rating rejects conflicting option rows and never maps external ratings to implied", async () => {
  const qb = client(() => [
    { sec_code: "123456.IB", valuate_date: "2026-10-22", implied_rating: "AA" },
    { sec_code: "123456.IB", valuate_date: "2026-10-22", implied_rating: "AA+" },
    { sec_code: "654321.IB", valuate_date: "2026-10-22", inst_rating_nm_cur: "AAA" },
  ]);
  assert.deepEqual(await ratingsCurvesFallback(implied, { securityIdList: ["123456.IB", "654321.IB"], startDate: "2026-10-22" }, qb), []);
  assert.equal(qb.calls.length, 1);
});

test("QB AA(2) and full-width variants reach the ordinary credit cap without changing provenance", async () => {
  for (const rating of ["AA(2)", "AA（2）", "ＡＡ（２）", "aa(2)"]) {
    const qb = client(() => [{ sec_code: "123456.IB", valuate_date: "2026-10-22", implied_rating: rating }]);
    const rows = await ratingsCurvesFallback(implied, { securityIdList: ["123456.IB"], startDate: "2026-10-22" }, qb);
    assert.equal(rows.length, 1, rating);
    assert.equal(rows[0].cbImpliedRating, "AA(2)");
    assert.deepEqual(rows[0]._qb.apiNames, ["cdcBondValuation"]);
    const result = calculateSuggestion({ durationText: "5Y", hiddenRating: rows[0].cbImpliedRating, offeringType: "公募", issueScale: 10 },
      { credit: { investmentTermText: "3年", approvedRatio: 30 } });
    assert.equal(result.suggestedRatio, 10);
  }
  for (const rating of ["", "AA(3)", "not-a-rating", "AA(2)+"]) {
    const qb = client(() => [{ sec_code: "123456.IB", valuate_date: "2026-10-22", implied_rating: rating }]);
    assert.deepEqual(await ratingsCurvesFallback(implied, { securityIdList: ["123456.IB"], startDate: "2026-10-22" }, qb), []);
  }
});

test("QB implied lookup is bounded to seven dates and batches unresolved exact securities", async () => {
  const qb = client(() => []);
  assert.deepEqual(await ratingsCurvesFallback(implied, { securityIdList: ["123456.IB", "654321.SH"], startDate: "2026-09-23" }, qb), []);
  assert.equal(qb.calls.length, 7);
  assert.equal(qb.calls[0].params.bond_code_par, "123456.IB,654321.SH");
  assert.equal(qb.calls.at(-1).params.date, "2026-10-16");
});

test("QB curve first verifies dictionary then requests name, basis, term range and dated history", async () => {
  const qb = client(api => api === "cdcCurveDictNew" ? [dictionary(), dictionary({ curvePeriodType: "即期", code: "D.CDC.CIB.FRB.CDB" })] : [node(), node({ periodY: 3, period: "3Y", yield: 1.6 })]);
  const result = await ratingsCurvesFallback(curve, curveInput(), qb);
  assert.deepEqual(result.map(r => [r.curveTerm, r.yield]), [[1, 1.354], [3, 1.6]]);
  assert.deepEqual(qb.calls.map(c => c.api), ["cdcCurveDictNew", "cdcYieldCurveHis"]);
  assert.equal(qb.calls[1].params.indexDesc, "中债国开债收益率曲线");
  assert.equal(qb.calls[1].params.curveCoding, undefined);
  assert.equal(qb.calls[1].params.periodYStart, 1);
  assert.equal(qb.calls[1].params.periodYEnd, 3);
  assert.equal(result[0].dataSource, "18");
  assert.equal(result[0]._qb.fieldMap.yield, "yield");
  assert.deepEqual(result[0]._qb.apiNames, ["cdcCurveDictNew", "cdcYieldCurveHis"]);
});

test("QB curve excludes wrong institution, curve, yield basis, term, dates, nulls and implausible values", async () => {
  const qb = client(api => api === "cdcCurveDictNew" ? [dictionary()] : [node(), node({ src: "CSI" }), node({ indexDesc: "中债国债收益率曲线" }),
    node({ curvePeriodType: "即期" }), node({ periodY: 2 }), node({ date: "2026-10-23" }), node({ date: "2026-10-19" }), node({ yield: null }), node({ yield: 999 })]);
  const result = await ratingsCurvesFallback(curve, curveInput(), qb);
  assert.equal(result.length, 1);
  assert.equal(result[0].yield, 1.354);
});

test("QB curve rejects mismatched or ambiguous dictionary identity and non-yield families", async () => {
  for (const rows of [[dictionary({ source: "CSI" })], [dictionary({ sourceSub: "2" })], [dictionary({ flag: 0 })], [dictionary(), dictionary({ code: "OTHER" })]]) {
    const qb = client(api => { assert.equal(api, "cdcCurveDictNew"); return rows; });
    assert.deepEqual(await ratingsCurvesFallback(curve, curveInput(), qb), []);
    assert.equal(qb.calls.length, 1);
  }
});

test("QB curve does not silently replace unsupported institutions or basis, and clamps future as-of dates", async () => {
  const qb = client(api => api === "cdcCurveDictNew" ? [dictionary()] : [node()]);
  assert.deepEqual(await ratingsCurvesFallback(curve, curveInput({ dataSource: 19 }), qb), []);
  assert.deepEqual(await ratingsCurvesFallback(curve, curveInput({ curveType: 2 }), qb), []);
  assert.equal(qb.calls.length, 0);
  await ratingsCurvesFallback(curve, curveInput({ endDate: "2026-10-25" }), qb);
  assert.equal(qb.calls[1].params.dateEnd, "2026-10-22");
});

test("QB curve normalizes Chinese brackets/fullwidth plus without changing the exact rating curve", async () => {
  const name = "中债中短期票据收益率曲线(AA+)";
  const qb = client(api => api === "cdcCurveDictNew" ? [dictionary({ curveName: "中债中短期票据收益率曲线（AA＋）" })] : [node({ indexDesc: "中债中短期票据收益率曲线（AA＋）" }), node({ indexDesc: "中债中短期票据收益率曲线(AA)" })]);
  assert.equal((await ratingsCurvesFallback(curve, curveInput({ curveName: name }), qb)).length, 1);
});
