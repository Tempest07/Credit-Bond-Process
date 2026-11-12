import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViewModels} from '../inventory-qa/answer-view-data.js';
import {chooseAnswerView} from '../inventory-qa/answer-views.js';

function snapshot(date, cents) {
  return {resultId:date, snapshot:{date}, plan:{date,group:'none',metric:'principal',filters:{branch:'甲分行'}},
    totalCents:cents,rowCount:1,securityCount:1,groups:[{name:'全部',cents,count:1,securityCount:1}]};
}

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
