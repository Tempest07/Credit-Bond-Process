import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
function load(context,name){
  const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0);
  const tail=source.slice(start),end=tail.slice(1).search(/\n(?:async )?function /);
  vm.runInContext(end<0?tail:tail.slice(0,end+1),context);
}
test('a source switch invalidates queries and caches without saving or replacing business state',()=>{
  const state={projects:[{id:'one',note:'unsaved'}]},calls=[];
  const cache=()=>({resetDataSource:()=>calls.push('reset')});
  const context=vm.createContext({dataSourceGeneration:0,state,clearTimeout(){},valuationAssistTimer:null,
    valuationAssistController:{abort(){calls.push('abort');}},policyCurveController:{abort(){calls.push('abort');}},
    valuationAssistRequestKey:'old',renderedValuationPayload:{old:true},
    secondaryPendingDmLoading:true,secondaryLedgerDmLoading:true,projectScreenshotRows:[],refreshMarketDataLabels(){},
    paymentTodoCodes:cache(),bondListController:cache(),realtimeQuoteController:cache(),
    cancelProjectDmLookup:()=>calls.push('cancel'),cancelDmLookup:()=>calls.push('cancel'),resetModelValuationAssist:()=>calls.push('model'),
    updateSecondaryPendingControls(){},updateSecondaryLedgerControls(){},$:()=>null,
    persistState(){throw Error('must not write');},persistLocal(){throw Error('must not write');},saveCloudState(){throw Error('must not write');}});
  load(context,'handleDataSourceChange');context.handleDataSourceChange();
  assert.equal(context.dataSourceGeneration,1);assert.equal(context.state,state);
  assert.equal(state.projects[0].note,'unsaved');assert.equal(context.valuationAssistRequestKey,'');
  assert.equal(calls.filter(v=>v==='reset').length,3);
});
test('late policy curve results cannot replace the current source display',async()=>{
  let resolve;const displayed=[];
  const context=vm.createContext({LOCAL_BETA:false,dataSourceGeneration:0,AbortController,policyCurveController:null,
    $:()=>({}),authHeaders:()=>({}),localBetaManualHeaders:()=>({}),DM_POLICY_CURVE_URL:'./curve',parseJson:JSON.parse,
    renderPolicyCurveMessage(){},renderPolicyCurve:p=>displayed.push(p),fetch:()=>new Promise(r=>{resolve=r;})});
  load(context,'loadPolicyCurve');const pending=context.loadPolicyCurve();
  context.policyCurveController.abort();context.policyCurveController=null;
  resolve({ok:true,text:async()=>JSON.stringify({ok:true,nodes:[{yield:1.5}]})});await pending;
  assert.equal(displayed.length,0);
});
test('trade batches stop after switching mode and do not merge mixed-source records',async()=>{
  let resolve,calls=0;
  const context=vm.createContext({dataSourceGeneration:0,LOCAL_BETA:false,DOMException,DM_TRADE_RECORDS_URL:'./trades',
    authHeaders:()=>({}),localBetaManualHeaders:()=>({}),parseJson:JSON.parse,
    fetch:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  load(context,'requestTradeRecordDmRows');
  const pending=context.requestTradeRecordDmRows(Array.from({length:81},(_,i)=>({id:String(i)})));
  context.dataSourceGeneration++;
  resolve({ok:true,text:async()=>JSON.stringify({ok:true,rows:[{id:'0'}]})});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('late secondary enrichment cannot mutate drafts or clear the new request loading state',async()=>{
  for(const name of ['enrichSecondaryPendingFromDm','enrichSecondaryLedgerFromDm']){
    let resolve,merges=0;
    const original=[{id:'one',record:{note:'manual'}}];
    const context=vm.createContext({dataSourceGeneration:0,LOCAL_BETA:false,secondaryLedgerDateValue:()=>'',
      ensureSecondaryPendingDraft:()=>original,ensureSecondaryLedgerDraft:()=>original,
      tradeRecordDmRequestRows:()=>[{id:'one'}],tradeRecordDmDependencyKey:()=>'',
      secondaryPendingDraftRows:original,secondaryLedgerDraftRows:original,
      updateSecondaryPendingControls(){},updateSecondaryLedgerControls(){},
      requestTradeRecordDmRows:()=>new Promise(r=>{resolve=r;}),
      mergeTradeRecordDmResults:()=>{merges++;return [];}});
    load(context,name);const pending=context[name]();
    context.dataSourceGeneration++;context.secondaryPendingDmLoading=true;context.secondaryLedgerDmLoading=true;
    resolve({rows:[{id:'one'}],failedIds:[],errors:[]});await pending;
    assert.equal(merges,0);assert.equal(context.secondaryPendingDraftRows,original);
    assert.equal(context.secondaryPendingDmLoading,true);assert.equal(context.secondaryLedgerDmLoading,true);
  }
});
