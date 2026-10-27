import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaymentReceiptBoundaryReview} from '../payment-receipt-boundary-ui.js';

const rows=(classification='receipt_start')=>[1,2].map(pageNumber=>({pageNumber,classification:pageNumber===1?'receipt_start':classification,confidence:.99,
  recognizedText:'缴款通知书\n26测试MTN001',textEvidence:'缴款通知书',visualReason:'图片有完整标题',uncertainties:[]}));
const payload=(extra={})=>({ok:true,fileId:'file',fileUpdatedAt:'v1',pageCount:4,cached:false,proposal:{pageNumbers:[1,2],pages:rows(),canApply:true},...extra});
const response=value=>({ok:true,json:async()=>value});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(options={}){
  const listeners=new Map(),elements=new Map();
  const make=(selector,value='')=>{const node={value,disabled:false,textContent:'',innerHTML:'',replaceChildren(){this.innerHTML='';},matches(selectors){return selectors.split(',').includes(selector);},closest(match){return match===selector?this:null;}};elements.set(selector,node);return node;};
  for(const selector of ['[data-boundary-start]','[data-boundary-count]','[data-boundary-status]','[data-boundary-results]','[data-boundary-review]','[data-boundary-undo]'])make(selector);
  const container={hidden:true,_html:'',querySelector:selector=>elements.get(selector),replaceChildren(){this._html='';},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},
    set innerHTML(html){this._html=html;elements.get('[data-boundary-start]').value=html.match(/data-boundary-start[^>]*value="(\d+)"/)?.[1]||'1';elements.get('[data-boundary-count]').value='3';},get innerHTML(){return this._html;}};
  const data={file:{id:'file',updatedAt:'v1',pageCount:4},pages:[],groups:[[1,2,3,4]],blankPages:[]};
  let context={fileId:'file',data},draft={groups:[[1,2,3,4]],blankPages:[]};
  const requests=[],applied=[],toasts=[];
  const controller=createPaymentReceiptBoundaryReview({container,getContext:()=>context,getDraft:()=>draft,onApply:value=>{applied.push(value);draft=JSON.parse(JSON.stringify(value));},onToast:value=>toasts.push(value),
    getHeaders:()=>({'X-Test-Auth':'present'}),fetchImpl:async(url,init)=>{requests.push({url,init});return options.fetchImpl?options.fetchImpl(url,init):response(payload());}});
  controller.render(data);elements.get('[data-boundary-count]').value='2';
  return{controller,container,elements,requests,applied,toasts,data,setContext:value=>context=value,setDraft:value=>draft=value,getDraft:()=>draft,
    async emit(name,selector,extra={}){listeners.get(name)?.({target:elements.get(selector),...extra});await settle();}};
}
test('review automatically fills the current draft and offers undo without saving',async()=>{
  const h=fixture();h.setDraft({groups:[[1,2],[3,4]],blankPages:[]});await h.emit('click','[data-boundary-review]');
  assert.equal(h.requests.length,1);assert.equal(JSON.parse(h.requests[0].init.body).expectedUpdatedAt,'v1');assert.equal(h.requests[0].init.headers['X-Test-Auth'],'present');
  assert.match(h.elements.get('[data-boundary-results]').innerHTML,/缴款通知书/);
  assert.ok(!h.elements.get('[data-boundary-results]').innerHTML.includes('data-boundary-apply'));
  assert.deepEqual(h.applied,[{groups:[[1],[2],[3,4]],blankPages:[]}]);
  assert.equal(h.elements.get('[data-boundary-undo]').hidden,false);
  await h.emit('click','[data-boundary-undo]');
  assert.deepEqual(h.getDraft(),{groups:[[1,2],[3,4]],blankPages:[]});
  assert.equal(h.elements.get('[data-boundary-undo]').hidden,true);
  assert.equal(h.requests.length,1,'filling does not invoke the final regroup API');
});
test('reset or source version changes suppress stale model responses and draft application',async()=>{
  let resolve;const pending=new Promise(yes=>resolve=yes);const h=fixture({fetchImpl:()=>pending});
  await h.emit('click','[data-boundary-review]');h.controller.reset();resolve(response(payload()));await settle();
  assert.equal(h.container.hidden,true);assert.equal(h.applied.length,0);
  let resolveChanged;const changed=fixture({fetchImpl:()=>new Promise(yes=>resolveChanged=yes)});await changed.emit('click','[data-boundary-review]');changed.setContext({fileId:'file',data:{file:{updatedAt:'v2'}}});
  resolveChanged(response(payload()));await settle();assert.equal(changed.applied.length,0);
});
test('uncertain suggestions, unsafe model markup and incomplete manual drafts do not apply',async()=>{
  const uncertain=fixture({fetchImpl:async()=>response(payload({proposal:{pageNumbers:[1,2],pages:rows('uncertain'),canApply:false}}))});
  await uncertain.emit('click','[data-boundary-review]');assert.equal(uncertain.applied.length,0);
  const html=fixture({fetchImpl:async()=>response(payload({proposal:{pageNumbers:[1,2],pages:rows().map(row=>({...row,visualReason:'<img onerror="steal()">'})),canApply:true}}))});
  html.setDraft({groups:[[1,2]],blankPages:[]});await html.emit('click','[data-boundary-review]');assert.match(html.elements.get('[data-boundary-results]').innerHTML,/&lt;img/);assert.ok(!html.elements.get('[data-boundary-results]').innerHTML.includes('<img onerror'));
  assert.equal(html.applied.length,0);
});
test('changing selected pages discards the old proposal and Enter requests review instead of submitting the parent form',async()=>{
  const h=fixture();await h.emit('click','[data-boundary-review]');h.elements.get('[data-boundary-start]').value='2';await h.emit('input','[data-boundary-start]');
  await h.emit('click','[data-boundary-undo]');assert.deepEqual(h.getDraft(),{groups:[[1,2,3,4]],blankPages:[]});
  h.elements.get('[data-boundary-start]').value='1';let prevented=false,stopped=false;
  await h.emit('keydown','[data-boundary-start]',{key:'Enter',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(h.requests.length,2);assert.equal(h.applied.length,3);
});

test('cached no-op reviews retain the original undo snapshot',async()=>{
  const h=fixture({fetchImpl:async()=>response(payload({cached:true}))});
  await h.emit('click','[data-boundary-review]');await h.emit('click','[data-boundary-review]');
  assert.equal(h.applied.length,1);await h.emit('click','[data-boundary-undo]');
  assert.deepEqual(h.getDraft(),{groups:[[1,2,3,4]],blankPages:[]});
});

test('pending review merges into the latest manual draft and undo restores that draft',async()=>{
  let resolve;const pending=new Promise(yes=>resolve=yes),h=fixture({fetchImpl:()=>pending});
  await h.emit('click','[data-boundary-review]');h.setDraft({groups:[[1,2],[3],[4]],blankPages:[]});
  resolve(response(payload()));await settle();assert.deepEqual(h.getDraft(),{groups:[[1],[2],[3],[4]],blankPages:[]});
  await h.emit('click','[data-boundary-undo]');assert.deepEqual(h.getDraft(),{groups:[[1,2],[3],[4]],blankPages:[]});
});

test('undo does not overwrite later manual edits or cross a file version',async()=>{
  const h=fixture();await h.emit('click','[data-boundary-review]');h.setDraft({groups:[[1],[2],[3],[4]],blankPages:[]});
  await h.emit('click','[data-boundary-undo]');assert.equal(h.applied.length,1);assert.match(h.elements.get('[data-boundary-status]').textContent,/后续修改/);
  const changed=fixture();await changed.emit('click','[data-boundary-review]');changed.setContext({fileId:'file',data:{file:{updatedAt:'v2'}}});
  await changed.emit('click','[data-boundary-undo]');assert.equal(changed.applied.length,1);assert.match(changed.elements.get('[data-boundary-status]').textContent,/已变化/);
});

test('failed subsequent review retains undo and changing page controls cancels stale responses',async()=>{
  let calls=0;const h=fixture({fetchImpl:async()=>++calls===1?response(payload()):{ok:false,json:async()=>({error:'服务暂不可用'})}});
  await h.emit('click','[data-boundary-review]');await h.emit('click','[data-boundary-review]');await h.emit('click','[data-boundary-undo]');
  assert.deepEqual(h.getDraft(),{groups:[[1,2,3,4]],blankPages:[]});
  let resolve;const pending=new Promise(yes=>resolve=yes),waiting=fixture({fetchImpl:()=>pending});
  await waiting.emit('click','[data-boundary-review]');waiting.elements.get('[data-boundary-start]').value='2';await waiting.emit('input','[data-boundary-start]');
  resolve(response(payload()));await settle();assert.equal(waiting.applied.length,0);assert.equal(waiting.requests[0].init.signal.aborted,true);
});
