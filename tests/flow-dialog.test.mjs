import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {flowAction} from '../tools/flow-dialog.mjs';
test('transactions pin revisions across follow-ups, check export ownership and replay once',async()=>{
 const store=new DatabaseSync(':memory:'),r2=new Map();
 function prepare(sql,args=[]){
   const run=()=>({meta:store.prepare(sql).run(...args)});
   return {bind:(...a)=>prepare(sql,a),first:async()=>store.prepare(sql).get(...args),all:async()=>({results:store.prepare(sql).all(...args)}),run};
 }
 const db={prepare,batch:async s=>{store.exec('BEGIN');try{const r=s.map(x=>x.run());store.exec('COMMIT');return r;}catch(e){store.exec('ROLLBACK');throw e;}}};
 const res={db,bucket:{put:async(k,v)=>r2.set(k,v),get:async k=>r2.has(k)?new Response(r2.get(k)):null,delete:async k=>r2.delete(k)},owner:'alice'};
 const upload=async(amount)=>{
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('明细');
  s.addRow(['交易日期','交易交割日','名义本金','债券代码','发行人全称','债券简称','合同号','买入收益率','数据业务日期']);
  s.addRow(['2025-01-13','2025-01-13',amount,'100.IB','甲公司','甲债','A','0.02','2025-02-01']);
  return flowAction(res,'flow-upload',{upload:{bytes:await w.xlsx.writeBuffer(),filename:'信用债增持台账报表2501-2501.xlsx'}});
 };
 await upload(100);
 const plan={direction:'buy',groupBy:['发行人全称'],metric:'buy',order:'desc',filters:[],start:'2025-01-01',end:'2025-01-31'};
 const chatId=crypto.randomUUID(),input={chatId,version:0,requestId:crypto.randomUUID(),question:'一月买入多少？'};
 let calls=0;const planner=async args=>{calls++;if(args.previousPlan){assert.equal(args.previousGroups[0].buyCents,10000);assert.equal(args.previousGroupCount,1);}return {plan};};
 const first=await flowAction(res,'flow-ask',{input,planner});
 assert.equal(first.answer.result.totals.buyCents,10000);
 assert.deepEqual(await flowAction(res,'flow-ask',{input,planner}),first);assert.equal(calls,1);
 await upload(300);
 assert.equal((await flowAction(res,'flow-ask',{input:{...input,version:1,question:'还是这个期间？',requestId:crypto.randomUUID()},planner})).answer.result.totals.buyCents,10000);
 const second=await flowAction(res,'flow-ask',{input:{...input,chatId:crypto.randomUUID()},planner});assert.equal(second.answer.result.totals.buyCents,30000);
 const params=new URLSearchParams({id:first.answer.id});
 const w=new ExcelJS.Workbook();await w.xlsx.load(await flowAction(res,'flow-export',{params}));assert.equal(w.getWorksheet('交易明细').rowCount,2);
 await assert.rejects(flowAction({...res,owner:'bob'},'flow-export',{params}),{status:404});
 const chatParams=new URLSearchParams({id:chatId});
 assert.equal((await flowAction(res,'flow-chat',{params:chatParams})).turns.length,2);
 await assert.rejects(flowAction({...res,owner:'bob'},'flow-chat',{params:chatParams}),{status:404});
 await assert.rejects(flowAction(res,'flow-ask',{input:{...input,version:0,requestId:crypto.randomUUID()},planner}),{status:409});
 assert.equal((await flowAction(res,'flow-chats',{params:new URLSearchParams()})).chats.length,2);
});
