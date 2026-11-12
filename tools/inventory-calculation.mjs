import {accountLabel} from './inventory-account.mjs';
import {isFullLedgerName} from './inventory-evidence.mjs';
import {answerSourceRows,newInventoryAnswer} from './inventory-store.mjs';
import {InventoryError} from './inventory-workbook.mjs';
import {ambiguousSecurities,fullMarketCode,lookupInventorySecurity} from './inventory-security.mjs';

export const sliceFields=['account','branch','issuer','scope','code','marketType','sourceMarketType','holdingStatus','portfolio'];
export const calculationFields=[...sliceFields,'issuerOfCode','securityMarket'];
const markets={IB:/银行间|\.IB\b/i,SH:/上交所|上海证券交易所|沪市|沪交所|\.SH\b/i,SZ:/深交所|深圳证券交易所|深市|\.SZ\b/i};
const valueOf={principal:'totalCents',securities:'securityCount',count:'rowCount'};
const unitOf={principal:'亿元',securities:'只',count:'条'};
const labels={account:'会计科目',branch:'联动分行',scope:'表内/委外',issuer:'发行人',code:'券码',
  marketType:'归集品种',sourceMarketType:'原表债券类型',holdingStatus:'在账状态',portfolio:'交易组合'};
const pct=n=>n.toLocaleString('zh-CN',{maximumFractionDigits:4});
const amount=(n,metric)=>metric==='principal'?(n/1e10).toLocaleString('zh-CN',{maximumFractionDigits:8}):String(n);
const clarify=msg=>{throw new InventoryError(msg,422)};
const choose=(name,value)=>name==='account'?accountLabel(value):value;
function mentionsSecurity(question,value){
  if(!/^[a-z\d-]+(?:\.[a-z]+)?$/i.test(value))return question.toUpperCase().includes(value.toUpperCase());
  return new RegExp('(?:^|[^a-z0-9.])'+value.replaceAll('.','\\.')+'(?![a-z0-9.])','i').test(question);
}

export function normalizeSlices(step,ctx,check) {
  check(Object.hasOwn(valueOf,step.metric),'库存范围只能计算在账本金、不同券数或持仓行数。');
  check(Array.isArray(step.slices)&&step.slices.length>=1&&step.slices.length<=10,'请为库存计算列出 1 至 10 个明确范围。');
  const slices=step.slices.map(s=>{
    const date=s.date??ctx.selectedDate;
    check(ctx.snapshots.includes(date),'库存计算所用日期没有已导入的余额台账：'+date);
    check(Array.isArray(s.filters)&&s.filters.length<=calculationFields.length,'请明确库存范围的筛选列。');
    const filters={};
    for(const f of s.filters){
      check(calculationFields.includes(f.field)&&!Object.hasOwn(filters,f.field)&&typeof f.value==='string'&&
        f.value.trim().length>0&&f.value.length<=180,'每个库存范围的同一列只能指定一个精确值。');
      const value=f.value.trim();
      if(['issuerOfCode','code'].includes(f.field)){
        const literal=ctx.userTerms.some(q=>mentionsSecurity(q,value));
        const [stem,market]=value.toUpperCase().split('.');
        check(literal || (fullMarketCode(value)&&Object.hasOwn(markets,market)&&ctx.userTerms.some(q=>mentionsSecurity(q,stem)&&markets[market].test(q))),
          '请用原问或上文中实际给出的券码、券简称及交易市场查证。');
      }else if(f.field==='securityMarket'){
        check(Object.hasOwn(markets,value)&&ctx.userTerms.some(q=>markets[value].test(q)),'请只使用问题所指的证券交易市场。');
      }else if(['issuer','portfolio'].includes(f.field)){
        check(ctx.userTerms.some(q=>q.includes(value)) && (f.field!=='issuer'||isFullLedgerName(value)),
          '主体简称或券码需要先按库存查证；请将不确定的名称交给单期库存查证。');
      }
      filters[f.field]=choose(f.field,value);
    }
    check(!(filters.issuerOfCode && (filters.issuer||filters.code)) && (!filters.securityMarket||filters.code||filters.issuerOfCode),
      '同一范围请选择一只券或其发行人，并标明券所属市场。');
    return {date,filters};
  });
  check(Array.isArray(step.calculations)&&step.calculations.length<=12,'请限制库存计算的运算数量。');
  const calculations=step.calculations.map(c=>{
    check(['difference','share','codeSets'].includes(c.op)&&[c.left,c.right].every(i=>Number.isSafeInteger(i)&&i>=1&&i<=slices.length)&&c.left!==c.right,'每项运算必须引用两个不同的已定义库存范围。');
    if(c.op==='share')check(slices[c.left-1].date===slices[c.right-1].date,'同范围占比的分子分母必须使用同一快照。');
    return {op:c.op,left:c.left,right:c.right};
  });
  return {operation:'calculate',metric:step.metric,slices,calculations};
}
function sliceName(s) {
  return s.date+' '+(Object.entries(s.filters).map(([k,v])=>labels[k]+' '+v).join('、')||'全部在账持仓');
}
async function securitySlice(db,snapshot,filters){
  const {code,issuerOfCode,securityMarket,...other}=filters;
  const term=code||issuerOfCode;
  if(!term)return {filters};
  const hits=await lookupInventorySecurity(db,snapshot,term,securityMarket);
  if(hits.length>1)clarify(ambiguousSecurities(term,hits));
  if(!hits.length){
    if(code&&fullMarketCode(code)&&(!securityMarket||code.toUpperCase().endsWith('.'+securityMarket)))
      return {filters:{...other,code:code.toUpperCase()}};
    clarify(snapshot.date+' 库存未能按'+(securityMarket?securityMarket+' 市场、':'')+'“'+term+'”核实证券身份。');
  }
  const security=hits[0];
  if(code)return {filters:{...other,code:security.code},security};
  const {results}=await db.prepare('SELECT DISTINCT issuer FROM inventory_rows WHERE version=? AND code=?').bind(snapshot.id,security.code).all();
  if(results.length!==1||!results[0].issuer?.trim())clarify('本期台账不能唯一确认 '+security.code+' 的发行人。');
  return {filters:{...other,issuer:results[0].issuer},issuerSecurity:security};
}
export async function calculateInventory({db,bucket},step,snapshots){
  const setSources=new Set(step.calculations.filter(c=>c.op==='codeSets').flatMap(c=>[c.left-1,c.right-1]));
  const verifiedCodes=new Set();
  const parts=await Promise.all(step.slices.map(async(s,i)=>{
    const snapshot=snapshots.find(v=>v.date===s.date);
    if(!snapshot)clarify('原来指定的库存快照已不可用。');
    const resolved=await securitySlice(db,snapshot,s.filters);
    if(resolved.security)verifiedCodes.add(resolved.security.code);
    const filters=resolved.filters;
    const result=await newInventoryAnswer(db,snapshot,{date:s.date,group:filters.code||setSources.has(i)?'code':'none',
      metric:step.metric,filters},bucket);
    if(!result.resultId || result.roleEvidence?.kind==='unknown')clarify(result.clarification||'该范围的持仓未能核实。');
    if(filters.issuer && result.plan.filters.issuer!==filters.issuer)
      clarify('本期未匹配所给发行人全称，请先查证主体。');
    const security=resolved.security||resolved.issuerSecurity;
    return {title:sliceName({date:s.date,filters})+(security?'（'+security.name+(resolved.issuerSecurity?' '+security.code+' 的发行人':'')+'）':''),result};
  }));
  const measure=valueOf[step.metric],unit=unitOf[step.metric];
  const seenSecurities=new Set();
  const displayParts=parts.filter(({result})=>{
    if(!result.plan.filters.code)return true;
    const key=JSON.stringify([result.snapshot.id,Object.entries(result.plan.filters).sort()]);
    if(seenSecurities.has(key))return false;
    seenSecurities.add(key);
    return true;
  });
  const lines=displayParts.map(({title,result})=>{
    if(result.plan.filters.code)return title+'：'+result.rowCount+' 条持仓，'+amount(result.totalCents,'principal')+' 亿元'+
      (step.metric==='securities'?'，'+result.securityCount+' 只在账券':'')+'。';
    return title+'：'+amount(result[measure],step.metric)+' '+unit+'。';
  });
  // Individual security scopes can be added only when every other predicate and the snapshot agree.
  const scopeKeys=parts.map(({result:{plan}})=>JSON.stringify([plan.date,Object.entries(plan.filters).filter(([k])=>k!=='code').sort()]));
  let securityMembers;
  if(parts.length>1 && new Set(scopeKeys).size===1 && parts.every(p=>p.result.plan.filters.code)){
    const unique=new Map(parts.map(({result:r})=>[r.plan.filters.code,r]));
    const members=[...unique.values()];
    const cents=members.reduce((n,r)=>n+r.totalCents,0),count=members.reduce((n,r)=>n+r.rowCount,0);
    if(!Number.isSafeInteger(cents))clarify('名单合计金额超出精确计算范围。');
    lines.push('按券码去重合计：'+amount(cents,'principal')+' 亿元，'+count+' 条持仓。');
    if(members.every(r=>verifiedCodes.has(r.plan.filters.code)))
      securityMembers=members.map(r=>({code:r.plan.filters.code,cents:r.totalCents}));
  }
  const shares=[], codeComparisons=[], rowSets=new Map();
  function rowsFor(part){
    if(!rowSets.has(part))rowSets.set(part,answerSourceRows(db,part.result.resultId,part.result.snapshot.id).then(rows=>new Set(rows)));
    return rowSets.get(part);
  }
  for(const {op,left,right} of step.calculations){
    const a=parts[left-1],b=parts[right-1],av=a.result[measure],bv=b.result[measure];
    if(op==='difference'){
      const delta=av-bv;
      if(!Number.isSafeInteger(delta))clarify('差额超出精确计算范围。');
      lines.push(a.title+' 比 '+b.title+(delta===0?' 相同，差额为零。':(delta>0?' 多 ':' 少 ')+amount(Math.abs(delta),step.metric)+' '+unit+'。'));
    }else if(op==='share'){
      const [num,den]=await Promise.all([rowsFor(a),rowsFor(b)]);
      if([...num].some(row=>!den.has(row)))clarify('分子包含分母以外的持仓，需确认这两个库存范围。');
      if(!bv){lines.push(a.title+' 占 '+b.title+' 的比例无法计算，分母为零。');continue;}
      const ratio=av/bv*100;
      shares.push({title:a.title,ratio});
      lines.push(a.title+' 占 '+b.title+' 的 '+pct(ratio)+'%。');
    }else{
      const before=new Set(a.result.groups.map(g=>g.name)),after=new Set(b.result.groups.map(g=>g.name));
      const shared=[...before].filter(code=>after.has(code)).length;
      codeComparisons.push({left:a.title,right:b.title,shared,leftOnly:before.size-shared,rightOnly:after.size-shared});
      const datesOrdered=a.result.snapshot.date<b.result.snapshot.date;
      lines.push(a.title+' 与 '+b.title+' 按债券代码核对：共有 '+shared+' 只，'+
        (datesOrdered?'期末新出现 ':'仅后者 ')+(after.size-shared)+' 只，'+(datesOrdered?'期末不再持有 ':'仅前者 ')+(before.size-shared)+' 只。');
    }
  }
  if(shares.length>1){
    const max=Math.max(...shares.map(s=>s.ratio)),winners=shares.filter(s=>s.ratio===max);
    lines.push('占比最高：'+winners.map(s=>s.title).join('、')+'（'+pct(max)+'%）。');
  }
  return {clarification:lines.join('\n'),overview:displayParts,snapshot:parts.at(-1).result.snapshot,
    ...(codeComparisons.length?{codeComparisons}:{}),...(securityMembers?{securityMembers}:{})};
}
