import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentTodoCodes } from '../payment-todo-codes.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const payload = names => ({source:'DM',fetchedAt:'2026-10-21T03:00:00Z',results:Object.fromEntries(names.map((name,index)=>[name,{status:'matched',matches:[{name,code:`102600${String(index).padStart(3,'0')}.IB`}]}]))});

test('automatic queries are deduplicated, batched and cached without reloading on a render', async () => {
  const calls=[];
  let changes=0;
  const codes=createPaymentTodoCodes({lookup:async names=>{calls.push(names);return payload(names);},onChange:()=>{changes++;}});
  const names=Array.from({length:23},(_,index)=>'26测试MTN'+String(index).padStart(3,'0'));
  codes.ensure([...names,names[0]]);
  codes.ensure(names);
  assert.equal(codes.get(names[0]).status,'loading');
  await tick();
  assert.deepEqual(calls.map(names=>names.length),[20,3]);
  assert.equal(changes,2);
  assert.equal(codes.get(names[0]).code,'102600000.IB');
  codes.ensure(names);await tick();
  assert.equal(calls.length,2);
});

test('a late response remains tied to its exact name and never fills a different tranche', async () => {
  const resolvers=[];
  const codes=createPaymentTodoCodes({lookup:names=>new Promise(resolve=>resolvers.push(()=>resolve(payload(names)))),onChange:()=>{}});
  codes.ensure(['26测试MTN001A']);await tick();
  codes.ensure(['26测试MTN001B']);
  resolvers[0]();await tick();
  assert.equal(codes.get('26测试MTN001A').status,'matched');
  assert.equal(codes.get('26测试MTN001B').status,'loading');
  resolvers[1]();await tick();
  assert.equal(codes.get('26测试MTN001B').status,'matched');
  assert.equal(codes.get('26测试MTN002'),undefined);
});

test('wrong names, invalid codes and unsupported provider data cannot be displayed as verified codes', async () => {
  for (const change of [
    response=>{response.results['26测试MTN001'].matches[0].name='25测试MTN001';},
    response=>{response.results['26测试MTN001'].matches[0].code='102600001';},
    response=>{response.source='manual';},
  ]) {
    const codes=createPaymentTodoCodes({lookup:async names=>{const response=payload(names);change(response);return response;},onChange:()=>{}});
    codes.ensure(['26测试MTN001']);await tick();
    assert.equal(codes.get('26测试MTN001').status,'error');
    assert.equal(codes.get('26测试MTN001').code,'');
  }
});

test('QB fallback codes keep exact-name verification and their real provider in mixed batches', async () => {
  const names = ['26测试MTN001', '26测试MTN002'];
  const codes = createPaymentTodoCodes({ lookup: async requested => {
    const response = payload(requested); response.source = 'DM+QB';
    response.results[names[0]].matches[0].provider = 'QB';
    response.results[names[0]].matches[0].providerInfo = { apiNames: ['bondDimInfo'], date: '2026-10-22' };
    response.results[names[1]].matches[0].provider = 'DM';
    return response;
  }, onChange() {} });
  codes.ensure(names); await tick();
  assert.equal(codes.get(names[0]).status, 'matched');
  assert.equal(codes.get(names[0]).source, 'QB');
  assert.equal(codes.get(names[0]).providerInfo.apiNames[0], 'bondDimInfo');
  assert.equal(codes.get(names[1]).source, 'DM');
});

test('missing and ambiguous results stay explicit; network failures retry after a bounded delay', async () => {
  let time=0,calls=0;
  const codes=createPaymentTodoCodes({now:()=>time,lookup:async()=>{calls++;throw Error('private upstream details');},onChange:()=>{}});
  codes.ensure(['26测试MTN001']);await tick();
  assert.equal(codes.get('26测试MTN001').status,'error');
  codes.ensure(['26测试MTN001']);await tick();assert.equal(calls,1);
  time=60_001;codes.ensure(['26测试MTN001']);await tick();assert.equal(calls,2);
  for(const status of ['missing','ambiguous']) {
    const lookup=createPaymentTodoCodes({lookup:async()=>({source:'DM',results:{'26测试MTN001':{status,matches:[]}}}),onChange:()=>{}});
    lookup.ensure(['26测试MTN001']);await tick();
    assert.equal(lookup.get('26测试MTN001').status,status);
    assert.equal(lookup.get('26测试MTN001').code,'');
  }
});
