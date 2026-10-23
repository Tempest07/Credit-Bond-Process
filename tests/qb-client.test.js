import test from 'node:test';
import assert from 'node:assert/strict';
import { createQbClient, __test__ } from '../functions/api/qb/client.js';

const key='test-qb-secret-not-for-url';
const env={QB_ACCESS_KEY:key};
const params={ss_sec_code:'012682405.IB',page:1,pageSize:20};
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('QB client uses only the fixed production HTTPS endpoint and a private access-key header',async t=>{
  let observed;
  t.mock.method(globalThis,'fetch',async(url,init)=>{observed={url:new URL(url),init};return response([{ss_sec_code:'012682405.IB'}]);});
  const rows=await createQbClient(env).query('bondDimInfo',{...params,empty:'',omitted:null});
  assert.equal(rows.length,1);assert.equal(observed.url.origin,'https://data-api.qeubee.cn');
  assert.equal(observed.url.pathname,'/sumscope/common/api/bondDimInfo');
  assert.equal(observed.url.searchParams.get('ss_sec_code'),'012682405.IB');
  assert.equal(observed.url.searchParams.has('empty'),false);assert.equal(observed.url.searchParams.has('omitted'),false);
  assert.equal(observed.url.href.includes(key),false);assert.equal(observed.init.headers['X-Access-Key'],key);
  assert.equal(observed.init.redirect,'manual');assert.ok(observed.init.signal instanceof AbortSignal);
});

test('QB client rejects unknown API names and missing credentials before any request',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response([]);});
  await assert.rejects(createQbClient(env).query('../arbitrary',{anything:'x'}),/只读目录/);
  await assert.rejects(createQbClient({}).query('bondDimInfo',params),/尚未配置/);
  assert.equal(calls,0);
});

test('QB client refuses redirects without sending credentials to another host',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://other.test/'}});});
  await assert.rejects(createQbClient(env).query('bondDimInfo',params),/HTTP 302/);
  assert.equal(calls,1);
});

test('QB client unwraps supported JSON envelopes and rejects unsuccessful or invalid row shapes',async()=>{
  assert.deepEqual(__test__.unwrap({code:0,data:{rows:[{value:1}]}}),[{value:1}]);
  assert.deepEqual(__test__.unwrap({success:true,result:[]}),[]);
  for(const input of [{code:400,data:[]},{success:false,data:[]},{message:'bad'},null,42])assert.throws(()=>__test__.unwrap(input));
});

test('QB client never treats business errors, null rows or scalar arrays as successful data',async t=>{
  for(const value of [{code:403,message:key,data:[]},[null],['bad'],{rows:[[]]}]){
    t.mock.method(globalThis,'fetch',async()=>response(value));
    await assert.rejects(createQbClient(env).query('bondDimInfo',params),error=>!error.message.includes(key));
    t.mock.restoreAll();
  }
});

test('QB client reports sanitized HTTP failure and performs no blind retries on rate limiting',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(key,{status:429});});
  const qb=createQbClient(env);
  await assert.rejects(qb.query('bondDimInfo',params),error=>error.status===429&&error.code==='qb_rate_limited'&&!error.message.includes(key));
  assert.equal(calls,1);
});

test('QB HTTP 200 business rate-limit envelopes retain structured 429 without exposing the upstream message',async t=>{
  for(const code of [429,'429']){
    t.mock.method(globalThis,'fetch',async()=>response({code,message:key,data:null}));
    await assert.rejects(createQbClient(env).query('bondDimInfo',params),error=>error.status===429&&error.code==='qb_rate_limited'&&!error.message.includes(key)&&!('retryAfter' in error));
    t.mock.restoreAll();
  }
});

test('QB rate limiting accepts only safe integer delay-seconds from Retry-After',async t=>{
  for(const [value,expected] of [['15',15],['0',0],['-1',undefined],['1.5',undefined],['tomorrow',undefined],['Wed, 21 Oct 2026 07:28:00 GMT',undefined],['9007199254740992',undefined]]){
    for(const httpStatus of [200,429]){
      t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({code:429,data:null}),{status:httpStatus,headers:{'Retry-After':value}}));
      await assert.rejects(createQbClient(env).query('bondDimInfo',params),error=>error.status===429&&error.retryAfter===expected);
      t.mock.restoreAll();
    }
  }
});

test('QB first HTTP or business 429 blocks queued and later reads for that incoming request',async t=>{
  for(const httpStatus of [200,429]){
    const pending=[];let calls=0;
    t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(resolve=>pending.push(resolve));});
    const qb=createQbClient(env);
    const requests=Array.from({length:9},(_,i)=>qb.query('bondDimInfo',{ss_sec_code:`${100000+i}.SH`}));
    const results=Promise.allSettled(requests);
    assert.equal(calls,4);
    pending[0](new Response(JSON.stringify({code:429,message:key,data:null}),{status:httpStatus,headers:{'Retry-After':'12'}}));
    await assert.rejects(requests[0],error=>error.status===429&&error.retryAfter===12);
    await assert.rejects(qb.query('bondDimInfo',{ss_sec_code:'999999.SH'}),error=>error.status===429&&error.code==='qb_rate_limited');
    pending.slice(1).forEach(resolve=>resolve(response([])));
    const settled=await results;
    assert.equal(calls,4,'five queued requests and the later request never reach fetch');
    assert.equal(settled.filter(result=>result.status==='rejected').length,6);
    assert.throws(()=>qb.throwIfBlocked(),error=>error.status===429);
    t.mock.restoreAll();
    t.mock.method(globalThis,'fetch',async()=>{calls++;return response([]);});
    await createQbClient(env).query('bondDimInfo',params);
    assert.equal(calls,5,'the block is scoped to the incoming request, not global state');
    t.mock.restoreAll();
  }
});

test('QB client enforces Content-Length and streamed byte limits',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('[]',{headers:{'Content-Length':'1500001'}}));
  await assert.rejects(createQbClient(env).query('bondDimInfo',params),/安全大小/);
  t.mock.restoreAll();
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1500001));controller.close();}})));
  await assert.rejects(createQbClient(env).query('bondDimInfo',params),/安全大小/);
});

test('QB client shares duplicate reads within one request while keeping separate clients isolated',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,2));return response([{value:1}]);});
  const qb=createQbClient(env);
  const [a,b]=await Promise.all([qb.query('bondDimInfo',params),qb.query('bondDimInfo',{pageSize:20,page:1,ss_sec_code:'012682405.IB'})]);
  assert.deepEqual(a,b);assert.equal(calls,1);
  await createQbClient(env).query('bondDimInfo',params);assert.equal(calls,2);
});

test('QB client limits concurrent vendor requests to four and releases queued work',async t=>{
  let active=0,maximum=0,calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return response([]);});
  const qb=createQbClient(env);
  await Promise.all(Array.from({length:9},(_,i)=>qb.query('bondDimInfo',{ss_sec_code:`${100000+i}.SH`})));
  assert.equal(calls,9);assert.equal(maximum,4);assert.equal(active,0);
});

test('QB client honors shared deadline and both request-level and call-level cancellation',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response([]);});
  await assert.rejects(createQbClient(env,{deadline:Date.now()-1}).query('bondDimInfo',params),error=>error.name==='TimeoutError');
  const shared=new AbortController();shared.abort();
  await assert.rejects(createQbClient(env,{signal:shared.signal}).query('bondDimInfo',params),error=>error.name==='AbortError');
  const perCall=new AbortController();perCall.abort();
  await assert.rejects(createQbClient(env).query('bondDimInfo',params,{signal:perCall.signal}),error=>error.name==='AbortError');
  assert.equal(calls,0);
});

test('QB client has a finite vendor call budget even for distinct caller targets',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response([]);});
  const qb=createQbClient(env);
  const results=await Promise.allSettled(Array.from({length:33},(_,i)=>qb.query('bondDimInfo',{ss_sec_code:`${100000+i}.SH`})));
  assert.equal(calls,32);assert.equal(results.filter(value=>value.status==='rejected').length,1);
  assert.match(results.find(value=>value.status==='rejected').reason.message,/请求上限/);
});
