import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMemberReport} from '../tools/inventory-member-analysis.mjs';
import {executeJointPlan} from '../tools/joint-execute.mjs';

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

