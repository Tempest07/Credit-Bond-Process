import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareLocalIssuanceAi } from '../tools/prepare-local-issuance-ai.mjs';

const key = 'sk-test-only-deepseek-credential-1234567890';
const localToken = 'test-only-local-credential-1234567890';
const directory = () => Response.json({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]});
const localHealth = () => Response.json({status:'ok',model:'gpt-oss:20b',promptRevision:'local-20b-20260904-1'});
async function fixture(work) {
  const prefix = resolve(tmpdir(), 'bond-deepseek-config-');
  const dir = await mkdtemp(prefix);
  try { await work(dir); }
  finally { assert.ok(resolve(dir).startsWith(prefix)); await rm(dir,{recursive:true,force:true}); }
}

test('missing DeepSeek key leaves the existing local provider selected', async () => fixture(async dir => {
  await writeFile(join(dir,'.dev.vars.deepseek'),'# Fill the official key here.\nDEEPSEEK_API_KEY=\n');
  const result = await prepareLocalIssuanceAi(dir,{env:{LOCAL_ISSUANCE_AI_TOKEN:localToken},fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:11435/health');return localHealth();}});
  assert.equal(result.provider,'legacy');
  assert.doesNotMatch(await readFile(join(dir,'.dev.vars'),'utf8'),/ISSUANCE_AI_PROVIDER=deepseek/);
}));

test('a private key selects DeepSeek after only a bounded official model-directory GET', async () => fixture(async dir => {
  const privateText=`# Private API key\nDEEPSEEK_API_KEY=${key}\n`;
  await writeFile(join(dir,'.dev.vars.deepseek'),privateText);
  await writeFile(join(dir,'.dev.vars'),'QB_ACCESS_KEY=test-only-qb\nISSUANCE_LOCAL_AI_TOKEN=keep-existing-local-token\n');
  const requests=[];
  const options={env:{},fetchImpl:async(url,init)=>{requests.push({url,init});return directory();}};
  const first=await prepareLocalIssuanceAi(dir,options);
  assert.deepEqual(first,{configured:true,provider:'deepseek',model:'deepseek-flash',healthy:true});
  assert.equal(JSON.stringify(first).includes(key),false);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.deepseek.com/models');
  assert.equal(requests[0].init.method,'GET');
  assert.equal(requests[0].init.redirect,'error');
  assert.equal(requests[0].init.body,undefined);
  assert.equal(requests[0].init.headers.Authorization,'Bearer '+key);
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  const written=await readFile(join(dir,'.dev.vars'),'utf8');
  assert.match(written,/QB_ACCESS_KEY=test-only-qb\nISSUANCE_LOCAL_AI_TOKEN=keep-existing-local-token/);
  assert.match(written,/ISSUANCE_AI_PROVIDER=deepseek/);
  assert.match(written,/ISSUANCE_DEEPSEEK_TIMEOUT_MS=45000/);
  await prepareLocalIssuanceAi(dir,options);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),written);
  assert.equal(await readFile(join(dir,'.dev.vars.deepseek'),'utf8'),privateText);
  assert.equal(written.match(/^DEEPSEEK_API_KEY=/gm).length,1);
}));

test('environment and existing private main configuration can supply the DeepSeek key', async () => {
  for(const source of ['environment','main']) await fixture(async dir=>{
    await writeFile(join(dir,'.dev.vars'),source==='main'?`DEEPSEEK_API_KEY="${key}"\nDEEPSEEK_MODEL=deepseek-v4-pro\n`:'');
    const env=source==='environment'?{DEEPSEEK_API_KEY:key,DEEPSEEK_MODEL:'deepseek-v4-pro'}:{};
    const result=await prepareLocalIssuanceAi(dir,{env,fetchImpl:async()=>directory()});
    assert.equal(result.model,'deepseek-v4-pro');
    assert.equal(result.provider,'deepseek');
  });
});

test('a new beta folder reuses the read-only shared issuance key from a fake LOCALAPPDATA', async () => fixture(async dir=>{
  const runtime=join(dir,'new-beta'),appdata=join(dir,'fake-appdata');
  const secrets=join(appdata,'BondCentreBeta','secrets');
  await mkdir(runtime);await mkdir(secrets,{recursive:true});
  const sharedFile=join(secrets,'issuance-deepseek.env');
  const shared=`# Issuance recognition only\nDEEPSEEK_API_KEY=${key}\nDEEPSEEK_MODEL=do-not-import-this-setting\n`;
  await writeFile(sharedFile,shared);
  const result=await prepareLocalIssuanceAi(runtime,{env:{LOCALAPPDATA:appdata},fetchImpl:async(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/models');assert.equal(init.headers.Authorization,'Bearer '+key);return directory();
  }});
  assert.equal(result.provider,'deepseek');assert.equal(result.model,'deepseek-flash');
  assert.equal((await readFile(join(runtime,'.dev.vars'),'utf8')).includes('DEEPSEEK_API_KEY='+key),true);
  assert.equal(await readFile(sharedFile,'utf8'),shared);
}));

test('a runtime key takes priority over existing and shared credentials without changing the shared file', async () => fixture(async dir=>{
  const runtime=join(dir,'existing-beta'),appdata=join(dir,'fake-appdata');
  const secrets=join(appdata,'BondCentreBeta','secrets');
  await mkdir(runtime);await mkdir(secrets,{recursive:true});
  const sharedFile=join(secrets,'issuance-deepseek.env');
  const shared='DEEPSEEK_API_KEY=sk-test-only-shared-credential-1234567890\n';
  await writeFile(sharedFile,shared);
  await writeFile(join(runtime,'.dev.vars'),'DEEPSEEK_API_KEY=sk-test-only-older-credential-1234567890\n');
  await writeFile(join(runtime,'.dev.vars.deepseek'),'DEEPSEEK_API_KEY='+key+'\n');
  const result=await prepareLocalIssuanceAi(runtime,{env:{LOCALAPPDATA:appdata},fetchImpl:async(_url,init)=>{
    assert.equal(init.headers.Authorization,'Bearer '+key);return directory();
  }});
  assert.equal(result.provider,'deepseek');
  assert.equal(await readFile(sharedFile,'utf8'),shared);
  assert.equal((await readFile(join(runtime,'.dev.vars'),'utf8')).includes('DEEPSEEK_API_KEY='+key),true);
}));

test('explicit legacy selection does not contact DeepSeek even when its key is present', async () => fixture(async dir=>{
  await writeFile(join(dir,'.dev.vars'),`ISSUANCE_AI_PROVIDER=legacy\nDEEPSEEK_API_KEY=${key}\n`);
  const result=await prepareLocalIssuanceAi(dir,{env:{LOCAL_ISSUANCE_AI_TOKEN:localToken},fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:11435/health');return localHealth();}});
  assert.equal(result.provider,'legacy');
  assert.match(await readFile(join(dir,'.dev.vars'),'utf8'),/ISSUANCE_AI_PROVIDER=legacy/);
}));

test('an explicitly requested DeepSeek provider cannot silently run without its key', async () => fixture(async dir=>{
  const original='QB_ACCESS_KEY=test-only-qb\nISSUANCE_AI_PROVIDER=deepseek\n';
  await writeFile(join(dir,'.dev.vars'),original);
  await assert.rejects(prepareLocalIssuanceAi(dir,{env:{LOCAL_ISSUANCE_AI_TOKEN:localToken},fetchImpl:async()=>{throw Error('must not call');}}),/DeepSeek API key is missing/);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),original);
}));

test('an explicit environment rollback persists legacy selection without deleting the DeepSeek key', async () => fixture(async dir=>{
  await writeFile(join(dir,'.dev.vars'),`ISSUANCE_AI_PROVIDER=deepseek\nDEEPSEEK_API_KEY=${key}\n`);
  const result=await prepareLocalIssuanceAi(dir,{env:{ISSUANCE_AI_PROVIDER:'legacy',LOCAL_ISSUANCE_AI_TOKEN:localToken},fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:11435/health');return localHealth();}});
  assert.equal(result.provider,'legacy');
  const written=await readFile(join(dir,'.dev.vars'),'utf8');
  assert.match(written,/ISSUANCE_AI_PROVIDER=legacy/);
  assert.equal(written.includes('DEEPSEEK_API_KEY='+key),true);
  assert.equal(written.match(/^ISSUANCE_AI_PROVIDER=/gm).length,1);
}));

test('failed directory authentication, network, protocol or availability checks retain existing settings and redact details', async () => {
  const upstreamText='unexpected body with '+key;
  for(const fetchImpl of [
    async()=>new Response(upstreamText,{status:401}),
    async()=>{throw Error(upstreamText);},
    async()=>Response.json({data:[{id:'unavailable-model'}]}),
    async()=>new Response(upstreamText),
    async()=>new Response(' '.repeat(256001)),
    async()=>new Response('{}',{headers:{'Content-Length':'256001'}}),
  ]) await fixture(async dir=>{
    const original='QB_ACCESS_KEY=test-only-qb\n';await writeFile(join(dir,'.dev.vars'),original);
    await assert.rejects(prepareLocalIssuanceAi(dir,{env:{DEEPSEEK_API_KEY:key},fetchImpl}),error=>{assert.equal(String(error).includes(key),false);return true;});
    assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),original);
  });
});

test('unsafe credentials, unsupported model and invalid timeout are rejected before requests', async () => {
  for(const env of [
    {DEEPSEEK_API_KEY:key+'#comment'},
    {DEEPSEEK_API_KEY:key+'\nINJECTED=true'},
    {DEEPSEEK_API_KEY:key,DEEPSEEK_MODEL:'unapproved'},
    {DEEPSEEK_API_KEY:key,ISSUANCE_DEEPSEEK_TIMEOUT_MS:'90001'},
  ]) await fixture(async dir=>{
    await assert.rejects(prepareLocalIssuanceAi(dir,{env,fetchImpl:async()=>{assert.fail('must not request');}}));
    await assert.rejects(readFile(join(dir,'.dev.vars'),'utf8'),{code:'ENOENT'});
  });
});

test('non-success model-directory responses release their body without parsing provider details', async () => fixture(async dir=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(key));},cancel(){cancelled=true;}}),{status:401});
  await assert.rejects(prepareLocalIssuanceAi(dir,{env:{DEEPSEEK_API_KEY:key},fetchImpl:async()=>response}),/HTTP 401/);
  assert.equal(cancelled,true);
  await assert.rejects(readFile(join(dir,'.dev.vars'),'utf8'),{code:'ENOENT'});
}));

test('configuration changes during the model check are not overwritten', async () => fixture(async dir=>{
  await writeFile(join(dir,'.dev.vars'),'QB_ACCESS_KEY=before\n');
  await assert.rejects(prepareLocalIssuanceAi(dir,{env:{DEEPSEEK_API_KEY:key},fetchImpl:async()=>{
    await writeFile(join(dir,'.dev.vars'),'QB_ACCESS_KEY=changed-in-another-window\n');return directory();
  }}),/changed during preparation/);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),'QB_ACCESS_KEY=changed-in-another-window\n');
}));
