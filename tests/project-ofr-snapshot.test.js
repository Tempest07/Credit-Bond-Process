import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createProjectRecord, normalizeProjectRecord, upsertProject} from '../lifecycle.js';
import {validateState} from '../functions/api/state.js';

test('creation freezes each variety valuation independently and survives JSON storage and later edits', () => {
  const record=createProjectRecord({shortName:'26测试MTN001A/B',shortNames:['26测试MTN001A','26测试MTN001B'],
    tranchePricing:[{marketValuation:1.65},{marketValuation:1.9}]},null,{});
  assert.deepEqual(record.tranches.map(t=>t.initialMarketValuation),[1.65,1.9]);
  assert.ok(record.tranches.every(t=>t.initialMarketValuationAt===record.createdAt));
  const changed=normalizeProjectRecord({...record,tranches:record.tranches.map(t=>({...t,marketValuation:9}))});
  const saved=validateState(upsertProject({issuers:[],projects:[]},changed));
  const roundtrip=normalizeProjectRecord(JSON.parse(JSON.stringify(saved)).projects[0]);
  assert.deepEqual(roundtrip.tranches.map(t=>t.marketValuation),[9,9]);
  assert.deepEqual(roundtrip.tranches.map(t=>t.initialMarketValuation),[1.65,1.9]);
});

test('legacy load never invents a historical creation valuation from a mutable current field', () => {
  const legacy=normalizeProjectRecord({id:'old',shortName:'26旧券CP001',tranches:[{id:'t',shortName:'26旧券CP001',marketValuation:1.8}]});
  assert.equal(Object.hasOwn(legacy.tranches[0],'initialMarketValuation'),false);
  const missing=createProjectRecord({shortName:'26新券CP001'},null,{});
  assert.equal(missing.tranches[0].initialMarketValuation,null);
});

test('re-recognition keeps established entry snapshots and does not backfill legacy or unmatched varieties', async () => {
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const context=vm.createContext({normalizeSourceComparable:x=>String(x||'').replace(/\s/g,'')});
  const start=source.indexOf('function mergeExistingProjectTranche(existing, created) {');
  const end=source.indexOf('\nfunction ',start+1);
  vm.runInContext(source.slice(start,end),context);
  const fresh={shortName:'26测试CP001',marketValuation:2,initialMarketValuation:2,initialMarketValuationAt:'today'};
  const old={id:'same',shortName:'26测试CP001',marketValuation:1.8,initialMarketValuation:1.65,initialMarketValuationAt:'original'};
  const merged=context.mergeExistingProjectTranche(old,fresh);
  assert.equal(merged.initialMarketValuation,1.65);assert.equal(merged.initialMarketValuationAt,'original');assert.equal(merged.marketValuation,2);
  const legacy=context.mergeExistingProjectTranche({id:'legacy',shortName:'26测试CP001'},fresh);
  assert.equal(Object.hasOwn(legacy,'initialMarketValuation'),false);
  assert.equal(Object.hasOwn(context.mergeExistingProjectTranche(null,fresh),'initialMarketValuation'),false);
});
