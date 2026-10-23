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

test('source reset starts a fresh lookup and ignores late success or failure from the old source', async () => {
  for (const failOld of [false, true]) {
    const pending = [];
    let codes;
    codes = createPaymentTodoCodes({
      lookup: (names, { signal }) => new Promise((resolve, reject) => pending.push({ names, signal, resolve, reject })),
      onChange() { codes.ensure(['26测试MTN001']); },
    });
    codes.ensure(['26测试MTN001']); await tick();
    assert.equal(pending.length, 1);
    codes.resetDataSource(); await tick();
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(pending.length, 2);
    if (failOld) pending[0].reject(new Error('old source failed'));
    else pending[0].resolve(payload(pending[0].names));
    await tick();
    assert.equal(codes.get('26测试MTN001').status, 'loading');
    const current = payload(pending[1].names); current.source = 'QB';
    pending[1].resolve(current); await tick();
    assert.equal(codes.get('26测试MTN001').status, 'matched');
    assert.equal(codes.get('26测试MTN001').source, 'QB');
    assert.equal(pending.length, 2);
  }
});

test('source reset invalidates the current mode without waiting for the next daily check', async () => {
  let source = 'DM', calls = 0;
  const codes = createPaymentTodoCodes({ lookup: async names => {
    calls++; return { ...payload(names), source };
  }, onChange() {} });
  codes.ensure(['26测试MTN001']); await tick();
  assert.equal(codes.get('26测试MTN001').source, 'DM');
  source = 'QB'; codes.resetDataSource();
  assert.equal(codes.get('26测试MTN001'), undefined);
  codes.ensure(['26测试MTN001']); await tick();
  assert.equal(calls, 2);
  assert.equal(codes.get('26测试MTN001').source, 'QB');
});

test('loading and failed code lookups retain the requested mode without inventing a data provider', async () => {
  let mode = 'qb', rejectLookup;
  const codes = createPaymentTodoCodes({ getDataSourceMode: () => mode,
    lookup: () => new Promise((_resolve, reject) => { rejectLookup = reject; }), onChange() {} });
  codes.ensure(['26测试MTN001']);
  assert.equal(codes.get('26测试MTN001').requestMode, 'qb');
  await tick();
  mode = 'dm';
  rejectLookup(new Error('接口暂不可用')); await tick();
  assert.equal(codes.get('26测试MTN001').requestMode, 'qb');
  assert.equal(codes.get('26测试MTN001').source, undefined);
});

test('unmatched lookups use request mode while verified codes keep their actual provider', async () => {
  for (const status of ['missing', 'ambiguous', 'matched']) {
    const codes = createPaymentTodoCodes({ getDataSourceMode: () => 'qb', onChange() {}, lookup: async names => {
      const response = payload(names);
      response.results[names[0]].status = status;
      return response;
    } });
    codes.ensure(['26测试MTN001']); await tick();
    const result = codes.get('26测试MTN001');
    assert.equal(result.requestMode, 'qb');
    assert.equal(result.source, status === 'matched' ? 'DM' : '');
    assert.equal(result.status, status);
  }
});

test('verified codes remain fixed all day and recheck at Beijing midnight, independent of provider data time', async () => {
  let time = Date.parse('2026-10-23T00:00:00+08:00'), calls = 0;
  const codes = createPaymentTodoCodes({now:()=>time, onChange(){}, lookup:async names=>{ calls++; return payload(names); }});
  codes.ensure(['26测试MTN001']); await tick();
  time = Date.parse('2026-10-23T23:59:59+08:00');
  codes.ensure(['26测试MTN001']); await tick();
  assert.equal(calls, 1);
  time = Date.parse('2026-10-24T00:00:00+08:00');
  codes.ensure(['26测试MTN001']); await tick();
  assert.equal(calls, 2);
  assert.equal(codes.get('26测试MTN001').fetchedAt, '2026-10-21T03:00:00Z');
});

test('a failed daily recheck keeps the verified code visible and retries after the original minute', async () => {
  let time = Date.parse('2026-10-23T23:59:00+08:00'), calls = 0, rejectLookup;
  const codes = createPaymentTodoCodes({now:()=>time, onChange(){}, lookup:names=>{
    calls++;
    return calls === 1 ? Promise.resolve(payload(names)) : new Promise((_resolve,reject)=>{ rejectLookup=reject; });
  }});
  codes.ensure(['26测试MTN001']); await tick();
  const original = codes.get('26测试MTN001').code;
  time = Date.parse('2026-10-24T00:00:00+08:00');
  codes.ensure(['26测试MTN001']); await tick();
  assert.equal(codes.get('26测试MTN001').code, original);
  assert.equal(codes.get('26测试MTN001').status, 'matched');
  rejectLookup(Error('network failed')); await tick();
  assert.equal(codes.get('26测试MTN001').refreshStatus, 'error');
  assert.equal(codes.get('26测试MTN001').code, original);
  time += 59_999; codes.ensure(['26测试MTN001']); await tick(); assert.equal(calls, 2);
  time++; codes.ensure(['26测试MTN001']); await tick(); assert.equal(calls, 3);
  rejectLookup(Error('network failed')); await tick();
});

test('cloud fallback codes and a concurrent cloud lease respect the server retry window', async () => {
  for (const hasCode of [true, false]) {
    let time = Date.parse('2026-10-23T12:00:00+08:00'), calls = 0;
    const codes = createPaymentTodoCodes({now:()=>time,onChange(){},lookup:async names=>{
      calls++; const response=payload(names);
      response.results[names[0]]={...(hasCode ? response.results[names[0]] : {status:'loading',matches:[]}),
        checkedAt:'2026-10-22T03:00:00Z', refreshStatus:hasCode?'error':'loading',
        nextCheckAt:new Date(time+35_000).toISOString(), cached:true};
      return response;
    }});
    codes.ensure(['26测试MTN001']); await tick();
    assert.equal(codes.get('26测试MTN001').status, hasCode?'matched':'loading');
    time+=34_999; codes.ensure(['26测试MTN001']); await tick(); assert.equal(calls,1);
    time++; codes.ensure(['26测试MTN001']); await tick(); assert.equal(calls,2);
  }
});

test('manual refresh bypasses the daily cache, keeps codes visible and accepts a corrected verified code', async () => {
  let calls=0, finish;
  const codes=createPaymentTodoCodes({onChange(){},lookup:(names,options)=>{
    calls++;
    if(calls===1){assert.equal(options.force,false);return Promise.resolve(payload(names));}
    assert.equal(options.force,true);
    return new Promise(resolve=>{finish=()=>{
      const response=payload(names); response.results[names[0]].matches[0].code='102600999.IB'; resolve(response);
    };});
  }});
  codes.ensure(['26测试MTN001']);await tick();
  const refreshing=codes.refresh(['26测试MTN001','26测试MTN001']);await tick();
  assert.equal(codes.get('26测试MTN001').code,'102600000.IB');
  assert.equal(codes.get('26测试MTN001').status,'matched');
  const duplicate=codes.refresh(['26测试MTN001']); await tick();assert.equal(calls,2);
  finish();
  assert.deepEqual(await refreshing,{total:1,failed:0});
  assert.deepEqual(await duplicate,{total:1,failed:0});
  assert.equal(codes.get('26测试MTN001').code,'102600999.IB');
});

test('a source switch cancels manual-refresh completion without showing a stale success', async () => {
  let finish;
  const codes=createPaymentTodoCodes({onChange(){},lookup:names=>new Promise(resolve=>{finish=()=>resolve(payload(names));})});
  const pending=codes.refresh(['26测试MTN001']);await tick();
  codes.resetDataSource();
  assert.deepEqual(await pending,{cancelled:true});
  finish();await tick();
  assert.equal(codes.get('26测试MTN001'),undefined);
});

test('a cloud success marker cannot validate a mismatched corrected code', async()=>{
  let calls=0;
  const codes=createPaymentTodoCodes({onChange(){},lookup:async names=>{
    const response=payload(names);calls++;
    if(calls>1){response.results[names[0]].matches[0].name='26其他MTN001';response.results[names[0]].refreshStatus='matched';}
    return response;
  }});
  codes.ensure(['26测试MTN001']);await tick();
  assert.deepEqual(await codes.refresh(['26测试MTN001']),{total:1,failed:1});
  assert.equal(codes.get('26测试MTN001').code,'102600000.IB');
  assert.equal(codes.get('26测试MTN001').refreshStatus,'error');
});

test('manual refresh during an ordinary in-flight lookup follows the cloud hit with one forced check', async()=>{
  const pending=[];
  const codes=createPaymentTodoCodes({onChange(){},lookup:(names,options)=>new Promise(resolve=>pending.push({names,force:options.force,resolve}))});
  codes.ensure(['26测试MTN001']);await tick();
  const first=codes.refresh(['26测试MTN001']);
  const duplicate=codes.refresh(['26测试MTN001']);
  pending[0].resolve(payload(pending[0].names));await tick();
  assert.deepEqual(pending.map(request=>request.force),[false,true]);
  const joinForced=codes.refresh(['26测试MTN001']);await tick();
  assert.equal(pending.length,2);
  const corrected=payload(pending[1].names);
  corrected.results['26测试MTN001'].matches[0].code='102600999.IB';
  pending[1].resolve(corrected);
  for(const completion of [first,duplicate,joinForced])assert.deepEqual(await completion,{total:1,failed:0});
  assert.equal(codes.get('26测试MTN001').code,'102600999.IB');
});
