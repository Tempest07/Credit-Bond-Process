import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {initInventory,ingestInventory,listInventory,newInventoryAnswer,answerSourceRows,readInventoryAnswer,answerDetails,exportData} from '../tools/inventory-store.mjs';
import {exportInventoryWorkbook} from '../tools/inventory-workbook.mjs';
import {inventoryHttp,queryInventory} from '../tools/inventory-http.mjs';
import {executeJointPlan} from '../tools/joint-execute.mjs';
import {jointExcel} from '../tools/joint-export.mjs';
import {calculateInventory} from '../tools/inventory-calculation.mjs';

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
test('account aliases find the original ledger rows and old answers keep their saved classification',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await sample(),'库存.xlsx');
  await store.db.prepare("UPDATE inventory_rows SET account='RECEIVABLE' WHERE version=? AND code='123.IB'").bind(snap.id).run();
  const plan={date:snap.date,group:'account',metric:'principal',filters:{account:'ac'}};
  const current=await newInventoryAnswer(store.db,snap,plan);
  assert.equal(current.plan.filters.account,'Receivable');
  assert.equal(current.totalCents,41012);
  assert.equal((await answerDetails(store.db,current.resultId)).total,2);
  const oci=await newInventoryAnswer(store.db,snap,{...plan,filters:{account:'oci'}});
  assert.equal(oci.rowCount,1);
  const paired=await newInventoryAnswer(store.db,snap,{...plan,filters:{account:'AC（Receivable）'}});
  assert.equal(paired.totalCents,current.totalCents);
  await store.db.prepare("UPDATE inventory_rows SET account='AC（Receivable）' WHERE version=? AND code='123.IB'").bind(snap.id).run();
  assert.equal((await newInventoryAnswer(store.db,snap,plan)).totalCents,current.totalCents);
  const previous={...plan,filters:{account:'AC'},accountRules:1,typeRules:1};
  await store.db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind('legacy-ac',snap.id,JSON.stringify(previous),'2026-11-11').run();
  assert.equal((await readInventoryAnswer(store.db,'legacy-ac')).rowCount,0);
  assert.equal((await answerDetails(store.db,'legacy-ac')).total,0);
  const priorAnalysis={...previous,filters:{},analysis:[{op:'filter',field:'account',operator:'eq',value:'AC'},{op:'group',fields:['account']}]};
  await store.db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind('legacy-program',snap.id,JSON.stringify(priorAnalysis),'2026-11-11').run();
  assert.equal((await readInventoryAnswer(store.db,'legacy-program')).rowCount,0);
});
test('city shorthand uses the current snapshot branch label and preserves an exact label when both exist',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await sample(),'库存.xlsx');
  const plan={date:snap.date,group:'marketType',metric:'principal',filters:{branch:'广州'}};
  const short=await newInventoryAnswer(store.db,snap,plan);
  assert.equal(short.plan.filters.branch,'广州分行');
  assert.equal(short.totalCents,41012);
  await store.db.prepare("UPDATE inventory_rows SET branch='广州' WHERE version=? AND branch='北京分行'").bind(snap.id).run();
  const literal=await newInventoryAnswer(store.db,snap,plan);
  assert.equal(literal.plan.filters.branch,'广州');
  assert.equal(literal.totalCents,-220);
  await store.db.prepare("UPDATE inventory_rows SET branch='广州市分行' WHERE version=? AND branch='广州'").bind(snap.id).run();
  assert.match((await newInventoryAnswer(store.db,snap,plan)).clarification,/可能指/);
});
test('the combined share of ranked branches divides their own filtered holdings by their own complete holdings',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await sample(),'库存.xlsx');
  await store.db.prepare("UPDATE inventory_rows SET account='Receivable' WHERE version=? AND portfolio='交易组合B'").bind(snap.id).run();
  const prior={source:'inventory',id:'s1',question:'上期具名分行首位',data:{rankedMembers:{field:'branch',names:['广州分行']}}};
  const steps=[{account:'AFS'},{}].map((filters,i)=>({id:'s'+(i+1),operation:'memberSummary',source:'inventory',
    question:'沿用首位分行',snapshotDate:snap.date,metric:'principal',selection:{from:'previous1',field:'branch',limit:1},filters}));
  const answer=await executeJointPlan(store,{steps,question:'这一组的本金合计有多少比例在OCI？',snapshots:[snap],
    history:[{question:prior.question,answer:{steps:[prior]}}]});
  assert.equal(answer.ledgerReport.kind,'selectedScopeShare');
  const [row]=answer.ledgerReport.rows;
  assert.equal(row.num,10000/1e10);assert.equal(row.den,41012/1e10);assert.equal(row.ratio,10000/41012*100);
});

test('a request for pinned provenance keeps explicitly requested branch totals in the visible report',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await sample(),'库存.xlsx');
  const step={id:'s1',operation:'snapshotEvidence',source:'inventory',question:'确认来源',request:'source',examples:0,
    snapshotDate:snap.date,filters:{},group:'none'};
  const answer=await executeJointPlan(store,{steps:[step],question:'按分行列给我，附合计和原表',snapshots:[snap]});
  const rows=answer.ledgerReport.rows;
  assert.deepEqual(new Set(rows.map(r=>r.name)),new Set(['北京分行','广州分行','合计']));
  assert.equal(rows.at(-1).count,3);assert.equal(answer.steps[0].data.sourceEvidence.id,snap.id);
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
test('inventory calculations compare real code sets and validate share membership independently of equal totals',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  async function day(date,code){
    const b=new ExcelJS.Workbook(),s=b.addWorksheet('本期底稿');
    s.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','数据业务日期']);
    for(const [branch,c,name] of [['南京分行','Q.IB','第一期'],['杭州分行',code,'25青江SCP001']])
      s.addRow(['中心',branch,'AFS','甲组合','表内',c,name,100,'甲发行人','短期融资券',date]);
    return ingestInventory(store,await b.xlsx.writeBuffer(),date+'.xlsx');
  }
  const snapshots=[await day('2026-05-07','Z.IB'),await day('2026-05-14','R.IB')];
  const slices=snapshots.map(s=>({date:s.date,filters:{}}));
  const compare=(slices,op)=>calculateInventory(store,{slices,metric:'securities',calculations:[{op,left:1,right:2}]},snapshots);
  const compared=await compare(slices,'codeSets');
    assert.deepEqual(compared.codeComparisons.map(c=>[c.shared,c.leftOnly,c.rightOnly]),[[1,1,1]]);
  assert.match(compared.clarification,/共有 1 只，期末新出现 1 只，期末不再持有 1 只/);
  const [a]=snapshots;
  await assert.rejects(compare(['南京分行','杭州分行'].map(branch=>({date:a.date,filters:{branch}})),'share'),/分子包含分母以外/);
  const query=filters=>newInventoryAnswer(store.db,a,{date:a.date,group:'none',metric:'securities',filters},store.bucket);
  assert.equal((await query({sourceMarketType:'短期融资券'})).securityCount,2);
  assert.equal((await query({marketType:'短期融资券'})).securityCount,1);
  const rawGroups=await newInventoryAnswer(store.db,a,{date:a.date,group:'none',metric:'principal',filters:{},
    analysis:[{op:'group',fields:['sourceMarketType']},{op:'sort',metric:'principalCents',descending:true},{op:'take',limit:1}]},store.bucket);
  assert.deepEqual(rawGroups.groups.map(g=>[g.labels,g.securityCount]),[[['短期融资券'],2]]);
});

test('pinned security lookup retains market suffixes and disambiguates identical short names across issuers',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await roleFixture([
    ['7001.IB',3,'中票','','','甲','短名一'],['7001.SH',5,'中票','','','乙','短名一'],
    ['7002.IB',2,'中票','','','甲','短名二'],['7002.IB',4,'中票','','','甲','短名二'],
  ]),'券码.xlsx');
  const query=code=>newInventoryAnswer(store.db,snap,{date:snap.date,group:'none',metric:'count',filters:{code}},store.bucket);
  for(const term of ['短名一','7001'])assert.match((await query(term)).clarification,/7001\.IB.*7001\.SH/);
  const byName=await query('短名二');assert.equal(byName.plan.filters.code,'7002.IB');assert.equal(byName.rowCount,2);
  assert.equal((await query('7001.sh')).totalCents,500);
  assert.equal((await query('9000.IB')).rowCount,0);
});

test('a cross-ledger code/name pair is pinned by actual code; missing members remain zero in exports and history',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await sample(),'库存.xlsx');
  const previous={source:'trade',id:'s1',question:'按券码列出买入的券',
    data:{plan:{groupBy:['债券简称','债券代码'],metric:'buy'},result:{groups:[
      {values:['测试债','456.IB'],buyCents:400},{values:['同名券','789.IB'],buyCents:300}],groupCount:2}}};
  const step={id:'s1',source:'inventory',question:'这两只的余额',operation:'memberSummary',
    selection:{from:'previous1',field:'code',limit:null},filters:{},snapshotDate:snap.date,metric:'principal'};
  const reply=await executeJointPlan(store,{snapshots:[snap],steps:[step],history:[{answer:{steps:[previous]}}]});
  const result=reply.steps[0].data,groups=[['456.IB',-220,1],['789.IB',0,0]];
  for(const value of [result,await readInventoryAnswer(store.db,result.resultId),(await exportData(store.db,result.resultId)).result])
    assert.deepEqual(value.groups.map(g=>[g.name,g.cents,g.securityCount]),groups);
});

test('multiple security scopes resolve actual names and markets, deduplicate balances, and discover the issuer denominator',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const snap=await ingestInventory(store,await roleFixture([
    ['0007.IB',10,'中票','','','甲投资有限公司','甲一'],['0007.IB',20,'中票','','','甲投资有限公司','甲一'],
    ['0007.SH',80,'公司债','','','乙投资有限公司','乙一'],['0008.IB',70,'中票','','','甲投资有限公司','甲二'],
  ]),'同码.xlsx');
  const run=(filters,calculations=[])=>calculateInventory(store,{metric:'principal',
    slices:filters.map(filters=>({date:snap.date,filters})),calculations},[snap]);
  await assert.rejects(run([{code:'0007'}]),/0007\.IB.*0007\.SH/);
  const several=await run([{code:'0007',securityMarket:'IB'},{code:'甲一'},{code:'0008.IB'}]);
  assert.deepEqual(several.securityMembers,[{code:'0007.IB',cents:3000},{code:'0008.IB',cents:7000}]);
  assert.match(several.clarification,/甲一.*2 条持仓/);
  assert.equal(several.overview.length,2);
  assert.match(several.clarification,/去重合计：0\.000001 亿元，3 条持仓/);
  const fraction=await run([{code:'0007',securityMarket:'IB'},{issuerOfCode:'甲一'}],[{op:'share',left:1,right:2}]);
  assert.equal(fraction.overview[1].result.plan.filters.issuer,'甲投资有限公司');
  assert.match(fraction.clarification,/30%/);
  const previous={source:'inventory',id:'s1',question:'逐只核对',data:several};
  const step={id:'s1',source:'inventory',question:'沿用券码名单',operation:'memberSummary',selection:{from:'previous1',field:'code',limit:null},filters:{},snapshotDate:snap.date,metric:'principal'};
  const reply=await executeJointPlan(store,{snapshots:[snap],steps:[step],history:[{answer:{steps:[previous]}}]});
  assert.equal(reply.steps[0].data.totalCents,10000);
});

test('rank issuers within the branch first, then split by ledger account, preserving that cohort in detail, Excel and follow-ups',async()=>{
  const {db,bucket}=isolatedStore();
  await initInventory(db);
  const wb=new ExcelJS.Workbook(), sheet=wb.addWorksheet('本期底稿');
  sheet.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','数据业务日期']);
  for(const [issuer,account,yuan,branch='北京分行'] of [
    ['A','公募',79.01],['A','委外（公募）',1],['A','Receivable',20],['B','TRADING',91],['C','AFS',90],['C','AFS',999,'广州分行'],['A','AFS',500,'广州分行']
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
  // Reuse the executed result's rows even when a different branch holds a higher-ranked issuer.
  const ranked=await newInventoryAnswer(db,snap,{...plan,rank:null,group:'none',analysis:[
    {op:'group',fields:['issuer']},{op:'sort',metric:'principalCents',descending:true},{op:'take',limit:2}]},bucket);
  const follow=await executeJointPlan({db,bucket},{snapshots:[snap],
    history:[{question:'此分行排前两家的余额',answer:{steps:[{id:'s1',source:'inventory',question:'已选前二',data:ranked}]}}],
    steps:[{id:'s1',source:'inventory',operation:'regroup',from:'previous1',dimensions:['issuer','account'],metric:'principal',question:'这些发行人各按科目拆'}]});
  const split=follow.steps[0].data;
  assert.equal(split.totalCents,19101);
  assert.deepEqual(new Map(split.groups.map(g=>[g.labels.join('|'),g.cents])),new Map([['A|委外（公募）',8001],['A|Receivable',2000],['B|Trading',9100]]));
  assert.deepEqual((await exportData(db,split.resultId)).rows.map(r=>r.sourceRow),[2,3,4,5]);
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
test('full-name misses are dated ledger answers; nearby names, self-issued holdings and ABS customers remain separate',async()=>{
  const store=isolatedStore();
  await initInventory(store.db);
  const target='星帆产业投资有限公司', issuer='星帆新能源有限公司', support='星帆控股有限公司';
  const entries=[
    ['A.IB',120,'中期票据','',target,issuer],
    ['B.IB',30,'ABS','',support,issuer],
  ];
  const snap=await ingestInventory(store,await roleFixture(entries),'样例.xlsx');
  const query=async(field,identityValue,filters={})=>{
    const response=await inventoryHttp(new Request('http://localhost/test',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({field,identityValue,filters,snapshotId:snap.id,group:'code'}),
    }),'manual',async()=>store,[],true);
    assert.equal(response.status,200);
    return response.json();
  };
  const all=await query('overviewSubject',target);
  assert.match(all.clarification,/2026-10-29.*发行人全称.*ABS.*未查到.*星帆产业投资有限公司/);
  assert.equal(all.identity.fullNameMiss,true);
  assert.deepEqual(new Set(all.identity.candidates),new Set([issuer,support]));
  assert.deepEqual(all.identity.hints,[]);
  assert.equal(all.totalCents,undefined);
  assert.equal(all.resume.snapshotId,snap.id);
  const asIssuer=await query('issuer',target);
  assert.deepEqual(asIssuer.identity.candidates,[issuer]);
  assert.doesNotMatch(asIssuer.clarification,/ABS/);
  const exact=await query('overviewSubject',support);
  assert.equal(exact.overview[1].result.totalCents,3000);
  assert.equal((await query('issuer',issuer)).totalCents,15000);
  assert.equal((await query('attribution',target)).totalCents,12000);
  const weak=await query('overviewSubject','星帆');
  assert.equal(weak.identity.fullNameMiss,undefined);
  const unrelated=await query('issuer','青屿产业投资有限公司');
  assert.match(unrelated.clarification,/未查到/);
  assert.equal(unrelated.identity,undefined);
  assert.equal(unrelated.resume.snapshotId,snap.id);
});
test('cross-role inventory counts the union of source rows and preserves two distinct holdings of one code',async()=>{
  const store=isolatedStore();
  await initInventory(store.db);
  const name='珠海蓝澜集团有限公司',other='清川资产有限公司';
  const wb=await roleFixture([
    ['001.IB',100,'中期票据','',name,name],['001.IB',20,'中期票据','',name,name],
    ['002.IB',40,'资产支持证券','',name,name],['003.IB',10,'资产支持证券','',name,other],
    ['004.IB',80,'公司债','',name,other],
  ]);
  const snap=await ingestInventory(store,wb,'角色重叠.xlsx');
  const query={field:'overviewSubject',identityValue:'蓝澜集团',group:'code'};
  const answer=await queryInventory(query,'manual',store,snap,{snapshots:[snap]});
  const [issued,enhanced,union]=answer.overview.map(i=>i.result);
  assert.deepEqual([issued,enhanced,union].map(r=>[r.rowCount,r.securityCount,r.totalCents]),[[3,2,16000],[2,2,5000],[4,3,17000]]);
  assert.match(answer.clarification,/重叠 1 条持仓/);
  const exported=await exportData(store.db,union.resultId);
  assert.deepEqual(exported.rows.map(r=>r.sourceRow),[2,3,4,5]);
  assert.equal((await readInventoryAnswer(store.db,union.resultId)).totalCents,17000);
  const xlsx=await jointExcel(store,'核对两类和重叠持仓',{steps:[{id:'s1',source:'inventory',question:'分别核对',data:answer}]},[],'s1');
  const book=new ExcelJS.Workbook();await book.xlsx.load(xlsx);
  const sheetNames=book.worksheets.map(s=>s.name);
  assert.equal(new Set(sheetNames).size,sheetNames.length);
  assert(sheetNames.every(n=>n.length<=31));
  assert.deepEqual(book.worksheets.filter(s=>s.name.includes('持仓明细')).map(s=>[s.name,s.rowCount-1]),[
    ['1-2 自发债 持仓明细',3],['1-5 增信ABS 持仓明细',2],['1-8 去重合计 持仓明细',4]]);
  const missing=await ingestInventory(store,await roleFixture([['004.IB',80,'公司债','','',name]],false),'缺归属列.xlsx',snap.id);
  const unknown=await queryInventory(query,'manual',store,missing,{snapshots:[missing]});
  assert.equal(unknown.overview.find(i=>i.role==='union'),undefined);
});
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
  const broad=await newInventoryAnswer(store.db,v,{...base,filters:{attribution:'格力集团',marketType:'信用债'}},store.bucket);
  assert.equal(broad.totalCents,2600);
  assert.deepEqual(broad.groups.map(g=>g.name),['中期票据','超短期融资券','短期融资券']);
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

test('confirmed credit products reconcile across SQL, analysis, original rows and saved exports',async()=>{
  const store=isolatedStore();await initInventory(store.db);
  const products=['中期票据','短期融资券','超短融','定向工具','公司债','企业债','Medium-term Notes','Company Bonds','Corporate Bonds','Commercial Paper','PPN',
    '信用债','金融债','Commercial Bank Financial Bonds','Non-Bank Financial Bonds','MBS/ABS','资产支持证券','地方政府债',''];
  const snap=await ingestInventory(store,await roleFixture(products.map((type,i)=>['CODE'+i,1,type,'','','某金融资产管理公司'])),'分类.xlsx');
  const base={date:snap.date,group:'sourceMarketType',metric:'principal'};
  const expected=products.slice(0,11),rows=expected.map((_,i)=>i+2);
  for(const plan of [
    {...base,filters:{marketType:'非金融企业信用债'}},
    {...base,filters:{},analysis:[{op:'filter',field:'marketType',operator:'eq',value:'信用债'},{op:'group',fields:['sourceMarketType']}]},
  ]){
    const result=await newInventoryAnswer(store.db,snap,plan);
    assert.equal(result.totalCents,1100);
    assert.deepEqual(new Set(result.groups.map(g=>g.labels?.[0]??g.name)),new Set(expected));
    assert.deepEqual(await answerSourceRows(store.db,result.resultId,snap.id),rows);
    assert.equal((await answerDetails(store.db,result.resultId)).total,11);
    const saved=await exportData(store.db,result.resultId);
    assert.deepEqual(saved.rows.map(r=>r.marketType),expected);
    assert.match(saved.result.warnings.join(''),/不筛发行人行业/);
  }
  const literal=await newInventoryAnswer(store.db,snap,{...base,filters:{sourceMarketType:'信用债'}});
  assert.equal(literal.totalCents,100);
  const old='before-credit-rule';
  await store.db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind(old,snap.id,JSON.stringify({...base,filters:{marketType:'非金融企业信用债'},typeRules:1}),'old').run();
  assert.equal((await exportData(store.db,old)).result.rowCount,0);
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
