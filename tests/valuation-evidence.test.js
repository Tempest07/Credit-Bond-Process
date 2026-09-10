import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValuationOutput, buildCalculationEvidence } from '../valuation-model.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { valuationSample } from '../tools/valuation-sample.mjs';

function example() {
  const evidence = valuationSample();
  evidence.candidates = [evidence.candidates[0]];
  Object.assign(evidence.candidates[0], { years: 4.77, rate: 2.0147, sourceSpreadBp: 3.7 });
  evidence.curve = { date: '2026-09-08', nodes: [{years: 4.77, rate: 1.860112}, {years: 5, rate: 1.8683}] };
  const comparable = { securityId: 'SAMPLE1', weight: 1, tenorAdjustmentBp: .8188, marketAdjustmentBp: 0, adjustedYield: 2.022888, rationale: '保留主体利差，仅取曲线期限差', tenorBasis: {method: 'curve', securityIds: []} };
  const result = {targetIndex:0,center:2.0229,low:null,high:null,reasons:['曲线期限差'],limitations:[],comparables:[comparable],excluded:[]};
  return {evidence, comparable, result, output:{results:[result]}};
}

test('curve adjustment retains issuer spread and accepts independently computed result', () => {
  const x=example(); assert.equal(validateValuationOutput(x.output,x.evidence).ok,true);
});
test('rejects historical market spread misuse even when all arithmetic balances', () => {
  for(const market of [3.7,-15.4588]) {
    const x=example(); x.comparable.marketAdjustmentBp=market;
    x.comparable.adjustedYield+=market/100; x.result.center=Math.round(x.comparable.adjustedYield*10000)/10000;
    assert.match(validateValuationOutput(x.output,x.evidence).errors.join(),/市场调整/);
  }
});
test('rejects reversed curve slope, absent curve, stale curve and invented basis', () => {
  for(const mutate of [x=>{x.comparable.tenorAdjustmentBp=-.8188;x.comparable.adjustedYield=2.006512;x.result.center=2.0065;},x=>x.evidence.curve=null,x=>x.evidence.curve.date='2026-09-07',x=>x.comparable.tenorBasis={method:'guess',securityIds:[]}]) {
    const x=example();mutate(x);assert.equal(validateValuationOutput(x.output,x.evidence).ok,false);
  }
});
test('two point interpolation must reproduce the cited slope for each leg', () => {
  const x=example(); x.evidence.curve=null;
  const a=x.evidence.candidates[0];Object.assign(a,{years:4.46,rate:1.8025});
  x.evidence.candidates.push({...a,securityId:'SAMPLE2',years:6.82,rate:2.0558});
  const adjusted=1.8025+(2.0558-1.8025)/(6.82-4.46)*(5-4.46);
  x.comparable.tenorBasis={method:'bondSlope',securityIds:['SAMPLE1','SAMPLE2']};
  x.comparable.tenorAdjustmentBp=(adjusted-a.rate)*100;x.comparable.adjustedYield=adjusted;x.result.center=Math.round(adjusted*10000)/10000;
  assert.equal(validateValuationOutput(x.output,x.evidence).ok,true);
  x.comparable.tenorAdjustmentBp=8.3;x.comparable.adjustedYield=1.8855;x.result.center=1.8855;
  assert.equal(validateValuationOutput(x.output,x.evidence).ok,false);
  x.evidence.candidates[1].profile={...a.profile,exercisable:true};
  assert.match(validateValuationOutput(x.output,x.evidence).errors.join(),/同属性/);
});
test('single comparable cannot manufacture a reference interval',()=>{
  const x=example();x.result.low=2.01;x.result.high=2.04;
  assert.equal(validateValuationOutput(x.output,x.evidence).ok,false);
});
test('calculation aids do not mix ordinary and tech exchange bonds',()=>{
  const e=valuationSample(); e.candidates=e.candidates.slice(0,2);
  e.candidates.forEach((c,i)=>c.profile={...c.profile,market:'exchange',exchangeTech:Boolean(i)});
  assert.equal(buildCalculationEvidence(e).some(c=>c.options.some(o=>o.method==='bondSlope')),false);
});
test('unadjusted tenor reference requires limitations and is explicitly labelled in UI',()=>{
  const x=example();Object.assign(x.comparable,{tenorAdjustmentBp:0,adjustedYield:2.0147,tenorBasis:{method:'none',securityIds:[]}});x.result.center=2.0147;
  assert.equal(validateValuationOutput(x.output,x.evidence).ok,false);
  x.result.limitations=['缺少期限调整依据，仅展示原始期限参考'];
  assert.equal(validateValuationOutput(x.output,x.evidence).ok,true);
  x.evidence.warnings=['缺少有效隐含评级'];
  const context=vm.createContext({document:{addEventListener(){}},fixture:{evidence:x.evidence,result:{promptVersion:'valuation-evidence-1'},id:'test'},r:x.result});
  const source=readFileSync(new URL('../valuation-assistant.js',import.meta.url),'utf8');
  const html=vm.runInContext(source.replaceAll('export function ', 'function ')+';run=fixture;resultCard(r)',context);
  assert.match(html,/未调整期限参考/);assert.match(html,/缺少有效隐含评级/);assert.match(html,/期限 0.00 bp/);
});
