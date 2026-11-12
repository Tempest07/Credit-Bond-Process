import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {ingestTradeLedger,runTradeQuery,listTradeLedgers,loadTradeLedgers,exportTradeQuery} from '../tools/trade-store.mjs';
import {parseTradeWorkbook} from '../tools/trade-workbook.mjs';
import {executeJointPlan} from '../tools/joint-execute.mjs';
import {jointExcel} from '../tools/joint-export.mjs';
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
test('minimum group rows narrows complete groups before average ranking; exports distinguish the entire source from qualifying groups',async()=>{
 const r=isolated(),w=new ExcelJS.Workbook();await w.xlsx.load(await sample('buy'));
 w.worksheets[0].getCell('G4').value=999;
 await ingestTradeLedger(r,new Uint8Array(await w.xlsx.writeBuffer()),buy);
 const p={...plan,direction:'buy',metric:'average',minGroupRows:2};
 const hit=await runTradeQuery(r,p);
 assert.equal(hit.groupCount,1);assert.equal(hit.totals.rows,3);
 assert.deepEqual(hit.groups.map(g=>[g.values[0],g.rows,g.buyAverageCents]),[['甲',2,5010]]);
 assert.match(hit.warnings.join(''),/全部 2 组[\s\S]*至少 2 笔/);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportTradeQuery(r,p));
 assert.equal(book.getWorksheet('交易汇总').getCell('A3').value,'甲');assert.equal(book.getWorksheet('交易汇总').rowCount,3);
 assert.equal(book.getWorksheet('交易明细').rowCount,4);
 assert.equal((await runTradeQuery(r,{...p,minGroupRows:3})).groupCount,0);
});
test('complete covered calendar periods contain both transaction sides for a security with zero trades; incomplete book cannot establish zeros',async()=>{
 const r=isolated();await ingestTradeLedger(r,await sample('buy'),buy);
 const p={...plan,end:'2024-03-31',metric:'rows',limit:null,groupBy:['交易月份','增减方向'],filters:[{field:'券码',op:'eq',value:'000001.SZ'}]};
 await assert.rejects(runTradeQuery(r,p),/不完整/);
 await ingestTradeLedger(r,await sample('sell'),sell);
 const hit=await runTradeQuery(r,p);assert.equal(hit.totals.rows,0);
 assert.deepEqual(hit.groups.map(g=>g.values.join('/')).sort(),['01','02','03'].flatMap(m=>['增持','减持'].map(d=>'2024-'+m+'/'+d)).sort());
 assert.ok(hit.groups.every(g=>g.rows===0));assert.match(hit.warnings.join(''),/两个券码列均已检查/);
});
test('net contribution by category reconciles all positive and negative groups including unnamed rows',async()=>{
 const r=isolated();await ingestTradeLedger(r,await sample('buy'),buy);
 const edit=new ExcelJS.Workbook();await edit.xlsx.load(await sample('sell'));
 edit.worksheets[0].getCell('J3').value=null;
 await ingestTradeLedger(r,new Uint8Array(await edit.xlsx.writeBuffer()),sell);
 const full=await runTradeQuery(r,{...plan,groupBy:['联动分行'],limit:null});
 assert.deepEqual(full.highlights.map(h=>h.value),[12520,-10000,2520,-10000]);
 const cut=await runTradeQuery(r,{...plan,groupBy:['联动分行'],limit:1});
 assert.equal(cut.highlights.some(h=>h.label.includes('合计贡献')),false);
 const rows=edit.worksheets[0];rows.getCell('A2').value='2024-01-02';rows.getCell('J2').value='深圳';
 await ingestTradeLedger(r,new Uint8Array(await edit.xlsx.writeBuffer()),sell);
 const named=await runTradeQuery(r,{...plan,groupBy:['联动分行'],limit:null});
 assert.deepEqual(named.highlights.at(-1),{label:'具名联动分行中净卖出最多 · 深圳',value:-3000,unit:'分'});
});
test('account aliases keep the full-share denominator and label the direction of ungrouped net principal',async()=>{
 const r=isolated();
 await ingestTradeLedger(r,await sample('buy'),buy);
 await ingestTradeLedger(r,await sample('sell'),sell);
 const share=await runTradeQuery(r,{...plan,metric:'gross',groupBy:['会计分类'],share:'matched',showGroups:['AC（Receivable）'],limit:null});
 assert.deepEqual(share.groups.map(g=>g.values),[['Receivable']]);
 assert.equal(share.groups[0].share,10000/22520);
 const net=await runTradeQuery(r,{...plan,groupBy:[],filters:[{field:'会计分类',op:'eq',value:'AC/Receivable'}]});
 assert.equal(net.totals.netCents,-10000);
 assert.deepEqual(net.highlights,[{label:'按交易本金净流出（净减持）',value:10000,unit:'分'}]);
});
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
test('retain selected issuers without trades, intersect same-field predicates and export zeros without synthetic detail rows',async()=>{
 const r=isolated();await ingestTradeLedger(r,await sample('buy'),buy);
 const p={...plan,direction:'buy',metric:'buy',limit:null,filters:[{field:'发行人全称',op:'in',value:['甲','丙','丁']},{field:'发行人全称',op:'in',value:['甲','丙']},{field:'联动分行',op:'eq',value:'广州'},{field:'台账类别',op:'eq',value:'信用债'}]};
 const hit=await runTradeQuery(r,p);
 assert.deepEqual(hit.groups.map(g=>[g.values[0],g.buyCents,g.rows]),[['甲',10020,2],['丙',0,0]]);
 assert.equal(hit.totals.rows,2);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportTradeQuery(r,p));
 assert.equal(book.getWorksheet('交易明细').rowCount,3);assert.equal(book.getWorksheet('交易汇总').getCell('A4').value,'丙');
 assert.equal(book.getWorksheet('交易汇总').getCell('B4').value,0);
 await assert.rejects(runTradeQuery(r,{...p,filters:[{field:'台账类别',op:'eq',value:'利率债'}]}),/不覆盖/);
});
test('compute month extremes and changes from complete pinned calendar periods, including zero months',async()=>{
 const r=isolated();await ingestTradeLedger(r,await sample('buy'),buy);await ingestTradeLedger(r,await sample('sell'),sell);
 const p={...plan,limit:null,groupBy:['交易月份'],end:'2024-02-29'};
 const hit=await runTradeQuery(r,p);
 assert.deepEqual(hit.groups.map(g=>[g.values[0],g.netCents]),[['2024-01',2520],['2024-02',0]]);
 assert.deepEqual(hit.highlights,[
   {label:'2024-02 比 2024-01 减少',value:2520,unit:'分'},
   {label:'净增持最高 · 2024-01',value:2520,unit:'分'},
   {label:'净增持最低 · 2024-02',value:0,unit:'分'},
 ]);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportTradeQuery(r,p));
 assert.equal(book.getWorksheet('期间比较').getCell('B2').value,25.2);
 assert.equal(book.getWorksheet('期间比较').getCell('C2').value,'元');
 const missing=await runTradeQuery(r,{...p,direction:'buy',metric:'buy',end:'2025-03-31'});
 assert.match(missing.warnings.join(''),/尚未导入/);assert.deepEqual(missing.highlights,[]);
 assert.deepEqual(missing.groups.map(g=>g.values[0]),['2024-01']);
});
test('seasonal filters, blank exclusions and actual settlement bounds survive Excel and avoid false zero classifications',async()=>{
 const r=isolated(),w=new ExcelJS.Workbook(),sheet=w.addWorksheet('流水');
 sheet.addRow(['交易日期','交易交割日','合同号','发行人全称','债券代码','债券简称','名义本金','买入收益率','数据业务日期','联动分行','会计分类']);
 for(const [i,[day,settle,branch,account,size]] of [
   ['2024-03-29','2024-04-02','广州分行','公募',100],
   ['2024-03-30',null,'','公募',130],
   ['2024-08-01','2024-08-01','广州分行','AFS',150],
 ].entries())sheet.addRow([day,settle,String(i),'甲','123.IB','测',size,0.03,'2024-12-31',branch,account]);
 await ingestTradeLedger(r,new Uint8Array(await w.xlsx.writeBuffer()),buy);
 const qp={...plan,direction:'buy',metric:'buy',limit:null,groupBy:['交易月份'],filters:[{field:'交易季度',op:'eq',value:'Q1'}]};
 const all=await runTradeQuery(r,qp);
 assert.equal(all.totals.buyCents,23000);assert.deepEqual(all.groups.map(g=>g.values[0]).sort(),['2024-01','2024-02','2024-03']);
 const clean=await runTradeQuery(r,{...qp,filters:[...qp.filters,{field:'联动分行',op:'notEmpty',value:''}]});
 assert.equal(clean.totals.buyCents,10000);
 const p={...qp,metric:'dateRange',groupBy:[]},h=await runTradeQuery(r,p);
 assert.deepEqual(h.groups[0].values,['2024','增持']);assert.deepEqual(h.groups[0].dates,{
   firstTrade:'2024-03-29',lastTrade:'2024-03-30',firstSettlement:'2024-04-02',lastSettlement:'2024-04-02',missingSettlement:1});
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportTradeQuery(r,p));
 const summary=book.getWorksheet('交易汇总'),headers=summary.getRow(1).values;
 assert.equal(summary.getCell(3,headers.indexOf('最后交割日')).value,'2024-04-02');
 await assert.rejects(runTradeQuery(r,{...qp,filters:[{field:'会计分类',op:'eq',value:'公某'}]}),/已见取值包括/);
});
test('cross-column code lookup keeps exchange suffix, rejects ambiguity and verifies genuinely empty scopes',async()=>{
 const r=isolated(),w=new ExcelJS.Workbook(),sheet=w.addWorksheet('流水');
 sheet.addRow(['交易日期','交易交割日','合同号','发行人全称','债券代码','债券标准代码','债券简称','名义本金','买入收益率','数据业务日期']);
 for(const [i,[code,standard,amount]] of [['12345.IB','12345',100],['12345.SH','12345',80],['内部99','00666.SZ',90],['99999','99999',10]].entries())
   sheet.addRow(['2024-03-29','2024-04-01',String(i),'甲',code,standard,'测',amount,0.03,'2024-12-31']);
 await ingestTradeLedger(r,new Uint8Array(await w.xlsx.writeBuffer()),buy);
 const search=(value,field='券码')=>runTradeQuery(r,{...plan,direction:'buy',metric:'buy',groupBy:[],filters:[{field,op:'eq',value}]});
 assert.equal((await search('12345.IB')).totals.buyCents,10000);
 assert.equal((await search('00666.sz')).totals.buyCents,9000);
 const zero=await search('12345.SZ');assert.equal(zero.totals.rows,0);assert.match(zero.warnings.join(''),/两个券码列均已检查/);
 await assert.rejects(search('12345'),/多个市场代码/);await assert.rejects(search('99999.SZ'),/无法核实/);
 assert.equal((await search('12345.IB','债券标准代码')).totals.rows,0);
 const grouped=(values,extra=[])=>runTradeQuery(r,{...plan,direction:'buy',metric:'buy',limit:null,groupBy:['券码'],filters:[{field:'券码',op:'in',value:values},...extra]});
 const members=['00666','00666.SZ','12345.IB','00001.SH'];
 const named=await grouped(members);
 assert.deepEqual(named.groups.map(g=>[g.values[0],g.rows]),[['12345.IB',1],['00666.SZ',1],['00001.SH',0]]);
 const none=await grouped(members,[{field:'发行人全称',op:'eq',value:'无成交主体'}]);
 assert.deepEqual(none.groups.map(g=>[g.values[0],g.rows]),[['00001.SH',0],['00666.SZ',0],['12345.IB',0]]);
 await assert.rejects(grouped(['12345','00666']),/多个市场代码/);
});
test('mean pools actual rows across directions, group display leaves the ratio denominator intact and exports both',async()=>{
 const r=isolated();await ingestTradeLedger(r,await sample('buy'),buy);await ingestTradeLedger(r,await sample('sell'),sell);
 const avg={...plan,metric:'average',limit:null,groupBy:[]};
 const h=await runTradeQuery(r,avg),t=h.totals;
 assert.deepEqual([t.buyRows,t.sellRows,t.bonds,t.rows],[3,1,2,4]);
 assert.equal(t.averageCents,22520/4);assert.equal(t.buyAverageCents,12520/3);assert.equal(t.sellAverageCents,10000);
 const share={...plan,direction:'buy',metric:'buy',groupBy:['发行人全称'],limit:null,share:'matched',showGroups:['乙']};
 const sh=await runTradeQuery(r,share);assert.equal(sh.totals.buyCents,12520);assert.deepEqual(sh.groups.map(g=>g.values),[['乙']]);assert.equal(sh.groups[0].share,2500/12520);
 const zero=await runTradeQuery(r,{...avg,direction:'buy',filters:[{field:'发行人全称',op:'eq',value:'无'}]});assert.equal(zero.totals.averageCents,null);
 for(const [p,label,number] of [[avg,'全部匹配交易每笔平均本金（元）',225.20/4],[share,'占全部匹配交易的比重（比例）',2500/12520]]){
   const wb=new ExcelJS.Workbook();await wb.xlsx.load(await exportTradeQuery(r,p));const ws=wb.getWorksheet('交易汇总');
   assert.equal(ws.getCell(p===avg?2:3,ws.getRow(1).values.indexOf(label)).value,number);
 }
});

test('member comparison and export use every observed issuer beyond the first hundred groups',async()=>{
 const r=isolated();
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await sample('buy'));
 for(let i=0;i<103;i++)workbook.worksheets[0].addRow(['2024-01-03','2024-01-03',String(i),'新发行人'+i,'900.IB','测试',1,0.04,'2024-12-31','广州','公募','一级']);
 workbook.worksheets[0].addRow(['2024-01-03','2024-01-03','0','','900.IB','测试',1,0.04,'2024-12-31','广州','公募','一级']);
 await ingestTradeLedger(r,new Uint8Array(await workbook.xlsx.writeBuffer()),buy);
 await ingestTradeLedger(r,await sample('sell'),sell);
 const ledgers=await listTradeLedgers(r.db);
 const steps=['buy','sell'].map((direction,i)=>({id:'s'+(i+1),source:'trade',operation:'collectMembers',field:'issuer',
  question:direction==='buy'?'买过':'卖过',direction,start:'2024-01-01',end:'2024-12-31',filters:[]}));
 const query=steps=>executeJointPlan(r,{comparison:'memberSets',ledgers,steps});
 const answer=await query(steps),sets=answer.memberSets;
 assert.equal(answer.steps[0].data.result.groups.length,100);
 assert.deepEqual(sets.both,['甲']);assert.equal(sets.leftOnly.length,104);assert.deepEqual(sets.rightOnly,[]);assert.equal(sets.total,105);
 const out=new ExcelJS.Workbook();await out.xlsx.load(await jointExcel(r,'买卖的发行人重合吗',answer,ledgers.map(l=>l.id)));
 assert.equal(out.getWorksheet('完整名单').rowCount,106);
 const follow=await executeJointPlan(r,{ledgers,history:[{answer}],steps:[{id:'s1',source:'trade',question:'只买这批的交易',start:'2024-01-01',end:'2024-12-31',
   selection:{from:'previousLeftOnly',field:'issuer',limit:null}}]},
   {tradePlanner:async()=>({plan:{direction:'buy',metric:'buy',groupBy:[],filters:[]}})});
 assert.equal(follow.steps[0].data.result.totals.rows,104);
 const scoped=follow.steps[0].data.plan;
 await assert.rejects(runTradeQuery(r,scoped),/筛选值或操作无效/);
 const secondBook=new ExcelJS.Workbook();
 await secondBook.xlsx.load(await jointExcel(r,'这些交易',follow,ledgers.map(l=>l.id),'s1'));
 assert.equal(secondBook.worksheets.find(w=>w.name.endsWith('交易明细')).rowCount,105);
 const incomplete=await query(steps.map(step=>({...step,end:'2025-01-15'})));
 assert.match(incomplete.memberSets.note,/未能核全/);assert.equal(incomplete.memberSets.total,undefined);
});

test('partial annual ledgers cover an earlier settlement month including trades registered in a different month or year',async()=>{
 const r=isolated();
 for(const side of ['buy','sell'])await ingestTradeLedger(r,await sample(side,0,'2024-10-31'),(side==='buy'?buy:sell).replace('2412','2410'));
 const byMonth=month=>({...plan,start:null,end:null,filters:[{field:'交易交割日',op:'contains',value:month}],groupBy:[]});
 const january=await runTradeQuery(r,byMonth('2024-01'));assert.equal(january.completeCoverage,true);
 assert.equal(january.totals.sellCents,13000);assert.match(january.warnings.join(''),/按已入账流水的交易交割日/);
 const november=await runTradeQuery(r,byMonth('2024-11'));assert.equal(november.completeCoverage,false);
 assert.match(november.warnings.join(''),/仅覆盖至/);
 for(const [p,unconfirmed,rows] of [
   [byMonth('2024-11'),true,0], // Entire settlement month after the uploaded cutoff.
   [byMonth('2024-02'),false,0], // Covered month with no settlement.
   [{...byMonth(''),filters:[{field:'交易交割日',op:'between',value:['2024-01-01','2024-11-30']}]},false,5]
 ]){
   const x=new ExcelJS.Workbook();await x.xlsx.load(await exportTradeQuery(r,p));
   const sheet=x.getWorksheet('交易汇总');
   const count=sheet.getRow(1).values.indexOf('交易笔数');
   assert.match(sheet.getCell('A2').value,unconfirmed?/覆盖不足/:/全部匹配/);
   if(unconfirmed)assert.ok([null,''].includes(sheet.getCell(2,count).value));else assert.equal(sheet.getCell(2,count).value,rows);
 }
 const enumerated=await runTradeQuery(r,{...byMonth('2024-01'),filters:[{field:'交易交割日',op:'in',value:['2024-01-02','2024-01-03']}]});
 assert.equal(enumerated.completeCoverage,true);assert.deepEqual(enumerated.totals,january.totals);
 const bySettlement={...byMonth('2024-01'),filters:[{field:'交易交割日',op:'between',value:['2024-01-02','2024-01-03']}]};
 const bounded=await runTradeQuery(r,bySettlement);
 assert.deepEqual(bounded.totals,january.totals);
 assert.equal(bounded.totals.sellCents,13000);
 assert.deepEqual((await runTradeQuery(r,{...bySettlement,start:'2024-01-02',end:'2024-01-03'})).totals.sellCents,10000);
 const single=await runTradeQuery(r,{...bySettlement,filters:[{field:'交易交割日',op:'between',value:['2024-01-03','2024-01-03']}]});
 assert.equal(single.totals.buyCents,12520);assert.equal(single.totals.sellCents,0);
 await assert.rejects(runTradeQuery(r,{...bySettlement,filters:[{field:'交易交割日',op:'between',value:['2024-02-31','2024-03-01']}]}),/无效/);
});

test('rank subtotal sums the selected additive groups for both UI and XLSX and does not sum distinct bonds or averages',async()=>{
 const r=isolated();for(const side of ['buy','sell'])await ingestTradeLedger(r,await sample(side),side==='buy'?buy:sell);
 const ranked={...plan,metric:'gross',groupBy:['发行人全称','增减方向'],limit:2};
 const cash=await runTradeQuery(r,ranked);assert.deepEqual(cash.highlights,[{label:'已列 2 组双边成交本金合计',value:20020,unit:'分'}]);
 const byRows=await runTradeQuery(r,{...ranked,metric:'rows'});assert.equal(byRows.highlights[0].value,3);
 for(const metric of ['bonds','average'])assert.deepEqual((await runTradeQuery(r,{...ranked,metric})).highlights,[]);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportTradeQuery(r,ranked));assert.equal(book.getWorksheet('期间比较').getCell('B2').value,200.2);
});

test('side-by-side counts retain both directions of the same pinned member list, including zero-trade issuers',async()=>{
 const r=isolated();for(const side of ['buy','sell'])await ingestTradeLedger(r,await sample(side),side==='buy'?buy:sell);
 const hit=await runTradeQuery(r,{...plan,metric:'rows',groupBy:['发行人全称','增减方向'],limit:null,filters:[{field:'发行人全称',op:'in',value:['乙','丙']}]});
 assert.deepEqual(hit.groups.map(g=>[g.values.join('/'),g.rows]).sort(),[['乙/增持',1],['乙/减持',0],['丙/增持',0],['丙/减持',0]].sort());
});

test('a fixed issuer and calendar month group retains known zero months on either grouping axis, only with complete coverage',async()=>{
 const r=isolated();await ingestTradeLedger(r,await sample('buy',0,'2024-10-31'),buy.replace('2412','2410'));
 const p={direction:'buy',metric:'buy',start:'2024-09-01',end:'2024-10-31',filters:[{field:'发行人全称',op:'eq',value:'已核发行人'}]};
 for(const groupBy of [['交易月份','发行人全称'],['发行人全称','交易月份']]){
   const result=await runTradeQuery(r,{...p,groupBy});
   assert.deepEqual(result.groups.map(g=>g.values[groupBy.indexOf('交易月份')]),['2024-09','2024-10']);
   assert.ok(result.groups.every(g=>g.buyCents===0&&g.values[groupBy.indexOf('发行人全称')]==='已核发行人'));
   assert.deepEqual((await runTradeQuery(r,{...p,groupBy,end:'2024-11-30'})).groups,[]);
   assert.deepEqual((await runTradeQuery(r,{...p,groupBy,filters:[]})).groups,[]);
 }
});
