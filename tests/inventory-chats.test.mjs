import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initInventory} from '../tools/inventory-store.mjs';
import {inventoryHttp} from '../tools/inventory-http.mjs';
import {appendChatTurn,initChats} from '../tools/inventory-chats.mjs';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  function stmt(sql,args=[]) {
    const run=()=>({meta:sqlite.prepare(sql).run(...args)});
    const all=()=>({results:sqlite.prepare(sql).all(...args)});
    return {bind:(...values)=>stmt(sql,values),run,all,first:()=>all().results[0],exec:()=>/^SELECT/i.test(sql)?all():run()};
  }
  const db={prepare:stmt,async batch(statements){
    sqlite.exec('BEGIN');
    try{const out=statements.map(s=>s.exec());sqlite.exec('COMMIT');return out;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  const call=async(owner,action,body)=>{
    const req=new Request('https://test/'+action,body?{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://test'},body:JSON.stringify(body)}:{});
    const reply=await inventoryHttp(req,action.split('?')[0],async()=>({db,owner}),['https://test']);
    return {status:reply.status,data:await reply.json()};
  };
  return {db,sqlite,call};
}
async function seed(f) {
  await initInventory(f.db);
  for(const version of ['old','new']){
    f.sqlite.prepare('INSERT INTO inventory_versions VALUES(?,?,?,?,?,?,?,?)').run(version,'2026-10-29',version+'.xlsx','底稿',23,2300,'hash','now');
    for(let n=0;n<23;n++) f.sqlite.prepare('INSERT INTO inventory_rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(version,n,version==='new'?200:100,'机构','广州分行','组合','分类','表内','发行人'+n,'C'+n,'简称'+n,'中票','2030-01-01','','');
  }
  f.sqlite.prepare('INSERT INTO inventory_current VALUES(?,?)').run('2026-10-29','old');
}
const owner='u1';
const message=(extra={})=>({chatId:crypto.randomUUID(),version:0,requestId:crypto.randomUUID(),label:'广州分行有哪些发行人？',
  snapshotId:'old',group:'issuer',filters:{branch:'广州分行'},...extra});
test('cloud history persists a bounded preview, keeps result downloads and dates, and rejects other accounts',async()=>{
  const f=fixture();await seed(f);
  const input=message();
  const first=await f.call(owner,'manual',input);
  assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.groups.length,23);
  const result=first.data.resultId,id=input.chatId;
  const replay=await f.call(owner,'manual',input);
  assert.deepEqual(replay,first);
  assert.equal((await f.call(owner,'manual',{...input,label:'不同的问句'})).status,409);
  f.sqlite.exec("UPDATE inventory_current SET version='new'");
  const saved=(await f.call(owner,'chat?id='+id)).data;
  assert.equal(saved.version,1);assert.equal(saved.snapshot.filename,'old.xlsx');assert.equal(saved.turns.length,1);
  assert.equal(saved.turns[0].data.groups.length,16);assert.equal(saved.turns[0].data.groupCount,23);
  const complete=(await f.call(owner,'answer?id='+result+'&chatId='+id)).data;
  assert.equal(complete.groups.length,23);assert.equal(complete.totalCents,2300);
  const next=await f.call(owner,'manual',message({chatId:id,version:1,label:'同一份，逐券',group:'code'}));
  assert.equal(next.status,200);assert.equal(next.data.snapshot.id,'old');assert.equal(next.data.totalCents,2300);
  assert.equal((await f.call(owner,'chats')).data.chats[0].id,id);
  assert.equal((await f.call('u2','chats')).data.chats.length,0);
  assert.equal((await f.call('u2','chat?id='+id)).status,404);
  for(const endpoint of ['detail?id='+result,'export?id='+result,'answer?id='+result+'&chatId='+id]){
    const denied=await f.call('u2',endpoint);assert.equal(denied.status,404,endpoint);
  }
  assert.equal((await f.call('u2','ask',{question:'继续',previousResultId:result})).status,404);
  const foreignRef=await f.call('u2','ask',message({previousResultId:result}));
  assert.equal(foreignRef.status,404);
  assert.equal((await f.call(owner,'manual',input)).status,409);
});
test('concurrent writes reserve the version before computing and release on failure',async()=>{
  const f=fixture();await seed(f);await initChats(f.db,owner);
  const input=message(),access={db:f.db,owner};
  await assert.rejects(appendChatTurn(access,input,'ask',()=>{throw Error('network');}),/network/);
  let start,end;
  const entered=new Promise(resolve=>{start=resolve;});
  const gate=new Promise(resolve=>{end=resolve;});
  const running=appendChatTurn(access,input,'ask',async()=>{start();await gate;return {clarification:'请确认。'};});
  await entered;
  const forbidden=()=>assert.fail('duplicate computation');
  for(const request of [input,{...input,requestId:crypto.randomUUID()}])
    await assert.rejects(appendChatTurn(access,request,'ask',forbidden),error=>error.details?.code==='chat_busy');
  end();const saved=await running;
  assert.equal(saved.chat.version,1);
  assert.deepEqual(JSON.parse(JSON.stringify(await appendChatTurn(access,input,'ask',forbidden))),saved);
  await assert.rejects(appendChatTurn(access,{...input,requestId:crypto.randomUUID()},'ask',forbidden),error=>error.details?.code==='chat_conflict');
});
test('choosing an overview result becomes its own persisted exchange with the verified parent trace',async()=>{
  const f=fixture();await seed(f);await initChats(f.db,owner);
  const answer=(await f.call(owner,'manual',{snapshotId:'old',group:'branch'})).data;
  const input=message(), access={db:f.db,owner};
  await appendChatTurn(access,input,'ask',async()=>({clarification:'两种口径',trace:['核过发行人'],
    overview:[{title:'自发债',result:answer},{title:'增信',result:{clarification:'没有确定的增信方'}}]}));
  const request=message({chatId:input.chatId,version:1,previousResultId:answer.resultId,label:'自发债'});
  const reply=await f.call(owner,'select',request);
  assert.equal(reply.status,200,JSON.stringify(reply.data));
  assert.deepEqual(reply.data.trace,['核过发行人']);assert.equal(reply.data.resultId,answer.resultId);
  const chat=(await f.call(owner,'chat?id='+input.chatId)).data;
  assert.equal(chat.turns[1].action,'select');assert.equal(chat.turns[1].previousResultId,answer.resultId);
  assert.equal((await f.call(owner,'select',{...request,requestId:crypto.randomUUID(),version:2})).status,409);
});
