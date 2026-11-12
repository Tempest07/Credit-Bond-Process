import {deriveAnswer} from './joint-arithmetic.mjs';
import {InventoryError} from './inventory-workbook.mjs';
import {listInventory,initInventory} from './inventory-store.mjs';
import {listTradeLedgers,loadTradeLedgers} from './trade-store.mjs';
import {initChats,readChat} from './inventory-chats.mjs';
import {flowAction,readTurnHistory} from './flow-dialog.mjs';
import {planJointQuestion} from './joint-planner.mjs';
import {executeJointPlan} from './joint-execute.mjs';
import {jointExcel} from './joint-export.mjs';
import {getPortfolioMarketPins} from './portfolio-facts.mjs';
import {durationCoverageReport,ratingDenominatorReport} from './portfolio-metrics.mjs';

const uuid=v=>typeof v==='string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
const fail=(message,status=400,details={})=>{throw new InventoryError(message,status,details)};
const notFound=()=>fail('找不到该对话或结果。',404);
const conflict=()=>fail('这段对话已更新，请重新打开后继续。',409,{code:'chat_conflict'});
const initialized=new WeakSet();
async function init(db,owner){
  if(initialized.has(db))return;
  await initInventory(db);await initChats(db,owner);
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS joint_turns(owner TEXT NOT NULL,chat TEXT NOT NULL,version INTEGER NOT NULL,requestId TEXT NOT NULL,digest TEXT NOT NULL,resultId TEXT NOT NULL UNIQUE,title TEXT NOT NULL,question TEXT NOT NULL,updatedAt TEXT NOT NULL,pins TEXT,answer TEXT NOT NULL,PRIMARY KEY(owner,chat,version),UNIQUE(owner,chat,requestId))'),
    db.prepare('CREATE INDEX IF NOT EXISTS joint_recent ON joint_turns(owner,updatedAt DESC,chat DESC)'),
  ]);initialized.add(db);
}
async function snapshotsById(db,ids){
  const rows=[];
  for(let i=0;i<ids.length;i+=80){
    const batch=ids.slice(i,i+80);
    const hit=await db.prepare('SELECT id,date,filename,sheet,rowCount,totalCents,createdAt FROM inventory_versions WHERE id IN ('+batch.map(()=>'?').join(',')+')').bind(...batch).all();
    rows.push(...hit.results);
  }
  if(rows.length!==ids.length)fail('这段对话引用的库存版本不完整。',409);
  return rows.sort((a,b)=>b.date.localeCompare(a.date));
}
const info=({chat:id,title,version,updatedAt})=>({id,title,version,updatedAt});
const replay=row=>({chat:info(row),answer:JSON.parse(row.answer)});
const compact=data=>{
  if(data?.overview)return {...data,overview:data.overview.map(item=>({...item,result:compact(item.result)}))};
  return data?.groups?.length>100?{...data,groupCount:data.groupCount??data.groups.length,groups:data.groups.slice(0,100),groupsTruncated:true}:data;
};
function legacyStep(source,q,data){
  return {question:q,answer:{steps:[{id:'s1',source,question:q,snapshotDate:data.snapshot?.date||null,start:data.plan?.start||null,end:data.plan?.end||null,data}]}};
}
async function originSeed(resources,origin){
  if(!origin)return {turns:[]};
  const {db,owner}=resources;
  if(!uuid(origin.id)||!['trade','inventory'].includes(origin.source))notFound();
  if(origin.source==='trade'){
    const data=await flowAction(resources,'flow-chat',{params:new URLSearchParams({id:origin.id})});
    const row=await db.prepare('SELECT versionIds FROM flow_turns WHERE owner=? AND chat=? AND version=1').bind(owner,origin.id).first();
    if(!row)notFound();
    return {ledgers:await loadTradeLedgers(db,JSON.parse(row.versionIds)),turns:data.turns.slice(-6).map(t=>legacyStep('trade',t.question,t.answer))};
  }
  const legacy=await readChat(db,owner,origin.id);
  return {snapshot:legacy.snapshot,turns:legacy.turns.slice(-6).map(t=>legacyStep('inventory',t.label,t.data))};
}
const publicLedger=({id,year,direction,filename,rowCount,start,end,asOf,totalCents})=>({id,year,direction,filename,rowCount,start,end,asOf,totalCents});
const inventoryIds=step=>step.source!=='inventory'?[]:[step.data,...(step.data?.overview||[]).map(x=>x.result)].map(t=>t?.resultId).filter(uuid);
function describeMissingBranches(question,data){
  if(!/(?:未填|没填|空白|缺失|为空|没有填|空分行)/u.test(question)||!data?.dimensions?.includes('branch')||
    data.dimensions.length!==2||!Array.isArray(data.groups)||!data.groups.length||data.groupsTruncated)return;
  if(data.groups.some(g=>!Number.isSafeInteger(g.cents)||!Array.isArray(g.labels))||
    data.groups.reduce((sum,g)=>sum+g.count,0)!==data.rowCount)return;
  const branch=data.dimensions.indexOf('branch'),amounts=new Map();
  for(const g of data.groups){
    const name=g.labels[1-branch]||'未填写',label=(g.labels[branch]||'').trim();
    amounts.set(name,(amounts.get(name)||0)+(!label||['未填写','（未填）'].includes(label)?g.cents:0));
  }
  if(amounts.size<=15)data.summary=(data.summary||'')+'。未填写联动分行的本金分别为'+[...amounts].map(([name,cents])=>
    name+' '+(cents/1e10).toLocaleString('zh-CN',{maximumFractionDigits:8})+' 亿元').join('、')+'。';
}
function operatingRow(steps,note){
  const data=steps.filter(s=>s.source==='trade').map(s=>s.data);
  if(!data.length)return;
  let buy=null,sell=null,source;
  const seen=new Set();
  for(const d of data){
    if(d.flowMatrixSpec?.series?.length===1)continue;
    if(!d.plan||!d.result?.totals)continue;
    const p=d.plan;seen.add(JSON.stringify([p.start,p.end,p.filters||[]]));
    if(d.result.completeCoverage!==true)continue;
    if(p.direction!=='sell')buy=d.result.totals.buyCents/1e10;
    if(p.direction!=='buy')sell=d.result.totals.sellCents/1e10;
    source=[p.start+' 至 '+p.end,...(d.sources||[]).map(s=>s.filename)].join(' · ');
  }
  if(seen.size!==1||buy===null&&sell===null)return;
  return {title:'期间经营数据',source,summary:'按已报交易本金核实买入、卖出和净买入。实际投资收益率待核。',
    note,columns:[{key:'buy',label:'买入本金',unit:'亿元',kind:'number'},{key:'sell',label:'卖出本金',unit:'亿元',kind:'number'},
      {key:'net',label:'净买入',unit:'亿元',kind:'number'},{key:'returns',label:'实际投资收益率',kind:'category'}],
    rows:[{buy,sell,net:buy===null||sell===null?null:buy-sell,returns:'待核：需期初期末估值、交易价款、付息还本现金流及费用'}]};
}

export async function jointAction(resources,action,{input,params,planner=planJointQuestion,execute=executeJointPlan}={}){
  const {db,owner,apiKey}=resources;if(!owner)fail('请先登录。',401);
  await init(db,owner);
  if(action==='joint-status'){
    const [snapshots,ledgers]=await Promise.all([listInventory(db),listTradeLedgers(db)]);
    return {configured:!!apiKey,snapshots,ledgers:ledgers.map(publicLedger)};
  }
  if(['joint-chats','joint-chat'].includes(action))return readTurnHistory(db,owner,'joint_turns',action.slice(6),params);
  if(action==='joint-export'){
    const id=params.get('id');if(!uuid(id))notFound();
    const row=await db.prepare('SELECT t.question,t.answer,f.pins FROM joint_turns t JOIN joint_turns f ON f.owner=t.owner AND f.chat=t.chat AND f.version=1 WHERE t.owner=? AND t.resultId=?').bind(owner,id).first();
    if(!row)notFound();
    const answer=JSON.parse(row.answer),pins=JSON.parse(row.pins),chosen=params.get('step');
    const usesPortfolio=answer.steps.some(s=>s.source==='portfolio'&&(!chosen||s.id===chosen));
    const snapshots=usesPortfolio?await snapshotsById(db,pins.snapshots):[];
    return jointExcel(resources,row.question,answer,pins.ledgers,chosen,{snapshots,marketPins:pins.marketPins||{}});
  }
  if(action!=='joint-ask')notFound();
  const {chatId,version,requestId,effort='high',snapshotId=null,originChat=null}=input;
  const question=typeof input.question==='string'?input.question.trim():'';
  if(!uuid(chatId)||!uuid(requestId)||!Number.isSafeInteger(version)||version<0||!question||question.length>1200||
    !['none','low','medium','high','xhigh','max'].includes(effort)||(snapshotId && !uuid(snapshotId))||
    (originChat && (version!==0||!uuid(originChat.id)||!['inventory','trade'].includes(originChat.source))))fail('问答参数无效。');
  const digest=JSON.stringify([version,question,effort,snapshotId,originChat?.source,originChat?.id]);
  const previousCall=()=>db.prepare('SELECT chat,title,version,updatedAt,answer,digest FROM joint_turns WHERE owner=? AND chat=? AND requestId=?').bind(owner,chatId,requestId).first();
  const retry=row=>row.digest===digest?replay(row):conflict();
  const previous=await previousCall();if(previous)return retry(previous);
  const last=await db.prepare('SELECT version,title FROM joint_turns WHERE owner=? AND chat=? ORDER BY version DESC LIMIT 1').bind(owner,chatId).first();
  if((last?.version||0)!==version)conflict();
  let pins,snapshots,ledgers;
  if(last){
    pins=JSON.parse((await db.prepare('SELECT pins FROM joint_turns WHERE owner=? AND chat=? AND version=1').bind(owner,chatId).first()).pins);
    [snapshots,ledgers]=await Promise.all([snapshotsById(db,pins.snapshots),loadTradeLedgers(db,pins.ledgers)]);
  }else{
    const seed=await originSeed(resources,originChat);
    [snapshots,ledgers]=await Promise.all([listInventory(db),seed.ledgers??listTradeLedgers(db)]);
    if(seed.snapshot)snapshots=[seed.snapshot,...snapshots.filter(s=>s.date!==seed.snapshot.date)].sort((a,b)=>b.date.localeCompare(a.date));
    pins={snapshots:snapshots.map(s=>s.id),ledgers:ledgers.map(l=>l.id),origin:originChat,
      seed:seed.turns.map(t=>({question:t.question,answer:{steps:t.answer.steps.map(s=>({...s,data:compact(s.data)}))}})),selectedId:snapshotId||seed.snapshot?.id||snapshots[0]?.id};
  }
  if(!snapshots.length&&!ledgers.length)fail('请先上传余额台账或增减持台账。',409);
  const prior=(await db.prepare('SELECT question,answer FROM joint_turns WHERE owner=? AND chat=? ORDER BY version DESC LIMIT 8').bind(owner,chatId).all()).results.reverse().map(r=>({question:r.question,answer:JSON.parse(r.answer)}));
  const history=[...(pins.seed||[]),...prior].slice(-8);
  const recentDate=history.map(t=>t.answer?.steps?.map(s=>s.data?.snapshot?.date||s.spec?.end).filter(d=>snapshots.some(s=>s.date===d)).at(-1)||t.answer?.referenceDate).filter(Boolean).at(-1);
  const selected=snapshots.find(s=>s.id===snapshotId);
  if(snapshotId&&!selected)fail('该快照不在本对话锁定的版本中，请新建对话查询修订后的台账。',409);
  const selectedDate=selected?.date||recentDate||snapshots.find(s=>s.id===pins.selectedId)?.date||snapshots[0]?.date;
  const args={question,effort,snapshots,ledgers,selectedDate};
  const plannerHistory=history.map(t=>({
    question:t.question,
    memberSets:t.answer?.memberSets?.dimension?{field:t.answer.memberSets.dimension,labels:t.answer.memberSets.labels}:undefined,
    steps:(t.answer?.steps||[]).map(s=>{
      const plan=s.data?.plan,trade=s.source==='trade'&&s.data?.result;
      const availableTradeTotals=trade?.completeCoverage===true?['buyCents','sellCents','netCents','rows']
        .filter(k=>Number.isFinite(trade.totals[k])&&(plan.direction==='both'||k==='rows'||k===plan.direction+'Cents')):[];
      return {id:s.id,source:s.source,question:s.question,availableTradeTotals,
        ...(s.data?.flowMatrixSpec?{matrix:s.data.flowMatrixSpec}:{}),
        ...(s.data?.profileSpec?{profileSpec:s.data.profileSpec,filters:plan?.filters}:{}),
        settlementRange:trade?plan?.filters?.find(f=>f.field==='交易交割日'&&f.op==='between')?.value:undefined,
        groupBy:s.data?.securityMembers?.length?['code']:plan?.groupBy||s.data?.dimensions||plan?.group,
        snapshotDate:s.data?.snapshot?.date||s.snapshotDate,start:plan?.start||s.start,end:plan?.end||s.end,
        ...(s.spec?{spec:s.spec}:{})};
    }),
    clarification:t.answer?.clarification,
  }));
  const plan=await planner({...args,apiKey,history:plannerHistory});
  let pinMarket=false;
  async function runPlan(planned){
    if(planned.clarification)return {clarification:planned.clarification,steps:[]};
    if(planned.previousSteps){
      const prior=history.at(-1).answer.steps;
      return {steps:planned.previousSteps.map((index,i)=>({...prior[index],id:'s'+(i+1)}))};
    }
    if(!pins.marketPins && planned.steps?.some(s=>s.source==='portfolio'&&s.spec?.metric!=='weeklyMean')){
      pins.marketPins=await getPortfolioMarketPins(resources,snapshots);
      pinMarket=true;
    }
    return execute(resources,{...args,history,marketPins:pins.marketPins||{},steps:planned.steps,comparison:planned.comparison});
  }
  let result=await runPlan(plan);
  const durationReport=durationCoverageReport(result.steps||[],question)||ratingDenominatorReport(result.steps||[],question);
  if(durationReport)result.ledgerReport=durationReport;
  const memberReportComplete=plan.steps?.length===1 && plan.steps[0].operation==='memberAnalysis' &&
    ['newOnly','commonOnly','leaderShares'].includes(plan.steps[0].analysisMode) && result.ledgerReport;
  const signedComposition=result.steps?.length===1 && result.steps[0].data?.plan?.describeNetComposition &&
    result.steps[0].data?.result?.highlights?.length && !/逐(?:项|家|行)(?:计算|列出|给出).{0,8}(?:占比|比例)/u.test(question);
  if(plan.derive && result.steps?.length && !durationReport && !memberReportComplete && !signedComposition &&
      result.ledgerReport?.kind!=='selectedScopeShare'){
    try{
      const calculate=(steps,reused)=>deriveAnswer({question,steps,apiKey,effort,history:reused?
        [{question:history.at(-1).question,answer:{arithmetic:history.at(-1).answer.arithmetic}}]:history});
      result.arithmetic=await calculate(result.steps,plan.previousSteps);
      if(result.arithmetic.missing && !result.steps.some(s=>s.data?.notes?.some(n=>n.includes('没有锁定已核验')))){
        const next=await planner({...args,apiKey,history:plannerHistory,userQuestion:question,
          question:(question+'\n计算器核对后还缺以下中间结果，请重新规划可完整执行的查询，保持原题条件与分母：'+result.arithmetic.missing).slice(0,1200)});
        if(next.steps?.length||next.previousSteps?.length){
          const revised=await runPlan(next);
          const arithmetic=await calculate(revised.steps,next.previousSteps);
          if(arithmetic.rows.length && (!arithmetic.missing||arithmetic.rows.length>result.arithmetic.rows.length))result={...revised,arithmetic};
        }
      }
    }catch{result.arithmetic??={rows:[],missing:'派生指标暂未算出，可保留本轮已查到的数据重试。'};}
  }
  if(plan.basisNotes?.includes('investmentReturn')){
    result.methodNotes=['净买入按买卖名义本金计算，余额变化按两期在账名义本金相减，单凭这两个数不能确定投资收益。核算期间投资收益还需要期初、期末估值或公允价值，逐笔买卖价款、应计利息、付息与还本现金流及相关费用；发生划转时也要核对划转记录。'];
    if(/一行|同一表|依次|一张表/u.test(question)){
      const report=operatingRow(result.steps||[],result.methodNotes[0]);
      if(report)result.ledgerReport=report;
      else if(result.ledgerReport?.rows?.length===1){
        result.ledgerReport={...result.ledgerReport,columns:[...result.ledgerReport.columns,{key:'returns',label:'实际投资收益率',kind:'category'}],
          rows:result.ledgerReport.rows.map(r=>({...r,returns:'待核：需期初期末估值、交易价款、付息还本现金流及费用'}))};
      }
    }
  }
  if(plan.basisNotes?.includes('flowVsBalance')){
    result.methodNotes=['交易对库存的净流入或净流出按期间买入本金减卖出本金计算。实际在账余额的变动需另用期初、期末两期余额台账核对，期间还可能有兑付或划转。'];
  }
  if(plan.basisNotes?.includes('endpointTrend'))(result.methodNotes??=[]).push('按题目限定的两个余额时点，只能核实两端余额和净变化。开始下降的月份或期间走势需要逐月实际快照，不能从两端插值确定。');
  for(const s of result.steps||[])if(s.source==='inventory')describeMissingBranches(question,s.data);
  const answer={...result,referenceDate:selectedDate||null,id:crypto.randomUUID(),steps:(result.steps||[]).map(s=>({...s,data:s.source==='inventory'?compact(s.data):s.data}))};
  const next=version+1,title=last?.title||Array.from(question).slice(0,55).join(''),updatedAt=new Date().toISOString();
  const [saved]=await db.batch([
    db.prepare('INSERT OR IGNORE INTO joint_turns(owner,chat,version,requestId,digest,resultId,title,question,updatedAt,pins,answer) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(owner,chatId,next,requestId,digest,answer.id,title,question,updatedAt,last?null:JSON.stringify(pins),JSON.stringify(answer)),
    ...(last&&pinMarket?[db.prepare('UPDATE joint_turns SET pins=? WHERE owner=? AND chat=? AND version=1 AND EXISTS(SELECT 1 FROM joint_turns WHERE owner=? AND resultId=?)').bind(JSON.stringify(pins),owner,chatId,owner,answer.id)]:[]),
    ...[...new Set(answer.steps.flatMap(inventoryIds))].map(id=>db.prepare('INSERT OR IGNORE INTO inventory_chat_results(result,owner,chat) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM joint_turns WHERE owner=? AND resultId=?)')
      .bind(id,owner,chatId,owner,answer.id)),
  ]);
  if(!saved.meta.changes){const match=await previousCall();return match?retry(match):conflict();}
  return {chat:{id:chatId,title,version:next,updatedAt},answer};
}
