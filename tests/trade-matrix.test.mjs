import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTradeMatrix,tradeMatrix} from '../tools/trade-matrix.mjs';
const s=(label,year,amounts)=>({label,start:year+'-07-01',end:year+'-08-31',sources:['累计表'],notes:[],
  cells:amounts.map((buy,i)=>({month:year+'-0'+(7+i),buy})),total:{buy:amounts.reduce((a,b)=>a+b,0)}});
const series=[s('今年','2026',[1e10,4e10]),s('上年','2025',[2e10,2e10])];
test('year-on-year growth uses period sums, while a pivot preserves each series denominator',()=>{
  const spec={metrics:['buy'],layout:'monthsRows',shares:true,compare:'growth'};
  const report=buildTradeMatrix(spec,series);
  assert.deepEqual(report.rows.map(r=>[r.month,r.s0buy,r.s0buyShare,r.growthbuy]),[['7月',1,20,-50],['8月',4,80,100],['期间合计',5,100,25]]);
  const transposed=buildTradeMatrix({...spec,layout:'seriesRows',compare:'none'},series);
  assert.equal(transposed.rows[0].m1buyShare,80);assert.equal(transposed.rows[0].totalbuy,5);
});
test('a covered empty month is zero while a month beyond the annual cutoff stays unknown',async()=>{
  const step={metrics:['buy','sell','net'],layout:'monthsRows',shares:false,compare:'none',direction:'both',
    series:[{label:'全行',start:'2026-09-01',end:'2026-11-30',filters:[]}]};
  const query=async(_,plan)=>({plan,groups:[],versions:[{year:2026,direction:plan.direction,asOf:plan.direction==='buy'?'2026-10-31':'2026-09-30',filename:plan.direction}],warnings:[]});
  const {ledgerReport,flowPlans}=await tradeMatrix({},step,{ledgers:[]},query);
  assert.equal(flowPlans.length,2);
  assert.deepEqual(ledgerReport.rows.map(r=>[r.s0buy,r.s0sell,r.s0net]),[[0,0,0],[0,null,null],[null,null,null],[null,null,null]]);
});
test('a branch abbreviation resolves against actual trading group names before totaling',async()=>{
  const step={metrics:['buy'],layout:'periodRows',shares:false,compare:'none',direction:'buy',
    series:[{label:'北京',start:'2026-07-01',end:'2026-07-31',filters:[{field:'联动分行',op:'eq',value:'北京'}]}]};
  const query=async(_,plan,ids,options)=>{
    if(options?.collectMembers)return {memberNames:['北京分行'],groups:[]};
    assert.equal(plan.filters[0].value,'北京分行');
    return {plan,groups:[{values:['2026-07'],buyCents:15000000000,rows:2}],versions:[{year:2026,direction:'buy',asOf:'2026-10-31',filename:'年表'}]};
  };
  const {ledgerReport}=await tradeMatrix({},step,{ledgers:[]},query);
  assert.equal(ledgerReport.rows[0].totalbuy,1.5);
});
