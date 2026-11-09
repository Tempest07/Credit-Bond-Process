import {InventoryError} from './inventory-workbook.mjs';
import {listInventory,initInventory} from './inventory-store.mjs';
import {listTradeLedgers,loadTradeLedgers} from './trade-store.mjs';
import {initChats,readChat} from './inventory-chats.mjs';
import {flowAction,readTurnHistory} from './flow-dialog.mjs';
import {planJointQuestion} from './joint-planner.mjs';
import {executeJointPlan} from './joint-execute.mjs';
import {jointExcel} from './joint-export.mjs';

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
    return jointExcel(resources,row.question,JSON.parse(row.answer),JSON.parse(row.pins).ledgers,params.get('step'));
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
  const recentDate=history.map(t=>t.answer?.steps?.filter(s=>s.source==='inventory').at(-1)?.data?.snapshot?.date||t.answer?.referenceDate).filter(Boolean).at(-1);
  const selected=snapshots.find(s=>s.id===snapshotId);
  if(snapshotId&&!selected)fail('该快照不在本对话锁定的版本中，请新建对话查询修订后的台账。',409);
  const selectedDate=selected?.date||recentDate||snapshots.find(s=>s.id===pins.selectedId)?.date||snapshots[0]?.date;
  const args={question,effort,snapshots,ledgers,selectedDate};
  const plan=await planner({...args,apiKey,history:history.map(t=>({question:t.question,steps:(t.answer?.steps||[]).map(s=>({id:s.id,source:s.source,question:s.question,groupBy:s.data?.plan?.groupBy||s.data?.dimensions||s.data?.plan?.group,snapshotDate:s.data?.snapshot?.date||s.snapshotDate,start:s.data?.plan?.start||s.start,end:s.data?.plan?.end||s.end})),clarification:t.answer?.clarification}))});
  const result=plan.clarification?{clarification:plan.clarification,steps:[]}:await execute(resources,{...args,history,steps:plan.steps,comparison:plan.comparison});
  const answer={...result,referenceDate:selectedDate||null,id:crypto.randomUUID(),steps:(result.steps||[]).map(s=>({...s,data:s.source==='inventory'?compact(s.data):s.data}))};
  const next=version+1,title=last?.title||Array.from(question).slice(0,55).join(''),updatedAt=new Date().toISOString();
  const [saved]=await db.batch([
    db.prepare('INSERT OR IGNORE INTO joint_turns(owner,chat,version,requestId,digest,resultId,title,question,updatedAt,pins,answer) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(owner,chatId,next,requestId,digest,answer.id,title,question,updatedAt,last?null:JSON.stringify(pins),JSON.stringify(answer)),
    ...[...new Set(answer.steps.flatMap(inventoryIds))].map(id=>db.prepare('INSERT OR IGNORE INTO inventory_chat_results(result,owner,chat) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM joint_turns WHERE owner=? AND resultId=?)')
      .bind(id,owner,chatId,owner,answer.id)),
  ]);
  if(!saved.meta.changes){const match=await previousCall();return match?retry(match):conflict();}
  return {chat:{id:chatId,title,version:next,updatedAt},answer};
}
