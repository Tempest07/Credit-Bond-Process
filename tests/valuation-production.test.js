import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onRequest } from '../functions/api/valuation/[[path]].js';
import { createValuationGatewayHandler } from '../tools/valuation-gateway.mjs';
import { createLocalIssuanceGateway } from '../tools/serve-local-issuance-ai.mjs';
import { VALUATION_PROMPT_VERSION } from '../valuation-model.js';

const secret = 'valuation-test-gateway-signing-key';
const bearer = 'valuation-test-local-token-0123456789';
const env = {
  GATEWAY_AUTH_SECRET: secret,
  ISSUANCE_LOCAL_AI_ENABLED: 'true',
  ISSUANCE_LOCAL_AI_URL: 'https://local-model.example/v1/issuance-recognition',
  ISSUANCE_LOCAL_AI_TOKEN: bearer,
};
function token(sub = 'admin') {
  const payload = Buffer.from(JSON.stringify({ sub, username: 'admin', exp: Math.floor(Date.now()/1000)+300 })).toString('base64url');
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('hex')}`;
}
function context(action, { body, authenticated = true, origin = 'https://tempest07.com', user = 'admin', extraEnv = {} } = {}) {
  return { env: { ...env, ...extraEnv }, params: { path: action.split('/') }, request: new Request(`https://credit-bond-process.pages.dev/api/valuation/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(authenticated ? {'X-Tempest-Auth':token(user)} : {}), ...(origin ? {Origin:origin} : {}), ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  }) };
}

test('valuation production refuses anonymous requests and foreign origins before proxying', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('unexpected network');});
  assert.equal((await onRequest(context('status',{authenticated:false}))).status,401);
  assert.equal((await onRequest(context('status',{origin:'https://evil.example'}))).status,403);
  assert.equal(calls,0);
});

test('production status proxies with server identity and keeps credentials off response', async()=>{
  const ctx=context('status',{user:'signed-user',extraEnv:{INNO_APP_KEY:'test-key',INNO_APP_SECRET:'test-secret'}});
  ctx.fetchImpl=async(url,options)=>{
    assert.equal(String(url),'https://local-model.example/v1/valuation');
    assert.equal(options.headers.Authorization,`Bearer ${bearer}`);
    assert.equal(options.redirect,'manual');
    assert.deepEqual(JSON.parse(options.body),{userId:'signed-user',action:'status',method:'GET',body:{}});
    return Response.json({models:[{name:'gpt-oss:20b'}],defaultModel:'gpt-oss:20b',dmConfigured:false});
  };
  const response=await onRequest(ctx);
  assert.equal(response.status,200);
  const text=await response.text();
  assert.equal(JSON.parse(text).dmConfigured,true);
  assert.ok(!text.includes(bearer));
});

test('production reports unavailable model gateway without exposing upstream details',async()=>{
  const ctx=context('status');
  ctx.fetchImpl=async()=>new Response('private upstream diagnostics',{status:502});
  const response=await onRequest(ctx);
  assert.equal(response.status,503);
  assert.ok(!(await response.text()).includes('private upstream diagnostics'));
});

test('production ignores browser evidence and identity and validates against freshly collected evidence',async()=>{
  const evidence={sample:false,target:{issuerName:'测试主体',shortName:'测试债',offeringType:'public'},targets:[{years:3}],candidates:[]};
  const ctx=context('analyze',{user:'authenticated-user',extraEnv:{INNO_APP_KEY:'test-key',INNO_APP_SECRET:'test-secret'},body:{target:{issuerName:'测试主体',shortName:'测试债',durationText:'3Y'},userId:'attacker',sample:true,evidence:{poison:true},model:'attacker-model'}});
  let collections=0;
  ctx.collectEvidence=async(_dm,target)=>{collections++;assert.equal(target.issuerName,'测试主体');assert.equal(target.evidence,undefined);return evidence;};
  ctx.fetchImpl=async(_url,options)=>{
    const envelope=JSON.parse(options.body);
    assert.equal(envelope.userId,'authenticated-user');
    assert.deepEqual(envelope.body,{evidence});
    return Response.json({run:{evidence,result:{model:'gpt-oss:20b',promptVersion:VALUATION_PROMPT_VERSION,output:{results:[{targetIndex:0,center:null,low:null,high:null,reasons:['没有可用券'],limitations:[],comparables:[],excluded:[]}]}}}});
  };
  assert.equal((await onRequest(ctx)).status,200);
  assert.equal(collections,1);
});

test('production strips forged identity and evidence from feedback envelope',async()=>{
  const ctx=context('feedback',{body:{runId:'abc',targetIndex:0,finalYield:1.8,reason:'人工理由',userId:'other-user',evidence:{poison:true}}});
  ctx.fetchImpl=async(_url,options)=>{
    const envelope=JSON.parse(options.body);
    assert.equal(envelope.userId,'admin');
    assert.deepEqual(envelope.body,{runId:'abc',targetIndex:0,finalYield:1.8,reason:'人工理由'});
    return Response.json({feedback:{id:'saved'}});
  };
  assert.equal((await onRequest(ctx)).status,200);
});

test('production refuses a gateway result that replaces the original market evidence',async()=>{
  const evidence={sample:false,target:{issuerName:'真实主体',offeringType:'public'},targets:[{years:3}],candidates:[]};
  const ctx=context('analyze',{extraEnv:{INNO_APP_KEY:'test-key',INNO_APP_SECRET:'test-secret'},body:{target:{issuerName:'真实主体',shortName:'测试债',durationText:'3Y'}}});
  ctx.collectEvidence=async()=>evidence;
  ctx.fetchImpl=async()=>Response.json({run:{evidence:{...evidence,target:{...evidence.target,issuerName:'错误主体'}},result:{model:'gpt-oss:20b',promptVersion:VALUATION_PROMPT_VERSION,output:{results:[{targetIndex:0,center:null,low:null,high:null,reasons:['无券'],limitations:[],comparables:[],excluded:[]}]}}}});
  assert.equal((await onRequest(ctx)).status,503);
});

test('valuation gateway isolates histories and run lookup by server-authenticated identity', async t => {
  const directory=await mkdtemp(join(tmpdir(),'valuation-production-'));
  t.after(()=>{assert.ok(directory.startsWith(join(tmpdir(),'valuation-production-')));return rm(directory,{recursive:true,force:true});});
  const handler=createValuationGatewayHandler({directory});
  const evidence={sample:false,source:'test DM',target:{issuerName:'测试主体',shortName:'测试债',offeringType:'public',profile:{}},targets:[{years:3,hasExercise:false,durationText:'3Y'}],candidates:[],excluded:[]};
  const a=await handler({userId:'user-a',action:'analyze',method:'POST',body:{evidence}});
  assert.equal(a.run.status,'complete');
  assert.equal(a.run.result.attempts,0,'empty evidence must not invoke a model');
  assert.equal((await handler({userId:'user-a',action:'history',method:'GET'})).runs.length,1);
  assert.equal((await handler({userId:'user-b',action:'history',method:'GET'})).runs.length,0);
  await assert.rejects(handler({userId:'user-b',action:`runs/${a.run.id}`,method:'GET'}),/记录不存在/);
  await assert.rejects(handler({userId:'',action:'history',method:'GET'}),/identity/);
  await assert.rejects(handler({userId:'user-a',action:'analyze',method:'POST',body:{evidence:{...evidence,sample:true}}}),/evidence/);
});

test('valuation and issuance share an inference lock while status remains readable', async t => {
  let release, entered;
  const blocked=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const server=createLocalIssuanceGateway({token:bearer,logger:{log(){},warn(){}},valuation:async envelope=>{
    if(envelope.action==='analyze'){entered();await blocked;}
    return {ok:true};
  },extract:async()=>({attempts:1})});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{release();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,authorized=true)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)});
  assert.equal((await post('/v1/valuation',{action:'status'},false)).status,401);
  const running=post('/v1/valuation',{action:'analyze'});
  await started;
  assert.equal((await post('/v1/issuance-recognition',{request:{}})).status,429);
  assert.equal((await post('/v1/valuation',{action:'feedback'})).status,429);
  assert.equal((await post('/v1/valuation',{action:'status'})).status,200);
  assert.equal((await post('/v1/issuance-recognition',{request:{}})).status,429,'status must not release another request lock');
  release();assert.equal((await running).status,200);
  assert.equal((await post('/v1/issuance-recognition',{request:{}})).status,200);
});
