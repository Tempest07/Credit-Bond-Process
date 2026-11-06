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
    bucket:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?new Response(objects.get(k)):null,delete:async(k)=>objects.delete(k)},objects};
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

async function roleFixture(entries,withAttribution=true) {
  const wb=new ExcelJS.Workbook(), s=wb.addWorksheet('本期底稿');
  s.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','到期日期','数据业务日期','保证人全称',...(withAttribution?['资产端损益还原客户名称']:[])]);
  for(const [code,amount,type,guarantor,attribution,issuer='发行人甲',name='简称'+code] of entries)
    s.addRow(['中心','广州分行','AFS','组合甲','表内',code,name,amount,issuer,type,'2030-01-01','2026-10-29',guarantor, ...(withAttribution?[attribution]:[])]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
test('ABS enhancement uses only attributed exposure, handles incomplete coverage, and pins detail and export to the imported source',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const abs='资产支持证券',other='其他集团有限公司',org='珠海格力集团有限公司',electric='珠海格力电器股份有限公司';
  const rows=[['A',100.12,abs,other,org],['A',52.01,abs,'',org],['B',200,abs,org,other],['C',300,abs,'',electric],['D',20,'中期票据','',org],['E',30,abs,null,null]];
  const v=await ingestInventory(store,await roleFixture(rows),'旧版已上传.xlsx');
  const q={date:v.date,group:'code',metric:'principal',filters:{marketType:'ABS',guarantor:'格力集团'}};
  let reads=0;
  const a=await newInventoryAnswer(store.db,v,q,{get:key=>{
    if(++reads===1)throw Error('temporary R2 read failure');
    return store.bucket.get(key);
  }});
  assert.equal(reads,2);
  assert.equal(a.totalCents,15213);assert.equal(a.roleEvidence.kind,'enhancement');assert.equal(a.roleEvidence.entity,org);
  assert.equal(a.roleEvidence.missingAttributionRows,1);assert.equal(a.rowCount,2);assert.equal(a.securityCount,1);
  assert.equal(a.groups[0].securityName,'简称A');assert.match(a.summary,/增信占用/);assert.match(a.warnings.join(' '),/法律担保/);
  const noMatch=await newInventoryAnswer(store.db,v,{...q,filters:{...q.filters,guarantor:'其他未记录主体'}});
  assert.equal(noMatch.roleEvidence.kind,'unknown');assert.doesNotMatch(noMatch.summary,/0|零/);
  const changed=await ingestInventory(store,await roleFixture([['B',1000,abs,org,other]]),'新表.xlsx',v.id);
  const clean=await newInventoryAnswer(store.db,changed,q,store.bucket);
  assert.equal(clean.roleEvidence.kind,'enhancement');assert.match(clean.summary,/未匹配/);
  const detail=await answerDetails(store.db,a.resultId,{group:'A'});assert.deepEqual(detail.rows.map(r=>r.attribution),[org,org]);
  const full=await exportData(store.db,a.resultId);assert.equal(full.result.totalCents,15213);assert.equal(full.rows.length,2);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(await exportInventoryWorkbook(full.result,full.rows));
  assert.equal(wb.getWorksheet('持仓明细').getCell('O2').value,org);
  assert.equal(wb.getWorksheet('分组汇总').getCell('B3').value,152.13);assert.match(wb.getWorksheet('分组汇总').getCell('A3').value,/增信占用/);
});
test('missing attribution, namesakes and generic guarantee questions do not convert an ambiguous role to a definite amount',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const abs='资产支持证券',org='珠海格力集团有限公司';
  const v=await ingestInventory(store,await roleFixture([['A',200,abs,org,''],['B',300,abs,'','']],false),'无归属列.xlsx');
  const q={date:v.date,group:'none',metric:'principal',filters:{guarantor:'格力集团',marketType:'ABS'}};
  const absent=await newInventoryAnswer(store.db,v,q,store.bucket);
  assert.equal(absent.roleEvidence.kind,'unknown');assert.match(absent.warnings.join(' '),/缺少/);
  const ledger=await newInventoryAnswer(store.db,v,{...q,filters:{guarantor:'格力集团'}});
  assert.equal(ledger.roleEvidence.kind,'ledger');assert.equal(ledger.totalCents,20000);assert.equal(ledger.roleEvidence.missingGuarantorRows,1);
  const changed=await ingestInventory(store,await roleFixture([['A',1,abs,'',org],['B',2,abs,'','北京格力集团有限公司']]),'歧义.xlsx',v.id);
  const ambiguous=await newInventoryAnswer(store.db,changed,q,store.bucket);
  assert.match(ambiguous.clarification,/珠海格力集团有限公司/);assert.match(ambiguous.clarification,/北京格力集团有限公司/);
});
test('total attributed credit and self-issued debt are separate; CP and identifiable SCP never share a product group or export',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const org='珠海格力集团有限公司', manager='金元证券股份有限公司', other='甲电器有限公司';
  const sample=[
    ['A',30,'ABS','',org,manager],['B',15,'资产支持证券','',org,manager],
    ['M',8,'中期票据','',org,org],['M',9,'MTN','',org,org],
    ['C',2,'短期融资券','',org,org,'26格力CP001'],['S',3,'短期融资券','',org,org,'26格力SCP001'],
    ['T',4,'超短融','',org,org],['X',6,'公司债','',other,other],
  ];
  const v=await ingestInventory(store,await roleFixture(sample),'混合品种.xlsx');
  const base={date:v.date,group:'marketType',metric:'principal',filters:{attribution:'格力集团'}};
  const total=await newInventoryAnswer(store.db,v,base,store.bucket);
  assert.equal(total.totalCents,7100);assert.deepEqual(total.groups.map(g=>[g.name,g.cents]),[['资产支持证券',4500],['中期票据',1700],['超短期融资券',700],['短期融资券',200]]);
  const self=await newInventoryAnswer(store.db,v,{...base,filters:{issuer:'格力集团',marketType:'中票'}});
  assert.equal(self.totalCents,1700);assert.equal(self.securityCount,1);assert.equal(self.plan.filters.issuer,org);
  const short=await newInventoryAnswer(store.db,v,{...base,filters:{attribution:'格力集团',marketType:'CP'}});
  assert.equal(short.totalCents,200);assert.match(short.warnings.join(' '),/短融与超短融分列/);
  const superShort=await answerDetails(store.db,total.resultId,{group:'超短期融资券'});
  assert.deepEqual(superShort.rows.map(r=>[r.code,r.marketType,r.queryMarketType]),[['S','短期融资券','超短期融资券'],['T','超短融','超短期融资券']]);
  const {result,rows}=await exportData(store.db,total.resultId);const wb=new ExcelJS.Workbook();
  await wb.xlsx.load(await exportInventoryWorkbook(result,rows));assert.equal(wb.worksheets[1].getCell('Q7').value,'超短期融资券');
  const broad=await newInventoryAnswer(store.db,v,{...base,filters:{attribution:'格力集团',marketType:'信用债'}});
  assert.match(broad.clarification,/具体券种/);
  const noIssuer=await newInventoryAnswer(store.db,v,{...base,filters:{issuer:'不存在的集团'}});
  assert.match(noIssuer.clarification,/没有匹配/);
  const v2=await ingestInventory(store,await roleFixture([...sample,['2nd',1,'MTN','',other,'北京格力集团有限公司']]),'同名.xlsx',v.id);
  assert.match((await newInventoryAnswer(store.db,v2,{...base,filters:{issuer:'格力集团'}})).clarification,/北京格力集团有限公司/);
  // Replay a pre-normalization result: the formerly reported source-type
  // '短期融资券' still selects both original CP rows in the old download.
  const oldId=crypto.randomUUID();
  await store.db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind(oldId,v.id,JSON.stringify({...base,filters:{marketType:'短期融资券'}}),'old').run();
  const old=await exportData(store.db,oldId);assert.equal(old.result.totalCents,500);assert.equal(old.rows.length,2);
});
