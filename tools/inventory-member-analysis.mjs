import {newInventoryAnswer,readInventoryAnswer} from './inventory-store.mjs';
import {InventoryError} from './inventory-workbook.mjs';

const names={code:'债券代码',issuer:'发行人',branch:'联动分行',account:'会计科目'};
const category=(key,label)=>({key,label,kind:'category'});
const number=(key,label,unit)=>({key,label,kind:'number',unit});
const yi=cents=>cents/1e10;
const show=cents=>yi(cents).toLocaleString('zh-CN',{maximumFractionDigits:8});
const compareName=(a,b)=>a<b?-1:a>b?1:0;
const savedPreviewSize=150;

function exact(n) {
  if(!Number.isSafeInteger(n))throw new InventoryError('所选范围的本金超出可精确计算的金额范围。',422);
  return n;
}
function namedGroups(result) {
  if(result.groupsTruncated || !Array.isArray(result.groups) ||
     result.groups.reduce((total,g)=>total+g.count,0)!==result.rowCount) {
    throw new InventoryError('所选范围没有完整的分组明细，无法比较成员。',422);
  }
  return new Map(result.groups.filter(g=>g.count>0 && g.name?.trim() && !['未填写','（未填）'].includes(g.name))
    .map(g=>[g.name,g]));
}
function sorted(groups,metric) {
  return [...groups.values()].sort((a,b)=>b[metric]-a[metric]||compareName(a.name,b.name));
}
function scope(result) {
  const conditions=Object.values(result.plan.filters||{}).join('、')||'全部持仓';
  return result.snapshot.date+' '+conditions;
}
function boundaryNote(ordered,limit,metric,label) {
  const last=ordered[limit-1];
  if(!last || ordered[limit]?.[metric]!==last[metric])return '';
  const ties=ordered.filter(row=>row[metric]===last[metric]);
  return label+'末位有 '+ties.length+' 个成员同值，按名称升序取到第 '+limit+' 名。';
}
function rankOverlap(spec,left) {
  const balances=sorted(left,'cents'),counts=sorted(left,'securityCount');
  const principals=balances.slice(0,spec.limit),securities=counts.slice(0,spec.limit);
  const amountRank=new Map(principals.map((g,i)=>[g.name,i+1]));
  const countRank=new Map(securities.map((g,i)=>[g.name,i+1]));
  const members=[...new Set([...amountRank.keys(),...countRank.keys()])];
  const both=members.filter(name=>amountRank.has(name)&&countRank.has(name)).length;
  const rows=members.map(name=>{
    const g=left.get(name),a=amountRank.get(name),b=countRank.get(name);
    return {name,category:a&&b?'两榜都有':a?'仅本金榜':'仅券数榜',principal:yi(g.cents),codes:g.securityCount,
      principalRank:a??null,codeRank:b??null};
  });
  return {title:'本金榜与不同券数榜',summary:'两榜各列 '+principals.length+' 个'+names[spec.field]+'，两榜都有 '+both+
      ' 个，仅本金榜 '+(principals.length-both)+' 个，仅不同券数榜 '+(securities.length-both)+' 个。',
    note:['本金按原持仓行加总，券数在各成员内按券码去重，未填写的成员不参与排名。',
      boundaryNote(balances,spec.limit,'cents','本金榜'),boundaryNote(counts,spec.limit,'securityCount','券数榜')].filter(Boolean).join(' '),
    columns:[category('name',names[spec.field]),category('category','榜单归属'),number('principal','在账本金','亿元'),
      number('codes','不同券数','只'),number('principalRank','本金榜名次','名'),number('codeRank','券数榜名次','名')],rows};
}
function compareBalances(spec,left,right,labels) {
  const same=[],added=[],exited=[];
  let first=0,last=0,addedCents=0,exitedCents=0;
  function row(name,a,b,category){
    return {name,category,first:yi(a),last:yi(b),change:yi(exact(b-a))};
  }
  for(const [name,g] of left) {
    if(right.has(name)){
      const b=right.get(name).cents;
      first=exact(first+g.cents);last=exact(last+b);
      same.push(row(name,g.cents,b,'两边都有'));
    }else{
      exitedCents=exact(exitedCents+g.cents);
      exited.push(row(name,g.cents,0,'仅前一范围'));
    }
  }
  for(const [name,g] of right)if(!left.has(name)){
    addedCents=exact(addedCents+g.cents);
    added.push(row(name,0,g.cents,'仅后一范围'));
  }
  const columns=[category('name',names[spec.field]),category('category','范围归属'),number('first',labels[0]+'本金','亿元'),
    number('last',labels[1]+'本金','亿元'),number('change','后一范围减前一范围','亿元')];
  const change=exact(last-first);
  const common='共同'+names[spec.field]+' '+same.length+' 个；共同成员在 '+labels[0]+' 的本金 '+show(first)+' 亿元，在 '+
    labels[1]+' 的本金 '+show(last)+' 亿元，相差 '+show(change)+' 亿元（后减前）。';
  if(spec.analysisMode==='commonMovers') {
    // Sort by cents before formatting for display, including when two large yuan values round to the same number.
    const delta=r=>right.get(r.name).cents-left.get(r.name).cents;
    const up=same.filter(r=>delta(r)>0).sort((a,b)=>delta(b)-delta(a)||compareName(a.name,b.name));
    const down=same.filter(r=>delta(r)<0).sort((a,b)=>delta(a)-delta(b)||compareName(a.name,b.name));
    const leaders=(list,category)=>list.slice(0,spec.limit).map(r=>({...r,category}));
    const rows=[...leaders(up,'增加'),...leaders(down,'减少')];
    const max=spec.limit;
    const ties=[['增加榜',up],['减少榜',down]].filter(([,list])=>list.length>max&&delta(list[max-1])===delta(list[max]))
      .map(([name])=>name+'末位本金变动相同，按名称升序取前 '+max+' 个。');
    return {title:'共同持仓本金增减排名',summary:common+' 增加 '+up.length+' 个，减少 '+down.length+' 个。'+
      (rows.length?'增加榜：'+(up.slice(0,max).map(r=>r.name+' '+show(delta(r))+' 亿元').join('、')||'无')+
       '；减少榜：'+(down.slice(0,max).map(r=>r.name+' '+show(delta(r))+' 亿元').join('、')||'无')+'。':''),
      note:['比较仅限两期都有持仓的已具名成员。合计使用全部共同成员，各方向列前 '+max+' 个。',...ties].join(' '),columns,rows};
  }
  return {title:'两份库存的成员与本金对照',
    summary:common+' 两边合并去重 '+(same.length+added.length+exited.length)+' 个；仅前一范围 '+exited.length+
      ' 个（本金 '+show(exitedCents)+' 亿元），仅后一范围 '+added.length+' 个（本金 '+show(addedCents)+' 亿元）。',
    note:'按'+names[spec.field]+'对齐，同一范围同一成员的本金按原行加总。名单仅计已具名成员。仅单边有持仓的成员在另一完整范围列零。'+
      '仅前一范围对总差额贡献 '+show(-exitedCents)+' 亿元、仅后一范围贡献 '+show(addedCents)+' 亿元、共同成员贡献 '+show(change)+' 亿元。',
    columns,rows:[...same,...exited,...added]};
}
export function buildMemberReport(spec,results) {
  const groups=results.map(namedGroups),labels=results.map(scope);
  const report=spec.analysisMode==='rankOverlap'?rankOverlap(spec,groups[0]):compareBalances(spec,groups[0],groups[1],labels);
  return {...report,source:results.map(r=>scope(r)+' · '+r.snapshot.filename).join(' / ')};
}
export async function memberAnalysis({db,bucket},step,ctx) {
  const {analysisMode,field,limit}=step;
  const spec={analysisMode,field,limit};
  const results=await Promise.all(step.slices.map(async slice=>{
    const snapshot=ctx.snapshots.find(s=>s.date===slice.date);
    if(!snapshot)throw new InventoryError('所选日期没有库存快照。',422);
    return newInventoryAnswer(db,snapshot,{date:slice.date,metric:'principal',group:field,filters:slice.filters},bucket);
  }));
  const ambiguous=results.find(r=>!r.resultId || ['unknown','candidate'].includes(r.roleEvidence?.kind));
  if(ambiguous)return {clarification:ambiguous.clarification||'该范围的持仓归属待核。'};
  const full=buildMemberReport(spec,results);
  const ledgerReport=full.rows.length<=savedPreviewSize?full:{...full,rows:full.rows.slice(0,savedPreviewSize),
    note:full.note+' 页面列出 '+savedPreviewSize+' 行，共 '+full.rows.length+' 行；完整名单可下载。'};
  return {memberReportSpec:spec,overview:results.map(result=>({title:scope(result),result})),snapshot:results.at(-1).snapshot,ledgerReport};
}
export async function exportMemberReport(db,data) {
  const results=await Promise.all(data.overview.map(item=>readInventoryAnswer(db,item.result.resultId)));
  return buildMemberReport(data.memberReportSpec,results);
}

