import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {ingestTradeLedger,runTradeQuery,listTradeLedgers,loadTradeLedgers,exportTradeQuery} from '../tools/trade-store.mjs';
import {parseTradeWorkbook} from '../tools/trade-workbook.mjs';
function isolated(){
 const sql=new DatabaseSync(':memory:');const data=new Map();
 function query(text,args=[]){const q=()=>sql.prepare(text);return {bind:(...values)=>query(text,values),all:async()=>({results:q().all(...args)}),first:async()=>q().get(...args),run:async()=>({meta:q().run(...args)})};}
 return {db:{prepare:query,async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const q of stmts)out.push(await q.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}},
 bucket:{async put(k,v){data.set(k,v);},async get(k){return data.has(k)?new Response(data.get(k)):null;},async delete(k){data.delete(k);}}};
}
const buy='信用债增持台账报表2401-2412.xlsx',sell='信用债减持台账报表2401-2412.xlsx';
async function sample(side,extra=0,end='2024-12-31'){
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('流水');
 s.addRow(['交易日期','交易交割日','合同号','发行人全称','债券代码','债券简称','名义本金',side==='sell'?'卖出收益率':'买入收益率','数据业务日期','联动分行','会计分类',...(side==='buy'?['交易市场(一级/二级)']:[])]);
 if(side==='sell'){
  s.addRow(['2023-12-30','2024-01-02','1','甲','123.IB','测',30,0.04,end,'广州','RECEIVABLE']);
  s.addRow(['2024-01-02','2024-01-02','2','甲','123.IB','测',100,0.04,end,'广州','RECEIVABLE']);
 }else{
  for(const v of [50.1,50.1,25+extra])s.addRow(['2024-01-03','2024-01-03','3',v>40?'甲':'乙',v>40?'123.IB':'456.IB','测试',v,0.04,end,'广州','公募','一级']);
 }
 return new Uint8Array(await w.xlsx.writeBuffer());
}
const plan={direction:'both',metric:'net',start:'2024-01-01',end:'2024-12-31',groupBy:['发行人全称'],limit:1};
test('annual files replace by year and side; exact duplicates, immutable exports, date coverage and distinct counts',async()=>{
 const r=isolated(),b=await sample('buy'),a=await ingestTradeLedger(r,b,buy);
 assert.equal((await ingestTradeLedger(r,b,buy)).duplicate,true);
 await assert.rejects(runTradeQuery(r,plan),/尚未导入/);
 const ss=await ingestTradeLedger(r,await sample('sell'),sell);
 const first=await runTradeQuery(r,plan),ids=(await listTradeLedgers(r.db)).map(v=>v.id);
 assert.deepEqual(first.totals,{buyCents:12520,sellCents:10000,grossCents:22520,netCents:2520,rows:4,bonds:2});
 assert.deepEqual(first.groups.map(g=>g.values),[['乙']]);assert.equal(first.groupCount,2);
 const src=await runTradeQuery(r,{...plan,direction:'sell',metric:'sell',start:null,end:null,filters:[{field:'台账年度',op:'eq',value:'2024'}]});
 assert.equal(src.totals.sellCents,13000);assert.match(src.warnings.join(''),/跨期/);
 for(const field of ['会计科目','会计分类']){
   const acct=await runTradeQuery(r,{...plan,direction:'buy',metric:'buy',groupBy:[field],filters:[{field,op:'eq',value:'委外（公募）'}]});
   assert.deepEqual(acct.groups[0].values,['委外（公募）']);assert.equal(acct.totals.rows,3);
 }
 const all=await runTradeQuery(r,{...plan,filters:[{field:'发行人全称',op:'in',value:['甲']}]});assert.equal(all.totals.rows,3);
 await assert.rejects(runTradeQuery(r,{...plan,groupBy:['交易市场(一级/二级)']}),/缺少/);
 const revised=await ingestTradeLedger(r,await sample('buy',10),buy);assert.notEqual(revised.ledger.id,a.ledger.id);
 assert.equal((await listTradeLedgers(r.db)).length,2);assert.equal((await runTradeQuery(r,plan)).totals.netCents,3520);
 assert.deepEqual((await loadTradeLedgers(r.db,ids)).map(v=>v.id),ids);assert.equal((await runTradeQuery(r,plan,ids)).totals.netCents,2520);
 await assert.rejects(ingestTradeLedger(r,b,buy),e=>e.status===409);
 const early=buy.replace('2412','2401');
 await assert.rejects(ingestTradeLedger(r,await sample('buy',20,'2024-01-30'),early),e=>e.status===409);
 const out=new ExcelJS.Workbook();await out.xlsx.load(await exportTradeQuery(r,plan,ids));
 assert.deepEqual(out.worksheets.map(s=>s.name),['交易汇总','交易明细','口径与来源']);
 assert.equal(out.getWorksheet('交易明细').rowCount,5);assert.equal(out.getWorksheet('交易汇总').rowCount,4);
});
test('reject misleading names, wrong directions, and partial unvalidated amounts without activating data',async()=>{
 const r=isolated(), b=await sample('buy');
 assert.throws(()=>parseTradeWorkbook(b,sell),/交易方向/);
 assert.throws(()=>parseTradeWorkbook(b,buy.replace('2401','2302')),/累计范围/);
 await assert.rejects(ingestTradeLedger(r,await sample('buy',0.001),buy),/精度/);
 assert.equal((await listTradeLedgers(r.db)).length,0);
});
