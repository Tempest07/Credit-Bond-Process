import assert from 'node:assert/strict';
import test from 'node:test';
import {ISSUANCE_FIELDS} from '../issuance-recognition.js';
import {recognizeIssuanceWithProviders,localProviderConfig} from '../functions/api/_issuance-provider.js';
import {onRequestPost} from '../functions/api/issuance-results/recognize.js';

const key='deepseek-test-key-not-real-0123456789';
const text='26测试MTN001，代码102600001，实际发行5亿元，票面1.63%，2026年10月28日缴款。';
const input={text,noticeDate:'2026-10-27',tranches:[{id:'a',shortName:'26测试MTN001',bidAmount:9,valuation:1.77}]};
function output(){
 const fields=Object.fromEntries(Object.keys(ISSUANCE_FIELDS).map(name=>[name,{raw:null,evidence:''}]));
 Object.assign(fields,{securityCode:{raw:'102600001',evidence:'代码102600001'},couponRate:{raw:'1.63%',evidence:'票面1.63%'},issueScale:{raw:'5亿元',evidence:'实际发行5亿元'},paymentDate:{raw:'2026年10月28日',evidence:'2026年10月28日缴款'}});
 return {items:[{shortName:'26测试MTN001',sourceText:text,outcome:'issued',outcomeEvidence:'',fields}],sharedEvidence:[]};
}

test('explicit DeepSeek routing bypasses the local gateway and Cloudflare while retaining evidence validation', async()=>{
 let calls=0;
 const result=await recognizeIssuanceWithProviders(input,{ISSUANCE_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:key,ISSUANCE_LOCAL_AI_ENABLED:'true',AI:{run(){throw Error('must not call cloud');}}},{fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');
  const body=JSON.parse(init.body);assert.equal(body.thinking.type,'disabled');
  assert.equal(JSON.stringify(body).includes('bidAmount'),false);assert.equal(JSON.stringify(body).includes('valuation'),false);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}]});
 }});
 assert.equal(calls,1);assert.equal(result.provider,'deepseek');assert.equal(result.canApply,true);assert.equal(result.items[0].couponRate,1.63);
});

test('missing DeepSeek credentials and unknown provider never silently invoke other services',async()=>{
 for(const provider of ['deepseek','unknown']){
  await assert.rejects(recognizeIssuanceWithProviders(input,{ISSUANCE_AI_PROVIDER:provider,AI:{run(){throw Error('must not fall back');}}},{fetchImpl:()=>{throw Error('must not fetch');}}),error=>error.status===503&&['DEEPSEEK_CONFIG','ISSUANCE_PROVIDER_CONFIG'].includes(error.code));
 }
});

test('other local AI features retain their own gateway credential in DeepSeek recognition mode',()=>{
 const localKey='local-ai-test-key-separate-0123456789';
 const config=localProviderConfig({ISSUANCE_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:key,
  ISSUANCE_LOCAL_AI_ENABLED:'true',ISSUANCE_LOCAL_AI_URL:'http://127.0.0.1:11435/v1/issuance-recognition',ISSUANCE_LOCAL_AI_TOKEN:localKey});
 assert.equal(config.token,localKey);assert.notEqual(config.token,key);
 assert.equal(localProviderConfig({ISSUANCE_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:key}),null);
});

function context(env){return{env,request:new Request('http://127.0.0.1:8838/api/issuance-results/recognize',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:8838'},body:JSON.stringify(input)})};}

test('the recognition endpoint exposes actionable missing-key errors without requiring database writes',async()=>{
 const warn=console.warn;console.warn=()=>{};
 try{const response=await onRequestPost(context({ISSUANCE_AI_PROVIDER:'deepseek'}));const body=await response.json();assert.equal(response.status,503);assert.equal(body.code,'DEEPSEEK_CONFIG');assert.match(body.error,/密钥/);}
 finally{console.warn=warn;}
});

test('the recognition endpoint preserves rate-limit diagnostics but never returns or logs upstream bodies or credentials',async()=>{
 const originalFetch=globalThis.fetch,warn=console.warn,logs=[];
 globalThis.fetch=async()=>new Response('sensitive upstream '+key,{status:429,headers:{'Retry-After':'15'}});console.warn=value=>logs.push(value);
 try{
  const response=await onRequestPost(context({ISSUANCE_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:key}));const body=await response.json();
  assert.equal(response.status,429);assert.equal(body.code,'DEEPSEEK_RATE_LIMIT');assert.equal(body.upstreamStatus,429);assert.equal(body.retryAfter,15);assert.equal(response.headers.get('Retry-After'),'15');
  assert.equal(JSON.stringify(body).includes(key),false);assert.equal(logs.join('').includes(key),false);assert.equal(logs.join('').includes(text),false);
 }finally{globalThis.fetch=originalFetch;console.warn=warn;}
});
