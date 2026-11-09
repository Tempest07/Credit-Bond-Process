import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {jointAction} from '../tools/joint-dialog.mjs';
import {checkChatResult} from '../tools/inventory-chats.mjs';

test('a joint conversation pins both source catalogs, replays a request once and scopes stored results to its owner',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 function stmt(sql,args=[]){return {bind:(...a)=>stmt(sql,a),run:()=>({meta:sqlite.prepare(sql).run(...args)}),first:()=>sqlite.prepare(sql).get(...args),all:()=>({results:sqlite.prepare(sql).all(...args)})};}
 const db={prepare:stmt,batch:async list=>{sqlite.exec('BEGIN');try{const r=list.map(s=>s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const r={owner:'owner',db,bucket:{}},oldId=crypto.randomUUID(),newId=crypto.randomUUID(),tradeId=crypto.randomUUID(),resultId=crypto.randomUUID();
 await jointAction(r,'joint-status');
 for(const id of [oldId,newId])sqlite.prepare("INSERT INTO inventory_versions VALUES (?,'2026-10-30','a.xlsx','持仓',1,100,'abc','2026-11-01')").run(id);
 sqlite.prepare("INSERT INTO inventory_current VALUES('2026-10-30',?)").run(oldId);
 sqlite.prepare("INSERT INTO trade_ledger_versions VALUES(?,?)").run(tradeId,JSON.stringify({id:tradeId,year:2026,direction:'buy',headers:['名义本金'],blocks:[]}));
 sqlite.prepare("INSERT INTO trade_ledger_current VALUES(2026,'buy',?)").run(tradeId);
 const input={chatId:crypto.randomUUID(),requestId:crypto.randomUUID(),version:0,question:'广州分行持仓多少？'};
 let count=0;
 const planner=async({snapshots,ledgers})=>{count++;assert.deepEqual(snapshots.map(s=>s.id),[oldId]);assert.deepEqual(ledgers.map(s=>s.id),[tradeId]);return {steps:[{id:'s1',source:'inventory',question:input.question,snapshotDate:'2026-10-30'}]};};
 const execute=async(_,ctx)=>({steps:[{...ctx.steps[0],data:{snapshot:ctx.snapshots[0],resultId,totalCents:100}}]});
 const first=await jointAction(r,'joint-ask',{input,planner,execute});assert.equal(first.chat.version,1);
 assert.deepEqual(await jointAction(r,'joint-ask',{input,planner,execute}),first);assert.equal(count,1);
 assert.ok(first.answer.id);await checkChatResult(db,r.owner,resultId,input.chatId);
 sqlite.prepare("UPDATE inventory_current SET version=?").run(newId);sqlite.prepare("DELETE FROM trade_ledger_current").run();
 const next=await jointAction(r,'joint-ask',{input:{...input,requestId:crypto.randomUUID(),question:'同一期间呢？',version:1},planner,execute});assert.equal(next.chat.version,2);
 const params=new URLSearchParams({id:input.chatId});assert.equal((await jointAction(r,'joint-chat',{params})).turns.length,2);
 await assert.rejects(jointAction({...r,owner:'other'},'joint-chat',{params}),{status:404});
 await assert.rejects(jointAction({...r,owner:'other'},'joint-export',{params:new URLSearchParams({id:first.answer.id})}),{status:404});
 await assert.rejects(jointAction(r,'joint-ask',{input:{...input,question:'不同问题'},planner,execute}),{status:409});
 assert.equal((await jointAction(r,'joint-chats',{params:new URLSearchParams()})).chats.length,1);
});
