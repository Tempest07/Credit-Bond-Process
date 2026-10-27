import { boundaryReviewPages, parseBoundaryReview, mergeBoundaryReviewDraft, PAYMENT_RECEIPT_BOUNDARY_LABELS } from './payment-receipt-boundary-review.js';

const escape = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function createPaymentReceiptBoundaryReview({container,getContext,getDraft,onApply,getHeaders=()=>({}),onToast=()=>{},fetchImpl=fetch}){
  if(!container)return{render(){},reset(){},destroy(){}};
  let data=null,generation=0,controller=null,proposal=null,busy=false,undoEntry=null;
  const query=selector=>container.querySelector(selector);
  const current=()=>getContext?.()||{fileId:data?.file?.id,data};
  const matches=(snapshot,token)=>token===generation&&current()?.fileId===snapshot.fileId
    &&current()?.data?.file?.updatedAt===snapshot.updatedAt;
  const copyDraft=value=>({groups:value.groups.map(group=>[...group]),blankPages:[...value.blankPages]});
  const sameDraft=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
  function reset(){generation++;controller?.abort();controller=null;data=null;proposal=null;busy=false;undoEntry=null;container.replaceChildren();container.hidden=true;}
  function render(next){
    reset();data=next;
    const count=Number(data?.file?.pageCount);if(!Number.isInteger(count)||count<2)return;
    const uncertain=data.pages?.find(page=>page.classification==='uncertain')?.pageNumber||1;
    const start=Math.max(1,Math.min(count-1,uncertain-1)),length=Math.min(3,count-start+1);
    container.hidden=false;
    container.innerHTML=`<section class="payment-boundary-review"><h3>疑难边界联合复核</h3><div class="payment-boundary-review-controls">
      <label>起始页<input data-boundary-start type="number" min="1" max="${count-1}" step="1" value="${start}"></label>
      <label>相邻页数<select data-boundary-count><option value="2" ${length===2?'selected':''}>2 页</option><option value="3" ${length===3?'selected':''}>3 页</option></select></label>
      <button type="button" class="button subtle" data-boundary-review>联合复核</button>
      <button type="button" class="button subtle" data-boundary-undo aria-label="撤销本次自动填入" hidden>撤销</button></div>
      <p role="status" aria-live="polite" data-boundary-status></p><div data-boundary-results></div></section>`;
  }
  function status(message){const element=query('[data-boundary-status]');if(element)element.textContent=message;}
  function syncUndo(){const button=query('[data-boundary-undo]');if(button){button.hidden=!undoEntry;button.disabled=busy;}}
  function setBusy(value){busy=value;for(const selector of ['[data-boundary-start]','[data-boundary-count]','[data-boundary-review]']){const element=query(selector);if(element)element.disabled=value;}const button=query('[data-boundary-review]');if(button)button.textContent=value?'联合复核中…':'联合复核';syncUndo();}
  function renderProposal(){
    query('[data-boundary-results]').innerHTML=proposal.pages.map(row=>`<article class="payment-boundary-review-page ${escape(row.classification)}"><header><strong>第 ${row.pageNumber} 页</strong><span>${escape(PAYMENT_RECEIPT_BOUNDARY_LABELS[row.classification])} · ${Math.round(row.confidence*100)}%</span></header>
      ${row.textEvidence?`<blockquote>${escape(row.textEvidence)}</blockquote>`:''}<p>${escape(row.visualReason)}</p>
      <details><summary>本页原文摘录</summary><pre>${escape(row.recognizedText||'未读到业务文字')}</pre></details></article>`).join('');
  }
  async function review(){
    if(busy||!data)return;
    const context=current(),snapshot={fileId:context?.fileId,updatedAt:context?.data?.file?.updatedAt};
    if(!snapshot.fileId||!snapshot.updatedAt)return;
    let pages;
    try{const start=Number(query('[data-boundary-start]').value),length=Number(query('[data-boundary-count]').value);if(![2,3].includes(length))throw new Error('请选择相邻的 2–3 页');pages=boundaryReviewPages(Array.from({length},(_,index)=>start+index),Number(data.file.pageCount));}
    catch(error){status(error.message);return;}
    const token=++generation;controller?.abort();controller=new AbortController();proposal=null;query('[data-boundary-results]').replaceChildren();setBusy(true);status('正在对照相邻原页，原有拆页保持不变。');
    try{
      const response=await fetchImpl(`./api/payment-receipt-files/${encodeURIComponent(snapshot.fileId)}/boundary-review`,{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json',...getHeaders()},body:JSON.stringify({action:'preview',pages,expectedUpdatedAt:snapshot.updatedAt}),signal:controller.signal});
      const payload=await response.json();if(!matches(snapshot,token))return;
      if(!response.ok)throw new Error(payload.error||'联合复核失败，请稍后重试');
      if(payload.fileId!==snapshot.fileId||payload.fileUpdatedAt!==snapshot.updatedAt||payload.pageCount!==data.file.pageCount)throw new Error('原件状态已变化，请重新打开拆页修正');
      const result=payload.proposal;
      // The same pure validator checks the page set again before any draft use.
      boundaryReviewPages(result?.pageNumbers,Number(data.file.pageCount));
      if(JSON.stringify(result.pageNumbers)!==JSON.stringify(pages))throw new Error('建议页码与本次选择不符，请重新复核');
      proposal={...result,...parseBoundaryReview({pages:result.pages},pages,Number(data.file.pageCount)),fileId:snapshot.fileId,fileUpdatedAt:snapshot.updatedAt};renderProposal();
      if(proposal.canApply)apply();
      else status('部分页面仍不确定，未更改拆页草稿，请对照原件手工修正。');
    }catch(error){if(matches(snapshot,token)&&error?.name!=='AbortError')status(error.message||'联合复核失败，请稍后重试');}
    finally{if(matches(snapshot,token)){controller=null;setBusy(false);}}
  }
  function apply(){
    if(!proposal)return;
    const context=current();if(context?.fileId!==proposal.fileId||context?.data?.file?.updatedAt!==proposal.fileUpdatedAt){status('原件状态已变化，请重新复核');return;}
    try{
      // Read the latest draft: edits made while review was pending must survive.
      const before=copyDraft(getDraft()),merged=mergeBoundaryReviewDraft(before,proposal,Number(data.file.pageCount));
      if(sameDraft(before,merged)){status('复核完成，当前拆页草稿已与结果一致，无需调整。');return;}
      onApply(copyDraft(merged));
      undoEntry={before,after:copyDraft(merged),fileId:proposal.fileId,updatedAt:proposal.fileUpdatedAt};syncUndo();
      status('已自动填入拆页草稿，可撤销；尚未保存。');onToast('已更新拆页草稿，可撤销。');
    }
    catch(error){status(error.message||'当前草稿无法采用建议，请人工核对');}
  }
  function undo(){
    if(busy||!undoEntry)return;
    const context=current(),entry=undoEntry;
    if(context?.fileId!==entry.fileId||context?.data?.file?.updatedAt!==entry.updatedAt){undoEntry=null;syncUndo();status('原件状态已变化，未撤销，请重新打开拆页修正。');return;}
    try{
      if(!sameDraft(copyDraft(getDraft()),entry.after)){undoEntry=null;syncUndo();status('草稿已有后续修改，未撤销，以免覆盖手工调整。');return;}
      onApply(copyDraft(entry.before));undoEntry=null;syncUndo();status('已撤销本次自动填入，拆页草稿尚未保存。');onToast('已撤销本次自动填入。');
    }catch(error){status(error.message||'当前草稿无法撤销，请人工核对');}
  }
  function click(event){if(event.target.closest('[data-boundary-review]'))void review();else if(event.target.closest('[data-boundary-undo]'))undo();}
  function change(event){if(!event.target.matches('[data-boundary-start],[data-boundary-count]'))return;generation++;controller?.abort();controller=null;setBusy(false);proposal=null;query('[data-boundary-results]')?.replaceChildren();status('');}
  function keydown(event){if(event.key==='Enter'&&event.target.matches('[data-boundary-start],[data-boundary-count]')){event.preventDefault();event.stopPropagation();void review();}}
  container.addEventListener('click',click);container.addEventListener('change',change);container.addEventListener('input',change);container.addEventListener('keydown',keydown);
  return{render,reset,destroy(){reset();container.removeEventListener('click',click);container.removeEventListener('change',change);container.removeEventListener('input',change);container.removeEventListener('keydown',keydown);}};
}
