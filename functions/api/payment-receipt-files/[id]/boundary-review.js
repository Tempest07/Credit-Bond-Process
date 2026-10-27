import { PDFDocument } from 'pdf-lib';
import { apiHeaders,ensureAuthSchema,json,requireUser } from '../../_auth.js';
import { isSameOriginMutation } from '../../_same-origin.js';
import { ensurePaymentReceiptSchema } from '../../_payment-receipts.js';
import { extractPaymentReceiptPageImage } from '../../../../payment-receipt-worker.js';
import { selectDeepSeekOcr } from '../../../../ocr-deepseek.js';
import { PAYMENT_RECEIPT_BOUNDARY_VERSION,boundaryReviewPages,parseBoundaryReview,runBoundaryReview } from '../../../../payment-receipt-boundary-review.js';

const MAX_PDF_BYTES=20*1024*1024, MAX_BODY_BYTES=4096;
const READY=new Set(['processed','review','error']);
const EVENT='boundary_review_proposed';

export async function onRequestPost(context){
  const auth=await requireUser(context);if(auth.response)return auth.response;
  if(!isSameOriginMutation(context.request))return json({error:'请求来源不受信任'},403);
  if(!context.env.DB||!context.env.PAYMENT_RECEIPTS)return json({error:'缴款单数据库或存储尚未配置'},503);
  let lease=null;
  try{
    const body=await readBody(context.request);
    if(body.action!==undefined&&body.action!=='preview')throw fail(400,'联合复核仅支持生成建议');
    if(String(context.env.AI_PROCESSING_APPROVED).trim().toLowerCase()!=='true')throw fail(503,'缴款单图像识别尚未启用');
    // This operation is expressly assigned to the independent OCR credential.
    const ai=selectDeepSeekOcr({...context.env,OCR_AI_PROVIDER:'deepseek'},{fetchImpl:context.fetchImpl,signal:context.request.signal});
    await ensureAuthSchema(context.env.DB);await ensurePaymentReceiptSchema(context.env.DB);
    const file=await ownedFile(context.env.DB,auth.user.id,String(context.params.id||''));
    if(!file)throw fail(404,'未找到原始缴款单附件');
    assertFile(file,body.expectedUpdatedAt);
    const analyses=readObject(file.page_analysis_json);
    file.page_count=Number(file.page_count)||(Array.isArray(analyses)?analyses.length:0);
    let pages;try{pages=boundaryReviewPages(body.pages,Number(file.page_count));}catch(error){throw fail(400,error.message);}
    const id='boundary-review-'+(await hash(new TextEncoder().encode(JSON.stringify([auth.user.id,file.id,file.sha256,file.updated_at,PAYMENT_RECEIPT_BOUNDARY_VERSION,pages]))));
    const cached=await context.env.DB.prepare('SELECT detail_json,created_at FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2 AND batch_id=?3 AND event_type=?4')
      .bind(id,auth.user.id,file.batch_id,EVENT).first();
    if(cached){
      const saved=readObject(cached.detail_json);
      if(saved.status==='complete'&&matches(saved,file,pages)){
        try{
          const proposal={...parseBoundaryReview({pages:saved.proposal?.pages},pages,Number(file.page_count)),model:saved.proposal?.model,provider:'deepseek'};
          return json(publicResult(file,proposal,true));
        }catch{ /* Invalid cached suggestions are discarded and re-read from the original. */ }
      }
      if(saved.status==='processing'&&Date.now()-Date.parse(cached.created_at)<180000)throw fail(409,'这些页正在联合复核，请稍后再试');
      await context.env.DB.prepare('DELETE FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2 AND created_at=?3 AND detail_json=?4')
        .bind(id,auth.user.id,cached.created_at,cached.detail_json).run();
    }
    const now=new Date().toISOString(),token=crypto.randomUUID();
    const detail={status:'processing',lease:token,fileId:file.id,fileSha256:file.sha256,fileUpdatedAt:file.updated_at,version:PAYMENT_RECEIPT_BOUNDARY_VERSION,pageNumbers:pages};
    const claimed=await context.env.DB.prepare(`INSERT OR IGNORE INTO payment_receipt_events(id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at)
      SELECT ?1,?2,NULL,f.batch_id,?3,?4,?5 FROM payment_receipt_files f JOIN payment_receipt_batches b ON b.id=f.batch_id
      WHERE f.id=?6 AND b.owner_user_id=?2 AND f.sha256=?7 AND f.updated_at=?8 AND f.processing_status IN ('processed','review','error')
        AND b.processing_status IN ('processed','review','error')`).bind(id,auth.user.id,EVENT,JSON.stringify(detail),now,file.id,file.sha256,file.updated_at).run();
    if(changes(claimed)!==1)throw fail(409,'原件状态已变化或这些页正在复核，请刷新后重试');
    lease={id,owner:auth.user.id,token};
    if(Number(file.byte_size)>MAX_PDF_BYTES)throw fail(413,'原始 PDF 超过联合复核大小限制');
    const object=await context.env.PAYMENT_RECEIPTS.get(file.object_key);
    if(!object)throw fail(404,'原始 PDF 不存在');
    if(Number(object.size)>MAX_PDF_BYTES)throw fail(413,'原始 PDF 超过联合复核大小限制');
    const bytes=await object.arrayBuffer();
    if(bytes.byteLength>MAX_PDF_BYTES)throw fail(413,'原始 PDF 超过联合复核大小限制');
    if(await hash(bytes)!==file.sha256)throw fail(409,'原件校验信息已经变化，请刷新后重试');
    const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
    if(pdf.getPageCount()!==Number(file.page_count)||pdf.getPageCount()>60)throw fail(409,'原始 PDF 页数已经变化，请刷新后重试');
    const images=[];
    for(const pageNumber of pages){
      if(context.request.signal?.aborted)throw fail(499,'联合复核已取消');
      const single=await PDFDocument.create(),[page]=await single.copyPages(pdf,[pageNumber-1]);single.addPage(page);
      const image=await extractPaymentReceiptPageImage(await single.save());
      if(!image)throw fail(422,`第 ${pageNumber} 页暂不能提取完整图像，请对照原件人工修正`);
      images.push({...image,pageNumber});
    }
    const proposal=await runBoundaryReview(ai,images,Number(file.page_count));
    if(context.request.signal?.aborted)throw fail(499,'联合复核已取消');
    const completed={...detail,status:'complete',proposal};
    const saved=await context.env.DB.prepare(`UPDATE payment_receipt_events SET detail_json=?1 WHERE id=?2 AND owner_user_id=?3
      AND json_extract(detail_json,'$.lease')=?4 AND json_extract(detail_json,'$.status')='processing'
      AND EXISTS(SELECT 1 FROM payment_receipt_files f JOIN payment_receipt_batches b ON b.id=f.batch_id
        WHERE f.id=?5 AND b.owner_user_id=?3 AND f.sha256=?6 AND f.updated_at=?7
          AND f.processing_status IN ('processed','review','error') AND b.processing_status IN ('processed','review','error'))`)
      .bind(JSON.stringify(completed),id,auth.user.id,token,file.id,file.sha256,file.updated_at).run();
    if(changes(saved)!==1)throw fail(409,'原件或拆页状态已经变化，建议未采用，请刷新后重试');
    lease=null;
    return json(publicResult(file,proposal,false));
  }catch(error){
    if(lease)await context.env.DB.prepare(`DELETE FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2
      AND json_extract(detail_json,'$.lease')=?3 AND json_extract(detail_json,'$.status')='processing'`)
      .bind(lease.id,lease.owner,lease.token).run().catch(()=>{});
    return json({error:error.publicMessage||'联合复核暂时不可用，请对照原件人工修正',...(error.code?.startsWith('DEEPSEEK_OCR_')?{code:error.code}:{})},error.httpStatus||error.status||502);
  }
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:apiHeaders()});}

function publicResult(file,proposal,cached){return{ok:true,cached,fileId:file.id,fileUpdatedAt:file.updated_at,pageCount:Number(file.page_count),proposal};}
function matches(value,file,pages){return value.fileId===file.id&&value.fileSha256===file.sha256&&value.fileUpdatedAt===file.updated_at
  &&value.version===PAYMENT_RECEIPT_BOUNDARY_VERSION&&JSON.stringify(value.pageNumbers)===JSON.stringify(pages);}
async function ownedFile(db,owner,id){return db.prepare(`SELECT f.*,b.processing_status AS batch_status FROM payment_receipt_files f
  JOIN payment_receipt_batches b ON b.id=f.batch_id WHERE f.id=?1 AND b.owner_user_id=?2`).bind(id,owner).first();}
function assertFile(file,expected){
  if(!READY.has(file.processing_status)||!READY.has(file.batch_status))throw fail(409,'原件正在处理或拆页，完成后再联合复核');
  if(file.mime_type!=='application/pdf')throw fail(415,'联合复核只支持原始 PDF');
  if(typeof expected!=='string'||!expected||expected!==file.updated_at)throw fail(409,'原件状态已经变化，请重新打开拆页修正');
}
function changes(result){return Number(result?.meta?.changes??result?.changes??0);}
function readObject(text){try{return JSON.parse(text);}catch{return{};}}
async function hash(bytes){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function fail(httpStatus,publicMessage){return Object.assign(new Error(publicMessage),{httpStatus,publicMessage});}
async function readBody(request){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw fail(415,'请使用 JSON 请求');
  if(Number(request.headers.get('Content-Length'))>MAX_BODY_BYTES)throw fail(413,'请求数据过大');
  const reader=request.body?.getReader();if(!reader)throw fail(400,'请求数据无效');
  const chunks=[];let length=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY_BYTES){await reader.cancel();throw fail(413,'请求数据过大');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const value=JSON.parse(new TextDecoder().decode(bytes));if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}
  throw fail(400,'请求数据无效');
}
