import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestGet, onRequestPost } from '../functions/api/bond-list/state.js';
import { onRequestPost as lookup } from '../functions/api/bond-list/lookup.js';
import { matchRows, nameCandidates, readBody, validateSections } from '../functions/api/bond-list/_shared.js';
import { __test__ as dm } from '../functions/api/dm/lookup.js';

function dbFixture() {
  const rows = new Map();
  return { rows, prepare(sql) { let values; return {
    bind(...args) { values=args; return this; },
    async run() {
      if (sql.startsWith('CREATE')) return {meta:{changes:0}};
      if (sql.startsWith('INSERT')) {
        if (!rows.has(values[0])) rows.set(values[0], {sections:values[1], revision:0, updated_at:values[2]});
        return {meta:{changes:1}};
      }
      if (sql.startsWith('UPDATE')) {
        const row=rows.get(values[2]);
        if (!row || row.revision!==values[3]) return {meta:{changes:0}};
        Object.assign(row,{sections:values[0],revision:row.revision+1,updated_at:values[1]});
        return {meta:{changes:1}};
      }
      throw new Error('unexpected SQL');
    },
    async first() { return rows.get(values[0]); }
  }; } };
}
const sections=[{title:'浙江（杭州）',text:'123456.SH，测试，净价100*ofr\n123456.SH，测试，2.0*bid'},{title:'北京/上海',text:''}];
function post(body, headers={}) {
  return new Request('http://127.0.0.1:8794/api/bond-list/state',{method:'POST',headers:{Origin:'http://127.0.0.1:8794','X-Bond-List':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}

test('state is isolated from existing app state, preserves quotes and rejects stale writes',async()=>{
  const DB=dbFixture();
  const get=await onRequestGet({env:{DB},request:new Request('http://127.0.0.1:8794/api/bond-list/state')});
  assert.equal((await get.json()).sections.length,23);
  const result=await onRequestPost({env:{DB},request:post({revision:0,sections})});
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(DB.rows.get('admin').sections),sections);
  const stale=await onRequestPost({env:{DB},request:post({revision:0,sections:[]})});
  assert.equal(stale.status,400);
  const conflict=await onRequestPost({env:{DB},request:post({revision:0,sections})});
  assert.equal(conflict.status,409);
  assert.equal(DB.rows.get('admin').revision,1);
});

test('unauthenticated production and foreign-origin writes are denied',async()=>{
  const request=new Request('https://credit-bond-process.pages.dev/api/bond-list/state');
  assert.equal((await onRequestGet({request,env:{}})).status,401);
  assert.equal((await lookup({request,env:{}})).status,401);
  assert.equal((await onRequestPost({request:post({revision:0,sections},{Origin:'https://evil.example'}),env:{DB:dbFixture()}})).status,403);
});

test('signed user identity selects a separate draft',async()=>{
  const DB=dbFixture(), secret='test-secret';
  const payload=Buffer.from(JSON.stringify({sub:'second-user',username:'admin',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('hex');
  const response=await onRequestGet({env:{DB,GATEWAY_AUTH_SECRET:secret},request:new Request('https://credit-bond-process.pages.dev/api/bond-list/state',{headers:{'X-Tempest-Auth':payload+'.'+signature}})});
  assert.equal((await response.json()).userId,'second-user');
  assert.equal(DB.rows.has('admin'),false);
});

test('DM matching respects annotations, ambiguity and incomplete rows',()=>{
  assert.deepEqual(nameCandidates('26建行TLAC02A(BC)'),['26建行TLAC02A(BC)']);
  assert.equal(matchRows(['26测试（BC）'],[{sec_short_name:'26测试(BC)',security_id:'123456.SH'}])['26测试（BC）'].status,'matched');
  assert.equal(matchRows(['测试'],[{secShortName:'测试',securityId:'123456.SH'},{secShortName:'测试',securityId:'123457.SZ'}])['测试'].status,'ambiguous');
  assert.equal(matchRows(['测试'],[{secShortName:'测试',securityId:'123456.SH'},{secShortName:'测试'}])['测试'].status,'error');
  assert.equal(matchRows(['测试'],[{secShortName:'其他',securityId:'123456.SH'}])['测试'].status,'missing');
  assert.throws(()=>matchRows(['测试'],[{message:'upstream error'}]));
});

test('DM endpoint uses existing encrypted client and returns only exact codes',async()=>{
  const secret='1234567890abcdef', original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    assert.match(url,/bond\/basic-info\/info$/);
    assert.deepEqual(JSON.parse(dm.sm4DecryptFromBase64Url(init.body,secret)).secShortNameList,['26测试MTN001']);
    assert.ok(init.signal);
    return new Response(JSON.stringify({data:dm.sm4EncryptToBase64Url(JSON.stringify({code:0,data:[{secShortName:'26测试MTN001',securityId:'102600001.IB'}]}),secret)}));
  };
  try {
    const response=await lookup({env:{INNO_APP_KEY:'test',INNO_APP_SECRET:secret},request:post({names:['26测试MTN001']})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).results['26测试MTN001'].matches[0].code,'102600001.IB');
    globalThis.fetch=async()=>{throw new Error('sensitive-token-must-not-leak');};
    const failed=await lookup({env:{INNO_APP_KEY:'test',INNO_APP_SECRET:secret},request:post({names:['测试']})});
    assert.equal(failed.status,502);
    assert.doesNotMatch(await failed.text(),/sensitive-token/);
  } finally { globalThis.fetch=original; }
});

test('validation bounds body and preserves branch/quote strings',async()=>{
  assert.deepEqual(validateSections(sections),sections);
  assert.throws(()=>validateSections([{title:'a',text:''},{title:'a',text:''}]));
  assert.throws(()=>validateSections([{title:'a\nb',text:''}]));
  await assert.rejects(readBody(post({payload:'x'.repeat(100)}),10));
});
