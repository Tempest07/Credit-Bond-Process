import { InventoryError } from './inventory-workbook.mjs';
import { listTradeLedgers,loadTradeLedgers,runTradeQuery,exportTradeQuery,ingestTradeLedger } from './trade-store.mjs';
import { planFlowQuestion } from './flow-planner.mjs';

// An immutable turn pins its data versions. Replacing a cumulative file cannot
// change a historical result or silently change the scope of a follow-up.
const schema=[
  'CREATE TABLE IF NOT EXISTS flow_turns (owner TEXT NOT NULL, chat TEXT NOT NULL, version INTEGER NOT NULL, requestId TEXT NOT NULL, resultId TEXT NOT NULL UNIQUE, title TEXT NOT NULL, question TEXT NOT NULL, effort TEXT NOT NULL, updatedAt TEXT NOT NULL, versionIds TEXT NOT NULL, answer TEXT NOT NULL, PRIMARY KEY(owner,chat,version), UNIQUE(owner,chat,requestId))',
  'CREATE INDEX IF NOT EXISTS flow_turn_recent ON flow_turns(owner,updatedAt DESC,chat DESC)',
];
const ready=new WeakSet();
const uuid=id=>typeof id==='string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
const missing=()=>new InventoryError('找不到这段交易问答。',404);
const conflict=()=>new InventoryError('这段对话已更新，请重新打开后继续。',409,{code:'chat_conflict'});
const source=({id,filename,year,direction,sheet,start,end,asOf,reportDate,declaredEnd,outOfPeriodRows,outOfPeriodCents,rowCount,totalCents})=>({id,filename,year,direction,sheet,start,end,asOf,reportDate,declaredEnd,outOfPeriodRows,outOfPeriodCents,rowCount,totalCents});
const info=({chat:id,title,updatedAt,version})=>({id,title,updatedAt,version});
const reply=row=>({chat:info(row),answer:JSON.parse(row.answer)});
const pick='chat,version,title,updatedAt,question,answer,versionIds,effort';
async function init(db){
  if(ready.has(db))return;
  await db.batch(schema.map(sql=>db.prepare(sql)));ready.add(db);
}
async function ask(resources,input,planner){
  const {db,owner,apiKey}=resources;
  const {chatId:chat,requestId,version,effort='high'}=input, question=typeof input.question==='string'?input.question.trim():'';
  if(!uuid(chat)||!uuid(requestId)||!Number.isSafeInteger(version)||version<0||!question||question.length>3200
    ||!['none','low','medium','high','xhigh','max'].includes(effort))throw new InventoryError('交易问答参数无效。');
  const replay=async()=>{
    const old=await db.prepare('SELECT '+pick+' FROM flow_turns WHERE owner=? AND chat=? AND requestId=?').bind(owner,chat,requestId).first();
    if(!old)return;
    if(old.version!==version+1 || old.question!==question || old.effort!==effort)throw conflict();
    return reply(old);
  };
  const old=await replay();if(old)return old;
  const last=await db.prepare('SELECT '+pick+' FROM flow_turns WHERE owner=? AND chat=? ORDER BY version DESC LIMIT 1').bind(owner,chat).first();
  if((last?.version||0)!==version)throw conflict();
  const ledgers=last?await loadTradeLedgers(db,JSON.parse(last.versionIds)):await listTradeLedgers(db);
  if(!ledgers.length)throw new InventoryError('请先上传增持或减持累计台账。',409);
  const ids=ledgers.map(l=>l.id);
  const prior=(await db.prepare('SELECT question,answer FROM flow_turns WHERE owner=? AND chat=? ORDER BY version DESC LIMIT 8').bind(owner,chat).all()).results.reverse().map(row=>({question:row.question,answer:JSON.parse(row.answer)}));
  let prev=prior.filter(turn=>turn.answer.result).at(-1)?.answer;
  if(last && !prev){
    const row=await db.prepare("SELECT answer FROM flow_turns WHERE owner=? AND chat=? AND json_type(answer,'$.result')='object' ORDER BY version DESC LIMIT 1").bind(owner,chat).first();
    if(row)prev=JSON.parse(row.answer);
  }
  const runQuery=plan=>runTradeQuery(resources,plan,ids);
  const outcome=await planner({question,effort,apiKey,ledgers,previousPlan:prev?.plan,previousGroups:prev?.result.groups||[],previousGroupCount:prev?.result.groupCount,
    conversation:prior.map(({question,answer})=>({question,plan:answer.plan,clarification:answer.clarification})),runQuery});
  const answer={id:crypto.randomUUID()};
  if(outcome.clarification)answer.clarification=outcome.clarification;
  else{
    const hit=await runQuery(outcome.plan);
    answer.plan=hit.plan??outcome.plan;
    answer.result={groups:hit.groups.slice(0,100),groupCount:hit.groupCount,totals:hit.totals,warnings:hit.warnings||[]};
    answer.sources=hit.versions.map(source);
  }
  if(outcome.trace?.length)answer.trace=outcome.trace;
  const title=last?.title||Array.from(question.replace(/\s+/g,' ')).slice(0,55).join('');
  const updatedAt=new Date().toISOString(),next=version+1;
  // Two tabs racing for the same next version cannot both commit, even if
  // a model request finished after another tab already advanced the chat.
  const inserted=await db.prepare('INSERT OR IGNORE INTO flow_turns(owner,chat,version,requestId,resultId,title,question,effort,updatedAt,versionIds,answer) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .bind(owner,chat,next,requestId,answer.id,title,question,effort,updatedAt,JSON.stringify(ids),JSON.stringify(answer)).run();
  if(!inserted.meta.changes){const duplicate=await replay();if(duplicate)return duplicate;throw conflict();}
  return {chat:{id:chat,title,updatedAt,version:next},answer};
}
export async function flowAction(resources,action,{input,params,upload,planner=planFlowQuestion}={}){
  const {db,owner}=resources;
  if(!owner)throw new InventoryError('请登录后查看交易问答。',401);
  if(action==='flow-status')return {configured:Boolean(resources.apiKey),ledgers:(await listTradeLedgers(db)).map(source)};
  if(action==='flow-upload'){
    const {ledger,duplicate}=await ingestTradeLedger(resources,upload.bytes,upload.filename);
    return {ledger:source(ledger),unchanged:!!duplicate};
  }
  await init(db);
  if(action==='flow-ask')return ask(resources,input,planner);
  if(action==='flow-chats'){
    const cursor=params.get('cursor')||'';
    if(cursor && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[\da-f-]{36}$/i.test(cursor))throw new InventoryError('分页参数无效。');
    const before=cursor?' AND (updatedAt,chat)<(?,?)':'';
    const {results}=await db.prepare('SELECT t.chat,t.title,t.updatedAt,t.version FROM flow_turns t WHERE owner=? AND NOT EXISTS(SELECT 1 FROM flow_turns b WHERE b.owner=t.owner AND b.chat=t.chat AND b.version>t.version)'+before+' ORDER BY updatedAt DESC,chat DESC LIMIT 51').bind(owner,...(cursor?cursor.split('|'):[])).all();
    const chats=results.slice(0,50).map(info);return {chats,nextCursor:results.length>50?chats.at(-1).updatedAt+'|'+chats.at(-1).id:null};
  }
  const id=params.get('id');if(!uuid(id))throw missing();
  if(action==='flow-chat'){
    const last=await db.prepare('SELECT chat,title,updatedAt,version FROM flow_turns WHERE owner=? AND chat=? ORDER BY version DESC LIMIT 1').bind(owner,id).first();
    if(!last)throw missing();
    const turns=[];while(turns.length<last.version){
      const {results}=await db.prepare('SELECT question,answer FROM flow_turns WHERE owner=? AND chat=? AND version>? AND version<=? ORDER BY version LIMIT 40').bind(owner,id,turns.length,last.version).all();
      if(!results.length)throw missing();for(const row of results)turns.push({question:row.question,answer:JSON.parse(row.answer)});
    }
    return {chat:info(last),turns};
  }
  if(action==='flow-export'){
    const row=await db.prepare('SELECT versionIds,answer FROM flow_turns WHERE owner=? AND resultId=?').bind(owner,id).first();
    const result=row&&JSON.parse(row.answer);if(!result?.plan)throw missing();
    return exportTradeQuery(resources,result.plan,JSON.parse(row.versionIds));
  }
  throw missing();
}
