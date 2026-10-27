import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareLocalIssuanceAi } from '../tools/prepare-local-issuance-ai.mjs';

const token = 'test-only-local-credential-1234567890';
const health = () => Response.json({status:'ok',model:'gpt-oss:20b',promptRevision:'local-20b-20260904-1',busy:false});
async function fixture(work) { const prefix = resolve(tmpdir(),'bond-local-ai-'); const dir = await mkdtemp(prefix); try { await work(dir); } finally { assert.ok(resolve(dir).startsWith(prefix)); await rm(dir,{recursive:true,force:true}); } }

test('local AI preparation preserves unrelated credentials and is repeatable without duplicate entries', async () => fixture(async dir => {
  const original = '# private test config\nQB_ACCESS_KEY=test-only-qb\nISSUANCE_LOCAL_AI_ENABLED=false\n';
  await writeFile(join(dir,'.dev.vars'),original);
  let calls=0;
  const options={env:{LOCAL_ISSUANCE_AI_TOKEN:token},fetchImpl:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:11435/health');assert.equal(options.headers.Authorization,'Bearer '+token);return health();}};
  const result=await prepareLocalIssuanceAi(dir,options);
  const first=await readFile(join(dir,'.dev.vars'),'utf8');
  assert.match(first,/# private test config\nQB_ACCESS_KEY=test-only-qb/);
  assert.equal(first.match(/^ISSUANCE_LOCAL_AI_TOKEN=/gm).length,1);
  assert.match(first,/ISSUANCE_LOCAL_AI_ENABLED=true/);
  assert.match(first,/ISSUANCE_LOCAL_AI_TIMEOUT_MS=45000/);
  assert.equal(JSON.stringify(result).includes(token),false);
  await prepareLocalIssuanceAi(dir,options);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),first);
  assert.equal(calls,2);
}));

test('existing private local token can be reused when the parent process lacks its environment variable', async () => fixture(async dir => {
  await writeFile(join(dir,'.dev.vars'),`ISSUANCE_LOCAL_AI_TOKEN="${token}"\n`);
  await prepareLocalIssuanceAi(dir,{env:{},fetchImpl:async()=>health()});
  assert.match(await readFile(join(dir,'.dev.vars'),'utf8'),/ISSUANCE_LOCAL_AI_ENABLED=true/);
}));

test('missing or unsafe local credentials fail before network calls or config changes', async () => fixture(async dir => {
  await writeFile(join(dir,'.dev.vars'),'QB_ACCESS_KEY=test-only-qb\n');
  for(const value of [undefined,'short','test\n'+token,token+'#comment',token+'"quoted']){
    await assert.rejects(prepareLocalIssuanceAi(dir,{env:{LOCAL_ISSUANCE_AI_TOKEN:value},fetchImpl:()=>{throw Error('must not fetch');}}),/credential is missing or unsafe/);
  }
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),'QB_ACCESS_KEY=test-only-qb\n');
}));

test('an unavailable local gateway retains configured credentials and allows the cloud fallback to start', async () => fixture(async dir => {
  await writeFile(join(dir,'.dev.vars'),'QB_ACCESS_KEY=test-only-qb\n');
  await prepareLocalIssuanceAi(dir,{env:{LOCAL_ISSUANCE_AI_TOKEN:token},fetchImpl:async()=>health()});
  const original=await readFile(join(dir,'.dev.vars'),'utf8');
  for(const fetchImpl of [async()=>new Response('',{status:401}),async()=>Response.json({status:'ok',model:'other',promptRevision:'other'}),async()=>{throw Error('offline');}]){
    const result=await prepareLocalIssuanceAi(dir,{env:{LOCAL_ISSUANCE_AI_TOKEN:token},fetchImpl});
    assert.equal(result.configured,true);assert.equal(result.healthy,false);
    assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),original);
  }
}));
