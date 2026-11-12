import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMemberReport,heldMemberReport} from '../tools/inventory-member-analysis.mjs';
import {compareJointSteps,executeJointPlan} from '../tools/joint-execute.mjs';

const group=(name,cents,securityCount=1,count=1)=>({name,cents,securityCount,count});
const result=(date,groups)=>({
  resultId:date,snapshot:{date,filename:date+'.xlsx'},plan:{group:'code',metric:'principal',filters:{}},
  groups,rowCount:groups.reduce((n,g)=>n+g.count,0),totalCents:groups.reduce((n,g)=>n+g.cents,0),
});
const early=result('2026-09-30',[group('A',300),group('B',150),group('D',230),group('E',20)]);
const late=result('2026-11-05',[group('A',100),group('B',200),group('D',270),group('F',31)]);
test('common balances and mover rankings use common records, preserving zero separately from absent membership',()=>{
  const first={...early,groups:[...early.groups,group('Z',0)],rowCount:5};
  const {rows,summary}=buildMemberReport({field:'code',analysisMode:'commonBalances',limit:0},[first,late]);
  assert.equal(rows.length,6);
  assert.equal(rows.find(r=>r.name==='Z').category,'仅前一范围');
  assert.match(summary,/共同债券代码 3 个/);
  const board=buildMemberReport({field:'code',analysisMode:'commonMovers',limit:1},[first,late]);
  assert.deepEqual(board.rows.map(r=>[r.name,r.category,r.change]),[['B','增加',50/1e10],['A','减少',-200/1e10]]);
  assert.match(board.summary,/相差 -0.00000001 亿元/);
});
test('rank overlap ranks by aggregate principal and distinct security count, with deterministic disclosed cutoff ties',()=>{
  const r=result('2026-11-05',[group('A',9,2),group('C',8,3),group('B',1,5),group('D',7,3),group('E',6,3),group('未填写',900,100)]);
  const {rows,note}=buildMemberReport({field:'issuer',analysisMode:'rankOverlap',limit:3},[r]);
  assert.deepEqual(rows.map(x=>[x.name,x.principalRank,x.codeRank]),[['A',1,null],['C',2,2],['D',3,3],['B',null,1]]);
  assert.match(note,/券数榜末位有 3 个成员同值/);
  assert.throws(()=>buildMemberReport({field:'issuer',analysisMode:'rankOverlap',limit:2},[{...r,groupsTruncated:true}]),/完整/);
});
test('two independent rankings and tracking opening leaders distinguish a later entrant from a fall in rank',()=>{
  const spec={field:'issuer',analysisMode:'rankChanges',limit:2};
  const answer=buildMemberReport(spec,[early,late]);
  assert.deepEqual(answer.rows.map(r=>[r.name,r.category,r.firstRank,r.lastRank]),[
    ['A','掉出',1,null],['D','两期在榜',2,1],['B','新进',null,2]]);
  const tracked=buildMemberReport({...spec,analysisMode:'trackedLeaders'},[early,late]);
  assert.deepEqual(tracked.rows.map(r=>[r.name,r.last]),[['A',100/1e10],['D',270/1e10]]);
  const report=heldMemberReport({...late,groups:[...late.groups,group('Z',0,0,0)]},'issuer',5,1);
  assert.match(report.summary,/4 个仍然在账，1 个没有持仓/);
  assert.equal(report.rows[0].name,'D');
});
test('source category composition preserves missing labels and computes signed amounts against the complete branch totals',()=>{
  const other=result('2026-11-05',[group('A',20),group('B',40),group('未填写',60)]);
  const report=buildMemberReport({field:'sourceMarketType',analysisMode:'groupDifferences',limit:0},[late,other]);
  assert.equal(report.rows[0].name,'D');
  assert.equal(report.rows.find(r=>r.name==='未填写').lastShare,50);
  assert.equal(report.rows.find(r=>r.name==='未填写').difference,-60/1e10);
});
test('restricted member reports use full population denominators and new-only members have no growth percentage',()=>{
  const spec={field:'code',limit:0};
  const common=buildMemberReport({...spec,analysisMode:'commonOnly'},[early,late]);
  assert.equal(common.rows.length,3);
  const n=(300+150+230+100+200+270),d=early.totalCents+late.totalCents;
  assert.ok(common.summary.includes((100*n/d).toFixed(6)+'%'));
  const additions=buildMemberReport({...spec,analysisMode:'newOnly'},[early,late]);
  assert.deepEqual(additions.rows.map(r=>[r.name,r.first,r.last,r.growth]),[['F',0,31/1e10,'不适用（期初为零）']]);
  const leaders=buildMemberReport({...spec,analysisMode:'leaderShares',limit:2},[early,late]);
  assert.deepEqual(leaders.rows.map(r=>r.amount),[530/1e10,470/1e10,370/1e10]);
  assert.deepEqual(leaders.rows.map(r=>r.denominator),[early.totalCents/1e10,late.totalCents/1e10,late.totalCents/1e10]);
});
test('settlement reconciliation requires an exact settlement-only interval and matching non-date filters',()=>{
  const stock=d=>({source:'inventory',data:{...d,plan:{...d.plan,filters:{account:'AFS'}}}});
  const dateFilter={field:'交易交割日',op:'between',value:['2026-10-01','2026-11-05']};
  const data={plan:{direction:'both',metric:'net',filters:[dateFilter,{field:'会计分类',op:'eq',value:'AFS'}]},
    result:{completeCoverage:true,totals:{netCents:12}},sources:['buy','sell'].map(direction=>({direction,year:2026,asOf:'2026-11-06'}))};
  const run=()=>compareJointSteps([stock(early),stock(late),{source:'trade',data}],'reconcile');
  assert.equal(run().gapCents,late.totalCents-early.totalCents-12);
  data.plan.start='2026-10-01';
  assert.equal(run().gapCents,undefined);
  delete data.plan.start;
  dateFilter.value[0]='2026-10-02';
  assert.equal(run().gapCents,undefined);
});
test('a reference net from a wider scope cannot replace the matching net used for a branch reconciliation',()=>{
  const stock=r=>({source:'inventory',data:{...r,plan:{...r.plan,filters:{branch:'测试分行'}}}});
  const flow=(id,filters,netCents)=>({id,source:'trade',question:id,data:{plan:{direction:'both',metric:'net',
    start:'2026-10-01',end:'2026-11-05',filters},result:{completeCoverage:true,totals:{netCents}},
    sources:['buy','sell'].map(direction=>({direction,year:2026,asOf:'2026-11-10'}))}});
  const broad=flow('全范围',[],172),narrow=flow('同分行',[{field:'联动分行',op:'eq',value:'测试分行'}],14);
  const c=compareJointSteps([stock(early),broad,stock(late),narrow],'reconcile');
  assert.equal(c.flowId,narrow.id);assert.equal(c.netCents,14);assert.equal(c.referenceFlow.netCents,172);
  assert.equal(c.gapCents,late.totalCents-early.totalCents-14);
});
test('a missing valuation cohort and a verified empty cohort give distinct downstream messages',async()=>{
  const date='2026-06-30';
  const spec={metric:'valuationAudit',referenceDate:date};
  const data={spec,rows:[],memberCoverage:{referenceDate:date,complete:false,note:'本日市场资料未上传。'}};
  const steps=[{id:'s1',source:'inventory',question:'这批券后来仍有多少',selection:{from:'previous1',field:'code'}}];
  const ctx={steps,history:[{question:'此前剔除的券',answer:{steps:[{id:'s1',source:'portfolio',question:'此前剔除的券',data}]}}]};
  const run=async()=>(await executeJointPlan({},ctx)).steps[0].data.clarification;
  assert.match(await run(),/市场资料未上传.*无法确定原名单/);
  data.memberCoverage.complete=true;
  assert.match(await run(),/已核实入选 0 只/);
});
test('complete empty inventory for a verified full market code is zero, but a truncated result cannot certify absence',async()=>{
  const frame={id:'v2',date:'2026-11-05'};
  const code='148787.SZ';
  const db={prepare(){return {bind(){return {all:async()=>({results:[]})};}};}};
  const steps=[{id:'s1',source:'trade',question:'按券码找买入前一'},
    {id:'s2',source:'inventory',question:'这些券在账多少',snapshotDate:frame.date,selection:{from:'s1',field:'code',limit:1}}];
  const flowPlan={direction:'buy',metric:'buy',groupBy:['券码'],filters:[]};
  const stock=result(frame.date,[]);
  const deps={queryInventory:async()=>stock,tradePlanner:async()=>({plan:flowPlan}),tradeQuery:async()=>({plan:flowPlan,versions:[],
    totals:{buyCents:30},groupCount:1,groups:[{values:[code],buyCents:30}]})};
  const ctx={steps,snapshots:[frame],ledgers:[{id:'buy',direction:'buy',year:2026,asOf:'2026-10-31'}]};
  assert.deepEqual((await executeJointPlan({db},ctx,deps)).alignment.rows,[{name:code,values:[30,0]}]);
  stock.groupsTruncated=true;
  assert.deepEqual((await executeJointPlan({db},ctx,deps)).alignment.rows,[{name:code,values:[30,null]}]);
});
test('partial reconciliation reports a common known prefix; different ledger cutoffs do not certify the same amount',async()=>{
  const snapshots=[early,late].map((r,i)=>({id:'v'+i,...r.snapshot}));
  const steps=[...snapshots.map((s,i)=>({id:'s'+i,source:'inventory',question:'期间全账余额',snapshotDate:s.date})),
    {id:'s2',source:'trade',question:'同期已入账净买入'}];
  const ledgers=['buy','sell'].map(direction=>({id:direction,direction,year:2026,asOf:'2026-10-31'}));
  const plan={direction:'both',metric:'net',start:'2026-10-01',end:'2026-10-31',groupBy:[],filters:[]};
  const deps={queryInventory:async(_i,_a,_r,s)=>s.id==='v0'?early:late,tradePlanner:async()=>({plan}),
    tradeQuery:async()=>({plan,groups:[],groupCount:0,totals:{netCents:45},versions:ledgers,completeCoverage:true})};
  const ctx={steps,snapshots,ledgers,comparison:'reconcile'};
  const verified=await executeJointPlan({},ctx,deps);
  assert.match(verified.ledgerReport.summary,/2026-11-01 至 2026-11-05/);
  assert.equal(verified.ledgerReport.rows.at(-1).amount,null);
  ledgers[1].asOf='2026-10-28';
  assert.equal((await executeJointPlan({},ctx,deps)).ledgerReport,undefined);
});

