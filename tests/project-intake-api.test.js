import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestPost} from '../functions/api/project-intake/recognize.js';
const text='请支持26示例MTN001，发行规模10亿元，期限3年。';
const output={projects:[{sourceText:text,fields:{shortName:{raw:'26示例MTN001',evidence:'请支持26示例MTN001'},issueScale:{raw:'10亿元',evidence:'发行规模10亿元'},durationText:{raw:'3年',evidence:'期限3年'}},tranches:[]}],warnings:[]};
function db(){const cache=new Map(),writes=[];return {cache,writes,prepare(sql){let args=[];return {bind(...values){args=values;return this;},async run(){writes.push(sql);if(sql.startsWith('INSERT'))cache.set(args[0],{result_json:args[3]});return {meta:{changes:1}};},async first(){return cache.get(args[0])||null;}};}};}
const request=(url='http://127.0.0.1/api/project-intake/recognize',origin='http://127.0.0.1',body={text})=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('project intake is authenticated, same-origin, bounded and never borrows OCR key',async()=>{
 const database=db();let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected');};
 assert.equal((await onRequestPost({request:request('https://example.com/api/project-intake/recognize','https://example.com'),env:{DB:database},fetchImpl})).status,401);
 assert.equal((await onRequestPost({request:request(undefined,'https://evil.example'),env:{DB:database},fetchImpl})).status,403);
 assert.equal((await onRequestPost({request:request(undefined,undefined,{text:'x'.repeat(100001)}),env:{DB:database},fetchImpl})).status,413);
 assert.equal((await onRequestPost({request:request(),env:{DB:database,DEEPSEEK_OCR_API_KEY:'second-key-only-tests'},fetchImpl})).status,503);
 assert.equal(calls,0);assert.ok(database.writes.every(sql=>sql.includes('ai_task_cache')));
});
test('project draft is validated and reused in the cloud without project/state writes',async()=>{
 const database=db();let calls=0;
 const context=()=>({request:request(),env:{DB:database,DEEPSEEK_API_KEY:'first-key-only-tests'},fetchImpl:async(_url,options)=>{
  calls++;assert.equal(options.headers.Authorization,'Bearer first-key-only-tests');return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
 }});
 const first=await onRequestPost(context());assert.equal(first.status,200);const value=await first.json();assert.equal(value.cached,false);assert.equal(value.projects[0].patch.issueScale,10);
 const second=await onRequestPost(context());assert.equal(second.status,200);assert.equal((await second.json()).cached,true);assert.equal(calls,1);
 assert.ok(database.writes.every(sql=>sql.includes('ai_task_cache')));
});
test('unsupported model evidence is never cached as a valid project draft',async()=>{
 const database=db(),bad=structuredClone(output);bad.projects[0].fields.shortName.raw='26虚构SCP999';
 const response=await onRequestPost({request:request(),env:{DB:database,DEEPSEEK_API_KEY:'first-key-only-tests'},fetchImpl:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(bad)}}]})});
 assert.equal(response.status,422);assert.equal(database.cache.size,0);
});
