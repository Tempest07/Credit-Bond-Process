import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMeasures,evaluateOperations} from '../tools/joint-arithmetic.mjs';
import {jointExcel} from '../tools/joint-export.mjs';
import ExcelJS from 'exceljs';

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
