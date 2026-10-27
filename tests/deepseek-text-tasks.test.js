import assert from 'node:assert/strict';
import test from 'node:test';
import {runDeepseekText} from '../functions/api/_deepseek-text.js';
const env={DEEPSEEK_API_KEY:'first-key-project-intake-only-tests',DEEPSEEK_OCR_API_KEY:'second-key-receipt-tasks-only-tests'};
const input={purpose:'project-intake',messages:[{role:'system',content:'Return JSON.'},{role:'user',content:'test material'}]};
test('approved task purposes use the exact separately assigned key',async()=>{
 for(const [purpose,key] of [['project-intake',env.DEEPSEEK_API_KEY],['receipt-match',env.DEEPSEEK_OCR_API_KEY]]){
  let calls=0;
  const result=await runDeepseekText(env,{...input,purpose},{fetchImpl:async(url,options)=>{
   calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,`Bearer ${key}`);
   assert.equal(options.redirect,'manual');assert.equal(JSON.parse(options.body).thinking.type,'disabled');
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});
  }});assert.equal(result.output.ok,true);assert.equal(calls,1);
 }
});
test('unapproved purposes and missing designated keys never borrow the other key',async()=>{
 let calls=0;const options={fetchImpl:()=>{calls++;throw Error('unexpected');}};
 await assert.rejects(runDeepseekText(env,{...input,purpose:'valuation'},options));
 await assert.rejects(runDeepseekText({DEEPSEEK_OCR_API_KEY:env.DEEPSEEK_OCR_API_KEY},input,options));
 await assert.rejects(runDeepseekText({DEEPSEEK_API_KEY:env.DEEPSEEK_API_KEY},{...input,purpose:'receipt-match'},options));
 assert.equal(calls,0);
});
test('throttling, redirects and incomplete output fail once without vendor text disclosure',async()=>{
 for(const response of [new Response('secret upstream details',{status:429}),new Response('',{status:302}),
  Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),Response.json({choices:[{finish_reason:'stop',message:{content:'[]'}}]})]){
   let calls=0;await assert.rejects(runDeepseekText(env,input,{fetchImpl:async()=>{calls++;return response;}}),error=>error.retryable===false&&!error.message.includes('secret'));
   assert.equal(calls,1);
 }
});
test('task deadlines bound stalled request and response bodies',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}))])
  await assert.rejects(runDeepseekText(env,input,{fetchImpl,timeoutMs:15}),error=>error.code==='DEEPSEEK_TASK_TIMEOUT');
});
