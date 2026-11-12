import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViewModels} from '../inventory-qa/answer-view-data.js';
import {ordinaryPresentation} from '../inventory-qa/answer-summary.js';

function trade(groups, options={}) {
  const plan={direction:'buy',metric:'buy',start:'2020-04-01',end:'2020-04-30',
    groupBy:['发行人'],limit:2,order:'desc',...options};
  const totals={buyCents:12e10,sellCents:8e10,netCents:4e10,rows:15,bonds:5};
  return {steps:[{source:'trade',data:{plan,result:{groups,totals,groupCount:4,completeCoverage:true},sources:[]}}]};
}
const group=(name,buy,sell=0)=>({values:[name],buyCents:buy*1e10,sellCents:sell*1e10,netCents:(buy-sell)*1e10,rows:2});

test('ranked subtotal includes only the returned members and follows converted currency and precision',()=>{
  const answer=trade([group('甲',4),group('乙',3)]);
  const model=answerViewModels({answer,question:'买入榜和合计，单位为万元，保留三位小数。'})[0];
  assert.equal(model.displayLead.metrics[0].value,70000);
  assert.equal(model.displayLead.metrics[0].unit,'万元');
  assert.equal(model.displayLead.metrics[0].digits,3);
  assert.match(model.displayLead.notes[0],/2 \/ 4/);
  assert.equal(model.result.rows.length,2);
  assert.ok(model.answer.length);
});

test('ranking on a per-trade average keeps the admission threshold visible and never adds averages',()=>{
  const answer=trade([{...group('甲',4),averageCents:2e10},{...group('乙',3),averageCents:1.5e10}],{metric:'average',minGroupRows:2});
  const {metrics,notes}=answerViewModels({answer,question:'逐组均笔的排名及合计'})[0].displayLead;
  assert.deepEqual(metrics,[{label:'甲',value:2,unit:'亿元/笔'}]);
  assert.match(notes[0],/至少 2 笔买入/);
});

test('monthly extrema name the actual net sellers and preserve monthly signed values',()=>{
  const answer=trade([group('2020-01',1,3),group('2020-02',5,1),group('2020-03',2,5)],{
    limit:null,groupBy:['交易月份'],direction:'both',metric:'net',order:'asc'});
  answer.steps[0].data.result.groupCount=3;
  const model=answerViewModels({answer,question:'哪两个月净卖出最多？'})[0];
  assert.deepEqual(model.displayLead.metrics.map(m=>[m.label,m.value]),[['2020-03 净卖出',3],['2020-01 净卖出',2]]);
  assert.equal(model.result.rows.find(r=>r.d0==='2020-03').net,-3);
});

test('weekly means use the saved precision and distinguish a missing week from an observed zero',()=>{
  const data={spec:{metric:'weeklyMean',start:'2020-01-01',end:'2020-01-21'},mean:0.002,
    headline:'完整周观察说明',rows:[['2020-01-01 至 2020-01-05','2020-01-03','0.00'],['2020-01-06 至 2020-01-12','缺台账','—']],notes:[]};
  const m=answerViewModels({question:'每周的情况',answer:{steps:[{source:'portfolio',data}]}})[0];
  assert.equal(m.displayLead.metrics[0].value,0.002);
  assert.match(m.displayLead.notes[0],/1 周计入均值.*缺台账 1 周/u);
  assert.equal(m.result.rows[1].principal,null);
  assert.equal(m.answer,data.headline);
});

test('contributions keep the original datasets and require both exact membership and reconciliation',()=>{
  const measures=['甲','乙'].map((scope,i)=>({key:'s'+i,label:scope+' 在账本金',unit:'亿元'}));
  const original={shortTitle:'期初期末本金',answer:'两期对照',result:{dimensions:[{key:'date',kind:'date'}],
    measures,rows:[{date:'2020-01-01',s0:4,s1:2},{date:'2020-02-01',s0:1,s1:4}],coverage:'complete'}};
  const answer={arithmetic:{rows:[['甲的贡献',-3],['乙的贡献',2],['全账变化',-1]].map(([label,value])=>({label,value,unit:'亿元',op:'difference'}))}};
  const result=ordinaryPresentation([original],answer,'哪个账户的贡献抵消了下降？','');
  assert.equal(result[1],original);
  assert.deepEqual(result[0].result.rows,[{scope:'甲',delta:-3},{scope:'乙',delta:2}]);
  assert.equal(result[0].displayLead.metrics[0].value,-1);
  answer.arithmetic.rows[2].value=0;
  assert.deepEqual(ordinaryPresentation([original],answer,'贡献',''),[original]);
});

test('a scoped share requires nested filters, the same snapshot and agreement with the saved ratio',()=>{
  const date='2020-02-03';
  const balance=(title,filters,total)=>({title:date+' '+title,result:{
    resultId:title,plan:{date,group:'none',metric:'principal',filters},snapshot:{date},totalCents:total*1e10,
    rowCount:2,securityCount:1,groups:[],warnings:[]}});
  const overview=[balance('分支甲',{branch:'甲',account:'A'},1),balance('账户A',{account:'A'},4)];
  const clarification=overview.map(p=>p.title+'：'+p.result.totalCents/1e10+' 亿元。').join('\n')+'\n分支甲占账户A的 25%。';
  const data={overview,clarification};
  const input={question:'分支甲占账户A多少？',answer:{steps:[{source:'inventory',data}]}};
  assert.equal(answerViewModels(input)[0].displayLead.metrics.at(-1).value,25);
  data.clarification=clarification.replace('25%','20%');
  assert.equal(answerViewModels(input)[0].displayLead,undefined);
  data.clarification=clarification;
  overview[1].result.plan.filters.account='B';
  assert.equal(answerViewModels(input)[0].displayLead,undefined);
});

test('no same-day valuation shows unknown duration and keeps the unverified amount in the requested currency',()=>{
  const data={spec:{metric:'modifiedDuration',account:'A',start:'2020-01-01',end:'2020-01-01'},
    headline:'没有锁定已核验的同日逐券市场资料。',values:[{date:'2020-01-01',value:null,covered:0,gross:5e10,unknown:5e10,unknownCount:2}],notes:[]};
  const m=answerViewModels({question:'修正久期和待核本金是多少？金额单位为万元。',answer:{steps:[{source:'portfolio',data}]}})[0];
  assert.equal(m.result.coverage,'missing');
  assert.deepEqual(m.displayLead.metrics,[{label:'修正久期',value:'待核'},{label:'待核本金',value:50000,unit:'万元'}]);
});
