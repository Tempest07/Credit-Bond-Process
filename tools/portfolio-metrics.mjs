import {lookupInventorySecurity,ambiguousSecurities} from './inventory-security.mjs';
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
    const account = accountLabel(spec.account);
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
  const observations = [];
  for (let day = start; day <= end; ) {
    const sunday = endOfWeek(day), weekEnd = dateText(Math.min(end, sunday));
    const week = dateText(day) + ' 至 ' + weekEnd;
    const snapshot = byWeek.get(sunday);
    if (snapshot) {
      const amount = cents(filter.bindings.length ? totals.get(snapshot.id) ?? 0 : snapshot.totalCents);
      total += BigInt(amount);
      observations.push({week, date:snapshot.date, amount});
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
  let headline = mean === null ? '期间内没有可用的余额台账，无法计算周均规模。'
    : filter.label + '周均规模为 ' + shown(mean) + ' 亿元（' + byWeek.size + ' 个有台账的自然周）。';
  const notes = [spec.start + ' 至 ' + spec.end + '，按周一至周日取期间内最后一个有台账的业务日，各有数据的周等权平均。',
    '规模按全部在账名义本金计算，包含违约和实质展期持仓。'];
  if (absent.length) {
    const preview = absent.slice(0, 4).join('、');
    headline += '缺台账的自然周共 ' + absent.length + ' 个：' + preview +
      (absent.length > 4 ? '等，完整日期见逐周明细。' : '。');
    notes.push('缺台账的周不参与平均，逐周明细列出各周的取值日期。');
  }
  let extremes=null;
  if (observations.length) {
    const sorted = observations.toSorted((a,b)=>a.amount-b.amount);
    const low=sorted[0].amount, high=sorted.at(-1).amount;
    extremes={low:yi(low),high:yi(high),weeks:observations.length};
    function describe(value) {
      const tied=sorted.filter(r=>r.amount===value);
      const labels=tied.slice(0,3).map(r=>r.week+'（取值日 '+r.date+'）').join('、');
      return labels+(tied.length>3?'等 '+tied.length+' 周':'')+' '+shown(yi(value))+' 亿元';
    }
    headline += '最高为 '+describe(high)+'，最低为 '+describe(low)+'，相差 '+shown(yi(high-low))+' 亿元。';
  }
  const columns = ['统计周', '取值业务日', '全额名义本金（亿元）'];
  return {spec, headline, columns, rows, notes, mean, extremes, ...(details ? {detailSheets: [{name: '逐周规模',
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
    for(const period of periods){
      if(period.note)headline+=' '+period.note;
      if(period.unknownCount)headline+=' '+period.date+' 有 '+period.unknownCount+' 只在账券、'+shown(yi(period.unknown))+' 亿元待核。';
      if(!duration && period.covered>0)headline+=' '+period.date+' 仅按有有效评级的 '+shown(yi(period.covered))+' 亿元核算，门槛内 '+shown(yi(period.target))+' 亿元，占 '+shown(period.value,digits)+'%。';
      if(duration && period.covered>0)headline+=' '+period.date+' 在可核久期的 '+shown(yi(period.covered))+' 亿元内，本金加权修正久期为 '+shown(period.value,6)+' 年。';
    }
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
  return {spec,headline,columns,rows,notes,values:periods.map(p=>({date:p.date,gross:p.gross,covered:p.covered,excluded:p.excluded,
    value:p.unknownCount?null:p.value,target:p.unknownCount?null:p.target,
    unknown:p.unknown,coveredCount:p.used,excludedCount:p.excludedCount,unknownCount:p.unknownCount,
    ...(duration?{coveredDuration:p.value}:{coveredTarget:p.target,coveredShare:p.value})})),...(details ? {detailSheets} : {})};
}

async function auditHoldings(resources, spec, snapshots, filter, details) {
  const anchor=snapshots.find(s=>s.date===(spec.referenceDate||spec.end));
  const current=snapshots.find(s=>s.date===spec.end);
  if(!anchor||!current)throw new InventoryError('缺少所选业务日的余额台账。',422);
  let selectedCode=null;
  if(spec.code){
    const hits=await lookupInventorySecurity(resources.db,anchor,spec.code);
    if(hits.length!==1)throw new InventoryError(hits.length?ambiguousSecurities(spec.code,hits):'名单核验日未能核实这只券，请确认名称或券码。',422);
    selectedCode=hits[0].code.toUpperCase();
  }
  const facts=await readPortfolioFacts(resources,anchor,spec.marketPins);
  const columns=['债券代码','债券简称','持仓本金（亿元）','名单核验日','采用隐含评级','来源或剔除依据'];
  if(!facts.byCode.size&&spec.subset!=='unknown')return {spec,headline:facts.note,columns,rows:[],notes:[],
    memberCoverage:{complete:false,referenceDate:anchor.date,note:facts.note||'名单核验日缺少逐券估值与信用事件资料，无法确认成员。'}};
  const sql='SELECT upper(trim(code)) AS code, MIN(name) AS name, SUM(cents) AS amount FROM inventory_rows WHERE version=?'+filter.sql+' GROUP BY upper(trim(code))';
  const read=snapshot=>resources.db.prepare(sql).bind(snapshot.id,...filter.bindings).all();
  const anchored=await read(anchor), positions=anchor.id===current.id?anchored:await read(current);
  const membership=new Set(), limit=spec.threshold?ratingOrder.indexOf(ratingLabel(spec.threshold)):-1;
  if(spec.threshold&&limit<0)throw new InventoryError('无法识别评级门槛。',422);
  let unavailable=0, ratingDenominator=0, excludedPrincipal=0, excludedCount=0;
  for(const {code,amount:principal} of anchored.results){
    const fact=facts.byCode.get(code);
    if(!fact)unavailable++;
    if(fact?.excluded===true){excludedPrincipal+=principal;excludedCount++;}
    if(fact?.excluded===false && ratingOrder.includes(ratingLabel(fact.rating)))ratingDenominator+=principal;
    if(selectedCode && code!==selectedCode)continue;
    const match=spec.subset==='rated'?fact?.excluded===false && ratingOrder.includes(ratingLabel(fact.rating)):spec.subset==='ratedExact'?fact?.excluded===false && ratingLabel(fact.rating)===spec.threshold:spec.subset==='unknown'?(!fact||!fact.excluded&&!fact.rating):
      spec.subset==='excluded'?fact?.excluded:fact&&!fact.excluded&&(spec.subset==='csi'?fact.ratingSource.startsWith('中证'):fact.ratingSource==='中债');
    if(match && (!spec.threshold||ratingOrder.indexOf(ratingLabel(fact?.rating))>=limit))membership.add(code);
  }
  const picked=positions.results.filter(r=>membership.has(r.code)).sort((a,b)=>b.amount-a.amount);
  const amount=cents(picked.reduce((t,r)=>t+r.amount,0));
  const rows=picked.map(r=>{
    const f=facts.byCode.get(r.code);
    return [r.code,r.name,shown(yi(r.amount)),anchor.date,ratingLabel(f?.rating)||missing,f?.reason||f?.ratingSource||'待核'];
  });
  const label={excluded:'违约或实质展期剔除',csi:'同日中证补缺',cdc:'中债评级',unknown:'核验资料待补',ratedExact:'精确评级',rated:'已核验评级'}[spec.subset];
  let headline=anchor.date+' '+filter.label+' 的'+label+'名单'+(spec.threshold?'（'+spec.threshold+(spec.subset==='ratedExact'?'）':'及以下）'):'')+'，在 '+current.date+' 持有 '+rows.length+' 只，合计 '+shown(yi(amount))+' 亿元。'+(unavailable?'名单日有 '+unavailable+' 只缺核验资料。':'');
  if(anchor.id===current.id && !selectedCode && !spec.threshold && spec.subset==='rated' && excludedCount)
    headline+=' 同范围另有 '+excludedCount+' 只、'+shown(yi(cents(excludedPrincipal)))+' 亿元因已确认违约或实质展期剔除。';
  const detailSheets=details?[{name:'名单逐券',headers:['债券代码','债券简称','持仓本金（人民币元）','持仓日','名单核验日','隐含评级','依据'],rows:picked.map((r,i)=>
    [r.code,r.name,r.amount/100,current.date,anchor.date,rows[i][4],rows[i][5]])}]:undefined;
  return {spec,headline,auditCents:unavailable?null:amount,grossCents:cents(positions.results.reduce((sum,r)=>sum+r.amount,0)),ratingCoveredCents:anchor.id===current.id?cents(ratingDenominator):null,columns,rows,
    memberCoverage:{complete:spec.subset==='unknown'||!unavailable,referenceDate:anchor.date,note:unavailable?anchor.date+' 有 '+unavailable+' 只持仓缺核验资料，无法确认完整名单。':''},
    notes:['按名单核验日的逐券记录筛选，再按券码匹配持仓日余额。'],...(details?{detailSheets}:{})};
}

async function ratingTransitions(resources,spec,snapshots,filter,details){
  async function period(date){
    const snapshot=snapshots.find(s=>s.date===date);
    if(!snapshot)throw new InventoryError('缺少 '+date+' 的余额快照。',422);
    const [holdings,facts]=await Promise.all([
      resources.db.prepare('SELECT upper(trim(code)) AS code,MIN(name) AS name,SUM(cents) AS amount FROM inventory_rows WHERE version=?'+
        filter.sql+' GROUP BY upper(trim(code))').bind(snapshot.id,...filter.bindings).all(),
      readPortfolioFacts(resources,snapshot,spec.marketPins)]);
    return {snapshot,byCode:new Map(holdings.results.filter(r=>r.code).map(r=>[r.code,r])),facts:facts.byCode};
  }
  const [before,after]=await Promise.all([period(spec.start),period(spec.end)]);
  const counts={entered:0,left:0,unchanged:0,unknown:0,excluded:0},rows=[];
  const grade=f=>f?.excluded===false && ratingOrder.includes(ratingLabel(f.rating))?ratingLabel(f.rating):null;
  const labels={entered:'进入',left:'离开',unknown:'缺资料待核',excluded:'信用事件剔除',unchanged:'未进出'};
  for(const [code,a] of before.byCode){
    const b=after.byCode.get(code);if(!b)continue;
    const f=before.facts.get(code),g=after.facts.get(code),x=grade(f),y=grade(g);
    const status=f?.excluded||g?.excluded?'excluded':!x||!y?'unknown':x===spec.threshold&&y!==spec.threshold?'left':
      x!==spec.threshold&&y===spec.threshold?'entered':'unchanged';
    counts[status]++;
    if(spec.subset==='unknown'?status==='unknown':['entered','left'].includes(status))rows.push({code,name:b.name||a.name,status:labels[status],
      first:x,last:y,firstPrincipal:yi(a.amount),lastPrincipal:yi(b.amount)});
  }
  rows.sort((a,b)=>a.status.localeCompare(b.status,'zh-CN')||a.code.localeCompare(b.code));
  const columns=[['code','券码'],['name','简称'],['status','两期比较'],['first',spec.start+'评级'],['last',spec.end+'评级'],
    ['firstPrincipal',spec.start+'本金','亿元'],['lastPrincipal',spec.end+'本金','亿元']].map(([key,label,unit])=>({key,label,kind:unit?'number':'category',...(unit?{unit}:{})}));
  const summary=filter.label+' 两期共有持仓中，进入 '+spec.threshold+' 的有 '+counts.entered+' 只，离开 '+counts.left+' 只，可比且未进出 '+counts.unchanged+
    ' 只；缺任一期评级或信用事件资料待核 '+counts.unknown+' 只，已明确剔除 '+counts.excluded+' 只。';
  const report={title:spec.subset==='unknown'?'缺期评级的共同券':'共同持仓评级进出',summary,source:[before,after].map(p=>p.snapshot.date+' '+p.snapshot.filename).join(' / '),
    note:'按相同券码匹配。任一日确认违约或实质展期先剔除；仅在两日均核实信用事件且取得有效隐含评级时判断是否进出。',columns,rows};
  const values=rows.map(r=>columns.map(c=>r[c.key]??''));
  return {spec,headline:summary,columns:columns.map(c=>c.label+(c.unit?'（'+c.unit+'）':'')),rows:values,notes:[report.note],
    ledgerReport:report,...(details?{detailSheets:[{name:'共同券评级核对',headers:columns.map(c=>c.label+(c.unit?'（'+c.unit+'）':'')),rows:values}]}:{})};
}

export async function portfolioMetrics(resources, spec, snapshots, {details=false}={}) {
  if (parseDate(spec.start) > parseDate(spec.end)) throw new InventoryError('起始日期应早于或等于结束日期。', 422);
  const filter = scopeFilter(spec);
  if(spec.metric==='ratingTransitions')return ratingTransitions(resources,spec,snapshots,filter,details);
  if (spec.metric === 'valuationAudit') return auditHoldings(resources,spec,snapshots,filter,details);
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

export function durationCoverageReport(steps,question){
  const parts=steps.filter(s=>s.spec?.metric==='modifiedDuration'&&s.data?.values?.length===1).map(s=>({spec:s.spec,v:s.data.values[0]}));
  if(!parts.length||parts.length!==steps.length||parts.some(p=>!Number.isSafeInteger(p.v.coveredCount)))return;
  const number=(key,label,unit)=>({key,label,unit,kind:'number'}),category=(key,label)=>({key,label,kind:'category'});
  if(parts.length===1 && /覆盖率|按券数.*覆盖|按本金.*覆盖/u.test(question)){
    const [{spec,v}]=parts,total=v.coveredCount+v.unknownCount+v.excludedCount;
    const portion=(a,b)=>b>0?100*a/b:null;
    const rows=[{basis:'名义本金',unit:'亿元',covered:yi(v.covered),total:yi(v.gross),rate:portion(v.covered,v.gross)},
      {basis:'不同券数',unit:'只',covered:v.coveredCount,total,rate:portion(v.coveredCount,total)}];
    return {title:'修正久期资料覆盖率',source:[v.date,spec.branch,spec.account||'全账户'].filter(Boolean).join(' · '),
      summary:rows.map(x=>x.basis+'覆盖 '+shown(x.covered,4)+' / '+shown(x.total,4)+' '+x.unit+'，覆盖率 '+(x.rate===null?'待核':shown(x.rate,4)+'%')).join('；')+'。',
      note:'本金覆盖率按每只券的在账本金加权，券数覆盖率按券码一券一票。两项均以该范围全部在账持仓为分母；没有可用久期资料时两项均为零，实际久期仍待核。',
      columns:[category('basis','覆盖口径'),category('unit','原数单位'),number('covered','有有效久期资料',''),number('total','全部在账',''),number('rate','覆盖率','%')],rows};
  }
  if(parts.length<2||!/(?:合并|合起来|合在一起|加权合计|合算|两个账户.*(?:一起|合计))/u.test(question)||
    parts.some(({spec,v})=>!spec.account||v.date!==parts[0].v.date||spec.branch!==parts[0].spec.branch)||
    new Set(parts.map(x=>x.spec.account)).size!==parts.length)return;
  const covered=parts.reduce((s,p)=>s+p.v.covered,0);
  if(!covered||parts.some(({v})=>v.covered>0&&!Number.isFinite(v.coveredDuration)))return;
  const weighted=parts.reduce((sum,{v})=>sum+(v.coveredDuration??0)*v.covered,0)/covered;
  const rows=parts.map(({spec,v})=>({account:spec.account,duration:v.coveredDuration,base:yi(v.covered),weight:100*v.covered/covered,unknown:yi(v.unknown)}));
  const unknown=rows.reduce((s,p)=>s+p.unknown,0);
  return {title:'合并账户的有效本金与修正久期',source:[parts[0].v.date,parts[0].spec.branch,...rows.map(x=>x.account)].filter(Boolean).join(' · '),
    summary:'按各账户有效本金加权，已覆盖 '+shown(yi(covered),6)+' 亿元的合并修正久期为 '+shown(weighted,6)+' 年。待核本金 '+shown(unknown,6)+' 亿元。',
    note:'权重等于各账户有效本金除以所列账户有效本金合计，待核本金未进入权重。',
    columns:[category('account','会计科目'),number('duration','已覆盖修正久期','年'),number('base','有效本金','亿元'),number('weight','有效本金权重','%'),number('unknown','待核本金','亿元')],
    rows:[...rows,{account:'合并',duration:weighted,base:yi(covered),weight:100,unknown}]};
}


// Compare the unrounded values used by the portfolio calculations.
export function explainPortfolioDifferences(steps, previous=[]) {
  const current=steps.filter(s=>s.source==='portfolio' && s.data?.headline);
  for(let i=0;i<current.length;i++){
    const later=current[i], b=later.data, bs=later.spec;
    const candidates=[...current.slice(0,i),...previous.filter(s=>s.source==='portfolio')];
    const matched=candidates.find(s=>{
      const a=s.spec;
      if(!a||!s.data||a.metric!==bs.metric||a.account!==bs.account)return false;
      if(a.metric==='weeklyMean')return a.branch===bs.branch && a.end<bs.start && s.data.mean!=null && b.mean!=null;
      if(a.start!==bs.start||a.end!==bs.end)return false;
      if(a.metric==='modifiedDuration')return a.branch!==bs.branch && a.start!==a.end;
      return a.metric==='impliedRatingShare' && a.branch===bs.branch && a.threshold!==bs.threshold;
    });
    if(!matched)continue;
    const a=matched.data, as=matched.spec;
    if(bs.metric==='weeklyMean'){
      b.headline+=' 与 '+as.start+' 至 '+as.end+' 相比，周均本金变化 '+shown(b.mean-a.mean)+' 亿元。';
    }else if(bs.metric==='modifiedDuration'){
      if(![a,b].every(d=>d.values?.length===2&&d.values.every(v=>Number.isFinite(v.value))))continue;
      const priorChange=a.values[1].value-a.values[0].value, change=b.values[1].value-b.values[0].value;
      b.headline+=' '+(bs.branch||'全分行')+' 的久期变化量减去 '+(as.branch||'全分行')+' 的变化量为 '+shown(change-priorChange,4)+' 年。';
    }else if(a.values&&b.values){
      const deltas=b.values.map(v=>{
        const prior=a.values.find(z=>z.date===v.date);
        return v.target!=null&&prior?.target!=null?v.date+' '+shown(yi(v.target-prior.target))+' 亿元':null;
      }).filter(Boolean);
      if(deltas.length)b.headline+=' 与 '+as.threshold+' 及以下相比，门槛内本金变化为 '+deltas.join('、')+'。';
    }
  }
}
