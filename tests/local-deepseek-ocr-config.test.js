import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareDeepseekOcr } from '../tools/prepare-deepseek-ocr.mjs';
import { prepareLocalIssuanceAi } from '../tools/prepare-local-issuance-ai.mjs';

const ocrKey = 'sk-test-only-ocr-credential-1234567890';
const issuanceKey = 'sk-test-only-issuance-credential-1234567890';
const models = () => Response.json({data:[{id:'deepseek-flash'}]});
async function fixture(work) {
  const prefix=resolve(tmpdir(),'bond-ocr-config-'), dir=await mkdtemp(prefix);
  try { await work(dir); }
  finally { assert.ok(resolve(dir).startsWith(prefix)); await rm(dir,{recursive:true,force:true}); }
}

test('OCR preparation ignores generic issuance credentials and an unfilled dedicated template', async () => fixture(async dir=>{
  // A directory guards against accidental reads of the issuance private file.
  await mkdir(join(dir,'.dev.vars.deepseek'));
  await writeFile(join(dir,'.dev.vars.deepseek-ocr'),'OCR_AI_PROVIDER=deepseek\nDEEPSEEK_OCR_API_KEY=\n');
  const original=`DEEPSEEK_API_KEY=${issuanceKey}\nISSUANCE_AI_PROVIDER=deepseek\n`;
  await writeFile(join(dir,'.dev.vars'),original);
  const result=await prepareDeepseekOcr(dir,original,{env:{DEEPSEEK_API_KEY:issuanceKey},fetchImpl:()=>assert.fail('must not use an issuance credential')});
  assert.equal(result,null);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),original);
}));

test('OCR uses only its dedicated key and preserves issuance and market credentials idempotently', async () => fixture(async dir=>{
  const privateText=`DEEPSEEK_OCR_API_KEY=${ocrKey}\n`;
  await writeFile(join(dir,'.dev.vars.deepseek-ocr'),privateText);
  const original=`DEEPSEEK_API_KEY=${issuanceKey}\nISSUANCE_AI_PROVIDER=deepseek\nQB_ACCESS_KEY=test-only-qb\n`;
  await writeFile(join(dir,'.dev.vars'),original);
  const requests=[];
  const options={env:{DEEPSEEK_API_KEY:issuanceKey},fetchImpl:async(url,init)=>{requests.push({url,init});return models();}};
  const result=await prepareDeepseekOcr(dir,original,options);
  assert.deepEqual(result,{configured:true,provider:'deepseek',model:'deepseek-flash',healthy:true,processingApproved:true});
  assert.equal(JSON.stringify(result).includes(ocrKey),false);
  assert.equal(requests[0].url,'https://api.deepseek.com/models');
  assert.equal(requests[0].init.method,'GET');assert.equal(requests[0].init.redirect,'error');
  assert.equal(requests[0].init.headers.Authorization,'Bearer '+ocrKey);assert.equal(requests[0].init.body,undefined);
  const current=await readFile(join(dir,'.dev.vars'),'utf8');
  assert.ok(current.includes(original.trimEnd()));
  assert.match(current,/AI_PROCESSING_APPROVED=true/);
  await prepareDeepseekOcr(dir,current,options);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),current);
  assert.equal(await readFile(join(dir,'.dev.vars.deepseek-ocr'),'utf8'),privateText);
  assert.equal(current.match(/^DEEPSEEK_OCR_API_KEY=/gm).length,1);
}));

test('OCR key sources are scoped to the environment, runtime or OCR-only shared file', async () => {
  for(const source of ['environment','runtime','main','shared']) await fixture(async dir=>{
    const appdata=join(dir,'fake-local-appdata'), secrets=join(appdata,'BondCentreBeta','secrets');
    await mkdir(secrets,{recursive:true});
    const sharedFile=join(secrets,'ocr-deepseek.env');
    const original=source==='main'?`DEEPSEEK_OCR_API_KEY=${ocrKey}\n`:'';
    await writeFile(join(dir,'.dev.vars'),original);
    await writeFile(sharedFile,source==='shared'?`DEEPSEEK_OCR_API_KEY=${ocrKey}\n`:'DEEPSEEK_API_KEY=must-not-reuse-generic-key\n');
    if(source==='runtime')await writeFile(join(dir,'.dev.vars.deepseek-ocr'),`DEEPSEEK_OCR_API_KEY=${ocrKey}\n`);
    const beforeShared=await readFile(sharedFile,'utf8');
    const env={LOCALAPPDATA:appdata,DEEPSEEK_API_KEY:issuanceKey,...(source==='environment'?{DEEPSEEK_OCR_API_KEY:ocrKey}:{})};
    const result=await prepareDeepseekOcr(dir,original,{env,fetchImpl:async(_url,init)=>{assert.equal(init.headers.Authorization,'Bearer '+ocrKey);return models();}});
    assert.equal(result.provider,'deepseek');assert.equal(await readFile(sharedFile,'utf8'),beforeShared);
  });
});

test('explicit OCR DeepSeek mode fails closed without its own key', async () => {
  for(const from of ['environment','main'])await fixture(async dir=>{
    const original=from==='main'?'OCR_AI_PROVIDER=deepseek\n':'';await writeFile(join(dir,'.dev.vars'),original);
    const env={DEEPSEEK_API_KEY:issuanceKey,...(from==='environment'?{OCR_AI_PROVIDER:'deepseek'}:{})};
    await assert.rejects(prepareDeepseekOcr(dir,original,{env,fetchImpl:()=>assert.fail('must not request')}),/OCR-only DeepSeek API key is missing/);
    assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),original);
  });
});

test('explicit OCR legacy selection persists a rollback without removing either credential', async () => fixture(async dir=>{
  const original=`OCR_AI_PROVIDER=deepseek\nDEEPSEEK_OCR_API_KEY=${ocrKey}\nDEEPSEEK_API_KEY=${issuanceKey}\n`;
  await writeFile(join(dir,'.dev.vars'),original);
  const result=await prepareDeepseekOcr(dir,original,{env:{OCR_AI_PROVIDER:'legacy'},fetchImpl:()=>assert.fail('must not request')});
  assert.equal(result.provider,'legacy');
  const written=await readFile(join(dir,'.dev.vars'),'utf8');
  assert.match(written,/OCR_AI_PROVIDER=legacy/);
  assert.equal(written.includes('DEEPSEEK_OCR_API_KEY='+ocrKey),true);assert.equal(written.includes('DEEPSEEK_API_KEY='+issuanceKey),true);
}));

test('OCR cannot silently override an explicit processing-authorization denial', async () => {
  for(const source of ['environment','main'])await fixture(async dir=>{
    const original=source==='main'?'AI_PROCESSING_APPROVED=false\n':'';await writeFile(join(dir,'.dev.vars'),original);
    const env={DEEPSEEK_OCR_API_KEY:ocrKey,...(source==='environment'?{AI_PROCESSING_APPROVED:'false'}:{})};
    const result=await prepareDeepseekOcr(dir,original,{env,fetchImpl:async()=>models()});
    assert.equal(result.processingApproved,false);
    assert.match(await readFile(join(dir,'.dev.vars'),'utf8'),/AI_PROCESSING_APPROVED=false/);
  });
});

test('OCR invalid credentials, unavailable model and failed network checks never expose or overwrite secrets', async () => {
  for(const fetchImpl of [
    async()=>new Response(ocrKey,{status:401}),
    async()=>{throw Error(ocrKey);},
    async()=>Response.json({data:[{id:'other-model'}]}),
    async()=>new Response(ocrKey),
    async()=>new Response(' '.repeat(256001)),
  ])await fixture(async dir=>{
    const original=`DEEPSEEK_API_KEY=${issuanceKey}\n`;await writeFile(join(dir,'.dev.vars'),original);
    await assert.rejects(prepareDeepseekOcr(dir,original,{env:{DEEPSEEK_OCR_API_KEY:ocrKey},fetchImpl}),error=>{assert.equal(String(error).includes(ocrKey),false);return true;});
    assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),original);
  });
  await fixture(async dir=>{
    await assert.rejects(prepareDeepseekOcr(dir,'',{env:{DEEPSEEK_OCR_API_KEY:ocrKey,DEEPSEEK_OCR_MODEL:'deepseek-v4-pro'},fetchImpl:()=>assert.fail('must not request')}),/must be deepseek-flash/);
  });
});

test('OCR preparation does not overwrite simultaneous configuration edits', async () => fixture(async dir=>{
  const original='QB_ACCESS_KEY=before\n';await writeFile(join(dir,'.dev.vars'),original);
  await assert.rejects(prepareDeepseekOcr(dir,original,{env:{DEEPSEEK_OCR_API_KEY:ocrKey},fetchImpl:async()=>{await writeFile(join(dir,'.dev.vars'),'QB_ACCESS_KEY=changed\n');return models();}}),/changed during OCR preparation/);
  assert.equal(await readFile(join(dir,'.dev.vars'),'utf8'),'QB_ACCESS_KEY=changed\n');
}));

test('combined beta preparation checks issuance and OCR sequentially with independent credentials', async () => fixture(async dir=>{
  let beginFirst,finishFirst;
  const firstStarted=new Promise(resolve=>{beginFirst=resolve;}),firstGate=new Promise(resolve=>{finishFirst=resolve;});
  const seen=[];
  const work=prepareLocalIssuanceAi(dir,{env:{DEEPSEEK_API_KEY:issuanceKey,DEEPSEEK_OCR_API_KEY:ocrKey},fetchImpl:async(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/models');seen.push(init.headers.Authorization);
    if(seen.length===1){beginFirst();await firstGate;}
    return models();
  }});
  await firstStarted;assert.deepEqual(seen,['Bearer '+issuanceKey]);finishFirst();
  const result=await work;
  assert.deepEqual(seen,['Bearer '+issuanceKey,'Bearer '+ocrKey]);
  assert.equal(result.provider,'deepseek');assert.equal(result.ocr.provider,'deepseek');
  const written=await readFile(join(dir,'.dev.vars'),'utf8');
  assert.equal(written.includes('DEEPSEEK_API_KEY='+issuanceKey),true);assert.equal(written.includes('DEEPSEEK_OCR_API_KEY='+ocrKey),true);
}));
