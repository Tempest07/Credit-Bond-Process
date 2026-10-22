// QB schemas verified 2026-10-22. These adapters retain DM's field contract;
// _qb records the actual provider and fields rather than disguising QB as DM.
const PREFIX = "/dm-quant-func-service/api/v1/";
const COMPANY_RATING = `${PREFIX}company/rating/data`;
const BOND_RATING = `${PREFIX}bond/rating/data`;
const IMPLIED_RATING = `${PREFIX}bond/analysis/implied-rating`;
const DEFAULT_RATE = `${PREFIX}bond/default-rate/data`;
const CURVE = `${PREFIX}bond/yield-curve/data`;
const DAY = 86400000;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

export async function ratingsCurvesFallback(path, input = {}, client) {
  if (![COMPANY_RATING, BOND_RATING, IMPLIED_RATING, DEFAULT_RATE, CURVE].includes(path)) return null;
  // No subscribed QB endpoint has the same implied-default-probability measure.
  // Observed defaults and default statistics cannot substitute for it.
  if (path === DEFAULT_RATE) return [];
  const end = cutoff(input.endDate, client.today);
  if (!end) return [];
  if (path === COMPANY_RATING) return companyRatings(input, client, end);
  if (path === BOND_RATING) return bondRatings(input, client, end);
  if (path === IMPLIED_RATING) return impliedRatings(input, client, end);
  return curveRows(input, client, end);
}

async function companyRatings(input, client, end) {
  const names = list(input.comChiNameList).filter(name => name.length <= 200).slice(0, 5);
  if (!names.length) return [];
  const start = validDate(input.startDate) || `${Number(end.slice(0, 4)) - 5}${end.slice(4)}`;
  if (start > end) return [];
  const result = [];
  for (const name of names) {
    const raw = await pages(client, "institutionRating", {
      institution_name: name,
      institution_type: "ISR",
      rating_date_start: Number(start.replaceAll("-", "")),
      rating_date_end: Number(end.replaceAll("-", "")),
    });
    for (const row of raw) {
      const date = dataDate(row.rating_date);
      const agency = text(row.rating_agcy_name);
      if (identity(row.institution_name) !== identity(name)
        || !["ISR", "发行人"].includes(text(row.institution_type))
        || !date || date < start || date > end || !externalRating(row.rate, agency, row.rating_source)) continue;
      const output = {
        comChiName: text(row.institution_name),
        ratingDate: date,
        rating: text(row.rate),
        ratingInstitutionShortName: agency,
        ratingOutlook: text(row.outlook),
      };
      // The upstream name lookup is fuzzy; only a registered, exact issuer name
      // permits carrying the caller's society code into the compatible row.
      if (list(input.societyCodeList).length === 1 && names.length === 1) output.societyCode = list(input.societyCodeList)[0];
      result.push(withMeta(output, client, ["institutionRating"], date, {
        comChiName: "institution_name", ratingDate: "rating_date", rating: "rate",
        ratingInstitutionShortName: "rating_agcy_name", ratingOutlook: "outlook",
      }));
    }
  }
  return result.sort((a, b) => b.ratingDate.localeCompare(a.ratingDate));
}

async function bondRatings(input, client, end) {
  const codes = list(input.securityIdList).map(securityCode).filter(Boolean).slice(0, 5);
  const names = list(input.secShortNameList).slice(0, 5);
  if (!codes.length && !names.length) return [];
  const params = codes.length ? { bond_code_par: codes.join(",") } : { bond_short_name_cn: names.join(",") };
  const raw = await pages(client, "bondRatingLatest", params);
  const start = validDate(input.startDate);
  return raw.flatMap(row => {
    const code = securityCode(row.bond_code_par);
    const date = dataDate(row.bond_ratingdate_latest);
    const agency = text(row.bond_rating_agcy);
    if (!code || (codes.length ? !codes.includes(code) : !names.some(name => identity(name) === identity(row.bond_short_name_cn)))
      || !date || date > end || start && date < start
      || !externalRating(row.bond_ratinglevel_latest, agency)) return [];
    return [withMeta({
      securityId: code, secShortName: text(row.bond_short_name_cn), ratingDate: date,
      rating: text(row.bond_ratinglevel_latest), ratingInstitutionShortName: agency,
      ratingOutlook: text(row.bond_ratingoutlook_latest),
    }, client, ["bondRatingLatest"], date, {
      securityId: "bond_code_par", secShortName: "bond_short_name_cn", ratingDate: "bond_ratingdate_latest",
      rating: "bond_ratinglevel_latest", ratingInstitutionShortName: "bond_rating_agcy", ratingOutlook: "bond_ratingoutlook_latest",
    })];
  });
}

async function impliedRatings(input, client, end) {
  const codes = list(input.securityIdList).map(securityCode).filter(Boolean).slice(0, 5);
  if (!codes.length) return [];
  const earliest = validDate(input.startDate) || offset(end, -6);
  const lower = earliest > offset(end, -6) ? earliest : offset(end, -6);
  const result = [];
  const remaining = new Set(codes);
  for (let date = end; date >= lower && remaining.size; date = offset(date, -1)) {
    const raw = await client.query("cdcBondValuation", { bond_code_par: [...remaining].join(","), date });
    for (const code of [...remaining]) {
      const candidates = raw.filter(row => securityCode(row.sec_code) === code && dataDate(row.valuate_date) === date);
      const ratings = [...new Set(candidates.map(row => text(row.implied_rating)).filter(validRating))];
      // Some option-bearing bonds have maturity and exercise rows. A conflicting
      // implied rating is not resolved by accidentally picking array order.
      if (ratings.length !== 1) continue;
      const matched = candidates.find(row => text(row.implied_rating) === ratings[0]);
      result.push(withMeta({ securityId: code, secShortName: text(matched.sec_short_name), ratingDate: date, cbImpliedRating: ratings[0] },
        client, ["cdcBondValuation"], date,
        { securityId: "sec_code", secShortName: "sec_short_name", ratingDate: "valuate_date", cbImpliedRating: "implied_rating" }));
      remaining.delete(code);
    }
  }
  // csiBondValuation.implied_rating is documented as 中债债项隐含评级.
  // It is deliberately not relabelled csImpliedRating without provider evidence.
  return result;
}

async function curveRows(input, client, end) {
  // This application uses ChinaBond YTM curves. Other institutions or curve
  // bases are not interchangeable backups, even if the Chinese name is close.
  if (String(input.dataSource) !== "18" || String(input.curveType ?? "1") !== "1") return [];
  const name = text(input.curveName);
  const terms = [...new Set(list(input.curveTermList).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 100))].slice(0, 20);
  const start = validDate(input.startDate) || offset(end, -7);
  if (!name || name.length > 200 || !terms.length || start > end || (Date.parse(end) - Date.parse(start)) / DAY > 31) return [];
  const dict = await client.query("cdcCurveDictNew", { curveName: name, source: "CDC", curvePeriodType: "到期" });
  // sourceSub=1 is the yield-curve family. Repr/private/perpetual/overseas
  // families require their own entitled endpoint and must not cross this adapter.
  const matches = dict.filter(row => curveName(row.curveName) === curveName(name)
    && text(row.source) === "CDC" && text(row.sourceSub) === "1"
    && text(row.curvePeriodType) === "到期" && text(row.flag) === "1" && text(row.code));
  if (new Set(matches.map(row => text(row.code))).size !== 1) return [];
  // Dictionary code (e.g. CDC.CIB.FRB.CDB) and history curveCoding (CB001250)
  // are different identifiers in the live schema. Query the dictionary-verified
  // exact name, basis, term range and dates, then verify every returned row.
  const raw = await pages(client, "cdcYieldCurveHis", {
    indexDesc: text(matches[0].curveName), curvePeriodType: "到期",
    periodYStart: Math.min(...terms), periodYEnd: Math.max(...terms), dateStart: start, dateEnd: end,
  });
  return raw.flatMap(row => {
    const date = dataDate(row.date);
    const term = finite(row.periodY);
    const rate = finite(row.yield);
    if (text(row.src) !== "CDC" || curveName(row.indexDesc) !== curveName(name) || text(row.curvePeriodType) !== "到期"
      || !date || date < start || date > end || term === null || !terms.some(wanted => Math.abs(wanted - term) < 0.000001)
      || rate === null || rate <= -5 || rate >= 25) return [];
    return [withMeta({ dataSource: "18", curveChName: text(row.indexDesc), curveTerm: term, curveType: "1", valuationDate: date, yield: rate },
      client, ["cdcCurveDictNew", "cdcYieldCurveHis"], date,
      { dataSource: "src", curveChName: "indexDesc", curveTerm: "periodY", curveType: "curvePeriodType", valuationDate: "date", yield: "yield" })];
  });
}

async function pages(client, api, params) {
  const result = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await client.query(api, { ...params, page, pageSize: PAGE_SIZE });
    result.push(...rows);
    if (rows.length < PAGE_SIZE) return result;
  }
  // No arbitrary first-page rating can be called the latest historical rating.
  return [];
}

function withMeta(row, client, apiNames, date, fieldMap) {
  return { ...row, _qb: { apiNames, date, fetchedAt: client.fetchedAt, fieldMap } };
}
function list(value) { return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []; }
function text(value) { return value === undefined || value === null ? "" : String(value).trim(); }
function identity(value) { return text(value).replace(/\s+/g, ""); }
function curveName(value) { return identity(value).replaceAll("（", "(").replaceAll("）", ")").replaceAll("＋", "+"); }
function securityCode(value) { const code = text(value).toUpperCase(); return /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/.test(code) ? code : ""; }
function finite(value) { if (!text(value)) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function validRating(value) { return /^(?:AAA|AA|A|BBB|BB|B|CCC|CC|C|D)[+-]?$|^A-[123]$/.test(text(value).toUpperCase()); }
function externalRating(value, agency, source = "") { return validRating(value) && Boolean(agency) && !/PCA|YY|评分|score/i.test(`${agency} ${source}`); }
function validDate(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}
function dataDate(value) {
  const v = text(value);
  if (validDate(v)) return v;
  if (/^\d{8}$/.test(v)) return validDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}`);
  if (/(?:Z|[+-]\d\d:\d\d)$/.test(v)) {
    const n = Date.parse(v);
    return Number.isFinite(n) ? new Date(n + 8 * 3600000).toISOString().slice(0, 10) : "";
  }
  return validDate(v.slice(0, 10));
}
function cutoff(value, today) { const now = validDate(today); const wanted = validDate(value) || now; return now && wanted ? (wanted < now ? wanted : now) : ""; }
function offset(date, days) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
