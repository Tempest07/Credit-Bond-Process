import test from 'node:test';
import assert from 'node:assert/strict';
import { dataSourceStatus, resolveDataSourceMode } from '../functions/api/_data-source.js';
import { onRequestGet } from '../functions/api/data-source.js';
import { validateDmConfig } from '../functions/api/dm/lookup.js';
import { createFallbackClient, withDataSources } from '../functions/api/qb/fallback.js';

const env={INNO_APP_KEY:'private-dm-key',INNO_APP_SECRET:'private-dm-secret',QB_ACCESS_KEY:'private-qb-key'};
const path='/dm-quant-func-service/api/v1/bond/basic-info/info';
const code='012682405.IB';
const request=(mode,header={})=>new Request('http://127.0.0.1/api',{headers:{...(mode?{Cookie:'bond_centre_data_source='+mode}:{}),...header}});
function qb(query){return {today:'2026-10-23',fetchedAt:'2026-10-23T01:00:00Z',query,
  scope:{codes:new Set(),names:new Set(),basicByCode:new Map(),issuerNameBySocietyCode:new Map()}};}
const query=async api=>api==='bondDimInfo'?[{ss_sec_code:code,sec_shrt_nm:'26测试SCP001',coupon_rt_cur:1.38}]:[];

test('configured installations temporarily default to QB; explicit server default and valid cookie override it',()=>{
  assert.equal(resolveDataSourceMode(env,request()),'qb');
  assert.equal(resolveDataSourceMode({...env,BOND_DATA_SOURCE_MODE:'auto'},request()),'auto');
  for(const mode of ['auto','dm','qb'])assert.equal(resolveDataSourceMode(env,request(mode)),mode);
  assert.equal(resolveDataSourceMode(env,request('bogus')),'qb');
  assert.equal(resolveDataSourceMode(env,request('%ZZ')),'qb');
  assert.equal(resolveDataSourceMode(env,request('auto',{'X-Bond-Data-Source':'DM'})),'dm');
  assert.equal(resolveDataSourceMode({INNO_APP_KEY:'x'},request()),'auto');
});

test('status discloses configured flags and selected mode only, never credentials',async()=>{
  const result=await onRequestGet({env,request:request('auto')});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.deepEqual(body,{mode:'auto',defaultMode:'qb',configured:{dm:true,qb:true}});
  for(const value of Object.values(env))assert.ok(!JSON.stringify(body).includes(value));
  assert.equal((await onRequestGet({env,request:new Request('https://other.test/api/data-source')})).status,401);
});

test('configuration follows forced mode and never silently uses another configured source',()=>{
  assert.equal(validateDmConfig({QB_ACCESS_KEY:'x'},request('dm')).status,503);
  assert.equal(validateDmConfig({INNO_APP_KEY:'x',INNO_APP_SECRET:'y'},request('qb')).status,503);
  assert.equal(validateDmConfig({QB_ACCESS_KEY:'x'},request('auto')),null);
  assert.equal(validateDmConfig(env,request('dm')),null);
});

test('QB mode bypasses DM completely and identifies QB as the selected primary',async()=>{
  let dmCalls=0;
  const client=createFallbackClient(env,request('qb'),{post:async()=>{dmCalls++;throw Error('DM down');}},{qbClient:qb(query)});
  const data=await client.post(path,{securityIdList:[code]});
  assert.equal(dmCalls,0);assert.equal(data[0].newCoupRate,1.38);
  assert.equal(client.sourceInfo().primary,'QB');assert.equal(client.sourceInfo().fallbackUsed,false);
  const payload=withDataSources({source:'DM',results:data},client);
  assert.equal(payload.source,'QB');assert.equal(payload.dataSources.mode,'qb');
});

test('empty, unsupported and failing QB requests never call DM',async()=>{
  let dmCalls=0;
  const dm={post:async()=>{dmCalls++;return [{securityId:code,newCoupRate:2}];}};
  const empty=createFallbackClient(env,request('qb'),dm,{qbClient:qb(async()=>[])});
  assert.deepEqual(await empty.post(path,{securityIdList:[code]}),[]);
  assert.equal(withDataSources({source:'DM',results:[]},empty).source,'QB');
  await assert.rejects(empty.post('/unmapped',{}),/QB/);
  const failed=createFallbackClient(env,request('qb'),dm,{qbClient:qb(async()=>{throw Error('private upstream error');})});
  await assert.rejects(failed.post(path,{securityIdList:[code]}),/QB 查询暂时失败/);
  assert.equal(dmCalls,0);
});

test('DM mode bypasses QB even when DM is down',async()=>{
  let qbCalls=0;const dm={post:async()=>{throw Error('DM down');}};
  const client=createFallbackClient(env,request('dm'),dm,{qbClient:qb(async()=>{qbCalls++;return [];})});
  assert.equal(client,dm);await assert.rejects(client.post(path,{}),/DM down/);assert.equal(qbCalls,0);
});

test('auto retains DM priority and switches only when DM is empty or fails',async()=>{
  let dmCalls=0,qbCalls=0;
  const dm={post:async()=>{dmCalls++;return [];}};
  const client=createFallbackClient(env,request('auto'),dm,{qbClient:qb(async api=>{qbCalls++;return query(api);})});
  const data=await client.post(path,{securityIdList:[code]});
  assert.equal(dmCalls,1);assert.ok(qbCalls>0);assert.equal(data[0]._provider,'QB');
  assert.equal(client.sourceInfo().fallbackUsed,true);
  const original=[{securityId:code,newCoupRate:1.5}];
  const complete=createFallbackClient(env,request('auto'),{post:async()=>original},{qbClient:qb(()=>{throw Error('must not query');})});
  assert.equal(await complete.post(path,{securityIdList:[code],fieldNames:['newCoupRate']}),original);
});
