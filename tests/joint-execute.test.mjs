import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {executeJointPlan,compareJointSteps} from '../tools/joint-execute.mjs';
const days=['2026-09-30','2026-10-30'];
const snapshots=days.map((date,i)=>({id:'snap'+i,date}));
const ledgers=['buy','sell'].map(direction=>({id:direction,year:2026,direction,asOf:'2026-10-31'}));
const flowPlan={direction:'both',start:'2026-10-01',end:'2026-10-30',metric:'net',groupBy:['发行人全称'],filters:[]};
const part=(source,id,extra)=>({id,source,question:'本次查询',...extra});
function stockData(date,cents){
  return {snapshot:{date},resultId:'saved',totalCents:cents,plan:{group:'issuer',metric:'principal',filters:{branch:'广州分行'}},
    groups:[{name:'甲公司',cents:90},{name:'乙公司',cents:80},{name:'丙公司',cents:50}]};
}
test('inventory ranking constrains the transaction probe and final computation, including date and exact issuer labels',async()=>{
 const calls=[];
 const dependencies={queryInventory:async(input,action,resources,snapshot,ctx)=>{
   assert.deepEqual(ctx.snapshots,[snapshot]);return stockData(snapshot.date,220);
 },tradePlanner:async({runQuery,boundScope})=>{
   assert.deepEqual(boundScope,{source:'trade',start:'2026-10-15',end:'2026-10-16',members:{field:'发行人全称',count:2,alreadyApplied:true}});
   await runQuery(flowPlan);return {plan:flowPlan};
 },
 tradeQuery:async(res,plan,ids)=>{calls.push({plan,ids});return {plan,versions:ledgers,groups:[{values:['乙公司'],netCents:0}],groupCount:1,totals:{netCents:4},warnings:[]};}};
 const outcome=await executeJointPlan({}, {snapshots,ledgers,steps:[
  part('inventory','s1',{snapshotDate:days[1]}),
  part('trade','s2',{selection:{from:'s1',field:'issuer',indices:[2,1]},start:'2026-10-15',end:'2026-10-16'}),
 ]},dependencies);
 assert.equal(calls.length,2);
 for(const {plan,ids} of calls){
   assert.deepEqual(plan.filters,[{field:'发行人全称',op:'in',value:['乙公司','甲公司']}]);
   assert.deepEqual(ids,['buy','sell']);assert.equal(plan.start,'2026-10-15');assert.equal(plan.end,'2026-10-16');
 }
 assert.deepEqual(outcome.alignment.rows,[{name:'乙公司',values:[80,0]},{name:'甲公司',values:[90,null]}]);
});
test('reverse linkage reads only the source rows belonging to a verified prior trading group',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec("CREATE TABLE inventory_rows(version TEXT,sourceRow INTEGER,issuer TEXT);INSERT INTO inventory_rows VALUES('snap1',4,'乙公司'),('snap1',8,'甲公司'),('snap1',9,'甲公司'),('snap0',1,'甲公司')");
 const db={prepare(sql){return {bind:(...a)=>({all:async()=>({results:sqlite.prepare(sql).all(...a)})})};}};
 const prior=part('trade','s1',{data:{plan:flowPlan,result:{groups:[{values:['甲公司'],netCents:100}],groupCount:1}}});
 let invoked=0;const deps={queryInventory:async(input,action,r,snapshot,{scopeRows,boundScope})=>{
  assert.deepEqual(boundScope,{source:'inventory',snapshotDate:days[1],members:{field:'发行人',count:1,alreadyApplied:true}});
  invoked++;assert.deepEqual(scopeRows,[8,9]);return stockData(snapshot.date,220);
 }};
 const ctx={snapshots,ledgers,history:[{question:'谁净买入最多',answer:{steps:[prior]}}],
   steps:[part('inventory','s1',{snapshotDate:days[1],selection:{from:'previous1',field:'issuer',limit:1}})]};
 await executeJointPlan({db},ctx,deps);
 ctx.steps[0].selection.indices=[2];ctx.steps[0].selection.limit=null;
 const invalid=await executeJointPlan({db},ctx,deps);assert.match(invalid.steps[0].data.clarification,/名次/);assert.equal(invoked,1);
});
test('reconciles actual dates, identical business scope and both cumulative coverage periods before calculating any gap',()=>{
 const first=part('inventory','s1',{data:stockData(days[0],200)});
 const last=part('inventory','s2',{data:stockData(days[1],260)});
 const f=part('trade','s3',{data:{plan:{...flowPlan,filters:[{field:'联动分行',op:'eq',value:'广州分行'}]},sources:ledgers,result:{totals:{netCents:70}}}});
 const compare=()=>compareJointSteps([first,last,f],'reconcile');
 assert.equal(compare().changeCents,60);assert.equal(compare().gapCents,-10);
 f.data.sources=[ledgers[0]];assert.equal(compare().gapCents,undefined);f.data.sources=ledgers;
 f.data.plan.start=days[0];assert.equal(compare().gapCents,undefined);f.data.plan.start='2026-10-01';
 f.data.plan.filters=[];assert.equal(compare().gapCents,undefined);
 f.data.plan.filters=[{field:'联动分行',op:'eq',value:'广州分行'}];f.data.plan.metric='rows';assert.equal(compare().netCents,undefined);
 f.data.plan.metric='net';last.data.plan.metric='securities';assert.equal(compare().changeCents,undefined);
 last.data.plan.metric='principal';last.data.plan.filters={branch:'北京分行'};assert.equal(compare().changeCents,undefined);
});
test('non-monetary inventory rank still supplies a trading cohort without a misleading balance column',async()=>{
  const stock=stockData(days[1],90);
  stock.plan={group:'account',rank:{by:'issuer',limit:1},metric:'securities',filters:{}};
  stock.groups=[{rankName:'乙公司',bucketName:'AFS',cents:90,securityCount:1}];
  const result=await executeJointPlan({}, {snapshots,ledgers,steps:[
    part('inventory','s1',{snapshotDate:days[1]}),part('trade','s2',{selection:{from:'s1',field:'issuer',limit:1}})
  ]},{queryInventory:async()=>stock,tradePlanner:async()=>({plan:flowPlan}),tradeQuery:async(_,plan)=>{
    assert.deepEqual(plan.filters.at(-1).value,['乙公司']);
    return {plan,versions:ledgers,groups:[],totals:{netCents:0},groupCount:0};
  }});
  assert.equal(result.alignment,undefined);
});
