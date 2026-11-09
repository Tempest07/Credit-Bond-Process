import test from 'node:test';
import assert from 'node:assert/strict';
import {planJointQuestion} from '../tools/joint-planner.mjs';

const data={apiKey:'test',today:'2026-11-09',selectedDate:'2026-10-30',
  snapshots:['2026-09-24','2026-10-29','2026-10-30','2026-11-05'].map(date=>({date})),
  ledgers:[{year:2026,direction:'buy',asOf:'2026-10-31'},{year:2026,direction:'sell',asOf:'2026-10-31'}]};
const step=(source,question,props)=>({source,question,snapshotDate:null,start:null,end:null,selection:null,...props});
function mock(run){
  let i=0;
  return async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const request=JSON.parse(options.body);assert.equal(request.store,false);
    const decision=run(JSON.parse(request.input),i++);
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision})}]}]});
  };
}
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
