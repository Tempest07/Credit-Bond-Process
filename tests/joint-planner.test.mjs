import test from 'node:test';
import assert from 'node:assert/strict';
import {planJointQuestion} from '../tools/joint-planner.mjs';

const data={apiKey:'test',today:'2026-11-09',selectedDate:'2026-10-30',
  snapshots:['2026-09-24','2026-10-29','2026-10-30','2026-11-05'].map(date=>({date})),
  ledgers:[{year:2026,direction:'buy',asOf:'2026-10-31'},{year:2026,direction:'sell',asOf:'2026-10-31'}]};
const step=(source,question,props)=>({source,question,snapshotDate:null,start:null,end:null,selection:null,...props});
test('a truncated provider reply is retried once before running any ledger query',async()=>{
  let requests=0;
  const valid=mock(()=>({kind:'steps',comparison:'none',steps:[step('inventory','查本金',{})]}));
  const fetchImpl=(...args)=>++requests===1?new Response('{'):valid(...args);
  const result=await planJointQuestion({...data,question:'查本金',fetchImpl});
  assert.equal(requests,2);assert.equal(result.steps.length,1);
});
function mock(run){
  let i=0;
  return async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const request=JSON.parse(options.body);assert.equal(request.store,false);
    const decision=run(JSON.parse(request.input),i++);
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision})}]}]});
  };
}
test('a two-period member cohort and a ranked breakdown retain their real scopes',async()=>{
  const options={...data,question:'比较OCI两期共有的券，核对本金'};
  const slices=['2026-10-29','2026-10-30'].map(date=>({date,filters:[{field:'account',value:'OCI'}]}));
  const member={source:'inventory',operation:'memberAnalysis',analysisMode:'commonMovers',field:'code',question:options.question,slices,limit:3};
  const choose=step=>mock(()=>({kind:'steps',steps:[step],comparison:'none',derive:false}));
  const result=await planJointQuestion({...options,fetchImpl:choose(member)});
  assert.equal(result.steps[0].slices[0].date,slices[0].date);
  assert.equal(result.steps[0].slices[0].filters.account,'AFS');
  const breakdown={source:'inventory',operation:'profile',question:'前三家发行人按分行拆分',snapshotDate:slices[1].date,filters:[],
    profile:{type:'groups',stat:'breakdown',by:'issuer',within:'branch',limit:3}};
  const profile=await planJointQuestion({...options,fetchImpl:choose(breakdown)});
  assert.deepEqual(profile.steps[0].profile,breakdown.profile);
});
test('same question can cross sources using real ranked members and carry into a follow-up',async()=>{
  const question='广州持仓前五大发行人这个月各净增了多少？';
  const result=await planJointQuestion({...data,question,fetchImpl:mock(input=>{
    assert.equal(input.selectedDate,'2026-10-30');assert.deepEqual(input.snapshots.map(d=>d.slice(-2)),['24','29','30','05']);
    return {kind:'steps',comparison:'none',steps:[
      step('inventory','广州分行按持仓本金最大的五家发行人',{}),
      step('trade','广州分行按发行人列出各家十月净买入本金',{start:'2026-10-01',end:'2026-10-31',
        selection:{from:'s1',field:'issuer',limit:5,indices:[]}})]};
  })});
  assert.equal(result.steps[0].snapshotDate,'2026-10-30');
  assert.deepEqual(result.steps[1].selection,{from:'s1',field:'issuer',limit:5});
  const history=[{question,steps:result.steps,holdings:[123456789]}];
  const follow=await planJointQuestion({...data,question:'刚才第二家持仓分券列出来',history,fetchImpl:mock(input=>{
    assert.equal(JSON.stringify(input).includes('123456789'),false);
    assert.equal(input.history[0].steps[0].id,'previous1');
    return {kind:'steps',comparison:'none',steps:[step('inventory','广州分行按券码列出本金',
      {selection:{from:'previous1',field:'issuer',limit:null,indices:[2]}})]};
  })});
  assert.deepEqual(follow.steps[0].selection.indices,[2]);
});

test('a flow follow-up can reuse verified trade operands when balance snapshots do not cover its period',async()=>{
  const follow={...data,question:'那段时间对库存是净流入还是净流出？',history:[{question:'2024年四至六月买卖多少？',
    steps:[{source:'trade',question:'同一期间的买卖',start:'2024-04-01',end:'2024-06-30',
      availableTradeTotals:['buyCents','sellCents','netCents','rows']}]}]};
  let calls=0;
  const result=await planJointQuestion({...follow,fetchImpl:mock(input=>{
    assert.deepEqual(input.history[0].steps[0].availableTradeTotals,['buyCents','sellCents','netCents','rows']);
    return ++calls===1?{kind:'clarification',clarification:'缺少当年的快照'}:
      {kind:'previousCalculation',from:['previous1'],flowVsBalance:true};
  })});
  assert.equal(calls,2);
  assert.deepEqual(result,{previousSteps:[0],derive:true,basisNotes:['flowVsBalance']});
  const invalid=await planJointQuestion({...follow,fetchImpl:mock(()=>({kind:'previousCalculation',from:['previous2'],flowVsBalance:false}))});
  assert.match(invalid.clarification,/上轮/);
});
test('changing the date basis reuses the measured month, while an independent or explicit date request can move it',async()=>{
  const history=[{question:'5月全账的买入卖出额？',steps:[step('trade','5月按交易日确认',{start:'2026-05-01',end:'2026-05-31'})]}];
  const next=q=>({kind:'steps',comparison:'none',steps:[step('trade',q,{})]});
  let calls=0;
  const changed=await planJointQuestion({...data,history,question:'本月改按交割发生日期确认，同样三个数字。',fetchImpl:mock(input=>{
    assert.deepEqual(input.retainedTradeRange,['2026-05-01','2026-05-31']);
    if(calls++)assert.match(input.correction,/2026-05-01/);
    return next(calls===1?'按2026年11月1日至30日交割统计':'按交割发生日期统计同一期买卖额');
  })});
  assert.equal(calls,2);
  assert.equal(changed.steps[0].start,null);
  assert.match(changed.steps[0].question,/2026-05-01 至 2026-05-31/);
  const reverse=[{question:'五月交割数据？',steps:[step('trade','按交割日',{settlementRange:['2026-05-01','2026-05-31']})]}];
  await planJointQuestion({...data,history:reverse,question:'改为按交易日期呢？',fetchImpl:mock(input=>{
    assert.deepEqual(input.retainedTradeRange,['2026-05-01','2026-05-31']);
    return next('按成交日统计');
  })});
  for(const question of ['现在的本月改按交割日期呢？','这个自然月改按交割日','期间改到本月，改按交割日期','改按交割日看六月','今天的交易？','近期各账户净买入？','本月买卖多少？']){
    await planJointQuestion({...data,history,question,fetchImpl:mock(input=>{
      assert.equal(input.retainedTradeRange,undefined,question);
      return next('查询指定期间的买卖');
    })});
  }
});
test('regroup references an executed inventory question and preserves its date, including follow-ups',async()=>{
  const input={...data,question:'这些主体各自的品种分布和合计呢？',
    history:[{question:'上期头部发行人',steps:[step('inventory','上期头部发行人',{snapshotDate:'2026-10-29',groupBy:['issuer']})]}]};
  const next={source:'inventory',operation:'regroup',from:'previous1',question:input.question,dimensions:['issuer','marketType'],metric:'principal'};
  const plan=step=>planJointQuestion({...input,fetchImpl:mock(()=>({kind:'steps',comparison:'none',steps:[step]}))});
  assert.equal((await plan(next)).steps[0].snapshotDate,'2026-10-29');
  assert.match((await plan({...next,from:'s1'})).clarification,/已查到/);
  assert.match((await plan({...next,filters:{issuer:'甲'}})).clarification,/新筛选/);
});
test('balance reconciliation validates real snapshot dates and the exclusive opening boundary',async()=>{
  function plan(start){return {kind:'steps',comparison:'reconcile',steps:[
    step('inventory','期初本金',{snapshotDate:'2026-09-24'}),step('inventory','期末本金',{snapshotDate:'2026-10-30'}),
    step('trade','期间净买入',{start,end:'2026-10-30'})]};}
  const result=await planJointQuestion({...data,question:'余额变化与两次报表之间的净买入差多少',fetchImpl:mock((input,i)=>{
    if(i){assert.match(input.correction,/次日/);return plan('2026-09-25');}return plan('2026-09-24');
  })});
  assert.equal(result.comparison,'reconcile');assert.equal(result.steps[2].start,'2026-09-25');
  const missing=await planJointQuestion({...data,question:'9月30日当日库存',fetchImpl:mock(()=>({
    kind:'steps',comparison:'none',steps:[step('inventory','9/30 快照',{snapshotDate:'2026-09-30'})]}))});
  assert.match(missing.clarification,/快照/);
});
test('rejects forward references and permits single-source questions without the other ledger type',async()=>{
  const bad=await planJointQuestion({...data,question:'这批券还有多少？',fetchImpl:mock(()=>({
    kind:'steps',comparison:'none',steps:[step('inventory','持仓',{selection:{from:'s2',field:'code',limit:null,indices:[]}})]
  }))});
  assert.match(bad.clarification,/实际步骤/);
  const flow=await planJointQuestion({...data,selectedDate:null,snapshots:[],question:'去年买多少？',fetchImpl:mock(input=>{
    assert.equal(input.today,'2026-11-09');
    return {kind:'steps',comparison:'none',steps:[step('trade','2025年买入多少',{start:'2025-01-01',end:'2025-12-31'})]};
  })});
  assert.equal(flow.steps[0].source,'trade');
});

const dated={...data,snapshots:[{date:'2025-12-31'},...data.snapshots],ledgers:[]};
const portfolio=(metric,options={})=>({source:'portfolio',question:'按指定口径查询组合指标',period:'yearToDate',
  spec:{metric,start:null,end:null,account:null,threshold:null,branch:null,...options}});
const decision=steps=>({kind:'steps',comparison:'none',steps});
test('portfolio YTD uses the previous year close for risk and January 1 for period averages',async()=>{
  const plan=await planJointQuestion({...dated,question:'对比本年久期并列出周均持仓规模',fetchImpl:mock(()=>decision([
    portfolio('modifiedDuration',{account:'oci',branch:'北京分行'}),portfolio('weeklyMean'),
  ]))});
  assert.deepEqual(plan.steps[0].spec,{metric:'modifiedDuration',start:'2025-12-31',end:dated.selectedDate,
    account:'AFS',threshold:null,branch:'北京分行'});
  assert.deepEqual(plan.steps[1].spec,{metric:'weeklyMean',start:'2026-01-01',end:dated.selectedDate,
    account:null,threshold:null,branch:null});
  const absent=await planJointQuestion({...data,question:'比较年初至今久期',fetchImpl:mock(()=>decision([portfolio('modifiedDuration')]))});
  assert.match(absent.clarification,/2025-12-31.*快照/);
});
test('portfolio follow-ups receive only the prior parameters; cutoff and threshold can change',async()=>{
  const first=portfolio('impliedRatingShare',{account:'AFS',branch:'北京分行',threshold:'AA(2)',end:'2026-10-29'});
  const history=[{question:'之前小于等于AA(2)的占比',steps:[{...first,spec:{...first.spec,start:'2025-12-31',marketPins:{internal:'secret-object'}}}]}];
  const plan=await planJointQuestion({...dated,selectedDate:null,question:'只看深圳，改到AA−档',history,fetchImpl:mock(input=>{
    assert.equal(input.selectedDate,'2026-10-29');
    assert.equal(input.history[0].steps[0].spec.threshold,'AA(2)');
    assert.equal(JSON.stringify(input).includes('secret-object'),false);
    return decision([portfolio('impliedRatingShare',{account:'AFS',branch:'深圳分行',threshold:'AA−'})]);
  })});
  assert.equal(plan.steps[0].spec.threshold,'AA-');
  assert.equal(plan.steps[0].spec.end,'2026-10-29');
});
test('portfolio validation refuses absent dates, unknown restrictions and reusing a metric as a member list',async()=>{
  const extra=portfolio('weeklyMean',{issuer:'某集团'});
  const invalid=await planJointQuestion({...dated,question:'查某集团每周余额',fetchImpl:mock(()=>decision([extra]))});
  assert.match(invalid.clarification,/组合指标/);
  const missingDate=await planJointQuestion({...dated,question:'12月末久期',fetchImpl:mock(()=>decision([
    {...portfolio('modifiedDuration',{end:'2026-12-31'}),period:'asOf'}]))});
  assert.match(missingDate.clarification,/2026-12-31/);
  const rank=await planJointQuestion({...dated,question:'用之前的名单查快照',fetchImpl:mock(()=>decision([
    portfolio('weeklyMean'),step('inventory','查这些券',{selection:{from:'s1',field:'code',limit:null,indices:[]}})]))});
  assert.match(rank.clarification,/组合指标.*名单/);
});

test('separate dated scopes can be compared for shared issuers without first guessing issuer names',async()=>{
 const result=await planJointQuestion({...data,question:'广州哪些发行人既买过又还持有？',fetchImpl:mock(()=>({
    kind:'memberSets',field:'issuer',
    left:{source:'trade',question:'广州十月买过的发行人',direction:'buy',start:'2026-10-01',end:'2026-10-31',filters:[{field:'联动分行',value:'广州分行'}]},
    right:{source:'inventory',question:'广州现有持仓发行人',snapshotDate:null,filters:[{field:'branch',value:'广州分行'}]},
 }))});
 assert.equal(result.comparison,'memberSets');assert.equal(result.steps[1].snapshotDate,data.selectedDate);
 assert.deepEqual(result.steps[0].filters,[{field:'联动分行',op:'eq',value:'广州分行'}]);
});
