import {newInventoryAnswer,readInventoryAnswer} from './inventory-store.mjs';
import {InventoryError} from './inventory-workbook.mjs';

const names={code:'债券代码',issuer:'发行人',branch:'联动分行',account:'会计科目',marketType:'标准债券类型',sourceMarketType:'原表债券类型'};
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
function namedGroups(result,includeMissing=false) {
  if(result.groupsTruncated || !Array.isArray(result.groups) ||
     result.groups.reduce((total,g)=>total+g.count,0)!==result.rowCount) {
    throw new InventoryError('所选范围没有完整的分组明细，无法比较成员。',422);
  }
  return new Map(result.groups.filter(g=>g.count>0 && (includeMissing || g.name?.trim()&&!['未填写','（未填）'].includes(g.name)))
    .map(g=>[g.name||'未填写',g]));
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
function rankAcrossDates(spec,left,right,labels) {
  const ordered=[sorted(left,'cents'),sorted(right,'cents')];
  const [a,b]=ordered.map(groups=>new Map(groups.slice(0,spec.limit).map((g,i)=>[g.name,i+1])));
  const tracked=spec.analysisMode==='trackedLeaders';
  const members=tracked?[...a.keys()]:[...new Set([...a.keys(),...b.keys()])];
  const rows=members.map(name=>({name,category:a.has(name)&&b.has(name)?'两期在榜':a.has(name)?'掉出':'新进',
    firstRank:a.get(name)??null,first:yi(left.get(name)?.cents??0),lastRank:b.get(name)??null,last:yi(right.get(name)?.cents??0)}));
  const moved=status=>rows.filter(row=>row.category===status).map(row=>row.name).join('、')||'无';
  return {title:tracked?'固定首期前 '+spec.limit+' 名的两期本金':'两期各自前 '+spec.limit+' 名的进出榜对照',
    summary:tracked?'按 '+labels[0]+' 的前 '+a.size+' 名固定成员，逐一对照两期余额。':
      labels[0]+' 与 '+labels[1]+' 独立排名，新进：'+moved('新进')+'；掉出：'+moved('掉出')+'。',
    note:['空名次表示未进入该期排名；完整范围内没有持仓时，本金计零。',
      ...ordered.map((list,i)=>boundaryNote(list,spec.limit,'cents',labels[i]))].filter(Boolean).join(' '),
    columns:[category('name',names[spec.field]),category('category','榜单归属'),number('firstRank',labels[0]+'榜内名次','名'),
      number('first',labels[0]+'本金','亿元'),number('lastRank',labels[1]+'榜内名次','名'),number('last',labels[1]+'本金','亿元')],rows};
}
function leaderShares(spec,groups,labels,results) {
  const ordered=groups.map(group=>sorted(group,'cents'));
  const leaders=ordered.map(ordered=>ordered.slice(0,spec.limit));
  const [opening,closing]=leaders.map(list=>new Set(list.map(r=>r.name)));
  const entered=[...closing].filter(name=>!opening.has(name)),exited=[...opening].filter(name=>!closing.has(name));
  const requests=[[0,0],[1,1],[0,1]];
  const rows=requests.map(([rankDate,balanceDate])=>{
    const list=leaders[rankDate],data=groups[balanceDate],denominator=results[balanceDate].totalCents;
    const cents=exact(list.reduce((n,r)=>n+(data.get(r.name)?.cents??0),0));
    return {basis:labels[rankDate]+' 前 '+spec.limit+' 名',period:labels[balanceDate],
      members:list.map(r=>r.name).join('、'),amount:yi(cents),denominator:yi(denominator),ratio:denominator?cents/denominator*100:null};
  });
  return {title:'当期前列与固定名单的占比',summary:rows.map(r=>r.basis+' 在 '+r.period+' 占 '+(r.ratio==null?'不适用':r.ratio.toFixed(6)+'%')).join('；')+
    '。当期新进：'+(entered.join('、')||'无')+'；掉出：'+(exited.join('、')||'无')+'。',
    note:['分子取所列名单在实际计量日的本金；分母取计量日本范围全部本金，包含未填写成员。',
      ...ordered.map((list,i)=>boundaryNote(list,spec.limit,'cents',labels[i]))].filter(Boolean).join(' '),
    columns:[category('basis','取榜范围'),category('period','余额计量范围'),category('members',names[spec.field]+'名单'),
    number('amount','名单本金','亿元'),number('denominator','全部本金','亿元'),number('ratio','占比','%')],rows};
}
export function heldMemberReport(result,field,selectedCount,limit) {
  const groups=sorted(namedGroups(result),'cents');
  const chosen=groups.slice(0,limit);
  return {title:'入选名单在 '+result.snapshot.date+' 的持仓',source:scope(result)+' · '+result.snapshot.filename,
    summary:'原名单 '+selectedCount+' 个'+names[field]+'，其中 '+groups.length+' 个仍然在账，'+(selectedCount-groups.length)+' 个没有持仓。'+
      (limit?'按在账本金降序列出前 '+chosen.length+' 名。':''),
    note:['在账按快照内确有持仓行判定，先核对完整名单，再对有持仓的成员排名。',
      boundaryNote(groups,limit,'cents','在账榜')].filter(Boolean).join(' '),
    columns:[number('rank','名次','名'),category('name',names[field]),number('principal','在账本金','亿元'),
      number('securities','不同券数','只'),number('positions','持仓行数','条')],
    rows:chosen.map((g,i)=>({rank:i+1,name:g.name,principal:yi(g.cents),securities:g.securityCount,positions:g.count}))};
}
function groupDifferences(spec,groups,labels,results) {
  const units=results.map(r=>r.totalCents);
  const categories=[...new Set(groups.flatMap(g=>[...g.keys()]))];
  const entries=categories.map(name=>{
    const [a,b]=groups.map(g=>g.get(name)?.cents??0);
    return {name,a,b,difference:exact(a-b)};
  }).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)||compareName(a.name,b.name));
  const max=entries.length?Math.abs(entries[0].difference):null;
  const ties=entries.filter(r=>Math.abs(r.difference)===max);
  return {title:names[spec.field]+'本金构成与差额',source:labels.join(' / '),
    summary:labels[0]+' 合计 '+show(units[0])+' 亿元，'+labels[1]+' 合计 '+show(units[1])+' 亿元。'+
      (ties.length?'按本金差额绝对值最大：'+ties.map(r=>r.name+'（前者减后者 '+show(r.difference)+' 亿元）').join('、')+'。':''),
    note:'按'+names[spec.field]+'逐组核对，差额按第一范围减第二范围，按差额绝对值降序。占比以各范围全部在账本金为分母。',
    columns:[category('name',names[spec.field]),number('first',labels[0]+'本金','亿元'),number('firstShare',labels[0]+'占比','%'),
      number('last',labels[1]+'本金','亿元'),number('lastShare',labels[1]+'占比','%'),number('difference','第一范围减第二范围','亿元')],
    rows:(spec.limit?entries.slice(0,spec.limit):entries).map(({name,a,b,difference})=>({
      name,first:yi(a),firstShare:units[0]?100*a/units[0]:null,last:yi(b),lastShare:units[1]?100*b/units[1]:null,difference:yi(difference)}))};
}
function compareBalances(spec,left,right,labels,results) {
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
  if(spec.analysisMode==='commonOnly'){
    const numerator=exact(first+last),denominator=exact(results[0].totalCents+results[1].totalCents);
    return {title:'共同持仓按成员的本金及占比',summary:common+' 共同成员两边本金合计 '+show(numerator)+
      ' 亿元，两边全部本金合计 '+show(denominator)+' 亿元，'+(denominator?'占 '+(100*numerator/denominator).toFixed(6)+'%。':'分母为零，占比不适用。'),
      note:'仅列两边均有持仓的具名成员。分子是共同成员在两边的本金之和，分母是两份所选范围各自全额本金之和。',
      columns:[...columns,number('combined','两边本金合计','亿元')],rows:same.map(r=>({...r,combined:yi(exact(left.get(r.name).cents+right.get(r.name).cents))}))};
  }
  if(spec.analysisMode==='newOnly')return {title:'本期新增持仓',summary:labels[1]+' 相对 '+labels[0]+' 新增 '+added.length+' 个'+names[spec.field]+
    '，期末本金合计 '+show(addedCents)+' 亿元。新增成员在期初没有持仓；以期初为分母的增幅不适用。',
    note:'只列在期初完整范围没有任何持仓行、期末有持仓行的成员。增幅的分母为零，列示本金绝对变化。',
    columns:[...columns,category('growth','相对期初增幅')],rows:added.map(r=>({...r,growth:'不适用（期初为零）'}))};
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
  const combined=exact(addedCents-exitedCents+change);
  const observed=exact(results[1].totalCents-results[0].totalCents);
  return {title:'两份库存的成员与本金对照',
    summary:common+' 两边合并去重 '+(same.length+added.length+exited.length)+' 个；仅前一范围 '+exited.length+
      ' 个（本金 '+show(exitedCents)+' 亿元），仅后一范围 '+added.length+' 个（本金 '+show(addedCents)+' 亿元）。',
    note:'按'+names[spec.field]+'对齐，同一范围同一成员的本金按原行加总。名单仅计已具名成员。仅单边有持仓的成员在另一完整范围列零。'+
      '仅前一范围对总差额贡献 '+show(-exitedCents)+' 亿元、仅后一范围贡献 '+show(addedCents)+' 亿元、共同成员贡献 '+show(change)+' 亿元。'+
      '三组贡献合计 '+show(combined)+' 亿元，全范围本金变动 '+show(observed)+' 亿元。'+
      (observed===combined?'两者一致。':'未填写成员另有 '+show(observed-combined)+' 亿元的变动。'),
    columns,rows:[...same,...exited,...added]};
}
export function buildMemberReport(spec,results) {
  const groups=results.map(r=>namedGroups(r,spec.analysisMode==='groupDifferences')),labels=results.map(scope);
  let report;
  if(spec.analysisMode==='rankOverlap')report=rankOverlap(spec,groups[0]);
  else if(spec.analysisMode==='leaderShares')report=leaderShares(spec,groups,labels,results);
  else if(spec.analysisMode==='groupDifferences')report=groupDifferences(spec,groups,labels,results);
  else if(['rankChanges','trackedLeaders'].includes(spec.analysisMode))report=rankAcrossDates(spec,...groups,labels);
  else report=compareBalances(spec,...groups,labels,results);
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

