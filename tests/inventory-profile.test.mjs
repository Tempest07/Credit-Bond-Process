import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProfile,validateProfile} from '../tools/inventory-profile.mjs';

const snapshot={date:'2026-11-05',filename:'余额表.xlsx'};
const row=(code,issuer,cents,expected,legal)=>({code,name:code,issuer,portfolio:'P',cents,expected,legal});
const records=[row('a','甲',40,'2027-01-01','2030-04-30'),row('a','甲',10,'2027-01-01','2030-04-30'),
  row('b','乙',50,'2028-01-01',''),row('c','',20,'','2027-01-01')];
test('aggregate before applying cutoff and count repeat rows separately from securities',()=>{
  const above=buildProfile({type:'groups',stat:'threshold',by:'issuer',compare:'gte',thresholdYuan:0.5},records,snapshot);
  assert.deepEqual(above.rows.map(r=>[r.name,r.count,r.codes]).sort(),[['乙',1,1],['甲',2,1]].sort());
  const top=buildProfile({type:'groups',stat:'concentration',by:'portfolio',within:'issuer',minMembers:2},records,snapshot);
  assert.equal(top.rows[0].share,100*50/120);assert.deepEqual(top.rows[0].leader.split('、').sort(),['乙','甲'].sort());
});
test('expected date independently selects rows and discloses unknowns, including for an empty result',()=>{
  const spec={type:'dates',stat:'inRange',field:'expected',start:'2027-01-01',end:'2027-12-31'};
  const {rows,note}=buildProfile(spec,records,snapshot);
  assert.deepEqual(rows.map(r=>[r.code,r.other,r.principal]),[['a','2030-04-30',50/1e10]]);
  assert.match(note,/1 条、1 只/);
  const ranked=buildProfile({...spec,rankIssuers:3},[...records,row('d','甲',50,'2029-01-01','')],snapshot);
  assert.equal(ranked.rows[0].share,50);assert.match(ranked.summary,/实际可列 1 家/);
  const none=buildProfile({...spec,field:'legal',start:'2040-01-01',end:'2040-12-31'},records,snapshot);
  assert.equal(none.rows.length,0);assert.match(none.note,/1 条、1 只/);
  assert.throws(()=>validateProfile({...spec,start:'2026-02-29'},assert.ok));
});
test('rank primary groups before breaking them down and retain the missing dimension amount',()=>{
  const data=[{issuer:'甲',branch:'A',cents:20},{issuer:'甲',branch:'',cents:9},
    {issuer:'乙',branch:'B',cents:25},{issuer:'丙',branch:'B',cents:1}];
  const result=buildProfile({type:'groups',stat:'breakdown',by:'issuer',within:'branch',limit:2},data,snapshot);
  assert.deepEqual(result.rows.map(x=>[x.name,x.child]),[['甲','A'],['甲','未填写'],['乙','B']]);
  assert.match(result.summary,/乙.*未填写联动分行 0 亿元/);
});
test('rank actual names after aggregating all rows, preserve cutoff ties and keep missing member balances separate',()=>{
  const rows=[
    {branch:'A',issuer:'甲城投',cents:70},{branch:'A',issuer:'乙城投',cents:50},{branch:'A',issuer:'甲城投',cents:5},
    {branch:'A',issuer:'丙',cents:50},{branch:'B',issuer:'丙',cents:80},{branch:'',issuer:'甲城投',cents:500},
    {branch:'B',issuer:'',cents:200},{branch:'C',issuer:'丙',cents:280},
  ];
  const spec={type:'groups',stat:'ranking',by:'branch',limit:2};
  const named=buildProfile(spec,rows,snapshot);
  assert.deepEqual(named.rows.map(r=>[r.name,r.rank]),[['B',1],['C',1]]);
  assert.match(named.note,/未填写联动分行/);
  const within=buildProfile({...spec,stat:'withinRanking',within:'issuer'},rows,snapshot);
  assert.deepEqual(within.rows.filter(r=>r.group==='A').map(r=>r.rank),[1,2,2]);
  assert.deepEqual(within.rows.filter(r=>r.group==='B').map(r=>r.name),['丙']);
  assert.equal(within.rows.at(-1).group,'未填写');
  const filtered=buildProfile({...spec,by:'issuer',membersContain:'城投'},rows,snapshot);
  assert.deepEqual(filtered.rows.map(r=>r.name),['甲城投','乙城投']);
  assert.throws(()=>validateProfile({...spec,membersContain:''},assert.ok));
});
