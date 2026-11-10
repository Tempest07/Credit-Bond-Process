import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {portfolioMetrics} from '../tools/portfolio-metrics.mjs';
import {factsDigest, factsObjectKey} from '../tools/portfolio-facts.mjs';

const dates=['2025-12-31','2026-01-16'];
const snapshots=dates.map((date,i)=>({date,id:'v'+i,filename:date+'.xlsx'}));
const yi=1e10;
function ledger(rows){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE inventory_rows(version TEXT,account TEXT,branch TEXT,code TEXT,name TEXT,cents INTEGER)');
  const insert=sqlite.prepare('INSERT INTO inventory_rows VALUES (?,?,?,?,?,?)');
  for(const [version,account,branch,code,n] of rows)insert.run(version,account,branch,code,code,n*yi);
  return {prepare(sql){return {bind(...args){return {async all(){return {results:sqlite.prepare(sql).all(...args)};}};}};}};
}
const holdings=[
  ['v0','AFS','广州','A',1],['v0','afs','广州','A',2],['v0','AFS','广州','B',1],['v0','AFS','广州','X',9],
  ['v1','AFS','广州','A',1],['v1','AFS','广州','B',3],['v1','AFS','广州','X',7],
  ['v1','AFS','北京','C',2],['v1','公募','广州','C',5],
];
function fact(code,duration,rating,excluded=false){
  return {code,duration,rating,excluded,reason:excluded?'实质展期':'',
    durationSource:excluded?'':'中债',durationBasis:excluded?'':'行权',durationApi:'cdcBondValuation',
    durationField:'val_modified_duration',durationCollectedAt:'2026-01-20',
    ratingRaw:rating,ratingSource:excluded?'':'中债',ratingApi:'cdcBondValuation',ratingCollectedAt:'2026-01-20'};
}
async function setup(){
  const objects=new Map(),marketPins={};
  for(const [i,day] of dates.entries()){
    const rows=[fact('A',i?2:1,'AA'),fact('B',i?4:3,i?'AA2':'AA-'),fact('X',null,'',true)];
    const bytes=new TextEncoder().encode(JSON.stringify({version:1,asOf:day,rows:rows.map(r=>({...r,asOf:day}))}));
    const digest=await factsDigest(bytes);
    objects.set(factsObjectKey(day,digest),bytes);marketPins[day]=digest;
  }
  return {resources:{db:ledger(holdings),bucket:{async get(k){return objects.has(k)?new Response(objects.get(k)):null;}}},
    spec:{start:dates[0],end:dates[1],account:'OCI',branch:'广州',marketPins}};
}
test('portfolio duration joins locked dated facts to current principals and excludes historical credit events',async()=>{
  const {resources,spec}=await setup();
  const out=await portfolioMetrics(resources,{...spec,metric:'modifiedDuration'},snapshots,{details:true});
  assert.match(out.headline,/1\.5000年.*3\.5000年.*拉长 2\.0000 年/);
  assert.deepEqual(out.rows.map(r=>r.slice(2,6)),[['4.00',2,'9.00',1],['4.00',2,'7.00',1]]);
  assert.equal(out.detailSheets[0].rows.length,6);
  assert.equal(out.detailSheets[0].rows[0][3],300000000);
  assert.equal(out.detailSheets[0].rows[0].length,out.detailSheets[0].headers.length);
});
test('threshold is inclusive, independently normalized, and does not pool the two dates',async()=>{
  const {resources,spec}=await setup();
  const out=await portfolioMetrics(resources,{...spec,metric:'impliedRatingShare',threshold:'AA（2）'},snapshots);
  assert.match(out.headline,/25\.00%.*75\.00%.*上升 50\.00 个百分点/);
  assert.equal(out.detailSheets,undefined);
  assert.deepEqual(out.rows.map(r=>r.slice(2,4)),[['1.00',1],['3.00',1]]);
  const one=await portfolioMetrics(resources,{...spec,start:dates[1],metric:'impliedRatingShare',threshold:'AA-'},snapshots,{details:true});
  assert.match(one.headline,/为 0\.00%/);
  assert.equal(one.detailSheets[0].rows[0].length,one.detailSheets[0].headers.length);
});
test('unknown eligibility or missing source date never yields a complete portfolio change',async()=>{
  const {resources,spec}=await setup();
  const out=await portfolioMetrics(resources,{...spec,branch:null,metric:'modifiedDuration'},snapshots,{details:true});
  assert.match(out.headline,/无法/);
  assert.deepEqual(out.rows[1].slice(-2),['2.00',1]);
  const noData=await portfolioMetrics(resources,{...spec,metric:'modifiedDuration',start:dates[1],marketPins:{}},snapshots);
  assert.equal(noData.rows[0][1],'—');
  await assert.rejects(()=>portfolioMetrics(resources,{...spec,metric:'modifiedDuration',start:'2025-12-30'},snapshots),/缺少/);
  await assert.rejects(()=>portfolioMetrics(resources,{...spec,metric:'impliedRatingShare',threshold:'市场评级'},snapshots),/门槛/);
});
test('weekly mean picks each last available snapshot before cutoff, crosses year boundary and skips empty weeks',async()=>{
  const all=[['2025-12-30',8],['2025-12-31',7],['2026-01-01',9],['2026-01-02',0],['2026-01-16',3],['2026-01-19',6],['2026-01-21',20]]
    .map(([date,n])=>({id:date,date,filename:date+'.xlsx',totalCents:n*yi})).reverse();
  const spec={metric:'weeklyMean',start:'2025-12-31',end:'2026-01-20'};
  const out=await portfolioMetrics({},spec,all,{details:true});
  assert.match(out.headline,/3\.00 亿元（3 个/);
  assert.deepEqual(out.rows.map(r=>r[1]),['2026-01-02','缺台账','2026-01-16','2026-01-19']);
  assert.equal(out.detailSheets[0].rows[1][3],'');
  const db=ledger([['2026-01-02','公募','广州','A',1],['2026-01-16','委外(公募)','广州','A',5],['2026-01-19','AFS','广州','A',9]]);
  const split=await portfolioMetrics({db},{...spec,account:'委外（公募）',branch:'广州'},all);
  assert.match(split.headline,/2\.00 亿元/);
});
