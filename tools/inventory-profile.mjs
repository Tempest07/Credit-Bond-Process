import {accountLabel} from './inventory-account.mjs';
import {exportData,newInventoryAnswer} from './inventory-store.mjs';
import {InventoryError} from './inventory-workbook.mjs';

const groupFields={issuer:'发行人',branch:'联动分行',account:'会计科目',portfolio:'交易组合',code:'债券代码',sourceMarketType:'原表债券类型'};
const dateFields={legal:'法定到期日',expected:'ABS预计到期日',maturity:'台账到期日'};
const textFields={issuer:'发行人全称',name:'债券简称',code:'债券代码'};
const num=(key,label,unit)=>({key,label,unit,kind:'number'});
const cat=(key,label)=>({key,label,kind:'category'});
const yuan=cents=>cents/1e10;
const show=value=>value.toLocaleString('zh-CN',{maximumFractionDigits:8});
const safeText=(x,map)=>typeof x==='string'&&Object.hasOwn(map,x);
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().startsWith(s);
export function validateProfile(p,check){
  check(p&&typeof p==='object','请指定分组或日期核对方式。');
  if(p.type==='textMatch'){
    check(safeText(p.field,textFields)&&['prefix','equals'].includes(p.compare)&&
      typeof p.text==='string'&&p.text.trim().length>0&&p.text.length<=256,'请指定原表文本列和要精确比较的内容。');
    check(['list','count','accountShare'].includes(p.stat),'请选择券表、去重券数或科目本金占比。');
    if(p.stat==='accountShare')check(typeof p.account==='string'&&p.account.trim().length>0&&p.account.length<=100,'请指定占比分子的会计科目。');
  }else if(p.type==='groups'){
    check(safeText(p.by,groupFields)&&['counts','concentration','threshold','breakdown','ranking','withinRanking'].includes(p.stat),'请选择已知的分组与统计口径。');
    if(['ranking','withinRanking'].includes(p.stat)){
      check(Number.isInteger(p.limit)&&p.limit>=1&&p.limit<=100,'请选择 1 至 100 的排名上限。');
      if(p.stat==='withinRanking')check(safeText(p.within,groupFields)&&p.by!==p.within,'请选择不同的组别和组内排名维度。');
      if(p.membersContain!=null)check(typeof p.membersContain==='string'&&p.membersContain.trim().length>0&&p.membersContain.length<=200,'请指定要匹配的名称片段。');
      if(p.rankGap!=null)check(p.stat==='ranking'&&Array.isArray(p.rankGap)&&p.rankGap.length===2&&
        p.rankGap.every(i=>Number.isInteger(i)&&i>=1&&i<=p.limit)&&p.rankGap[0]!==p.rankGap[1],'请指定榜单内两个不同名次。');
    }
    if(p.stat==='counts' && p.order!=null)check(['codesAsc','codesDesc','extraDesc'].includes(p.order),'请选择券数升序、券数降序或重复行数降序。');
    if(p.stat==='breakdown')check(safeText(p.within,groupFields)&&p.within!==p.by&&
      (p.limit==null||Number.isInteger(p.limit)&&p.limit>=1&&p.limit<=100),'请选择第二级分组和有效的一级排名数量。');
    if(p.stat==='concentration')check(safeText(p.within,groupFields)&&p.within!==p.by&&Number.isInteger(p.minMembers)&&p.minMembers>=1,'请指定子分组和有效成员数量。');
    if(p.stat==='threshold')check(Number.isFinite(p.thresholdYuan)&&p.thresholdYuan>=0&&Number.isSafeInteger(Math.round(p.thresholdYuan*100))&&['gt','gte'].includes(p.compare),'请指定明确的人民币本金门槛和是否含边界。');
  }else{
    check(p.type==='dates'&&safeText(p.field,dateFields)&&['inRange','differentYears'].includes(p.stat),'请选择台账日期字段及比较方式。');
    if(p.stat==='inRange'){
      check(iso(p.start)&&iso(p.end)&&p.start<=p.end,'请给出有效的起止日期。');
      check(p.rankIssuers==null||Number.isInteger(p.rankIssuers)&&p.rankIssuers>=1&&p.rankIssuers<=100,'发行人排名须为 1 至 100。');
    }
    else check(safeText(p.other,dateFields)&&p.other!==p.field,'请选择两个不同的到期日期字段。');
  }
  return p;
}
function fieldValue(r,f){
  if(f==='account')return accountLabel(r.account||'');
  return r[f==='sourceMarketType'?'marketType':f]||'';
}
function buckets(rows,field){
  const groups=new Map();
  for(const r of rows){
    const name=fieldValue(r,field);
    if(!groups.has(name))groups.set(name,{cents:0,records:[],codes:new Set()});
    const g=groups.get(name);g.cents+=r.cents;g.records.push(r);if(r.code)g.codes.add(r.code);
  }
  return groups;
}
function rankNames(groups,limit,contains) {
  const ordered=[...groups].filter(([name])=>name.trim()&&(!contains||name.includes(contains))).sort((a,b)=>
    b[1].cents-a[1].cents || a[0].localeCompare(b[0],'zh-CN'));
  let lastAmount,rank=0;
  const rows=[];
  for(const [i,[name,g]] of ordered.entries()){
    if(lastAmount!==g.cents)rank=i+1;
    if(rank>limit)break;
    rows.push({rank,name,principal:yuan(g.cents)});
    lastAmount=g.cents;
  }
  return rows;
}
function rankingReport(p,grouped) {
  const child=groupFields[p.within], parent=groupFields[p.by];
  const nested=p.stat==='withinRanking', entity=nested?child:parent;
  const columns=[...(nested?[cat('group',parent)]:[]),num('rank','名次',''),cat('name',entity),num('principal','在账本金','亿元')];
  let rows,summary,missing=0;
  if(nested){
    rows=[];
    const groups=[...grouped].sort(([a],[b])=>a&&b?a.localeCompare(b,'zh-CN'):a?-1:b?1:0);
    for(const [group,g] of groups){
      const members=buckets(g.records,p.within);
      missing+=members.get('')?.cents||0;
      for(const r of rankNames(members,p.limit,p.membersContain))rows.push({group:group||'未填写',...r});
    }
    summary='从本次筛选的全部持仓出发，在 '+groups.length+' 个'+parent+'分组内分别列出本金前 '+p.limit+' 名具名'+entity+'。';
    if(grouped.has(''))summary+='未填写'+parent+'单列为一组。';
  }else{
    rows=rankNames(grouped,p.limit,p.membersContain);
    missing=grouped.get('')?.cents||0;
    summary=rows.length?'具名'+entity+'本金前 '+p.limit+' 名中，第一名为'+rows.filter(r=>r.rank===1)
      .map(r=>r.name).join('、')+'，本金 '+show(rows[0].principal)+' 亿元。':'当前范围没有具名'+entity+'。';
    const tied=rows.filter(r=>r.rank===p.limit);
    if(tied.length>1)summary+='第 '+p.limit+' 名并列：'+tied.map(r=>r.name).join('、')+'，各 '+show(tied[0].principal)+' 亿元。行数有限时可将并列名称合写一行。';
    if(p.rankGap){
      const peers=p.rankGap.map(i=>rows.filter(r=>r.rank===i));
      if(peers.every(group=>group.length)){
        const values=peers.map(group=>grouped.get(group[0].name).cents);
        const gap=Math.abs(values[0]-values[1]), gapText=gap>0&&gap<100?show(gap/100)+' 元':show(yuan(gap))+' 亿元';
        summary+=peers.map((group,i)=>'第 '+p.rankGap[i]+' 名'+group.map(r=>r.name).join('、')+' '+show(yuan(values[i]))+' 亿元').join('，')+
          '，差额为 '+gapText+'。';
      }else summary+='所选名次有空缺，无法计算两名的差额。';
    }
  }
  const note='先按原表持仓行汇总人民币名义本金，再按金额降序排列；并列使用同一名次，保留边界并列项。'+
    (p.membersContain?'仅纳入'+entity+'名称包含“'+p.membersContain+'”的具名成员。':'未填写'+entity+'本金 '+show(yuan(missing))+' 亿元，单列在排名之外。');
  return {title:nested?'各'+parent+'的'+entity+'排名':'具名'+entity+'本金排名',summary,note,columns,rows};
}
function groupReport(p,records){
  const grouped=buckets(records,p.by), title=groupFields[p.by];
  if(['ranking','withinRanking'].includes(p.stat))return rankingReport(p,grouped);
  let rows=[],columns=[cat('name',title)],summary,note='';
  if(p.stat==='counts'){
    columns.push(num('principal','在账本金','亿元'),num('count','持仓行数','条'),num('codes','不同券数','只'),num('extra','行数减不同券数','条'));
    for(const [name,g] of grouped)rows.push({name:name||'未填写',principal:yuan(g.cents),count:g.records.length,codes:g.codes.size,extra:g.records.length-g.codes.size});
    const byCount=p.order==='codesAsc'||p.order==='codesDesc';
    rows.sort((a,b)=>(byCount?(p.order==='codesAsc'?a.codes-b.codes:b.codes-a.codes):b.extra-a.extra)||a.name.localeCompare(b.name,'zh-CN'));
    const max=rows[0]?.extra;
    summary=!rows.length?'本范围无持仓行。':byCount?'共 '+rows.length+' 个'+title+'分组，按不同券数'+(p.order==='codesAsc'?'从少到多':'从多到少')+'排列。':
      '行数减去不同券数的最大差额为 '+max+' 条，对应'+rows.filter(x=>x.extra===max).map(x=>x.name).join('、')+'。';
    note='同券多条持仓分别计行，券数按有效券码去重。缺少券码的行有 '+records.filter(r=>!r.code).length+' 条。';
  }else if(p.stat==='breakdown'){
    const childLabel=groupFields[p.within],ordered=[...grouped].filter(([name])=>!p.limit||name).sort((a,b)=>b[1].cents-a[1].cents||a[0].localeCompare(b[0],'zh-CN'));
    const parents=p.limit?ordered.slice(0,p.limit):ordered,descriptions=[];
    columns=[cat('name',title),cat('child',childLabel),num('principal','在账本金','亿元'),num('count','持仓行数','条'),num('codes','不同券数','只')];
    for(const [name,g] of parents){
      const children=buckets(g.records,p.within);
      const sorted=[...children].sort((a,b)=>b[1].cents-a[1].cents||a[0].localeCompare(b[0],'zh-CN'));
      for(const [child,item] of sorted)rows.push({name:name||'未填写',child:child||'未填写',principal:yuan(item.cents),count:item.records.length,codes:item.codes.size});
      const top=sorted.find(([child])=>child);
      if(parents.length<=15)descriptions.push((name||'未填写')+'：'+(top?'首位 '+sorted.filter(([child,x])=>child&&x.cents===top[1].cents).map(([child])=>child).join('、')+'各 '+show(yuan(top[1].cents))+' 亿元，':'')+'未填写'+childLabel+' '+show(yuan(children.get('')?.cents||0))+' 亿元');
    }
    summary='按本金'+(p.limit?'选取前 '+p.limit+' 个具名'+title:'汇总 '+parents.length+' 个'+title+'分组')+'，再按'+childLabel+'拆分。'+descriptions.join('；');
    note='同一持仓行按原表归入一个分组。未填写的次级字段保留。';
  }else if(p.stat==='threshold'){
    const boundary=Math.round(p.thresholdYuan*100);
    columns.push(num('principal','在账本金','亿元'),num('count','持仓行数','条'),num('codes','不同券数','只'));
    let total=0;
    for(const [name,g] of grouped){
      if(!name||(p.compare==='gt'?g.cents<=boundary:g.cents<boundary))continue;
      total+=g.cents;rows.push({name,principal:yuan(g.cents),count:g.records.length,codes:g.codes.size});
    }
    rows.sort((a,b)=>b.principal-a.principal||a.name.localeCompare(b.name,'zh-CN'));
    summary='按'+title+'合并本金后，'+(p.compare==='gt'?'超过':'达到或超过')+show(p.thresholdYuan)+'元的具名'+title+'有 '+rows.length+' 个，合计 '+show(yuan(total))+' 亿元。';
  }else{
    const child=groupFields[p.within];
    columns.push(cat('leader','首位'+child),num('members','不同'+child+'数','个'),num('part','首位本金','亿元'),num('total','组内总本金','亿元'),num('share','首位占比','%'));
    for(const [name,g] of grouped){
      if(!name)continue;
      const subs=[...buckets(g.records,p.within)].filter(([key])=>key);
      if(subs.length<p.minMembers||g.cents<=0)continue;
      const top=Math.max(...subs.map(([,v])=>v.cents));
      const leaders=subs.filter(([,v])=>v.cents===top).map(([key])=>key).sort();
      rows.push({name,leader:leaders.join('、'),members:subs.length,part:yuan(top),total:yuan(g.cents),share:100*top/g.cents});
    }
    rows.sort((a,b)=>b.share-a.share||a.name.localeCompare(b.name,'zh-CN'));
    summary=rows.length?'首位'+child+'占比最高的是'+rows.filter(x=>x.share===rows[0].share).map(x=>x.name).join('、')+'，占 '+show(rows[0].share)+'%。':'无满足条件的分组。';
    note='仅比较至少有 '+p.minMembers+' 个具名'+child+'的具名'+title+'。各组分母包含该组未填写'+child+'的金额。首位并列时展示所有并列名称。';
  }
  return {title:'按'+title+'核对持仓',summary,note,columns,rows};
}
function dateReport(p,records){
  const byCode=new Map(),missingCodes=new Set(),matchedIssuers=new Map();
  let unknown=0,unknownCents=0,matched=0,total=0;
  const otherField=p.stat==='differentYears'?p.other:p.field==='expected'?'legal':null;
  for(const r of records){
    const a=r[p.field],b=otherField?r[otherField]:null;
    if(!a||(p.stat==='differentYears'&&!b)){unknown++;unknownCents+=r.cents;if(r.code)missingCodes.add(r.code);continue;}
    if(p.stat==='differentYears'?a.slice(0,4)===b.slice(0,4):a<p.start||a>p.end)continue;
    matched++;total+=r.cents;
    if(r.issuer)matchedIssuers.set(r.issuer,(matchedIssuers.get(r.issuer)||0)+r.cents);
    const k=JSON.stringify([r.code,a,b]);
    const g=byCode.get(k)||{code:r.code,name:r.name,date:a,...(b?{other:b}:{}),cents:0};
    g.cents+=r.cents;byCode.set(k,g);
  }
  const rows=[...byCode.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code)).map(({cents,...g})=>({...g,principal:yuan(cents)}));
  const columns=[cat('code','债券代码'),cat('name','债券简称'),{key:'date',label:dateFields[p.field],kind:'date'}];
  if(otherField)columns.push({key:'other',label:dateFields[otherField],kind:'date'});
  columns.push(num('principal','在账本金','亿元'));
  const matchedCodes=new Set(rows.map(r=>r.code)).size;
  const scope=p.stat==='differentYears'?dateFields[p.field]+'与'+dateFields[p.other]+'跨年':dateFields[p.field]+'在 '+p.start+' 至 '+p.end;
  const note='缺少所查日期的持仓 '+unknown+' 条、'+missingCodes.size+' 只，本金 '+show(yuan(unknownCents))+' 亿元，单列待核。';
  if(p.rankIssuers){
    const all=buckets(records,'issuer');
    const ranked=[...matchedIssuers].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN')).slice(0,p.rankIssuers);
    return {title:'到期本金的发行人排名',summary:scope+'的具名发行人共 '+matchedIssuers.size+' 家，实际可列 '+ranked.length+' 家。',note,
      columns:[cat('issuer','发行人'),num('due','到期本金','亿元'),num('total','全部在账本金','亿元'),num('share','占本发行人本金','%')],
      rows:ranked.map(([issuer,cents])=>({issuer,due:yuan(cents),total:yuan(all.get(issuer).cents),share:all.get(issuer).cents>0?100*cents/all.get(issuer).cents:null}))};
  }
  return {title:'到期日期核对',summary:scope+'的已填记录有 '+matched+' 条、'+matchedCodes+' 只，合计 '+show(yuan(total))+' 亿元。'+(rows.length?'最早日期为 '+rows[0].date+'。':'没有已核实的匹配券。'),
    note,columns,rows};
}

function textMatchReport(p,records,snapshot){
  const matched=records.filter(r=>typeof r[p.field]==='string'&&
    (p.compare==='equals'?r[p.field]===p.text:r[p.field].startsWith(p.text)));
  const groups=buckets(matched,'code'), codes=[...groups.keys()].filter(Boolean);
  const total=matched.reduce((sum,r)=>sum+r.cents,0);
  const condition=snapshot.date+' '+textFields[p.field]+(p.compare==='equals'?'严格等于':'以此开头：')+'“'+p.text+'”';
  const summary=condition+'，匹配 '+codes.length+' 只不同券码、'+matched.length+' 条原表持仓。';
  if(p.stat==='accountShare'){
    const account=accountLabel(p.account);
    const part=matched.filter(r=>accountLabel(r.account||'')===account).reduce((sum,r)=>sum+r.cents,0);
    const share=total===0?null:100*part/total;
    return {title:'会计科目本金占比',summary:summary+account+' 本金 '+show(yuan(part))+' 亿元，匹配范围全部本金 '+show(yuan(total))+
      ' 亿元，'+(share===null?'分母为零，比例无法计算。':'占 '+show(share)+'%。'),note:'分子与分母使用同一批精确匹配持仓。',
      columns:[cat('account','分子科目'),num('part','分子本金','亿元'),num('total','分母本金','亿元'),num('share','占比','%')],
      rows:[{account,part:yuan(part),total:yuan(total),share}]};
  }
  const rows=codes.sort().map(code=>{
    const g=groups.get(code);
    return {code,name:[...new Set(g.records.map(r=>r.name))].join('、'),count:g.records.length,
      principal:yuan(g.cents),sourceRows:g.records.map(r=>r.sourceRow).join('、')};
  });
  return {title:p.stat==='count'?'精确匹配券数':'原表匹配券清单',summary,
    columns:[cat('code','债券代码'),cat('name','债券简称'),num('count','原持仓行数','条'),num('principal','在账本金','亿元'),cat('sourceRows','原表行号')],
    rows,note:rows.length?'券码按原表保留前导零和市场后缀；同券各持仓保留原表行号。':'没有符合此条件的原表持仓。'};
}
export function buildProfile(p,records,snapshot){
  const report=p.type==='textMatch'?textMatchReport(p,records,snapshot):p.type==='dates'?dateReport(p,records):groupReport(p,records);
  return {...report,source:snapshot.date+' 余额台账 · '+snapshot.filename};
}
export async function inventoryProfile({db,bucket},step,ctx){
  const snapshot=ctx.snapshots.find(s=>s.date===step.snapshotDate);
  if(!snapshot)throw new InventoryError('所选业务日缺少余额台账。',422);
  const p=step.profile,filters={...step.filters};
  let sourceRows;
  if(p.type==='textMatch'){
    if(!safeText(p.field,textFields))throw new InventoryError('请选择已知的原表文本列。',422);
    // Restrict the saved answer itself so row details, following turns and Excel
    // use the same literal match. Explicit text comparisons do not resolve aliases.
    delete filters[p.field];
    if(p.stat==='accountShare')delete filters.account;
    const comparison=p.compare==='equals'?p.field+' = ?':'substr('+p.field+',1,length(?)) = ?';
    const args=p.compare==='equals'?[p.text]:[p.text,p.text];
    const hit=await db.prepare('SELECT sourceRow FROM inventory_rows WHERE version=? AND '+comparison)
      .bind(snapshot.id,...args).all();
    sourceRows=hit.results.map(r=>r.sourceRow);
  }
  const data=await newInventoryAnswer(db,snapshot,{date:snapshot.date,metric:'principal',group:'none',filters},bucket,[],undefined,sourceRows);
  if(!data.resultId)return data;
  const {rows}=await exportData(db,data.resultId);
  const full=buildProfile(step.profile,rows,snapshot);
  // Allow large count lists in the matrix while bounding the persisted D1
  // answer payload for unusually large ledgers with very long group labels.
  let cap=150;
  if(p.stat==='counts' && ['codesAsc','codesDesc'].includes(p.order)){
    const encoder=new TextEncoder();let bytes=0;cap=0;
    for(const row of full.rows){bytes+=encoder.encode(JSON.stringify(row)).length+1;if(bytes>500000)break;cap++;}
  }
  const ledgerReport=full.rows.length>cap?{...full,rows:full.rows.slice(0,cap),note:full.note+' 页面列出前 '+cap+' 项，共 '+full.rows.length+' 项，完整结果可下载。'}:full;
  const rankedMembers=step.profile.stat==='ranking'?{field:step.profile.by,names:full.rows.map(r=>r.name)}:null;
  return {...data,profileSpec:step.profile,ledgerReport,...(rankedMembers?{rankedMembers}:{})};
}

