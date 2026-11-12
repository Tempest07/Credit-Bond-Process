import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMeasures,deriveAnswer,evaluateOperations} from '../tools/joint-arithmetic.mjs';
import {jointExcel} from '../tools/joint-export.mjs';
import ExcelJS from 'exceljs';

test('arithmetic labels identify actual tied monthly ranks and retain net-sell signs',()=>{
  const months=[['2026-01',-15],['2026-02',7],['2026-03',-15],['2026-04',-5]];
  const data={plan:{direction:'both',metric:'net',groupBy:['交易月份']},result:{completeCoverage:true,totals:{netCents:-28e10},groupCount:4,
    groups:months.map(([m,n])=>({values:[m],netCents:n*1e10})),highlights:[{label:'净增持最低期间',value:-15e10,unit:'分'}]}};
  const facts=collectMeasures([{source:'trade',question:'逐月净卖出最多的月份',data}]);
  assert.deepEqual(facts.filter(r=>r.label.endsWith('（净卖出金额第1）')).map(r=>r.value),[-15,-15]);
  assert.equal(facts.find(r=>r.label.includes('2026-04')).label,'2026-04 净买入本金（净卖出金额第3）');
  assert.equal(facts.find(r=>r.label==='净增持最低期间').value,-15);
  data.result.groupCount=14;
  assert.equal(collectMeasures([{source:'trade',question:'部分月份',data}]).some(r=>r.label.includes('金额第')),false);
});

test('export keeps the verified flow direction alongside an unsigned difference',async()=>{
  const rows=evaluateOperations([
    {id:'buy',label:'买入',tradeAmount:'buyCents',cohort:'OCI',unit:'亿元',value:3},
    {id:'sell',label:'卖出',tradeAmount:'sellCents',cohort:'OCI',unit:'亿元',value:5},
  ],[{op:'absoluteDifference',args:['buy','sell'],label:'买卖本金相差'}]);
  const answer={steps:[{id:'s1',source:'trade',question:'买卖本金',data:{}}],arithmetic:{rows}};
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await jointExcel({},'相差多少，资金往哪边走？',answer,[]));
  const sheet=workbook.getWorksheet('派生计算');
  assert.equal(sheet.getCell('B2').value,2);
  assert.equal(sheet.getCell('F1').value,'交易净流向');
  assert.equal(sheet.getCell('F2').value,'净流出');
});

test('combine two periods before dividing and distinguish missing from zero',()=>{
  const facts=[['a',8,'亿元'],['b',30,'亿元'],['n',4,'笔'],['m',6,'笔'],['zero',0,'亿元']].map(([id,value,unit])=>({id,label:id,value,unit}));
  const ops=[{op:'sum',args:['a','b'],show:false},{op:'sum',args:['n','m'],show:false},{op:'divide',args:['r1','r2'],show:true}].map(o=>({...o,label:'汇总计算'}));
  assert.equal(evaluateOperations(facts,ops)[0].value,3.8);
  assert.equal(evaluateOperations(facts,[{op:'share',args:['zero','a'],label:'占比'}])[0].value,0);
  assert.equal(evaluateOperations(facts,[{op:'share',args:['a','zero'],label:'占比'}])[0].value,null);
  assert.throws(()=>evaluateOperations(facts,[{op:'share',args:['a','n'],label:'占比'}]),/单位/);
  assert.equal(evaluateOperations(facts,[{op:'absoluteDifference',args:['a','b'],label:'两者相差'}])[0].value,22);
  const meanInWan=evaluateOperations(facts,[{op:'divide',args:['a','n'],show:false},{op:'toWan',args:['r1']}]);
  assert.equal(meanInWan[0].value,20000);assert.equal(meanInWan[0].unit,'万元/笔');
  assert.throws(()=>evaluateOperations(facts,[{op:'divide',args:['n','a']}]),/单位/);
});
test('balance growth uses the opening value, while composition changes use percentage points',()=>{
  const facts=[['openingA',4],['openingB',6],['endingA',5],['endingB',3],['zero',0]]
    .map(([id,value])=>({id,value,unit:'亿元'}));
  const operations=[
    {op:'growth',args:['endingB','openingB']},
    {op:'sum',args:['openingA','openingB'],show:false},
    {op:'sum',args:['endingA','endingB'],show:false},
    {op:'share',args:['endingA','r3'],show:false},
    {op:'share',args:['openingA','r2'],show:false},
    {op:'difference',args:['r4','r5']},
    {op:'growth',args:['endingA','zero']},
  ];
  assert.deepEqual(evaluateOperations(facts,operations).map(r=>[r.value,r.unit]),
    [[-50,'%'],[22.5,'个百分点'],[null,'%']]);
});

test('an incomplete trade period cannot supply a denominator',()=>{
  const step={source:'trade',question:'全年总额',data:{plan:{direction:'buy'},result:{warnings:['2025 年增持累计表尚未导入，缺少的交易不能按 0 计算。'],totals:{buyCents:123}}}};
  assert.deepEqual(collectMeasures([step]),[]);
  step.data.result.completeCoverage=true;
  assert.equal(collectMeasures([step]).some(f=>f.label.endsWith('买入本金')),true);
});

test('a date basis scopes monthly totals and genuine daily breakdown or other incomplete calculations survive',async()=>{
  const step={source:'trade',question:'五月全账户按交割发生日期的净买入',data:{
    plan:{direction:'both',start:null,end:null,groupBy:[],filters:[{field:'交易交割日',op:'between',value:['2026-05-01','2026-05-31']}]},
    result:{completeCoverage:true,totals:{buyCents:8e10,sellCents:2e10,netCents:6e10},groups:[],groupCount:0}}};
  const calculate=(question,request)=>deriveAnswer({question,steps:[step],fetchImpl:async(_,options)=>{
    const input=JSON.parse(JSON.parse(options.body).input);
    assert.deepEqual(input.rendered[0].settlementDateRange,['2026-05-01','2026-05-31']);
    const net=input.facts.find(f=>f[2].endsWith('净买入本金'))[0];
    const reply={operations:[{label:'五月净买入',op:'value',args:[net],show:true}],missing:[
      {kind:'dailyBreakdown',request,detail:'缺少每个交割日的买入卖出本金。'},
      {kind:'calculation',request:'投资收益',detail:'缺少利息和估值等投资收益依据。'}]};
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(reply)}]}]});
  }});
  const aggregate=await calculate('五月按交割发生日期给买、卖、净三个数，再算投资收益。','按交割发生日期');
  assert.equal(aggregate.rows[0].value,6);
  assert.equal(aggregate.missing,'缺少利息和估值等投资收益依据。');
  const daily=await calculate('五月按交割发生日期归期并列出每个交易日净买入，再算投资收益。','每个交易日净买入');
  assert.match(daily.missing,/每个交割日/);
  assert.match(daily.missing,/投资收益/);
  const misquoted=await calculate('五月按交割发生日期逐日给出净额，再算投资收益。','每一交割日的净金额');
  assert.equal(misquoted.rows[0].value,6);
  assert.match(misquoted.missing,/每个交割日/);
  assert.match(misquoted.missing,/投资收益/);
});

test('explicit effective-rating share uses the verified denominator of the requested date and account',()=>{
  const audit=(date,account,amount,gross,covered,threshold='AA-')=>({source:'portfolio',question:'评级名单',data:{
    rows:[],spec:{metric:'valuationAudit',subset:'ratedExact',end:date,account,threshold},auditCents:amount*1e10,
    grossCents:gross*1e10,ratingCoveredCents:covered*1e10}});
  const book=(date,account)=>({source:'inventory',question:'全额在账本金',data:{resultId:'id',snapshot:{date},
    totalCents:32e10,plan:{date,filters:{account}}}});
  const facts=collectMeasures([audit('2026-01-31','AFS',2,10,8),audit('2026-02-28','AFS',4,32,20),
    audit('2026-02-28','Receivable',6,32,30),audit('2026-02-28','AFS',4,32,20,'AA(2)'),book('2026-02-28','AFS')]);
  const n=facts.filter(f=>f.ratingNumerator),d=facts.at(-1);
  const calc=q=>evaluateOperations(facts,[{op:'value',args:[d.id],show:false},
    {op:'sum',args:[n[1].id,n[3].id],show:false},{op:'share',args:['r2','r1']}],q).at(-1);
  assert.equal(calc('两项合计占有效 OCI 本金百分之几？').value,40);
  assert.equal(calc('两项合计占全部在账本金百分之几？').value,25);
  const earlier=evaluateOperations(facts,[{op:'share',args:[n[0].id,d.id]}],'年初档位本金占二月底有效本金多少？');
  assert.equal(earlier[0].value,10);
  const anotherAccount=facts.find(f=>f.bookScope?.includes('Receivable'));
  assert.equal(evaluateOperations(facts,[{op:'divide',args:[n[1].id,anotherAccount.id]}],'以AC有效本金为分母')[0].value,4/30);
});

test('wan is a display unit; arithmetic dependencies and already converted monthly amounts retain scale',()=>{
  const facts=[{id:'a',label:'甲',value:2,unit:'亿元/笔'},{id:'b',label:'乙',value:1.5,unit:'亿元/笔'}];
  const ops=[{op:'value',args:['a']},{op:'toWan',args:['r1']},{op:'absoluteDifference',args:['r1','b']}];
  const out=evaluateOperations(facts,ops,'每笔差多少万元？');
  assert.deepEqual(out.map(r=>[r.value,r.unit]),[[20000,'万元/笔'],[20000,'万元/笔'],[5000,'万元/笔']]);
  assert.equal(evaluateOperations(facts,ops,'期初本金 3 亿元，按万元列金额还是亿元列金额？')[0].value,2);
});

test('net direction is attached only to a verified single-scope buy-minus-sell or net amount',()=>{
  const facts=[{id:'a',tradeAmount:'buyCents',cohort:'A',value:4,unit:'亿元'},
    {id:'b',tradeAmount:'sellCents',cohort:'A',value:10,unit:'亿元'},
    {id:'c',tradeAmount:'netCents',cohort:'A',value:-6,unit:'亿元'},
    {id:'d',tradeAmount:'sellCents',cohort:'B',value:5,unit:'亿元'}];
  const out=evaluateOperations(facts,[{op:'difference',args:['a','b']},{op:'value',args:['c']},
    {op:'absoluteDifference',args:['b','a']},{op:'difference',args:['a','d']},
    {op:'difference',args:['b','a']},{op:'toWan',args:['r3']}]);
  assert.deepEqual(out.map(r=>r.flowDirection),['净流出','净流出','净流出',undefined,'净流出','净流出']);
  assert.deepEqual(out.map(r=>r.value),[-6,-6,6,-1,6,60000]);
});
