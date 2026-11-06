import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {initInventory,ingestInventory,listInventory,newInventoryAnswer,answerDetails,exportData} from '../tools/inventory-store.mjs';
import {exportInventoryWorkbook} from '../tools/inventory-workbook.mjs';

// Runs the actual SQLite queries and transactions, without provisioning cloud data for tests.
function isolatedStore(){
  const sqlite=new DatabaseSync(':memory:');
  const objects=new Map();
  function stmt(sql,args=[]){
    const sqliteStatement=()=>sqlite.prepare(sql);
    return {bind:(...values)=>stmt(sql,values),all:async()=>({results:sqliteStatement().all(...args)}),
      first:async()=>sqliteStatement().get(...args),run:async()=>({meta:sqliteStatement().run(...args)}),
      batchExec:()=>/^SELECT/i.test(sql)?{results:sqliteStatement().all(...args)}:{meta:sqliteStatement().run(...args)}};
  }
  return {db:{prepare:stmt,async batch(stmts){sqlite.exec('BEGIN');try{const out=stmts.map(s=>s.batchExec());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}},
    bucket:{put:async(k,v)=>objects.set(k,v),delete:async(k)=>objects.delete(k)},objects};
}
async function sample(last=310.12,date='2026-10-29'){
  const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('本期底稿');
  s.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','到期日期','数据业务日期']);
  for(const line of [['广州分行','表内','交易组合A','123.IB',100,'甲公司'],['广州分行','委外(公募)','交易组合B','123.IB',last,'甲公司'],['北京分行','表内','交易组合A','456.IB',-2.20,'乙公司']]){
    const [branch,scope,portfolio,code,amount,issuer]=line;s.addRow(['中心',branch,'AFS',portfolio,scope,code,'测试债',amount,issuer,'中期票据','2030-12-31',date]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
test('immutable versions, row preservation, distinct codes, confirmation and full Excel export',async()=>{
  const storage=isolatedStore();await initInventory(storage.db);const v1bytes=await sample();
  const v1=await ingestInventory(storage,v1bytes,'库存.xlsx');
  assert.equal(v1.totalCents,40792);assert.equal(v1.rowCount,3);
  assert.equal((await ingestInventory(storage,v1bytes,'同一文件.xlsx')).id,v1.id);
  const query={date:v1.date,group:'issuer',metric:'principal',filters:{branch:'广州分行'}};
  const r=await newInventoryAnswer(storage.db,v1,query);
  assert.equal(r.totalCents,41012);assert.equal(r.rowCount,2);assert.equal(r.securityCount,1);
  const second=await sample(215.09);
  await assert.rejects(ingestInventory(storage,second,'修订.xlsx'),e=>e.status===409&&e.details.previousId===v1.id);
  const v2=await ingestInventory(storage,second,'修订.xlsx',v1.id);
  assert.equal((await listInventory(storage.db))[0].id,v2.id);
  const old=await answerDetails(storage.db,r.resultId,{group:'甲公司'});
  assert.equal(old.rows.length,2);assert.equal(old.rows[1].cents,31012);
  const {result,rows}=await exportData(storage.db,r.resultId);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(await exportInventoryWorkbook(result,rows));
  assert.equal(wb.getWorksheet('持仓明细').rowCount,3);assert.equal(wb.getWorksheet('分组汇总').getCell('B3').value,410.12);
  assert.equal(wb.getWorksheet('持仓明细').getCell('N3').value,3);
  const inBook=await newInventoryAnswer(storage.db,v2,{...query,filters:{...query.filters,scope:'表内',holdingStatus:'存续'}});
  assert.equal(inBook.rowCount,1);assert.equal(inBook.totalCents,10000);
});
test('bad workbook and staging failure leave published version effective',async()=>{
  const storage=isolatedStore();await initInventory(storage.db);
  const original=await ingestInventory(storage,await sample(),'库存.xlsx');
  await assert.rejects(ingestInventory(storage,Buffer.from('invalid'),'bad.xlsx'),e=>e.status===400);
  const initialBatch=storage.db.batch;
  storage.db.batch=(arr)=>{if(arr.length&&!storage.broke){storage.broke=true;return Promise.reject(Error('fault injection'))}return initialBatch(arr)};
  await assert.rejects(ingestInventory(storage,await sample(1),'修订.xlsx',original.id));
  assert.equal((await listInventory(storage.db))[0].id,original.id);assert.equal(storage.objects.size,1);
});
