import {InventoryError} from './inventory-workbook.mjs';
import {readInventoryAnswer} from './inventory-store.mjs';

const schema = [
  'CREATE TABLE IF NOT EXISTS inventory_chats(owner TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,snapshotId TEXT NOT NULL,updatedAt TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(owner,id))',
  'CREATE INDEX IF NOT EXISTS inventory_chat_list ON inventory_chats(owner,updatedAt DESC,id DESC)',
  'CREATE TABLE IF NOT EXISTS inventory_chat_turns(owner TEXT NOT NULL,chat TEXT NOT NULL,version INTEGER NOT NULL,request TEXT NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,chat,version),UNIQUE(owner,chat,request))',
  'CREATE TABLE IF NOT EXISTS inventory_chat_results(result TEXT NOT NULL,owner TEXT NOT NULL,chat TEXT NOT NULL,PRIMARY KEY(result,owner,chat))',
  'CREATE TABLE IF NOT EXISTS inventory_chat_writes(owner TEXT NOT NULL,chat TEXT NOT NULL,token TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,chat))',
];
const columns = 'id,title,snapshotId,updatedAt,version';
const initialized = new WeakSet();
const uuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const missing = () => new InventoryError('找不到这段对话或查询结果。',404);
const conflict = () => new InventoryError('对话已更新，请重新打开后继续。',409,{code:'chat_conflict'});
function checkOwner(owner) {
  if (typeof owner !== 'string' || !owner) throw new InventoryError('请登录后查看保存的对话。',401);
}
export async function initChats(db,owner) {
  checkOwner(owner);
  if(initialized.has(db))return;
  await db.batch(schema.map(sql=>db.prepare(sql)));
  initialized.add(db);
}
function chatInfo(db,owner,id) {
  return db.prepare('SELECT '+columns+' FROM inventory_chats WHERE owner=? AND id=?').bind(owner,id).first();
}
async function snapshotInfo(db,id) {
  return db.prepare('SELECT id,date,filename,sheet,rowCount,totalCents,createdAt FROM inventory_versions WHERE id=?').bind(id).first();
}
export async function listChats(db,owner,cursor) {
  let date='',id='';
  if(cursor) {
    [date,id]=cursor.split('|');
    if(!uuid(id)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date)||cursor!==date+'|'+id)
      throw new InventoryError('历史对话分页参数无效。');
  }
  const before=cursor?' AND (updatedAt,id)<(?,?)':'';
  const args=cursor?[owner,date,id]:[owner];
  const {results}=await db.prepare('SELECT '+columns+' FROM inventory_chats WHERE owner=?'+before+' ORDER BY updatedAt DESC,id DESC LIMIT 51').bind(...args).all();
  const chats=results.slice(0,50), last=chats.at(-1);
  return {chats,nextCursor:results.length>50 ? last.updatedAt+'|'+last.id : null};
}
export async function readChat(db,owner,id) {
  if(!uuid(id))throw missing();
  const chat=await chatInfo(db,owner,id);
  if(!chat)throw missing();
  const turns=[];
  // A bound version gives every page the same view even as another tab appends.
  while(turns.length<chat.version) {
    const page=await db.prepare('SELECT version,request,body FROM inventory_chat_turns WHERE owner=? AND chat=? AND version>? AND version<=? ORDER BY version LIMIT 60')
      .bind(owner,id,turns.length,chat.version).all();
    if(!page.results.length)throw Error('incomplete conversation');
    for(const row of page.results)turns.push({...JSON.parse(row.body),version:row.version,requestId:row.request});
  }
  return {...chat,snapshot:await snapshotInfo(db,chat.snapshotId),turns};
}
export async function checkChatResult(db,owner,id,chatId) {
  if(!uuid(id)||!uuid(chatId))throw missing();
  const found=await db.prepare('SELECT 1 AS ok FROM inventory_chat_results WHERE result=? AND owner=? AND chat=?').bind(id,owner,chatId).first();
  if(!found)throw missing();
}
// Existing stateless answer IDs remain valid. Saved conversations' links also
// check the owner on the older detail/export endpoints.
export async function checkResultOwner(db,owner,id) {
  if(!uuid(id))throw missing();
  const other=await db.prepare('SELECT 1 AS ok FROM inventory_chat_results WHERE result=? AND owner<>? LIMIT 1').bind(id,owner).first();
  if(other)throw missing();
}
function preview(data) {
  if(data.overview)return {...data,overview:data.overview.map(item=>({...item,result:preview(item.result)}))};
  if(data.groups?.length>16)return {...data,groupCount:data.groups.length,groupsTruncated:true,groups:data.groups.slice(0,16)};
  return data;
}
async function fullReply(db,data) {
  if(data.overview)return {...data,overview:await Promise.all(data.overview.map(async item=>({...item,result:await fullReply(db,item.result)})))};
  if(!data.groupsTruncated)return data;
  return {...await readInventoryAnswer(db,data.resultId),...(data.trace?{trace:data.trace}:{})};
}
function resultIds(data) {
  return data.overview?data.overview.flatMap(item=>resultIds(item.result)):(data.resultId?[data.resultId]:[]);
}
async function fingerprint(input,action) {
  // Include only defined API fields; key ordering in a JSON object is irrelevant.
  function canonical(value) {
    if(Array.isArray(value))return value.map(canonical);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    return value;
  }
  const data=JSON.stringify([action,canonical(input)]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function appendChatTurn({db,owner},input,action,execute) {
  const {chatId:id,version,requestId,label}=input;
  if(!uuid(id)||!uuid(requestId)||!Number.isSafeInteger(version)||version<0||typeof label!=='string'||!label.trim()||label.length>3200)
    throw new InventoryError('对话编号、版本或问句无效。');
  const digest=await fingerprint(input,action);
  async function replay() {
    const saved=await db.prepare('SELECT version,digest,body FROM inventory_chat_turns WHERE owner=? AND chat=? AND request=?').bind(owner,id,requestId).first();
    if(!saved)return null;
    const info=await chatInfo(db,owner,id);
    if(saved.digest!==digest||info.version!==saved.version)throw conflict();
    return {...await fullReply(db,JSON.parse(saved.body).data),chat:info};
  }
  const previous=await replay();
  if(previous)return previous;
  const token=crypto.randomUUID(),now=Date.now();
  // Lease before calling the model. Expiry covers a terminated Worker, while
  // the token prevents a slow prior execution from committing after takeover.
  const lease=await db.prepare('INSERT INTO inventory_chat_writes(owner,chat,token,expires) SELECT ?,?,?,? WHERE ?=coalesce((SELECT version FROM inventory_chats WHERE owner=? AND id=?),0) ON CONFLICT(owner,chat) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE inventory_chat_writes.expires<?')
    .bind(owner,id,token,now+180000,version,owner,id,now).run();
  if(!lease.meta.changes) {
    const done=await replay();
    if(done)return done;
    const info=await chatInfo(db,owner,id);
    if((info?.version||0)!==version)throw conflict();
    throw new InventoryError('这段对话正在保存另一条答复，请稍后重试。',409,{code:'chat_busy'});
  }
  const release=db.prepare('DELETE FROM inventory_chat_writes WHERE owner=? AND chat=? AND token=?').bind(owner,id,token);
  try {
    const chat=await chatInfo(db,owner,id);
    const pinned=chat?await snapshotInfo(db,chat.snapshotId):null;
    if(chat && (!pinned||input.snapshotId && input.snapshotId!==chat.snapshotId))throw conflict();
    if(input.previousResultId)await checkChatResult(db,owner,input.previousResultId,id);
    let data;
    if(action==='select'){
      const last=await db.prepare('SELECT body FROM inventory_chat_turns WHERE owner=? AND chat=? AND version=?').bind(owner,id,version).first();
      const parent=last && JSON.parse(last.body).data;
      if(!parent?.overview?.some(item=>item.result.resultId===input.previousResultId && input.previousResultId))throw conflict();
      data=await readInventoryAnswer(db,input.previousResultId);
      if(parent.trace?.length)
        data.trace=[...new Set([...parent.trace,...(data.trace||[])])];
    } else {
      data=await execute(pinned);
    }
    const snapshotId=data.snapshot?.id||data.resume?.snapshotId||data.overview?.find(item=>item.result.snapshot)?.result.snapshot.id||pinned?.id||input.snapshotId||
      (await db.prepare('SELECT version FROM inventory_current ORDER BY date DESC LIMIT 1').first())?.version;
    if(!snapshotId||!await snapshotInfo(db,snapshotId))throw new InventoryError('请先选择库存快照。',409);
    const saved={label,action,data:preview(data),...(input.previousResultId?{previousResultId:input.previousResultId}:{}),
      ...(input.identityValue?{identityValue:input.identityValue}:{})};
    const title=chat?.title||Array.from(label.trim().replace(/\s+/g,' ')).slice(0,55).join('');
    const updatedAt=new Date().toISOString(),next=version+1;
    const valid='EXISTS(SELECT 1 FROM inventory_chat_writes WHERE owner=? AND chat=? AND token=?)';
    const lock=[owner,id,token];
    const save=await db.batch([
      db.prepare('INSERT INTO inventory_chats(owner,id,title,snapshotId,updatedAt,version) SELECT ?,?,?,?,?,? WHERE '+valid+' ON CONFLICT(owner,id) DO UPDATE SET snapshotId=excluded.snapshotId,updatedAt=excluded.updatedAt,version=excluded.version WHERE inventory_chats.version=?')
        .bind(owner,id,title,snapshotId,updatedAt,next,...lock,version),
      db.prepare('INSERT INTO inventory_chat_turns(owner,chat,version,request,digest,body) SELECT ?,?,?,?,?,? WHERE '+valid)
        .bind(owner,id,next,requestId,digest,JSON.stringify(saved),...lock),
      ...resultIds(data).map(result=>db.prepare('INSERT OR IGNORE INTO inventory_chat_results(result,owner,chat) SELECT ?,?,? WHERE '+valid).bind(result,owner,id,...lock)),
      release,
    ]);
    if(!save[1].meta.changes)throw conflict();
    return {...data,chat:{id,title,snapshotId,updatedAt,version:next}};
  } catch(error) {
    await release.run();
    throw error;
  }
}
