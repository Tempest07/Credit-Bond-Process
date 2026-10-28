import {classifyPaymentReceiptPage,comparePaymentReceiptIdentity,recognizePaymentReceiptText} from './payment-receipts.js';
import {normalizePaymentReceiptBondShortName} from './payment-receipt-names.js';
import {paymentReceiptCodeIdentity} from './payment-receipt-security.js';

const MAX_PAGE_BYTES=20*1024*1024,MAX_TEXT_CHARS=64000;

/** Extract a native PDF's text locally; no document is sent to any AI provider. */
export async function extractPaymentReceiptNativeText(pageBytes,options={}){
  const bytes=pageBytes instanceof Uint8Array ? pageBytes : new Uint8Array(pageBytes);
  if(!bytes.byteLength || bytes.byteLength>MAX_PAGE_BYTES)return{status:'unavailable',text:'',fields:{}};
  let pdf,timer,stopped=false;
  try{
    const task=(async()=>{
      const {getDocumentProxy}=await import('unpdf');
      if(stopped)throw Error('PDF text extraction stopped');
      pdf=await getDocumentProxy(bytes.slice(),{isEvalSupported:false,maxImageSize:18000000,disableFontFace:true,
        cMapUrl:'https://unpkg.com/pdfjs-dist@6.4.299/cmaps/',cMapPacked:true,useWorkerFetch:true});
      if(stopped){await pdf.loadingTask.destroy();throw Error('PDF text extraction stopped');}
      if(pdf.numPages!==1)return{status:'unavailable',text:'',fields:{}};
      const page=await pdf.getPage(1),content=await page.getTextContent();
      let text='';
      for(const item of content.items){
        if(typeof item.str!=='string')continue;
        text+=item.str+(item.hasEOL?'\n':' ');
        if(text.length>MAX_TEXT_CHARS)throw Error('PDF text exceeds limit');
      }
      text=text.replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').trim();
      const bad=(text.match(/\ufffd/g)||[]).length;
      if(!/[\u4e00-\u9fffA-Za-z0-9]{2}/.test(text) || text.length<8 || bad>Math.max(2,text.length*.02))return{status:'unavailable',text:'',fields:{}};
      return{status:'ok',text,fields:paymentReceiptNativeFields(text)};
    })();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PDF text extraction timed out')),options.timeoutMs||10000);});
    return await Promise.race([task,deadline]);
  }catch{return{status:'unavailable',text:'',fields:{}};}
  finally{stopped=true;clearTimeout(timer);await pdf?.loadingTask?.destroy().catch(()=>{});}
}

export function paymentReceiptNativeFields(text=''){
  const normalized=String(text).normalize('NFKC'),fields={};
  const combined=normalized.match(/(?:公司)?债券简称\s*\(\s*(?:证券|债券)?代码\s*\)\s*[:：]?\s*([^\n]{1,160})/u);
  if(combined){
    const code=combined[1].match(/\(\s*(\d{6,9}(?:\.[A-Z]{2})?)\s*\)/i);
    const name=normalizePaymentReceiptBondShortName(combined[1].replace(/\(\s*\d{6,9}(?:\.[A-Z]{2})?\s*\)/gi,''));
    if(name)fields.bondShortName=name;
    const identity=paymentReceiptCodeIdentity(code?.[1]);if(identity&&!identity.invalid)fields.securityCode=code[1];
  }
  const inline=normalized.match(/债券简称\s*[:：]?\s*([^\n,，;；]{1,100})[,，;；]\s*(?:债券|证券)?代码\s*[:：]?\s*(\d{6,9}(?:\.[A-Z]{2})?)/iu);
  if(inline){
    const name=normalizePaymentReceiptBondShortName(inline[1]),code=paymentReceiptCodeIdentity(inline[2]);
    if(name&&code&&!code.invalid){fields.bondShortName=name;fields.securityCode=inline[2];}
  }
  const recognized=recognizePaymentReceiptText(normalized,fields);
  return{...fields,paymentDate:recognized.paymentDate,amountFen:recognized.amountFen,
    bondShortName:recognized.bondShortName,securityCode:recognized.securityCode,prepaymentNumber:recognized.prepaymentNumber,
    couponRate:normalized.match(/票面利率\s*[:：]?\s*(\d+(?:\.\d+)?\s*%)/)?.[1]?.replace(/\s/g,'')||''};
}

export function paymentReceiptNativePageAnalysis(native,pageNumber,previous={}){
  if(native?.status!=='ok'||!native.text)return null;
  const classified=classifyPaymentReceiptPage({pageNumber,text:native.text}),fields=native.fields||{};
  const code=paymentReceiptCodeIdentity(fields.securityCode);
  const stampOnly=/(?:本页无正文|(?:盖章|签章|签字|签署)页)/.test(native.text.replace(/\s/g,''))
    && !fields.bondShortName && (!code||code.invalid) && !fields.prepaymentNumber && fields.amountFen==null;
  if(stampOnly && ['receipt_start','continuation'].includes(previous?.classification)){
    return{pageNumber,analysisVersion:7,analysisSource:'pdf-text-layer',classification:'continuation',confidence:.98,
      boundaryEvidence:'原生 PDF 明确标注本页无正文或盖章续页',recognizedText:native.text,fields};
  }
  const change=comparePaymentReceiptIdentity(fields,previous?.fields||{});
  const startsReceipt=classified.startsReceipt || change==='changed';
  const classification=change==='conflict'?'uncertain':startsReceipt?'receipt_start':
    ['receipt_start','continuation'].includes(previous?.classification)?'continuation':'uncertain';
  return{pageNumber,analysisVersion:7,analysisSource:'pdf-text-layer',classification,
    confidence:classification==='receipt_start'?.98:classification==='continuation'?.9:.5,
    boundaryEvidence:classification==='receipt_start'?'原生 PDF 文字层包含缴款通知与债券信息':'原生 PDF 文字层',
    recognizedText:native.text,fields};
}
