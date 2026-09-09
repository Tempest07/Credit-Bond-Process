import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateValuationOutput } from '../valuation-model.js';
import { ValuationStore } from '../tools/valuation-store.mjs';
import { valuationSample } from '../tools/valuation-sample.mjs';
import { analyzeValuation } from '../tools/local-valuation-model.mjs';
import { collectModelValuationEvidence } from '../functions/api/dm/valuation.js';
const valid = () => ({results:[{targetIndex:0,center:1.76,low:null,high:null,reasons:['两侧同属性券插值'],limitations:[],comparables:[{securityId:'SAMPLE2',weight:.5,tenorAdjustmentBp:2,marketAdjustmentBp:0,adjustedYield:1.76,rationale:'0.2年按同主体局部斜率10bp/年调整'},{securityId:'SAMPLE3',weight:.5,tenorAdjustmentBp:-2,marketAdjustmentBp:0,adjustedYield:1.76,rationale:'-0.2年按同主体局部斜率10bp/年调整'}],excluded:[]}]});
test('validates basis-point math, references, weights and all targets', () => {
  const evidence=valuationSample();
  assert.equal(validateValuationOutput(valid(),evidence).ok,true);
  for (const change of [r=>r.comparables[0].securityId='INVENTED',r=>r.comparables[0].adjustedYield=3.74,r=>r.comparables[0].weight=.8,r=>r.center=1.8,r=>r.low=1.9,r=>r.targetIndex=9,r=>r.comparables.push(r.comparables[0])]) {
    const out=valid(); change(out.results[0]); assert.equal(validateValuationOutput(out,evidence).ok,false);
  }
  evidence.target.offeringType=''; assert.equal(validateValuationOutput(valid(),evidence).ok,false);
});
test('supports abstention, rejects fabricated prices for missing data',()=>{
  const e=valuationSample();e.candidates=[];
  assert.equal(validateValuationOutput(valid(),e).ok,false);
  const out=valid(); Object.assign(out.results[0],{center:null,comparables:[]});
  assert.equal(validateValuationOutput(out,e).ok,true);
});
test('missing core evidence is refused before inference',async()=>{
  for (const missing of ['offering','prices']) {
    const e=valuationSample();if(missing==='offering')e.target.offeringType='';else e.candidates=[];
    const result=await analyzeValuation(e,{}, {invokeImpl:()=>{throw new Error('must not invoke');}});
    assert.equal(result.decisionSource,'evidence-gate');assert.equal(result.attempts,0);
  }
});
test('DM model evidence keeps more than five raw candidates and prefers latest date',async()=>{
  const bonds=Array.from({length:8},(_,i)=>({securityId:`10260000${i}`,secShortName:`26示例MTN00${i}`,remainingTenor:`${4.5+i/10}Y`}));
  const dm={post:async(path,body)=>{
    if(path.endsWith('/outstanding-bonds'))return bonds;
    if(path.endsWith('/info'))return bonds;
    if(path.endsWith('/date'))return bonds.filter(c=>body.securityIdList.includes(c.securityId)).flatMap((c,i)=>[
      {...c,valuationDate:'2026-09-07',cbYtm:1.7,cbReliability:'推荐'},
      ...(Number(c.securityId.at(-1))<6?[{...c,valuationDate:'2026-09-08',cbYtm:1.75,cbReliability:'推荐'}]:[]),
    ]);
    throw new Error('Unexpected endpoint');
  }};
  const e=await collectModelValuationEvidence(dm,{issuerName:'示例公司',shortName:'新券MTN009',durationText:'5Y',offeringType:'公募',venue:'银行间'}, {now:new Date('2026-09-09T09:00:00Z')});
  assert.equal(e.valuationDate,'2026-09-08');assert.equal(e.candidates.length,6);
  assert.equal(e.candidates.every(c=>c.rate===1.75 && !('adjustedRate' in c)),true);
  assert.equal(e.excluded.length,2);assert.equal('center' in e,false);
});
test('repairs only once and refuses a still-invalid model result',async()=>{
  let calls=0;
  const invokeImpl=async()=>{calls++;const out=valid();if(calls===1) out.results[0].center=9;return {output:out,metrics:{}};};
  const r=await analyzeValuation(valuationSample(),{}, {invokeImpl}); assert.equal(r.attempts,2);
  calls=0;
  await assert.rejects(analyzeValuation(valuationSample(),{}, {invokeImpl:async()=>{calls++;return {output:{},metrics:{}};}}),/核验/);
  assert.equal(calls,2);
});
test('learning survives restart, is confirmed-only, and disabling removes case retrieval too',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'valuation-store-'));
  try {
    const file=join(dir,'learning.json'),store=new ValuationStore(file),e=valuationSample();
    const run=await store.addRun(e,{},'test');await store.finishRun(run.id,{output:valid()});
    const {feedback}=await store.addFeedback(run.id,{targetIndex:0,finalYield:1.76,reason:'优先比较目标两侧的券'});
    const proposal=await store.addProposal(run,feedback,'本主体5Y优先核对两侧券');
    assert.deepEqual(await store.learning(e),{experiences:[],cases:[]});
    await store.setExperience(proposal.id,{status:'confirmed',text:proposal.text,revision:1});
    const restarted=new ValuationStore(file);
    assert.equal((await restarted.learning(e)).experiences.length,1);
    assert.equal((await restarted.learning(e)).cases[0].corrections[0].target.years,5);
    const real=structuredClone(e);real.sample=false;
    assert.equal((await restarted.learning(real)).experiences.length,0);
    const other=structuredClone(e);other.targets[0].years=10;
    assert.equal((await restarted.learning(other)).experiences.length,0);
    await assert.rejects(restarted.setExperience(proposal.id,{status:'disabled',text:proposal.text,revision:1}),/已变化/);
    await restarted.setExperience(proposal.id,{status:'disabled',text:proposal.text,revision:2});
    assert.deepEqual(await restarted.learning(e),{experiences:[],cases:[]});
    assert.equal((await restarted.read()).experiences[0].audit.length,2);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('concurrent appends survive and corrupt persisted data is not overwritten',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'valuation-store-'));
  try {
    const file=join(dir,'learning.json'),store=new ValuationStore(file);
    await Promise.all(Array.from({length:12},()=>store.addRun(valuationSample(),{},'test')));
    assert.equal((await store.read()).runs.length,12);
    await writeFile(file,'broken');
    await assert.rejects(store.addRun(valuationSample(),{},'test'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
