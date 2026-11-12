import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViewModels} from '../inventory-qa/answer-view-data.js';
import {chooseAnswerView} from '../inventory-qa/answer-views.js';

test('explicit currency display uses the unrounded balance and scales its matrix without mutating the answer',()=>{
  const data=snapshot('2026-06-30',540501234321);
  data.summary='名义本金 54.05 亿元';
  const input={question:'会计科目本金是多少？单位为万元。',answer:{steps:[{source:'inventory',data}]}};
  const m=answerViewModels(input)[0];
  assert.equal(m.result.measures[0].unit,'万元');
  assert.ok(Math.abs(m.result.rows[0].principal-540501.234321)<0.000001);
  assert.match(m.answer,/540,501\.2343 万元/);
  assert.match(data.summary,/54\.05 亿元/);
  input.question='超过十万元的持仓有多少？';
  assert.equal(answerViewModels(input)[0].result.measures[0].unit,'亿元');
});

test('complete empty selections preserve the requested dimensions, and absolute trade differences retain direction',()=>{
  const d={...snapshot('2026-01-30',0),groups:[],rowCount:0,securityCount:0,dimensions:['code','name']};
  const empty=answerViewModels(d)[0];
  assert.equal(empty.result.rows.length,0);
  assert.match(empty.answer,/没有匹配持仓/);
  const [a]=answerViewModels({steps:[],arithmetic:{rows:[{label:'买卖差额',unit:'亿元',flowDirection:'净流出',value:3.1,op:'absoluteDifference'}]}});
  assert.match(a.answer,/净流出/);
  assert.match(a.result.measures[0].label,/净流出/);
});

test('structured reports precede ordinary results and keep the source column order',()=>{
  const d=snapshot('2026-01-30',50000000000);
  const report={title:'核对表',summary:'两组',source:'2026-01-30 余额台账',columns:[
    {key:'issuer',label:'发行人',kind:'category'},{key:'share',label:'占比',kind:'number',unit:'%'},
    {key:'scope',label:'范围',kind:'category'}],rows:[{issuer:'甲',share:25,scope:'A'},{issuer:'乙',share:75,scope:'B'}]};
  const result=answerViewModels({steps:[{source:'inventory',data:d}],ledgerReport:report});
  assert.equal(result.length,2);
  assert.equal(result[0].result.defaultTable,true);
  assert.deepEqual(result[0].result.columns.map(c=>c.key),['issuer','share','scope']);
  assert.deepEqual(result[0].result.rows,report.rows);
  assert.equal(result[1].result.rows[0].principal,5);
});

test('ranked holdings expose the selection metric, with comparable differences in their own dataset',()=>{
  const data={...snapshot('2026-04-30',6e10),dimensions:['issuer'],groups:[
    {labels:['甲'],cents:4e10,securityCount:4},{labels:['乙'],cents:2e10,securityCount:3}]};
  data.plan.analysis=[{op:'having',metric:'securityCount',operator:'gte',value:3},{op:'sort',metric:'principalCents',descending:true},{op:'take',limit:2}];
  const steps=[{source:'inventory',data}];
  const models=answerViewModels({steps,arithmetic:{rows:[{label:'甲乙之差',value:2,unit:'亿元',op:'difference',
    inputs:[{value:4,unit:'亿元'},{value:2,unit:'亿元'}]}]}});
  assert.deepEqual(models[0].result.measures.map(m=>m.key),['principal','securities']);
  assert.deepEqual(models[0].result.rows.map(r=>r.securities),[4,3]);
  assert.equal(chooseAnswerView(models[0].result),'ranking');
  assert.equal(models[1].shortTitle,'差额');
  assert.equal(models[1].result.rows.length,1);
});

function snapshot(date, cents) {
  return {resultId:date, snapshot:{date}, plan:{date,group:'none',metric:'principal',filters:{branch:'甲分行'}},
    totalCents:cents,rowCount:1,securityCount:1,groups:[{name:'全部',cents,count:1,securityCount:1}]};
}

test('a ranked subtotal used directly by a share retains its members beside the calculated answer',()=>{
  const d=snapshot('2026-04-30',3e10);
  d.dimensions=['issuer'];
  d.groups=[{labels:['甲'],cents:2e10},{labels:['乙'],cents:1e10}];
  d.plan.analysis=[{op:'sort',metric:'principalCents',descending:true},{op:'take',limit:2}];
  const steps=[{source:'inventory',data:d},{source:'inventory',data:snapshot('2026-04-30',15e10)}];
  const [first,rank]=answerViewModels({steps,arithmetic:{rows:[{label:'占比',value:20,unit:'%',op:'share',
    inputs:[{label:'排名范围',value:3,unit:'亿元'},{label:'全账',value:15,unit:'亿元'}]}]}});
  assert.equal(first.result.rows[0].value,20);
  assert.deepEqual(rank.result.rows,[{d0:'甲',principal:2},{d0:'乙',principal:1}]);
});

test('rating coverage includes the effective, unverified and excluded books on direct and calculated answers',()=>{
  const d={spec:{metric:'impliedRatingShare',start:'2026-04-30'},headline:'有效评级本金中占比0%',notes:[],
    values:[{date:'2026-04-30',covered:200e8,unknown:36e8,excluded:0,coveredShare:0,value:null}],
    columns:['业务日','已覆盖券数','已剔除券数','待核券数'],rows:[['2026-04-30',8,0,3]]};
  const calculated={steps:[{source:'portfolio',data:d}],arithmetic:{rows:[{op:'value',label:'占比',unit:'%',value:0}]}};
  for(const a of [d,calculated]){
    const [m]=answerViewModels(a);
    assert.match(m.ratingCoverage[0],/有效评级 2 亿元（8 只）.*待核 0.36 亿元（3 只）.*已剔除 0 亿元（0 只）/);
  }
});

test('verified group shares retain a composition view when arithmetic also includes a currency total',()=>{
  const data={...snapshot('2026-04-30',4e10),dimensions:['marketType'],measure:{fn:'principalShare'},measureTotal:100,
    groups:[{labels:['甲'],cents:3e10,measureValue:75},{labels:['乙'],cents:1e10,measureValue:25}]};
  data.plan.analysis=[{op:'group',fields:['marketType']},{op:'sort',metric:'principalCents',descending:true}];
  const a={steps:[{source:'inventory',data}],arithmetic:{rows:[
    {op:'value',label:'金额合计',value:4,unit:'亿元'},{op:'share',label:'甲的占比',value:75,unit:'%'}]}};
  const [m,calculations]=answerViewModels(a);
  assert.equal(chooseAnswerView(m.result),'share');
  assert.deepEqual(m.result.measures.map(v=>v.unit),['亿元','%']);
  assert.equal(m.result.whole.value,4);
  assert.equal(calculations.shortTitle,'全部计算');
  data.groups.pop();
  assert.notEqual(chooseAnswerView(answerViewModels(a)[0].result),'share');
});

test('the same inventory result renders on its own, in a saved turn and in a joint answer',()=>{
  const data=snapshot('2026-05-29',13000000000);
  const single=answerViewModels(data);
  assert.equal(chooseAnswerView(single[0].result),'scalar');
  assert.deepEqual(answerViewModels({label:'本金多少',data}),single);
  assert.deepEqual(answerViewModels({question:'多少钱',answer:{steps:[{source:'inventory',data}]}}),single);
  const m=single[0].result.measures[0];
  assert.equal(m.unit,'亿元');
  assert.equal(single[0].result.rows[0][m.key],1.3);
});

test('an account breakdown can use its reconciled total but cannot infer shares from a truncated ranking',()=>{
  const parts=[{name:'AFS',cents:9e9},{name:'Receivable',cents:2e9}];
  const data={...snapshot('2026-05-29',11e9),groupCount:2,groups:parts};
  data.plan.group='account';
  const full=answerViewModels(data)[0].result;
  assert.equal(chooseAnswerView(full),'share');
  assert.equal(full.whole.value,1.1);
  const partial=answerViewModels({...data,groups:[parts[0]],groupsTruncated:true})[0].result;
  assert.equal(partial.whole,undefined);
  assert.notEqual(chooseAnswerView(partial),'share');
});

test('no trades in a covered period means zero and a missing ledger means unknown',()=>{
  const trade={plan:{start:'2026-02-01',end:'2026-02-28',metric:'buy',direction:'buy',filters:[],groupBy:[]},
    result:{totals:{buyCents:0,rows:0,bonds:0},groups:[],completeCoverage:true}};
  const full=answerViewModels(trade)[0].result;
  assert.equal(chooseAnswerView(full),'scalar');
  assert.equal(full.rows[0][full.measures[0].key],0);
  const missing=answerViewModels({...trade,result:{...trade.result,completeCoverage:false}})[0].result;
  assert.equal(chooseAnswerView(missing),'missing');
  assert.equal(missing.rows.length,0);
});

test('weekly charts retain the saved mean and missing observations',()=>{
  const data={spec:{metric:'weeklyMean',start:'2026-01-01',end:'2026-01-31'},
    headline:'三周观察中有两周可用，均值为 1.505 亿元。',rows:[
      ['周一','2026-01-09','1.00'],['2026-01-12 至 2026-01-18','缺台账','—'],['周三','2026-01-23','2.01']
    ]};
  const [model]=answerViewModels({steps:[{source:'portfolio',data}]});
  assert.match(model.answer,/1\.505/);
  assert.equal(chooseAnswerView(model.result),'trend');
  const key=model.result.measures[0].key;
  assert.deepEqual(model.result.rows.map(row=>row[key]),[1,null,2.01]);
  assert.equal(model.result.coverage,'partial');
});
