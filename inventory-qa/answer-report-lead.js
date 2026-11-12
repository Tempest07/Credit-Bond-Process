// Saved ledger reports contain both a generated narrative and an auditable table.
// Only replace a known passage when its figures are accounted for by the report.
const shown = (n, digits) => n.toLocaleString('zh-CN', {maximumFractionDigits: digits});
const flowLabels = {buy:'买入本金', sell:'卖出本金', net:'净买入本金', rows:'交易笔数'};

// Unit and precision requests can rewrite numbers in model.answer. Sentence
// boundaries of a verified generated prefix are unchanged by those conversions.
function followingPrefix(report, model, prefix) {
  if (!report.summary.startsWith(prefix)) return null;
  const boundary = prefix.split('。').length - 1;
  return model.answer.split('。').slice(boundary).join('。').trim();
}

function measureValue(model, key, value, label) {
  const measure = model.result.measures.find(m => m.key === key);
  if (!measure || !Number.isFinite(value)) return null;
  return {label:label || measure.label, value, unit:measure.unit, digits:measure.digits};
}

function wholeNamedQuarter(s) {
  const m=/^(\d{4})年(?:第)?([一二三四1-4])季度$/u.exec(s.label);
  if (!m) return false;
  const quarter=Number(m[2]) || '一二三四'.indexOf(m[2])+1;
  const year=Number(m[1]);
  return new Date(Date.UTC(year,3*quarter-3,1)).toISOString().slice(0,10)===s.start &&
    new Date(Date.UTC(year,3*quarter,0)).toISOString().slice(0,10)===s.end;
}

function flowLead(report, model, spec, question, data) {
  if (!Array.isArray(spec?.series) || !spec.series.length || !Array.isArray(spec.metrics) ||
      !spec.metrics.length || spec.metrics.some(k => !Object.hasOwn(flowLabels, k))) return null;
  const monthly = spec.layout === 'monthsRows';
  const sums = monthly ? report.rows.filter(r => r.month === '期间合计') : report.rows;
  if (monthly ? sums.length !== 1 : sums.length !== spec.series.length) return null;
  const ranges = [], clauses = [], metrics = [];
  for (const [i, s] of spec.series.entries()) {
    if (!s?.label || !s.start || !s.end || (!monthly && sums[i].name !== s.label)) return null;
    const range = s.start + ' 至 ' + s.end;
    const row = sums[monthly ? 0 : i], projected = model.result.rows[report.rows.indexOf(row)];
    const amounts = [];
    for (const key of spec.metrics) {
      const column = (monthly ? 's'+i : 'total') + key, value = row[column];
      if (value !== null && !Number.isFinite(value)) return null;
      amounts.push(flowLabels[key] + ' ' + (value === null ? '待核' :
        shown(value, 6) + ' ' + (key === 'rows' ? '笔' : '亿元')));
      if (monthly && spec.series.length === 1 && spec.metrics.length <= 3) {
        const metric = measureValue(model, column, projected[column], '期间'+flowLabels[key]);
        if (metric) metrics.push(metric);
      }
    }
    clauses.push(s.label+'（'+range+'）'+amounts.join('、'));
    ranges.push(range);
  }
  const prefix = clauses.join('；')+'。';
  let suffix = followingPrefix(report, model, prefix);
  if (suffix === null) return null;
  const dates = new Set(ranges);
  let title = dates.size === 1 ? ranges[0] : spec.series.map((s,i) => s.label+' · '+ranges[i]).join(' / ');
  // Some period comparisons store the difference only in the narrative.
  // Keep its sign, unit and null status in separate figures under one scope.
  if (spec.series.length === 2 && !monthly && spec.compare !== 'none' && spec.metrics.length <= 3) {
    const differenceText = [], deltas = [];
    for (const key of spec.metrics) {
      const col = 'total'+key, scale = key === 'rows' ? 1 : 1e10;
      const [a,b] = sums.map(r => r[col] === null ? null : Math.round(r[col]*scale));
      const diff = Number.isSafeInteger(a) && Number.isSafeInteger(b) && Number.isSafeInteger(a-b) ? (a-b)/scale : null;
      differenceText.push(spec.series[0].label+'减'+spec.series[1].label+'的'+flowLabels[key]+'差额 '+
        (diff === null?'待核':shown(diff,6)+' '+(key === 'rows'?'笔':'亿元'))+'。');
      const measure = model.result.measures.find(m => m.key === col);
      if (!measure) return null;
      const multiplier = {'元':1e8,'万元':1e4,'亿元':1,'笔':1}[measure.unit];
      if (!multiplier) return null;
      deltas.push({label:flowLabels[key]+'差额',value:diff === null?'待核':diff*multiplier,
        unit:diff === null?'':measure.unit,digits:measure.digits});
    }
    if (report.summary === prefix+differenceText.join('')) {
      metrics.push(...deltas);
      title = spec.series[0].label+' 减 '+spec.series[1].label;
      suffix = spec.series.every(wholeNamedQuarter) ? '' : ranges.join(' / ');
    }
  }
  const standard = '按原始成交日归期。覆盖完整且无匹配成交记为 0，缺台账或超过累计截止日的单元格留空。';
  const foldNote = model.result.note.startsWith(standard);
  const missing = sums.some(row => Object.entries(row).some(([key,v]) => /(?:buy|sell|net|rows)$/.test(key) && v === null));
  let coverage = foldNote ? model.result.note.slice(standard.length).trim() : '';
  const gap = /^已导入的交易台账不覆盖所选方向及日期，(?:流水累计至 (\d{4}-\d{2}-\d{2})，)?无法确定所问期间的交易额。余额变动受兑付、摊还和划转等影响，不能替代净买入。$/u.exec(coverage);
  if (gap) {
    const gaps = monthly ? [] : sums.flatMap(r=>{
      const sides = ['buy','sell'].filter(key=>spec.metrics.includes(key) && r['total'+key]===null);
      return sides.length?[r.name+'缺少完整'+sides.map(key=>key==='buy'?'买入':'卖出').join('、')+'流水']:[];
    });
    coverage = (gaps.length?gaps.join('；'):'所选方向流水覆盖不足')+(gap[1]?'，已入账流水累计至 '+gap[1]:'')+'。';
    if (!/净买入|净增持|净额/u.test(question) || /持仓|余额|变化原因|归因/u.test(question)) coverage += '余额变动不能替代净买入。';
  }
  if (!coverage && missing && foldNote) coverage = '部分交易流水缺失或超出截止日，对应金额或笔数待核。';
  const notes = [suffix,coverage].filter(Boolean);
  if (!monthly && sums.length <= 3 && spec.metrics.includes('net') && /净买入|净增持|净额/u.test(question)) {
    const measure = model.result.measures.find(m => m.key === 'totalnet');
    if (measure && (spec.compare === 'none' || metrics.length)) {
      // Period rows put the net after buy and sell on narrow screens. Promote
      // the requested net values and keep the other two sides in the table.
      const net = model.result.rows.map(r => measureValue(model,'totalnet',r.totalnet,r.name) || {label:r.name,value:'待核'});
      const netDelta = metrics.find(m => m.label === '净买入本金差额');
      if (netDelta) {
        title = '净买入变化 · '+spec.series[0].label+' 减 '+spec.series[1].label;
        metrics.splice(0,metrics.length,netDelta,...net);
      } else {
        title = '期间净买入本金';
        metrics.splice(0,metrics.length,...net);
        // The saved turn may contain a separate comparison of two of these
        // months. Use only that step's actual dates, operands and direction.
        const secondary = data.find(d => d?.flowMatrixSpec?.compare === 'difference' &&
          d.flowMatrixSpec.layout === 'periodRows' && d.flowMatrixSpec.metrics?.join() === 'net' &&
          d.flowMatrixSpec.series?.length === 2 && d.ledgerReport?.rows?.length === 2);
        if (secondary) {
          const series = secondary.flowMatrixSpec.series;
          const indices = series.map((s,i) => spec.series.findIndex((p,j) => p.start === s.start && p.end === s.end && p.label === s.label &&
            secondary.ledgerReport.rows[i].name === s.label && secondary.ledgerReport.rows[i].totalnet === sums[j].totalnet));
          if (indices.every(i => i >= 0) && indices[0] !== indices[1]) {
            const [a,b] = indices.map(i=>sums[i].totalnet);
            if (a === null || b === null) title = series[0].label+' 减 '+series[1].label+' · 净额差待核';
            else {
              const cents = Math.round(a*1e10)-Math.round(b*1e10);
              const scale = {'亿元':1e10,'万元':1e6,'元':100}[measure.unit];
              if (Number.isSafeInteger(cents) && scale) title = series[0].label+' 减 '+series[1].label+' · 净额差 '+
                shown(cents/scale,measure.digits ?? 6)+' '+measure.unit;
            }
          }
        }
      }
    }
  }
  return {title, metrics, notes, foldNote};
}

function versionLead(report, model, data, unit, question) {
  const v = data?.sourceEvidence, s = data?.snapshot;
  if (!v?.id || v.id !== s?.id || !v.file || !v.sheet || typeof v.active !== 'boolean' ||
      !Number.isSafeInteger(data.totalCents) || !Number.isSafeInteger(data.rowCount) || !Number.isSafeInteger(s.rowCount)) return null;
  const version = '本对话锁定 '+v.date+' 的《'+v.file+'》，工作表“'+v.sheet+'”，快照版本 '+v.id+'。'+
    (v.active ? '此版本仍为该日已发布版本。' : '该日已发布了其他版本，旧对话和下载继续使用此处锁定的版本。');
  const count = '原表共 '+s.rowCount+' 条持仓；本次筛选有 '+data.rowCount+' 条，本金 '+shown(data.totalCents/1e10,10)+' 亿元。';
  const minimum = report.title === '最小正本金持仓';
  if (minimum) {
    if (!report.summary.endsWith(' '+version) || !/^最小正本金是 .+ 元，共 \d+ 行同额。 本对话锁定/u.test(report.summary)) return null;
  } else if (report.summary !== count+' '+version) return null;
  const money = unit || '亿元', scale = {'元':100,'万元':1e6,'亿元':1e10}[money];
  const digits = model.result.measures.find(m => m.digits !== undefined && /^(元|万元|亿元)$/.test(m.unit))?.digits;
  if (!scale || (/小数/u.test(question) && digits === undefined)) return null;
  const metrics = minimum ? [] : [{label:'筛选本金',value:data.totalCents/scale,unit:money,digits},
    {label:'筛选持仓',value:data.rowCount,unit:'条'}];
  if (!minimum && s.rowCount !== data.rowCount) metrics.push({label:'原表持仓',value:s.rowCount,unit:'条'});
  const notes = ['工作表「'+v.sheet+'」 · '+(v.active?'当前发布版本':'已锁定旧版，对话和下载沿用此版')];
  const identity = '同一台账空间使用共同发布的版本。'+
    (v.uploadedBy?'该版本上传账号为 '+v.uploadedBy+'。':'该版本未保留可核对的上传账号。');
  const provenance = identity+' 下载中的“来源与口径”记录同一文件、业务日和快照版本。';
  const foldNote = [provenance,'原表行号与本次对话锁定的台账文件对应，同一券码在不同持仓行分别列出。 '+provenance].includes(model.result.note);
  if (foldNote) notes.push('空间内共享台账 · '+(v.uploadedBy?'上传账号 '+v.uploadedBy:'上传账号未留存'));
  const file = v.date+' · '+v.file;
  if (minimum) notes.unshift(file);
  return {title:minimum?model.answer.split('。 本对话锁定 ')[0]:file,metrics,notes,foldNote};
}

function reconciliationLead(report, model) {
  const row = (table,key) => table.find(r => r.item === key);
  const partial = report.title === '余额变动与已覆盖的买卖流水';
  const keys = partial ? ['余额变动','已覆盖的净买入'] : ['余额变动','期间净买入','余额变动减净买入'];
  const rows = keys.map(key => row(report.rows,key));
  if (rows.some(r => !Number.isFinite(r?.amount))) return null;
  const metrics = keys.map(key => measureValue(model,'amount',row(model.result.rows,key)?.amount,key));
  const numbers = rows.map(r => shown(r.amount,8)+' 亿元');
  let title, prefix;
  if (partial) {
    const pos = report.summary.indexOf(' 在 '+rows[0].period+' 的余额变动为 ');
    if (pos < 0 || !rows[1].period || row(report.rows,'完整期间对账差额')?.amount !== null) return null;
    title = report.summary.slice(0,pos)+' · '+rows[0].period;
    prefix = report.summary.slice(0,pos)+' 在 '+rows[0].period+' 的余额变动为 '+numbers[0]+'。'+rows[1].period+' 可核净买入 '+numbers[1]+'。';
  } else {
    title = /^\d{4}-\d{2}-\d{2} 至 \d{4}-\d{2}-\d{2}/u.exec(report.summary)?.[0];
    if (!title) return null;
    const scope = report.summary.startsWith(title+'，余额变动 '+numbers[0]+'，同范围') ? '同范围' : '';
    prefix = title+'，余额变动 '+numbers[0]+'，'+scope+'期间净买入 '+numbers[1]+'，余额变动减净买入为 '+numbers[2]+'。';
  }
  const suffix = followingPrefix(report,model,prefix);
  if (suffix === null || metrics.some(m => !m)) return null;
  return {title,metrics,notes:[partial && '已核流水 · '+rows[1].period,suffix].filter(Boolean)};
}

function rankingLead(report, model, spec) {
  if (spec?.stat !== 'ranking' || !Number.isInteger(spec.limit)) return null;
  const leaders = report.rows.filter(r => r.rank === 1);
  const entity = report.columns.find(c => c.key === 'name')?.label;
  if (!leaders.length || !entity || leaders.some(r => !r.name || !Number.isFinite(r.principal) ||
      r.principal !== leaders[0].principal)) return null;
  const prefix = '具名'+entity+'本金前 '+spec.limit+' 名中，第一名为'+leaders.map(r => r.name).join('、')+
    '，本金 '+shown(leaders[0].principal,8)+' 亿元。';
  const suffix = followingPrefix(report, model, prefix);
  if (suffix === null) return null;
  const row = model.result.rows.find(r => r.rank === 1);
  const metric = row && measureValue(model,'principal',row.principal,leaders.length === 1 ? '在账本金' : '每名在账本金');
  if (!metric) return null;
  const title = leaders.length === 1 ? leaders[0].name+' · 本金第 1 名' : leaders.length+' 个'+entity+'并列第 1 名';
  const basis = '先按原表持仓行汇总人民币名义本金，再按金额降序排列；并列使用同一名次，保留边界并列项。';
  const foldNote = model.result.note.startsWith(basis);
  return {title, metrics:[metric], notes:[suffix,foldNote && model.result.note.slice(basis.length).trim()].filter(Boolean), foldNote};
}

function denominatorLead(report, model) {
  const rows = report.rows;
  if (rows.length < 2 || !rows[0].numerator || rows.some(r => r.numerator !== rows[0].numerator || !r.denominator ||
      !Number.isFinite(r.top) || !Number.isFinite(r.bottom) || !Number.isFinite(r.ratio))) return null;
  const unit = report.columns.find(c => c.key === 'top')?.unit;
  if (!unit) return null;
  const statements = new Set();
  for (const r of rows) {
    statements.add(r.numerator+'：'+shown(r.top,8)+' '+unit);
    statements.add(r.denominator+'：'+shown(r.bottom,8)+' '+unit);
    statements.add(r.numerator+' 占 '+r.denominator+' 的 '+shown(r.ratio,4)+'%');
  }
  // A multi-operation answer can also contain a difference, overlap or winner.
  // Let that narrative through whenever the visible matrix cannot account for it.
  if (report.summary.split('。').map(s => s.trim()).filter(Boolean).some(s => !statements.has(s))) return null;
  const date = /^\d{4}-\d{2}-\d{2} /u.exec(rows[0].numerator)?.[0];
  const metrics = rows.length <= 3 ? model.result.rows.map(r => measureValue(model,'ratio',r.ratio,
    '占'+(date && r.denominator.startsWith(date) ? r.denominator.slice(date.length) : r.denominator))) : [];
  return {title:rows[0].numerator,metrics:metrics.filter(Boolean)};
}

function breakdownLead(report, model, spec) {
  const parentLabel=report.columns.find(c => c.key === 'name')?.label, childLabel=report.columns.find(c => c.key === 'child')?.label;
  if (spec?.stat !== 'breakdown' || !parentLabel || !childLabel || !report.rows.length) return null;
  const groups=new Map();
  for (const r of report.rows) {
    if (!r.name || !r.child || !Number.isFinite(r.principal)) return null;
    if (!groups.has(r.name)) groups.set(r.name,[]);
    groups.get(r.name).push(r);
  }
  if (groups.size > 3) return null;
  const scope=spec.limit?'前 '+spec.limit+' 个具名'+parentLabel:groups.size+' 个'+parentLabel+'分组';
  const clauses=[], metrics=[], unfilled=[];
  for (const [name,rows] of groups) {
    const known=rows.filter(r => r.child !== '未填写');
    const top=Math.max(...known.map(r => r.principal)), winners=known.filter(r => r.principal === top);
    const names=winners.map(r => r.child).join('、'), missing=rows.find(r => r.child === '未填写');
    clauses.push(name+'：'+(winners.length?'首位 '+names+'各 '+shown(top,8)+' 亿元，':'')+'未填写'+childLabel+' '+shown(missing?.principal||0,8)+' 亿元');
    const projected=r=>model.result.rows[report.rows.indexOf(r)].principal;
    const value=winners.length?measureValue(model,'principal',projected(winners[0]),name+' · '+names):null;
    if (value) metrics.push(value);
    unfilled.push({name,amount:missing?projected(missing):0});
  }
  if (report.summary!=='按本金'+(spec.limit?'选取':'汇总 ')+scope+'，再按'+childLabel+'拆分。'+clauses.join('；')) return null;
  const m=model.result.measures.find(v => v.key === 'principal');
  if (!m) return null;
  const missing=unfilled.every(g=>g.amount===0)?'各组均为 0 '+m.unit:
    unfilled.map(g=>g.name+' '+shown(g.amount,m.digits ?? 8)+' '+m.unit).join('、');
  return {title:scope+' · 首位'+childLabel,metrics,notes:['未填写'+childLabel+'本金：'+missing+'。']};
}

function commonMemberLead(report, model) {
  // Previews can contain only the first 150 members. These amounts are the
  // persisted full-range aggregates, never derived by summing preview rows.
  const m = /^共同(.+?) (\d+) 个；共同成员在 (.+?) 的本金 ([\d,.-]+) (亿元|万元|元)，在 (.+?) 的本金 ([\d,.-]+) (亿元|万元|元)，相差 ([\d,.-]+) (亿元|万元|元)（后减前）。\s*/u.exec(model.answer);
  if (!m) return null;
  const col = key => report.columns.find(c => c.key === key)?.label;
  if (col('name') !== m[1] || col('first') !== m[3]+'本金' || col('last') !== m[6]+'本金') return null;
  let tail = model.answer.slice(m[0].length);
  if (report.title === '共同持仓本金增减排名' && report.rows.every(r => Number.isFinite(r.change))) {
    const names = key => report.rows.filter(r => r.category === key).map(r => r.name+' '+shown(r.change,8)+' 亿元').join('、') || '无';
    const repeated = '增加榜：'+names('增加')+'；减少榜：'+names('减少')+'。';
    if (report.summary.endsWith(repeated) && /^增加 \d+ 个，减少 \d+ 个。增加榜：/u.test(tail)) tail = tail.split('。增加榜：')[0]+'。';
  }
  return {title:'共同'+m[1]+' · '+m[2]+' 个',metrics:[
    {label:m[3],value:m[4],unit:m[5]}, {label:m[6],value:m[7],unit:m[8]}, {label:'后减前',value:m[9],unit:m[10]},
  ],notes:tail?[tail]:[]};
}

export function reportDisplayLead(report, model, steps, unit, question) {
  if (!report?.summary || !model?.result?.columns) return null;
  let lead;
  const data = steps.map(s => s?.data);
  if (report.title === '交易流水对照表') {
    for (const step of data) {
      lead = flowLead(report,model,step?.flowMatrixSpec,question,data);
      if (lead) break;
    }
  }
  else if (['余额台账版本','来源与原表持仓样例','台账来源与分组本金','最小正本金持仓'].includes(report.title)) lead = versionLead(report,model,data.findLast(d => d?.sourceEvidence),unit,question);
  else if (['持仓与交易对账','余额变动与已覆盖的买卖流水'].includes(report.title)) lead = reconciliationLead(report,model);
  else if (/^具名.+本金排名$/u.test(report.title)) lead = rankingLead(report,model,data.findLast(d => d?.profileSpec?.stat === 'ranking')?.profileSpec);
  else if (/^按.+核对持仓$/u.test(report.title)) lead = breakdownLead(report,model,data.findLast(d => d?.profileSpec?.stat === 'breakdown')?.profileSpec);
  else if (report.title === '占比与分母对照') lead = denominatorLead(report,model);
  else if (['两份库存的成员与本金对照','共同持仓按成员的本金及占比','共同持仓本金增减排名'].includes(report.title)) lead = commonMemberLead(report,model);
  else if (report.title === '当期前列与固定名单的占比' && report.rows.length) {
    if (report.rows.some(r => !r.basis || !r.period || r.ratio !== null && !Number.isFinite(r.ratio))) return null;
    const prefix = report.rows.map(r => r.basis+' 在 '+r.period+' 占 '+(r.ratio === null?'不适用':r.ratio.toFixed(6)+'%')).join('；')+'。';
    const tail = followingPrefix(report,model,prefix);
    const [first,last,fixed]=model.result.rows;
    const rank=first?.basis?.match(/ 前 (\d+) 名$/u)?.[1];
    if (tail?.startsWith('当期新进：') && report.rows.length===3 && rank && fixed.basis===first.basis &&
        fixed.period===last.period && first.basis===first.period+' 前 '+rank+' 名' && last.basis===last.period+' 前 '+rank+' 名') {
      const scope = s=>s.replace(/ 全部持仓$/u,'');
      const labels=[scope(first.period),scope(last.period),'首期名单 · '+scope(last.period)];
      const metrics=model.result.rows.map((r,i)=>measureValue(model,'ratio',r.ratio,labels[i]) || {label:labels[i],value:'不适用'});
      lead = {title:'前 '+rank+' 名本金占比',metrics,notes:/进出|新进|掉出|进榜|出榜/u.test(question)?[tail]:[]};
    }
  }
  return lead ? {...lead,showOriginal:true} : null;
}
