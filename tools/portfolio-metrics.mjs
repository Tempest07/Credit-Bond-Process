import {InventoryError} from './inventory-workbook.mjs';
import {accountLabel, accountSql} from './inventory-account.mjs';
import {readPortfolioFacts} from './portfolio-facts.mjs';

const dayMs = 86400000;
const yi = cents => cents / 1e10;
const shown = (n, digits = 2) => n.toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
const missing = '—';
const ratingOrder = ['AAA+', 'AAA', 'AAA-', 'AA+', 'AA', 'AA(2)', 'AA-', 'A+', 'A', 'A-',
  'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC', 'CC', 'C', 'D'];
function ratingLabel(value) {
  const label = String(value || '').normalize('NFKC').trim().toUpperCase().replaceAll('−', '-');
  return label === 'AA2' ? 'AA(2)' : label;
}
const dateText = epoch => new Date(epoch).toISOString().slice(0, 10);
function parseDate(text) {
  const epoch = Date.parse(text + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(epoch) || dateText(epoch) !== text)
    throw new InventoryError('请指定有效的业务日期。', 422);
  return epoch;
}
function scopeFilter(spec) {
  const conditions = [], bindings = [], names = [];
  if (spec.account) {
    const account = /^OCI$/i.test(spec.account) ? 'AFS' : accountLabel(spec.account);
    conditions.push(accountSql + '=?');
    bindings.push(account);
    names.push(account === 'AFS' ? 'OCI（AFS）' : account);
  }
  if (spec.branch) {
    conditions.push('branch=?');
    bindings.push(spec.branch);
    names.push(spec.branch);
  }
  return {sql: conditions.map(c => ' AND ' + c).join(''), bindings, label: names.join(' · ') || '全账户'};
}
function cents(n) {
  if (!Number.isSafeInteger(n)) throw new InventoryError('台账本金超出可精确汇总的范围。', 422);
  return n;
}
const endOfWeek = epoch => epoch + ((7 - new Date(epoch).getUTCDay()) % 7) * dayMs;
async function weeklyResult(resources, spec, snapshots, filter, details) {
  const start = parseDate(spec.start), end = parseDate(spec.end);
  const byWeek = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.date < spec.start || snapshot.date > spec.end) continue;
    const key = endOfWeek(parseDate(snapshot.date));
    if (!byWeek.has(key) || byWeek.get(key).date < snapshot.date) byWeek.set(key, snapshot);
  }
  const totals = new Map();
  if (filter.bindings.length && byWeek.size) {
    const ids = [...byWeek.values()].map(s => s.id);
    const {results} = await resources.db.prepare('SELECT version,SUM(cents) AS cents FROM inventory_rows ' +
      'WHERE version IN (SELECT value FROM json_each(?))' + filter.sql + ' GROUP BY version')
      .bind(JSON.stringify(ids), ...filter.bindings).all();
    for (const row of results) totals.set(row.version, cents(row.cents));
  }
  const rows = [], exportRows = [], absent = [];
  let total = 0n;
  for (let day = start; day <= end; ) {
    const sunday = endOfWeek(day), weekEnd = dateText(Math.min(end, sunday));
    const week = dateText(day) + ' 至 ' + weekEnd;
    const snapshot = byWeek.get(sunday);
    if (snapshot) {
      const amount = cents(filter.bindings.length ? totals.get(snapshot.id) ?? 0 : snapshot.totalCents);
      total += BigInt(amount);
      rows.push([week, snapshot.date, shown(yi(amount))]);
      if (details) exportRows.push([dateText(day), weekEnd, snapshot.date, amount / 100, snapshot.filename, snapshot.id]);
    } else {
      absent.push(week);
      rows.push([week, '缺台账', missing]);
      if (details) exportRows.push([dateText(day), weekEnd, '', '', '', '']);
    }
    day = sunday + dayMs;
  }
  const mean = byWeek.size ? Number(total) / byWeek.size / 1e10 : null;
  const headline = mean === null ? '期间内没有可用的余额台账，无法计算周均规模。'
    : filter.label + '周均规模为 ' + shown(mean) + ' 亿元（' + byWeek.size + ' 个有台账的自然周）。';
  const notes = [spec.start + ' 至 ' + spec.end + '，按周一至周日取期间内最后一个有台账的业务日，各有数据的周等权平均。',
    '规模按全部在账名义本金计算，包含违约和实质展期持仓。'];
  if (absent.length) notes.push(absent.length + ' 周缺少台账，未参与平均；日期列于逐周明细。');
  const columns = ['统计周', '取值业务日', '全额名义本金（亿元）'];
  return {spec, headline, columns, rows, notes, ...(details ? {detailSheets: [{name: '逐周规模',
    headers: ['期间起日', '期间止日', '取值业务日', '名义本金（人民币元）', '台账文件', '库存版本'], rows: exportRows}]} : {})};
}

async function valuationPeriod(resources, spec, snapshot, filter, details) {
  const sql = 'SELECT upper(trim(code)) AS code,MIN(name) AS name,SUM(cents) AS cents FROM inventory_rows ' +
    'WHERE version=?' + filter.sql + ' GROUP BY upper(trim(code)) ORDER BY code';
  const [holdings, facts] = await Promise.all([
    resources.db.prepare(sql).bind(snapshot.id, ...filter.bindings).all(),
    readPortfolioFacts(resources, snapshot, spec.marketPins),
  ]);
  const duration = spec.metric === 'modifiedDuration';
  const threshold = ratingOrder.indexOf(spec.threshold);
  const result = {date: snapshot.date, gross: 0, excluded: 0, covered: 0, unknown: 0, target: 0,
    weighted: 0, used: 0, excludedCount: 0, unknownCount: 0, targetCount: 0, sources: new Map(), ratings: new Map(),
    note: facts.note, exportRows: []};
  for (const row of holdings.results) {
    const amount = cents(row.cents), fact = facts.byCode.get(row.code);
    const grade = ratingLabel(fact?.rating), rank = ratingOrder.indexOf(grade);
    const usable = duration ? Number.isFinite(fact?.duration) : rank >= 0;
    let decision;
    result.gross += amount;
    if (fact?.excluded === true) {
      decision = '剔除'; result.excluded += amount; result.excludedCount++;
    } else if (fact?.excluded !== false || !usable) {
      decision = fact?.excluded !== false ? '缺信用事件核对' : '缺当日指标';
      result.unknown += amount; result.unknownCount++;
    } else {
      const hit = !duration && rank >= threshold;
      decision = duration ? '纳入' : hit ? '纳入分子及分母' : '仅纳入分母';
      result.covered += amount; result.used++;
      if (duration) result.weighted += amount * fact.duration;
      else {
        result.ratings.set(grade, (result.ratings.get(grade) || 0) + amount);
        if (hit) { result.target += amount; result.targetCount++; }
      }
      const agency = (duration ? fact.durationSource : fact.ratingSource) || '来源待核';
      result.sources.set(agency, (result.sources.get(agency) || 0) + 1);
    }
    if (details) {
      const fields = duration
        ? [fact?.duration ?? '', fact?.durationSource ?? '', fact?.durationBasis ?? '', fact?.durationApi ?? '',
          fact?.durationField ?? '', fact?.durationCollectedAt ?? '', fact?.optionDate ?? '']
        : [grade, fact?.ratingSource ?? '', fact?.ratingRaw ?? '', fact?.ratingApi ?? '', fact?.ratingCollectedAt ?? '',
          fact?.subsequentDate ?? '', fact?.subsequentRating ?? ''];
      result.exportRows.push([snapshot.date, row.code, row.name, amount / 100, decision, ...fields,
        fact?.reason ?? '', fact?.evidence ?? '', snapshot.id]);
    }
  }
  for (const n of [result.gross, result.excluded, result.unknown, result.covered, result.target]) cents(n);
  result.value = result.covered <= 0 ? null : duration ? result.weighted / result.covered : 100 * result.target / result.covered;
  return result;
}

function marketResult(spec, periods, filter, details) {
  const duration = spec.metric === 'modifiedDuration', digits = duration ? 4 : 2;
  const title = duration ? '修正久期' : '隐含评级 ' + spec.threshold + ' 及以下持仓占比';
  const unit = duration ? '年' : '%';
  const complete = periods.every(p => !p.unknownCount && p.value !== null);
  let headline;
  if (!complete) {
    headline = filter.label + title + '无法按完整口径计算。';
  } else if (periods.length === 1) {
    headline = periods[0].date + ' ' + filter.label + title + '为 ' + shown(periods[0].value, digits) + unit + '。';
  } else {
    const [a,b] = periods, change = b.value - a.value;
    const direction = change < 0 ? (duration ? '缩短' : '下降') : (duration ? '拉长' : '上升');
    const difference = change === 0 ? '持平' : direction + ' ' + shown(Math.abs(change), digits) + (duration ? ' 年' : ' 个百分点');
    headline = filter.label + title + '从 ' + a.date + ' 的 ' + shown(a.value, digits) + unit +
      ' 至 ' + b.date + ' 的 ' + shown(b.value, digits) + unit + '，' + difference + '。';
  }
  const columns = ['业务日', (complete ? '' : '已覆盖持仓的') + title + '（' + unit + '）',
    ...(duration ? [] : ['门槛内本金（亿元）','门槛内券数']), '已覆盖本金（亿元）', '已覆盖券数',
    '已剔除本金（亿元）', '已剔除券数', '待核本金（亿元）', '待核券数'];
  const rows = periods.map(p => [p.date, p.value === null ? missing : shown(p.value, digits),
    ...(duration ? [] : [shown(yi(p.target)),p.targetCount]), shown(yi(p.covered)), p.used, shown(yi(p.excluded)),
    p.excludedCount, shown(yi(p.unknown)), p.unknownCount]);
  const notes = ['范围为' + filter.label + '，按估值日当时的违约及实质展期情况剔除对应持仓。',
    duration ? '按名义本金加权。含权券优先采用行权修正久期；已确认最后行权日经过且仍存续的券可取到期修正久期。'
      : '按人民币名义本金计算，包含门槛档位。优先采用同日中债债项隐含评级，缺失时用同日中证估值记录补缺；中证 AA2 按约定归入 AA(2)。'];
  for (const p of periods) {
    if (p.sources.size) notes.push(p.date + ' 已覆盖 ' + p.used + ' 只，' + [...p.sources].map(([key,n])=>key+' '+n+' 只').join('、') + '。');
    if (!duration && p.ratings.size) {
      const grades = ratingOrder.slice(ratingOrder.indexOf(spec.threshold)).filter(g=>p.ratings.has(g));
      if (grades.length) notes.push(p.date + ' 门槛内本金为 ' + grades.map(g=>g+' '+shown(yi(p.ratings.get(g)))+' 亿元').join('、') + '。');
    }
    if (p.unknownCount) notes.push(p.date + ' 有 ' + p.unknownCount + ' 只缺少当日可核实资料，局部指标只用已覆盖本金。');
    if (p.covered <= 0) notes.push(p.date + ' 可计入持仓的本金合计为零或负数，无法计算该期指标。');
    if (p.note) notes.push(p.note);
  }
  const detailSheets = details ? [{name: '逐券核对', headers: ['业务日','债券代码','债券简称','名义本金（人民币元）','处理',
    ...(duration ? ['修正久期（年）','估值来源','久期口径','QB接口','估值字段','采集时间','最后行权日']
      : ['采用隐含评级','评级来源','原始评级','QB接口','采集时间','期后首个中债估值日','期后中债评级（仅复核）']),
    '核对说明','条款及信用事件证据','库存版本'],
    rows: periods.flatMap(p => p.exportRows)}] : null;
  return {spec,headline,columns,rows,notes,...(details ? {detailSheets} : {})};
}

export async function portfolioMetrics(resources, spec, snapshots, {details=false}={}) {
  if (parseDate(spec.start) > parseDate(spec.end)) throw new InventoryError('起始日期应早于或等于结束日期。', 422);
  const filter = scopeFilter(spec);
  if (spec.metric === 'weeklyMean') return weeklyResult(resources, spec, snapshots, filter, details);
  if (spec.metric !== 'modifiedDuration' && spec.metric !== 'impliedRatingShare') throw new InventoryError('不支持该组合指标。', 422);
  if (spec.metric === 'impliedRatingShare') {
    const threshold = ratingLabel(spec.threshold);
    if (!ratingOrder.includes(threshold)) throw new InventoryError('请指定可核实的隐含评级门槛。', 422);
    spec = {...spec, threshold};
  }
  const selected = [...new Set([spec.start,spec.end])].map(date => {
    const snapshot = snapshots.find(s=>s.date===date);
    if (!snapshot) throw new InventoryError('缺少 '+date+' 的余额台账。', 422);
    return snapshot;
  });
  const periods = await Promise.all(selected.map(snapshot=>valuationPeriod(resources, spec, snapshot, filter, details)));
  return marketResult(spec, periods, filter, details);
}
