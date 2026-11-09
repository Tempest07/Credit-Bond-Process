import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {initInventory,ingestInventory,listInventory,newInventoryAnswer,answerSourceRows,readInventoryAnswer,answerDetails,exportData} from '../tools/inventory-store.mjs';
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
  const reopened=await readInventoryAnswer(storage.db,r.resultId);
  assert.equal(reopened.snapshot.id,v1.id);
  assert.deepEqual(reopened.groups,r.groups);
  assert.equal(reopened.totalCents,r.totalCents);
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

test('rank issuers within the branch first, then split by ledger account, preserving that cohort in detail, Excel and follow-ups',async()=>{
  const {db,bucket}=isolatedStore();
  await initInventory(db);
  const wb=new ExcelJS.Workbook(), sheet=wb.addWorksheet('本期底稿');
  sheet.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','数据业务日期']);
  for(const [issuer,account,yuan,branch='北京分行'] of [
    ['A','公募',79.01],['A','委外（公募）',1],['A','Receivable',20],['B','TRADING',91],['C','AFS',90],['C','AFS',999,'广州分行']
  ])sheet.addRow(['中心',branch,account,'组合','表内',issuer+'.IB','样例债',yuan,issuer,'中票','2026-10-29']);
  const snap=await ingestInventory({db,bucket},await wb.xlsx.writeBuffer(),'样例.xlsx');
  const plan={date:snap.date,group:'account',rank:{by:'issuer',limit:2},metric:'principal',filters:{branch:'北京分行'}};
  const answer=await newInventoryAnswer(db,snap,plan,bucket);
  assert.deepEqual(answer.groups.map(({rankName,bucketName,cents,rankPosition})=>[rankName,bucketName,cents,rankPosition]),
    [['A','委外（公募）',8001,1],['A','Receivable',2000,1],['B','Trading',9100,2]]);
  assert.equal(answer.totalCents,19101);assert.equal(answer.rowCount,4);assert.equal(answer.securityCount,2);
  const detail=await answerDetails(db,answer.resultId,{group:answer.groups[0].name});
  assert.equal(detail.total,2);assert.deepEqual(detail.rows.map(x=>x.queryAccount),['委外（公募）','委外（公募）']);
  assert.deepEqual(detail.rows.map(x=>x.account),['公募','委外（公募）']);
  assert.deepEqual((await readInventoryAnswer(db,answer.resultId)).groups,answer.groups);
  const {result,rows}=await exportData(db,answer.resultId);
  const file=new ExcelJS.Workbook();await file.xlsx.load(await exportInventoryWorkbook(result,rows));
  const summary=file.getWorksheet('分组汇总');
  assert.equal(summary.getCell('A2').value,'A');assert.equal(summary.getCell('B2').value,'委外（公募）');
  assert.equal(summary.getCell('C5').value,191.01);assert.equal(file.getWorksheet('持仓明细').rowCount,5);
  const filtered=await newInventoryAnswer(db,snap,{...plan,filters:{branch:'北京分行',account:'AFS'}},bucket,[],['A','B']);
  assert.equal(filtered.rowCount,0);assert.equal(filtered.rankReused,true);
  assert.equal((await readInventoryAnswer(db,filtered.resultId)).rankReused,true);
  const account=await newInventoryAnswer(db,snap,{...plan,rank:null,filters:{branch:'北京分行',account:'委外(公募)'}},bucket);
  assert.equal(account.totalCents,8001);
  const legacy=crypto.randomUUID();
  await db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind(legacy,snap.id,JSON.stringify({...plan,rank:null,typeRules:1}),new Date().toISOString()).run();
  const old=await readInventoryAnswer(db,legacy);
  assert.ok(old.groups.some(g=>g.name==='公募' && g.cents===7901));
  await assert.rejects(newInventoryAnswer(db,snap,{...plan,rank:{by:'issuer;--',limit:2}},bucket),e=>e.status===400);
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
  assert.deepEqual(noMatch.identity,{query:'其他未记录主体',field:'guarantor',candidates:[]});assert.equal(noMatch.totalCents,undefined);
  const changed=await ingestInventory(store,await roleFixture([['B',1000,abs,org,other],['C',15,'中票','',org]]),'新表.xlsx',v.id);
  const clean=await newInventoryAnswer(store.db,changed,q,store.bucket);
  assert.equal(clean.roleEvidence.kind,'enhancement');assert.match(clean.summary,/未匹配/);
  const detail=await answerDetails(store.db,a.resultId,{group:'A'});assert.deepEqual(detail.rows.map(r=>r.attribution),[org,org]);
  const full=await exportData(store.db,a.resultId);assert.equal(full.result.totalCents,15213);assert.equal(full.rows.length,2);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(await exportInventoryWorkbook(full.result,full.rows));
  assert.equal(wb.getWorksheet('持仓明细').getCell('O2').value,org);
  assert.equal(wb.getWorksheet('分组汇总').getCell('B3').value,152.13);assert.match(wb.getWorksheet('分组汇总').getCell('A3').value,/增信占用/);
});
test('weak nicknames and exact bond code clues request confirmation before reporting balances',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const group='珠海格力集团有限公司',electric='珠海格力电器股份有限公司',manager='金元证券股份有限公司',guarantor='其他担保有限公司';
  const v=await ingestInventory(store,await roleFixture([
    ['123456.SZ',55,'ABS',guarantor,group,manager],['1234567.SZ',7,'中票','',electric,electric],
    ['22.IB',30,'中票','',group,group],['99.IB',20,'中票','','铁路客户','中国国家铁路集团有限公司','26铁总MTN001'],
  ]),'线索.xlsx');
  const ask=filters=>newInventoryAnswer(store.db,v,{date:v.date,group:'code',metric:'principal',filters},store.bucket);
  const short=await ask({attribution:'格力'});
  assert.equal(short.resultId,undefined);
  assert.deepEqual(new Set(short.identity.candidates),new Set([group,electric]));
  const single=await ask({issuer:'电器'});
  assert.deepEqual(single.identity.candidates,[electric]);
  const clue=await ask({issuer:'铁总'});
  assert.deepEqual(clue.identity.candidates,['中国国家铁路集团有限公司']);
  assert.equal(clue.resultId,undefined);
  const cases=[
    [{issuer:'123456.sz'},'issuer',manager],
    [{attribution:'123456.SZ'},'attribution',group],
    [{guarantor:'123456.SZ',marketType:'ABS'},'guarantor',group],
    [{guarantor:'123456.SZ'},'guarantor',guarantor],
    [{issuer:'223344.SZ'},'issuer',null],
  ];
  for(const [filters,field,expected] of cases){
    const reply=await ask(filters);
    assert.equal(reply.resultId,undefined);
    assert.equal(reply.identity.field,field);
    assert.deepEqual(reply.identity.candidates,expected?[expected]:[]);
  }
  assert.equal((await ask({guarantor:group,marketType:'ABS'})).totalCents,5500);
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

test('a saved multi-stage program can change cohorts repeatedly and reconcile details and workbook after snapshot replacement',async()=>{
  const storage=isolatedStore();
  await initInventory(storage.db);
  const wb=new ExcelJS.Workbook(), sheet=wb.addWorksheet('本期底稿');
  sheet.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','到期日期','数据业务日期']);
  for(const [id,issuer,code,account,amount,branch] of [
    [1,'甲','A1','公募',150,'北京'],[2,'甲','A1','委外(公募)',150,'北京'],
    [3,'乙','B1','AFS',50,'北京'],[4,'乙','B2','公募',50,'北京'],
    [5,'丙','C1','AFS',200,'北京'],[6,'甲','A2','公募',5000,'上海'],
  ]) sheet.addRow(['中心',branch,account,'组合','表内',code,'示例'+id,amount,issuer,'中票','2030-01-01','2026-10-29']);
  const snap=await ingestInventory(storage,await wb.xlsx.writeBuffer(),'组合查询.xlsx');
  const plan={date:snap.date,group:'none',metric:'principal',filters:{branch:'北京'},analysis:[
    {op:'group',fields:['issuer']},{op:'having',metric:'rowCount',operator:'gte',value:2},
    {op:'sort',metric:'securityCount',descending:true},{op:'take',limit:2},{op:'expand'},
    {op:'group',fields:['account']},{op:'sort',metric:'principalCents',descending:true},{op:'take',limit:1},{op:'expand'},
    {op:'group',fields:['issuer','account','marketType']},
  ]};
  const answer=await newInventoryAnswer(storage.db,snap,plan,storage.bucket);
  assert.deepEqual(answer.dimensions,['issuer','account','marketType']);
  assert.deepEqual(answer.groups.map(g=>[g.labels,g.cents,g.count,g.securityCount]),
    [[['甲','委外（公募）','中期票据'],30000,2,1],[['乙','委外（公募）','中期票据'],5000,1,1]]);
  assert.equal(answer.totalCents,35000);assert.equal(answer.securityCount,2);
  assert.ok(answer.groups.every(g=>!Object.hasOwn(g,'sourceRows')));
  const second=await sample();
  await ingestInventory(storage,second,'替换.xlsx',snap.id);
  const read=await readInventoryAnswer(storage.db,answer.resultId);
  assert.deepEqual(read.groups,answer.groups);
  const page=await answerDetails(storage.db,answer.resultId,{group:answer.groups[0].name,offset:1,limit:1});
  assert.equal(page.total,2);assert.equal(page.rows[0].sourceRow,3);
  const empty=await answerDetails(storage.db,answer.resultId,{group:'["未入选"]'});
  assert.deepEqual(empty,{rows:[],total:0});
  const {result,rows}=await exportData(storage.db,answer.resultId);
  assert.deepEqual(rows.map(r=>r.sourceRow),[2,3,5]);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportInventoryWorkbook(result,rows));
  const groups=book.getWorksheet('分组汇总');
  assert.deepEqual(groups.getRow(1).values.slice(1,4),['发行人','会计科目','债券类型']);
  assert.equal(groups.getCell('D4').value,350);assert.equal(groups.getCell('F4').value,3);
  assert.equal(book.getWorksheet('持仓明细').getCell('N4').value,5);
  const noRows=await newInventoryAnswer(storage.db,snap,{...plan,analysis:[
    {op:'filter',field:'cents',operator:'gt',value:999999},{op:'group',fields:['issuer']},
  ]},storage.bucket);
  assert.equal(noRows.rowCount,0);assert.deepEqual(noRows.groups,[]);
  assert.deepEqual((await exportData(storage.db,noRows.resultId)).rows,[]);
});

test('uncatalogued workbook headers can be used in a program and replayed from the verified snapshot cache, including Excel columns past Z',async()=>{
  const storage=isolatedStore();
  await initInventory(storage.db);
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('本期底稿');
  const headers=['地区','内部类别',...Array.from({length:10},(_,i)=>'新字段'+(i+1))];
  sheet.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','数据业务日期',...headers]);
  for(const [code,principal,region] of [['A1',100,'北部'],['B1',90,'北部'],['C1',50,'南部']]){
    sheet.addRow(['总部','北京','AFS','组合','表内',code,'样例债',principal,'甲公司','MTN','2026-10-29',region,'内部A',...Array(10).fill('存在')]);
  }
  const snapshot=await ingestInventory(storage,await wb.xlsx.writeBuffer(),'更多列.xlsx');
  const plan={date:snapshot.date,group:'none',filters:{},metric:'principal',analysis:[
    ...headers.slice(2).map(header=>({op:'filter',field:'原表:'+header,operator:'eq',value:'存在'})),
    {op:'group',fields:['原表:地区']},{op:'take',limit:1},{op:'expand'},
    {op:'group',fields:['原表:内部类别','account']},
  ]};
  const answer=await newInventoryAnswer(storage.db,snapshot,plan,storage.bucket);
  assert.equal(answer.rowCount,2);assert.equal(answer.totalCents,19000);
  assert.match(answer.warnings.join(' '),/未经市场数据核验/);
  storage.objects.clear();
  const details=await answerDetails(storage.db,answer.resultId,{group:answer.groups[0].name});
  assert.deepEqual(details.rows.map(r=>r['原表:地区']),['北部','北部']);
  const {result,rows}=await exportData(storage.db,answer.resultId);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportInventoryWorkbook(result,rows));
  const detail=book.getWorksheet('持仓明细');
  assert.equal(detail.getCell('AB1').value,'内部类别');
  assert.equal(detail.getCell('AB2').value,'内部A');
  assert.equal(detail.autoFilter,'A1:AB3');
  assert.equal(book.getWorksheet('分组汇总').getCell('A1').value,'内部类别');
  assert.match(book.getWorksheet('计算口径').getSheetValues().flat().join(' '),/未经市场数据核验/);
});

test('custom numeric measurements reconcile independently and survive reopening without access to the original upload',async()=>{
  const storage=isolatedStore();
  await initInventory(storage.db);
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('本期底稿');
  sheet.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','数据业务日期','测试原字段(年)']);
  for(const [code,branch,amount,years] of [['01','北京',100,3],['02','北京',300,5],['03','广州',100,0],['04','上海',100,null]])
    sheet.addRow(['中心',branch,'AFS','组合','表内',code,'测试债',amount,'公司','中票','2026-10-29',years]);
  const snapshot=await ingestInventory(storage,await wb.xlsx.writeBuffer(),'期限.xlsx');
  const measure={fn:'weightedAvg',field:'原表:测试原字段(年)'};
  const answer=await newInventoryAnswer(storage.db,snapshot,{date:snapshot.date,group:'none',metric:'principal',filters:{},analysis:[
    {op:'group',fields:['branch'],measure,metric:'measure'},{op:'sort',metric:'measure',descending:true},
  ]},storage.bucket);
  assert.deepEqual(answer.measure,measure);
  assert.equal(answer.measureTotal,3.6);
  assert.deepEqual(answer.groups.map(g=>[g.labels[0],g.measureValue]),[['北京',4.5],['广州',0],['上海',null]]);
  storage.objects.clear();
  const {result,rows}=await exportData(storage.db,answer.resultId);
  assert.deepEqual(result.groups,answer.groups);assert.equal(result.measureTotal,3.6);
  const saved=new ExcelJS.Workbook();await saved.xlsx.load(await exportInventoryWorkbook(result,rows));
  const summary=saved.getWorksheet('分组汇总');
  assert.equal(summary.getCell('F1').value,'测试原字段(年)本金加权均值');
  assert.equal(summary.getCell('F3').value,0);assert.equal(summary.getCell('F5').value,3.6);
  assert.equal(saved.getWorksheet('持仓明细').getCell('Q2').value,3);
});

test('programs preserve issuer and guarantee lookup boundaries and only group roles present in this snapshot',async()=>{
  const storage=isolatedStore();await initInventory(storage.db);
  const snapshot=await ingestInventory(storage,await sample(),'角色边界.xlsx');
  const base={date:snapshot.date,group:'none',metric:'principal',filters:{}};
  for(const field of ['issuer','guarantor','attribution','code']){
    const analysis=[{op:'filter',field,operator:'contains',value:'电网'},{op:'group',fields:['account']}];
    await assert.rejects(newInventoryAnswer(storage.db,snapshot,{...base,analysis},storage.bucket),error=>error.status===400);
  }
  const program=[{op:'group',fields:['issuer']}];
  const ambiguous=await newInventoryAnswer(storage.db,snapshot,{...base,analysis:program,filters:{issuer:'电网'}},storage.bucket);
  assert.equal(ambiguous.identity.query,'电网');assert.equal(ambiguous.resultId,undefined);
  await assert.rejects(newInventoryAnswer(storage.db,snapshot,{...base,analysis:[{op:'group',fields:['guarantor']}]},storage.bucket),/没有台账列明担保人列/);
  await assert.rejects(newInventoryAnswer(storage.db,snapshot,{...base,analysis:[{op:'group',fields:['原表:发行人全称']}]},storage.bucket),/缺少查询使用的原表列/);
});

test('a follow-up inherits exact source rows including an empty prior answer, independent of the new query shape',async()=>{
  const storage=isolatedStore();await initInventory(storage.db);
  const {db,bucket}=storage,snapshot=await ingestInventory(storage,await sample(),'库存.xlsx');
  const base={date:snapshot.date,group:'none',metric:'principal',filters:{}};
  const first=await newInventoryAnswer(db,snapshot,{...base,analysis:[
    {op:'group',fields:['portfolio']},{op:'sort',metric:'principalCents',descending:true},{op:'take',limit:1},
  ]},bucket);
  const sourceRows=await answerSourceRows(db,first.resultId,snapshot.id);
  assert.deepEqual(sourceRows,[3]);
  const second=await newInventoryAnswer(db,snapshot,{...base,group:'branch',rank:{by:'issuer',limit:1}},bucket,[],undefined,sourceRows);
  assert.equal(second.scopedToPrevious,true);assert.equal(second.totalCents,31012);
  assert.equal(Object.hasOwn(second.plan,'sourceRows'),false);assert.equal(Object.hasOwn(second,'sourceRows'),false);
  assert.deepEqual(await answerSourceRows(db,second.resultId),sourceRows);
  const {rows,result}=await exportData(db,second.resultId);
  assert.deepEqual(rows.map(r=>r.sourceRow),[3]);assert.equal(result.totalCents,31012);
  assert.equal((await answerDetails(db,second.resultId,{group:second.groups[0].name})).total,1);
  assert.deepEqual((await readInventoryAnswer(db,second.resultId)).groups,second.groups);
  const third=await newInventoryAnswer(db,snapshot,{...base,filters:{branch:'北京分行'},analysis:[{op:'group',fields:['account']}]},bucket,[],undefined,sourceRows);
  assert.equal(third.rowCount,0);
  const empty=await answerSourceRows(db,third.resultId);
  assert.deepEqual(empty,[]);
  assert.equal((await newInventoryAnswer(db,snapshot,base,bucket,[],undefined,empty)).rowCount,0);
  const forged=await newInventoryAnswer(db,snapshot,{...base,sourceRows:[]},bucket);
  assert.equal(forged.rowCount,3);assert.equal(forged.scopedToPrevious,undefined);
  await assert.rejects(newInventoryAnswer(db,snapshot,base,bucket,[],undefined,[3,3]),err=>err.status===409);
  const replacement=await ingestInventory(storage,await sample(12),'修订.xlsx',snapshot.id);
  await assert.rejects(answerSourceRows(db,second.resultId,replacement.id),err=>err.status===409);
});

test('folder imports check the worksheet business year before publishing or accepting an existing copy',async()=>{
  const storage=isolatedStore();
  await initInventory(storage.db);
  const bytes=await sample(100,'2025-12-31');
  await assert.rejects(ingestInventory(storage,bytes,'余额台账260101.xlsx','','2026'),e=>e.status===422 && e.message.includes('2025-12-31'));
  assert.equal(storage.objects.size,0);
  const existing=await ingestInventory(storage,bytes,'2025年末.xlsx','','2025');
  await assert.rejects(ingestInventory(storage,bytes,'2026年初.xlsx','','2026'),e=>e.status===422);
  assert.equal((await listInventory(storage.db))[0].id,existing.id);
});
