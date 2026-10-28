import { apiHeaders, ensureAuthSchema, json, requireUser } from './_auth.js';
import { ensurePaymentReceiptSchema } from './_payment-receipts.js';
import { isSameOriginMutation } from './_same-origin.js';
import { readPaymentReceiptRebuild, requestPaymentReceiptRebuild } from './_payment-receipt-rebuild.js';

export async function onRequestGet(context) {
  const auth=await requireUser(context);if(auth.response)return auth.response;
  if(!context.env.DB)return json({error:'Cloudflare D1 binding DB 尚未配置'},503);
  try {
    await ensureAuthSchema(context.env.DB);await ensurePaymentReceiptSchema(context.env.DB);
    const id=new URL(context.request.url).searchParams.get('id')||'';
    return json({ok:true,rebuild:await readPaymentReceiptRebuild(context.env.DB,auth.user.id,id)});
  } catch(error){return json({error:error.message||'读取识别进度失败'},500);}
}

export async function onRequestPost(context) {
  const auth=await requireUser(context);if(auth.response)return auth.response;
  if(!isSameOriginMutation(context.request))return json({error:'请求来源不受信任'},403);
  if(!context.env.DB)return json({error:'Cloudflare D1 binding DB 尚未配置'},503);
  try {
    const raw=await context.request.text();if(raw.length>100000)return json({error:'请求内容过大'},413);
    let input;try{input=JSON.parse(raw);}catch{return json({error:'请求格式无效'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'请求格式无效'},400);
    await ensureAuthSchema(context.env.DB);await ensurePaymentReceiptSchema(context.env.DB);
    return json({ok:true,...await requestPaymentReceiptRebuild(context.env,auth.user.id,input,context)},202);
  } catch(error){
    if(/NOT NULL constraint failed: payment_receipt_events\.owner_user_id/i.test(error.message||''))return json({error:'文件状态已变化，请重试'},409);
    return json({error:error.message||'申请重新识别失败'},error.status||500);
  }
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:apiHeaders()});}
