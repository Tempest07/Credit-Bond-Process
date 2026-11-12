import {accountLabel} from './inventory-account.mjs';
import {isCreditGroup,isCreditSourceType} from './inventory-credit.mjs';
import {InventoryError} from './inventory-workbook.mjs';

export const analysisFieldLabels = Object.freeze({
  institution:'机构名称', branch:'联动分行', portfolio:'交易组合', account:'会计科目', scope:'表内/委外',
  issuer:'发行人', code:'债券代码', name:'债券简称', marketType:'归集品种', sourceMarketType:'原表债券类型', maturity:'到期日期',
  expected:'ABS预计到期日', legal:'法定到期日', attribution:'资产端损益还原客户名称',
  guarantor:'台账列明担保人', cents:'名义本金（人民币分）',
});
export const analysisFields = Object.freeze(Object.keys(analysisFieldLabels));
export const analysisMetrics = Object.freeze(['principalCents','rowCount','securityCount','measure']);
const dateFields = new Set(['maturity','expected','legal']);
const identityFields = new Set(['issuer','attribution','guarantor','code']);
const numericOps = new Set(['eq','neq','gt','gte','lt','lte']);
const textOps = new Set(['eq','neq','contains']);
const knownKeys = new Set(['op','fields','field','operator','value','metric','descending','limit','measure']);
const invalid = reason => new InventoryError('库存分析步骤无效。'+reason,400);
const sourceField = field => typeof field==='string' && /^原表:[^\u0000-\u001f\u007f]{1,80}$/u.test(field);
const allowedField = field => analysisFields.includes(field) || sourceField(field);

function isoDate(term) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(term)) return false;
  const stamp = Date.parse(term+'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(term);
}
function decimal(term) {
  if (typeof term!=='string' && typeof term!=='number') return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(term)) return null;
  const value = Number(term);
  return Number.isFinite(value) ? value : null;
}

function validateMetric(metric,measure) {
  if (!analysisMetrics.includes(metric) || metric==='measure' && !measure) throw invalid('请选择本次分组已计算的指标。');
  return metric;
}
function normalizeMeasure(input) {
  if (input==null) return null;
  if (typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['fn','field'].includes(key))) {
    throw invalid('分组指标定义无效。');
  }
  const {fn,field} = input;
  if (fn==='principalShare' && field===null) return {fn,field};
  if (fn==='distinct' && allowedField(field) && field!=='cents') return {fn,field};
  if (['sum','avg','min','max','weightedAvg'].includes(fn) && sourceField(field)) return {fn,field};
  throw invalid('所选聚合指标与数据列不匹配。');
}
function integer(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^[+-]?\d{1,18}$/.test(value))) {
    throw invalid('金额请使用整数人民币分，计数请使用整数。');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw invalid('数字超过精确统计范围。');
  return number;
}
function filterStep({field,operator,value},accountRules) {
  if (!allowedField(field)) throw invalid('台账未开放该筛选列。');
  if (sourceField(field)) {
    if ((typeof value!=='string' && !Number.isFinite(value)) || !String(value).trim() || String(value).length>256 ||
        (!textOps.has(operator) && !numericOps.has(operator))) throw invalid('原表列筛选条件无效。');
    const term = String(value).trim();
    if (!textOps.has(operator) && decimal(term)===null && !isoDate(term)) throw invalid('原表列大小比较应使用数字或 YYYY-MM-DD 日期。');
    return {op:'filter',field,operator,value:term};
  }
  if (field === 'cents') {
    if (!numericOps.has(operator)) throw invalid('本金比较方式无效。');
    return {op:'filter',field,operator,value:integer(value)};
  }
  if (identityFields.has(field) && !(value==='未填写' && ['eq','neq'].includes(operator))) {
    throw invalid('按具体主体或券码筛选须通过主体查证和基础筛选；可在步骤中按该列分组。');
  }
  const isDate = dateFields.has(field);
  if (!(isDate ? numericOps : textOps).has(operator) || typeof value !== 'string' || !value.trim() || value.length>256) {
    throw invalid('筛选条件与列类型不匹配。');
  }
  let term = value.trim();
  if (isDate && (term !== '未填写' || !['eq','neq'].includes(operator))) {
    if (!isoDate(term)) {
      throw invalid('日期比较需要有效的 YYYY-MM-DD。');
    }
  }
  if (field === 'account' && (operator !== 'contains' || accountRules===2)) term = accountLabel(term,accountRules);
  return {op:'filter',field,operator,value:term};
}

/** Compile a bounded, read-only program and check the row/group type at each stage. */
export function normalizeAnalysis(steps,accountRules=2) {
  if (!Array.isArray(steps) || steps.length<1 || steps.length>32) throw invalid('请使用 1 至 32 个步骤。');
  let grouped = false, measure = null;
  const result = steps.map(step => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).some(k=>!knownKeys.has(k))) {
      throw invalid('步骤结构无效。');
    }
    const {op,fields,metric,operator,descending,limit} = step;
    switch (op) {
      case 'filter':
        if (grouped) throw invalid('筛选明细前须先展开分组。');
        return filterStep(step,accountRules);
      case 'group': {
        if (grouped || !Array.isArray(fields) || fields.length>3 || new Set(fields).size!==fields.length ||
            fields.some(field=>!allowedField(field) || field==='cents')) {
          throw invalid('请选择最多三个不同的台账维度，并从明细开始分组。');
        }
        grouped = true;
        measure = normalizeMeasure(step.measure);
        return {op,fields:[...fields],...(measure ? {measure} : {}),...(metric ? {metric:validateMetric(metric,measure)} : {})};
      }
      case 'having': {
        if (!grouped || !numericOps.has(operator)) throw invalid('请在分组之后按指标筛选。');
        validateMetric(metric,measure);
        const value = metric==='measure' ? decimal(step.value) : integer(step.value);
        if (value===null) throw invalid('指标比较须使用有限数值。');
        return {op,metric,operator,value};
      }
      case 'sort':
        if (!grouped || typeof descending!=='boolean') throw invalid('请在分组之后指定指标和排序方向。');
        return {op,metric:validateMetric(metric,measure),descending};
      case 'take':
        if (!grouped || !Number.isInteger(limit) || limit<1 || limit>50000) throw invalid('请从已有分组中选取前 1 至 50000 个。');
        return {op,limit};
      case 'expand':
        if (!grouped) throw invalid('请先选出需要展开的分组。');
        grouped = false;
        return {op};
      default:
        throw invalid('无法识别该操作。');
    }
  });
  if (!grouped) throw invalid('最后一步需要形成可汇总和导出的分组。');
  return result;
}

function fieldValue(row,field) {
  if (field==='cents') return row.cents;
  if (sourceField(field)) return String(row[field] ?? '').trim() || '未填写';
  if (field==='marketType') return (row.queryMarketType ?? row.marketType) || '未填写';
  if (field==='sourceMarketType') return row.marketType || '未填写';
  if (field==='account') return (row.queryAccount ?? accountLabel(row.account || '')) || '未填写';
  if ((field==='guarantor' || field==='attribution') && !Object.hasOwn(row,field)) {
    throw new InventoryError('本期查询未载入'+analysisFieldLabels[field]+'。',422);
  }
  return row[field] || '未填写';
}
function compare(value,operator,term) {
  switch (operator) {
    case 'eq': return value===term;
    case 'neq': return value!==term;
    case 'gt': return value>term;
    case 'gte': return value>=term;
    case 'lt': return value<term;
    case 'lte': return value<=term;
    case 'contains': return value.toLowerCase().includes(term.toLowerCase());
  }
}
function matches(row,step,creditRules) {
  if (creditRules && step.field==='marketType' && isCreditGroup(step.value)) {
    const member = isCreditSourceType(row.marketType);
    return step.operator==='neq' ? !member : member;
  }
  const value = fieldValue(row,step.field);
  if (sourceField(step.field) && !textOps.has(step.operator)) {
    const numericTerm = decimal(step.value);
    if (numericTerm!==null) {
      const numericValue = decimal(value);
      return numericValue!==null && compare(numericValue,step.operator,numericTerm);
    }
    return isoDate(value) && compare(value,step.operator,step.value);
  }
  // A missing date has no position on the timeline.
  if (dateFields.has(step.field) && value==='未填写' && !['eq','neq'].includes(step.operator)) return false;
  return compare(value,step.operator,step.value);
}
function compareLabels(a,b) {
  for (let i=0; i<a.length; i++) {
    if (a[i]!==b[i]) return a[i]<b[i] ? -1 : 1;
  }
  return 0;
}
const metricOf = (group,metric) => metric==='measure' ? group.measureValue : group[metric];
function sortGroups(groups,metric,descending) {
  return groups.sort((a,b)=>{
    const left=metricOf(a,metric),right=metricOf(b,metric);
    if (left===right) return compareLabels(a.labels,b.labels);
    if (left===null) return 1;
    if (right===null) return -1;
    return (left<right ? -1 : 1)*(descending ? -1 : 1);
  });
}

function measureState(measure) {
  if (!measure) return null;
  return {values:measure.fn==='distinct' ? new Set() : null,value:0,count:0,weight:0};
}
function accumulate(state,measure,row) {
  if (measure.fn==='principalShare') {
    state.value+=row.cents;
    if (!Number.isSafeInteger(state.value)) throw new InventoryError('本金超过精确统计范围。',422);
    return;
  }
  const raw = fieldValue(row,measure.field);
  if (measure.fn==='distinct') {
    if (raw!=='未填写') state.values.add(raw);
    return;
  }
  const value = decimal(raw);
  if (value===null) return;
  switch (measure.fn) {
    case 'sum':
    case 'avg': state.value+=value; break;
    case 'weightedAvg':
      state.value+=value*row.cents;
      state.weight+=row.cents;
      break;
    case 'min': state.value=state.count===0 ? value : Math.min(state.value,value); break;
    case 'max': state.value=state.count===0 ? value : Math.max(state.value,value); break;
  }
  if (!Number.isFinite(state.value) || !Number.isSafeInteger(state.weight)) throw new InventoryError('原表指标超过可计算范围。',422);
  state.count++;
}
function finishMeasure(state,measure,denominator) {
  if (measure.fn==='principalShare') return denominator===0 ? null : state.value/denominator*100;
  if (measure.fn==='distinct') return state.values.size;
  if (!state.count) return null;
  if (measure.fn==='avg') return state.value/state.count;
  if (measure.fn==='weightedAvg') return state.weight===0 ? null : state.value/state.weight;
  return state.value;
}
function bucket(key,labels,measure) {
  return {name:key,labels,principalCents:0,rowCount:0,sourceRows:[],codes:new Set(),state:measureState(measure)};
}
function groupRows(rows,fields,measure,denominator) {
  const buckets = new Map();
  if (!fields.length) buckets.set('[]',bucket('[]',[],measure));
  for (const row of rows) {
    const labels = fields.map(field=>fieldValue(row,field));
    const key = JSON.stringify(labels);
    let group = buckets.get(key);
    if (!group) {
      group = bucket(key,labels,measure);
      buckets.set(key,group);
    }
    group.principalCents += row.cents;
    if (!Number.isSafeInteger(group.principalCents)) throw new InventoryError('分组本金超过精确统计范围。',422);
    group.rowCount++;
    group.sourceRows.push(row.sourceRow);
    group.codes.add(row.code);
    if (measure) accumulate(group.state,measure,row);
  }
  return Array.from(buckets.values(),({codes,state,...group})=>({
    ...group,securityCount:codes.size,...(measure ? {measureValue:finishMeasure(state,measure,denominator)} : {}),
  }));
}

/** Source row identities stay inside the authorized snapshot throughout regrouping. */
export function runAnalysis(rows,steps,accountRules=2,creditRules=true) {
  const program = normalizeAnalysis(steps,accountRules);
  if(accountRules!==2)rows=rows.map(row=>row.queryAccount===undefined?{...row,queryAccount:accountLabel(row.account||'',accountRules)}:row);
  const sourceRows = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.sourceRow) || row.sourceRow<1 || sourceRows.has(row.sourceRow) ||
        !Number.isSafeInteger(row.cents) || typeof row.code!=='string' || !row.code) {
      throw new InventoryError('分析明细缺少有效的行号、唯一来源、债券代码或本金。',422);
    }
    sourceRows.add(row.sourceRow);
  }
  const originals = [...rows].sort((a,b)=>a.sourceRow-b.sourceRow);
  let selected = originals, groups = [], dimensions = [], metric = 'principalCents', measure = null, denominator = 0;
  let expandedOrder=null, showMemberOrder=false;
  function retainedRows() {
    const retained = new Set();
    for (const group of groups) for (const id of group.sourceRows) retained.add(id);
    return selected.filter(row=>retained.has(row.sourceRow));
  }
  for (const step of program) {
    switch (step.op) {
      case 'filter':
        selected = selected.filter(row=>matches(row,step,creditRules));
        break;
      case 'group':
        dimensions = step.fields;
        showMemberOrder=dimensions.length>1 && expandedOrder?.field===dimensions[0];
        measure = step.measure ?? null;
        denominator = measure?.fn==='principalShare' ? selected.reduce((sum,row)=>sum+row.cents,0) : 0;
        if (!Number.isSafeInteger(denominator)) throw new InventoryError('本金占比分母超过精确统计范围。',422);
        metric = step.metric ?? (measure ? 'measure' : 'principalCents');
        groups = sortGroups(groupRows(selected,dimensions,measure,denominator),metric,true);
        break;
      case 'having':
        groups = groups.filter(group=>{
          const value=metricOf(group,step.metric);
          return value!==null && compare(value,step.operator,step.value);
        });
        break;
      case 'sort':
        showMemberOrder=false;
        metric = step.metric;
        sortGroups(groups,metric,step.descending);
        break;
      case 'take':
        showMemberOrder=false;
        groups = groups.slice(0,step.limit);
        break;
      case 'expand':
        expandedOrder=dimensions.length===1 ? {field:dimensions[0],order:new Map(groups.map((g,i)=>[g.labels[0],i]))} : null;
        selected = retainedRows();
        groups = [];
        break;
    }
  }
  // Present each member’s breakdown in the selection order, after all business operations.
  if (showMemberOrder) groups.sort((a,b)=>expandedOrder.order.get(a.labels[0])-expandedOrder.order.get(b.labels[0]));
  const kept = retainedRows();
  let measureTotal = null;
  if (measure) {
    const state = measureState(measure);
    for (const row of kept) accumulate(state,measure,row);
    measureTotal = finishMeasure(state,measure,denominator);
  }
  return {groups:groups.map(group=>({...group,value:metricOf(group,metric)})),rows:kept,dimensions,metric,
    ...(measure ? {measure,measureTotal} : {})};
}
