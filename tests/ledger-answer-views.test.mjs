import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViewModels} from '../inventory-qa/answer-view-data.js';
import {chooseAnswerView} from '../inventory-qa/answer-views.js';

test('requested currency bars, composition and a table follow-up use the same saved holdings',()=>{
  const data=snapshot('2020-03-03',3e10);
  data.plan={...data.plan,group:'account',metric:'principal'};
  data.groups=[{name:'甲',cents:2e10,count:5,securityCount:4},{name:'乙',cents:1e10,count:3,securityCount:3}];
  data.rowCount=8;data.groupCount=2;
  const answer={steps:[{source:'inventory',data}]};
  const view=question=>answerViewModels({question,answer})[0].result;
  const bars=view('按科目做横向条形图，本金由高到低。');
  assert.equal(chooseAnswerView(bars),'ranking');
  assert.equal(chooseAnswerView(view('按科目，各占多少？')),'share');
  const table=view('保留刚才的顺序，换成一张表给我，列本金和持仓行数，本金换成万元，保留两位小数。');
  assert.equal(table.defaultTable,true);
  assert.deepEqual(table.measures.map(m=>[m.key,m.unit,m.digits]),[['principal','万元',2],['count','条',undefined]]);
  assert.deepEqual(table.rows.map(r=>[r.principal,r.count]),[[20000,5],[10000,3]]);
});

test('two account lists display verified distinct counts and retain each complete group',()=>{
  const date='2022-07-01';
  const steps=['AFS','Receivable'].map(account=>({source:'inventory',data:{snapshot:{date},plan:{filters:{account}}}}));
  const sets={dimension:'code',field:'券码',labels:['前者','后者'],both:['b'],leftOnly:['a'],rightOnly:[],total:2};
  const views=answerViewModels({steps,memberSets:sets});
  assert.deepEqual(views[0].displayLead.metrics.map(m=>m.value),[2,1,1,2]);
  assert.deepEqual(views.map(m=>m.result.rows.map(r=>r.member)),[['b'],['a'],[]]);
  assert.equal(views.at(-1).result.coverage,'complete');
  assert.equal(answerViewModels({steps,memberSets:{...sets,rightOnly:['b'],total:3}}).length,0);
});

test('a share chart matches named numerators to the full ledger before publishing percentages',()=>{
  const date='2021-09-10', names=['发行人甲','发行人乙'];
  const rows=names.map((name,i)=>({rank:i+1,name,principal:2-i}));
  const ledgerReport={title:'具名发行人本金排名',summary:'按本金排序',rows,source:'原表',
    columns:[{key:'name',kind:'category',label:'发行人'},{key:'principal',kind:'number',label:'本金',unit:'亿元'}]};
  const arithmetic={rows:rows.map(r=>({label:r.name+'占比',op:'share',value:r.principal*10,unit:'%',
    inputs:[{label:'入选成员 / '+r.name+' 的本金',value:r.principal,unit:'亿元'},{label:'全行本金',value:10,unit:'亿元'}]}))};
  const data=snapshot(date,1e11);
  data.plan.filters={};
  const input={question:'两家各占全行本金多少？给我图。',answer:{ledgerReport,arithmetic,steps:[{source:'inventory',data}]}};
  const [chart]=answerViewModels(input);
  assert.equal(chooseAnswerView(chart.result),'ranking');
  assert.deepEqual(chart.result.rows.map(r=>r.share),[20,10]);
  arithmetic.rows[1].inputs[1].value=4;
  assert.equal(answerViewModels(input)[0].shortTitle,'具名发行人本金排名');
});

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

test('the same two dated principal observations present one scoped change across saved answer shapes',()=>{
  const issuer='示例制造股份有限公司';
  const first=snapshot('2024-06-30',23e9),last=snapshot('2024-09-30',81e9);
  for(const d of [first,last])d.plan.filters={issuer};
  const parts=[first,last].map(result=>({title:result.snapshot.date+' 发行人 '+issuer,result}));
  const body={overview:parts,clarification:parts[0].title+'：2.3 亿元。\n'+parts[1].title+'：8.1 亿元。\n'+
    parts[1].title+' 比 '+parts[0].title+' 多 5.8 亿元。'};
  const steps=[first,last].map(data=>({source:'inventory',data}));
  const cmp={kind:'balanceChange',openingCents:first.totalCents,closingCents:last.totalCents,changeCents:58e9};
  for(const answer of [body,{steps:[{source:'inventory',data:body}]},{steps},{steps,comparison:cmp}]){
    const [m]=answerViewModels({question:'看这两期在账本金',answer});
    assert.deepEqual(m.balanceChange,{subject:issuer,metric:'在账本金',delta:5.8,note:''});
    assert.deepEqual(m.result.rows.map(r=>r[m.result.measures[0].key]),[2.3,8.1]);
  }
  const [scaled]=answerViewModels({question:'以万元为单位',answer:body});
  assert.equal(scaled.result.measures[0].unit,'万元');assert.equal(scaled.balanceChange.delta,58000);
  assert.equal(answerViewModels({question:'给我一张对照表',answer:body})[0].balanceChange,undefined);
  assert.equal(answerViewModels({...body,clarification:body.clarification+'\n另有3只券退出。'})[0].balanceChange,undefined);
  assert.equal(answerViewModels({steps,comparison:{...cmp,changeCents:0}})[0].balanceChange,undefined);
  last.plan.filters={issuer:'另一发行人'};
  assert.equal(answerViewModels(body)[0].balanceChange,undefined);
});

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

test('explicit decimal precision uses the original values and preserves them for sorting and evidence',()=>{
  const data=snapshot('2026-04-30',12344900000);
  data.summary='名义本金 1.23 亿元';
  const [m]=answerViewModels({question:'只留小数点后一位。',answer:{steps:[{source:'inventory',data}]}});
  assert.equal(m.result.measures[0].digits,1);
  assert.equal(m.result.rows[0].principal,1.23449);
  assert.match(m.answer,/1\.2 亿元/);
  const [raw]=answerViewModels(data);
  assert.equal(raw.result.measures[0].digits,undefined);
});

test('side-by-side compares value operands with labeled columns while keeping the full calculation available',()=>{
  const amounts={rows:[{label:'买入本金',op:'value',value:2,unit:'亿元'},
    {label:'卖出本金',op:'value',value:1,unit:'亿元'},{label:'差额',op:'difference',value:1,unit:'亿元'}]};
  const models=answerViewModels({question:'金额并排给我',answer:{steps:[],arithmetic:amounts}});
  assert.deepEqual(models[0].result.columns.map(c=>c.label),['买入本金','卖出本金']);
  assert.deepEqual(models[0].result.rows,[{v0:2,v1:1}]);
  assert.equal(models[1].result.rows.length,3);
});
test('a reconciled signed flow breakdown survives an optional ratio failure and discloses the empty group separately',()=>{
  const amounts=[{name:'甲',net:4},{name:'乙',net:-3},{name:'（未填）',net:-2}];
  const data={plan:{metric:'net',direction:'both',groupBy:['联动分行'],describeNetComposition:true,start:'2026-05-01',end:'2026-05-31'},
    result:{totals:{netCents:-1e10},groupCount:3,completeCoverage:true,groups:amounts.map(r=>({values:[r.name],netCents:r.net*1e10}))}};
  const a={steps:[{source:'trade',data}],arithmetic:{rows:[],missing:'派生项未得到结果'}};
  const [m]=answerViewModels(a);
  assert.equal(chooseAnswerView(m.result),'diverging');
  assert.deepEqual(m.result.netComposition,{key:'net',blankIndex:2});
  assert.deepEqual(m.result.rows.map(r=>r.net),[4,-3,-2]);
  assert.match(m.answer,/负份额.*未填写联动分行净额 -2 亿元/);
  data.result.groupCount=5;assert.equal(answerViewModels(a).length,0);
});
test('signed trade differences preserve the sign in the matrix and use the magnitude after a flow direction',()=>{
  const [m]=answerViewModels({steps:[],arithmetic:{rows:[{label:'买入减卖出',flowDirection:'净流出',value:-3,unit:'亿元',op:'difference'}]}});
  assert.match(m.answer,/净流出 3 亿元/);
  assert.equal(m.result.rows[0].value,-3);
  assert.equal(m.result.measures[0].label,'买入减卖出');
});

test('month matrix plots the dated observations, skips totals, and preserves unknown months as gaps',()=>{
  const report={title:'流水表',summary:'按月核对',source:'增持与减持表',columns:[{key:'month',label:'月份',kind:'category'},
    {key:'a',label:'甲',kind:'number',unit:'亿元'},{key:'b',label:'乙',kind:'number',unit:'亿元'}],rows:[
      {month:'2026-09',a:20,b:-5},{month:'2026-11',a:null,b:0},{month:'期间合计',a:null,b:-5}]};
  const answer={ledgerReport:report,steps:[{source:'trade',data:{flowMatrixSpec:{layout:'monthsRows'}}}]};
  const [plot,table]=answerViewModels({question:'画每月净买入走势',answer});
  assert.equal(chooseAnswerView(plot.result),'trend');
  assert.deepEqual(plot.result.rows,[{month:'2026-09',a:20,b:-5},{month:'2026-10',a:null,b:null},{month:'2026-11',a:null,b:0}]);
  assert.match(plot.result.note,/2026-10、2026-11/);
  assert.equal(table.result.rows.at(-1).month,'期间合计');
  assert.equal(answerViewModels({question:'按月给我核对表',answer})[0].shortTitle,'流水表');
});
test('a requested table footer requires a full reconciliation across all pages',()=>{
  const data={...snapshot('2026-04-30',10e10),groups:[{name:'甲',cents:6e10},{name:'',cents:4e10}]};
  data.plan.group='branch';const show=()=>answerViewModels({question:'按分行拆分，表后给合计。',answer:{steps:[{source:'inventory',data}]}})[0];
  assert.deepEqual(show().result.footer,{measureKey:'principal',value:10});
  assert.equal(show().result.defaultTable,true);
  data.groupsTruncated=true;assert.equal(show().result.footer,undefined);
  data.groupsTruncated=false;data.groups.pop();assert.equal(show().result.footer,undefined);
});
test('a two-snapshot explanation shows only verified endpoint bars with its scope caveat',()=>{
  const early=snapshot('2025-12-31',4e10),late=snapshot('2026-11-05',3e10);
  const overview=[early,late].map(result=>({title:result.snapshot.date+' AFS',result}));
  const saved={steps:[{source:'inventory',data:{overview}}],methodNotes:['仅有两端余额，不能判定开始下降的月份。']};
  const [m]=answerViewModels(saved);
  assert.equal(chooseAnswerView(m.result),'comparison');
  assert.deepEqual(m.result.rows.map(row=>[row.date,row.s0]),[['2025-12-31',4],['2026-11-05',3]]);
  assert.match(m.answer,/不能判定开始下降的月份/);
  assert.equal(m.balanceChange.note,'仅有两端余额，不能判定开始下降的月份。');
  assert.equal(m.balanceChange.delta,-1);
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
