import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {onRequest} from '../functions/api/inventory/[action].js';

const secret=randomUUID(), prod='https://credit-bond-process.pages.dev/api/inventory/';
function signed(role='admin'){
  const body=Buffer.from(JSON.stringify({username:'admin',sub:'admin',role,exp:Math.floor(Date.now()/1000)+120})).toString('base64url');
  return body+'.'+createHmac('sha256',secret).update(body).digest('hex');
}
function call(action,init={},bindings={}) {
  return onRequest({request:new Request(prod+action,init),params:{action},env:{GATEWAY_AUTH_SECRET:secret,...bindings}});
}
test('every inventory route checks production gateway auth before touching cloud bindings',async()=>{
  for(const action of ['status','upload','manual','ask','detail','export','chats','chat','answer','select','flow-status','flow-upload','flow-ask','flow-chats','flow-chat','flow-export','joint-chat','joint-ask','joint-chats','joint-export','joint-status']){
    const response=await call(action,{headers:{'X-Tempest-User':'admin','X-Tempest-Auth':'forged'}});
    assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);
  }
  assert.equal((await call('status',{headers:{'X-Tempest-Auth':signed('reader')}})).status,403);
});
test('foreign-origin and origin-less writes are rejected even with a valid session',async()=>{
  for(const origin of ['https://example.org',null]){
    const headers={'X-Tempest-Auth':signed(),'Content-Type':'application/json'};
    if(origin)headers.Origin=origin;
    assert.equal((await call('ask',{method:'POST',headers,body:'{}'})).status,403);
  }
});
test('admin gets status exclusively from named inventory bindings',async()=>{
  const db={prepare(sql){return {bind(){return this},first:async()=>({scope:'bond-centre-inventory-qa-beta'}),all:async()=>{assert.match(sql,/inventory_current/);return {results:[]}}}}};
  const headers={'X-Tempest-Auth':signed()};
  const res=await call('status',{headers},{INVENTORY_DB:db,INVENTORY_FILES:{},INVENTORY_OPENAI_API_KEY:'test-only'});
  assert.equal(res.status,200);assert.deepEqual(await res.json(),{snapshots:[],configured:true});
  assert.equal((await call('status',{headers},{DB:db,PAYMENT_RECEIPTS:{}})).status,503);
});
