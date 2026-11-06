import { InventoryError, exportInventoryWorkbook } from './inventory-workbook.mjs';
import { listInventory, ingestInventory, answerContext, answerDetails, newInventoryAnswer, exportData } from './inventory-store.mjs';
import { planInventoryQuestion } from './inventory-openai.mjs';

const methods = {status:'GET', upload:'POST', ask:'POST', manual:'POST', detail:'GET', export:'GET'};
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const privateHeaders = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json = (value, status = 200) => Response.json(value, {status, headers:privateHeaders});

async function limitedBytes(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new InventoryError('请求或文件过大。',413);
  const reader=request.body?.getReader();
  if (!reader) throw new InventoryError('请求为空。');
  const parts=[]; let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>limit){await reader.cancel();throw new InventoryError('请求或文件过大。',413)}
      parts.push(value);
    }
  } finally {reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0;
  for (const p of parts) {bytes.set(p,offset);offset+=p.byteLength}
  return bytes;
}
async function jsonInput(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new InventoryError('需要 JSON 请求。',415);
  const bytes=await limitedBytes(request,16000);
  try {
    const input=JSON.parse(new TextDecoder().decode(bytes));
    if(!input || typeof input!=='object'|| Array.isArray(input)) throw Error();
    return input;
  } catch {throw new InventoryError('请求格式无效。')}
}
async function query(input, action, {db,bucket,apiKey}) {
  const snapshots=await listInventory(db);
  if(!snapshots.length)return {clarification:'请先上传完整库存快照。'};
  const previous=action==='ask'&&input.previousResultId ? await answerContext(db,input.previousResultId) : null;
  const selected=input.snapshotId ? snapshots.find(s=>s.id===input.snapshotId)||(previous?.snapshot.id===input.snapshotId?previous.snapshot:null) : null;
  if(input.snapshotId&&!selected)throw new InventoryError('所选库存快照已修订，请刷新数据台账。',409);
  const base=selected||previous?.snapshot||snapshots[0];
  let plan;
  if(action==='manual'){
    plan={date:base.date,group:input.group||'issuer',metric:input.metric||'principal',filters:input.filters||{}};
  }else{
    const previousPlan=previous?{...previous.plan,date:base.date}:{date:base.date,group:'none',metric:'principal',filters:{}};
    const outcome=await planInventoryQuestion({question:input.question,previousPlan,effort:input.effort,dates:snapshots.map(s=>s.date),apiKey});
    if(outcome.clarification)return outcome;
    plan=outcome.plan;
    if(outcome.overviewSubject){
      const subject=outcome.overviewSubject;
      const snapshot=base.date===plan.date?base:snapshots.find(s=>s.date===plan.date);
      const filters={...plan.filters};
      for(const key of ['issuer','attribution','guarantor','marketType'])delete filters[key];
      const lookup=extra=>newInventoryAnswer(db,snapshot,{...plan,group:'code',metric:'principal',filters:{...filters,...extra}},bucket);
      const [issued,enhanced]=await Promise.all([lookup({issuer:subject}),lookup({guarantor:subject,marketType:'资产支持证券'})]);
      for(const result of [issued,enhanced]){
        if(result.clarification?.includes('可能指多家主体'))return result;
      }
      if(issued.resultId && enhanced.rowCount && issued.plan.filters.issuer!==enhanced.roleEvidence.entity)
        return {clarification:'发行人与增信方匹配到不同主体，请指定机构全称：'+issued.plan.filters.issuer+'、'+enhanced.roleEvidence.entity+'。'};
      return {clarification:'按“'+subject+'”分别查看自发债和增信 ABS。',overview:[
        {title:'自己发行的债券',result:issued},{title:'占用其授信的 ABS',result:enhanced}]};
    }
  }
  return newInventoryAnswer(db,base.date===plan.date?base:snapshots.find(s=>s.date===plan.date),plan,bucket);
}

// The caller authenticates before providing bindings. Browser writes are restricted
// to the site origin (the Gateway keeps the original Origin when forwarding).
export async function inventoryHttp(request, action, getAccess, allowedOrigins, allowCli=false) {
  try {
    if(!Object.hasOwn(methods,action))return json({error:'找不到该接口。'},404);
    if(request.method!==methods[action])return json({error:'请求方式不正确。'},405);
    const origin=request.headers.get('Origin');
    if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(origin&&!allowedOrigins.includes(origin))||
       (request.method==='POST'&&!origin&&!allowCli)) return json({error:'请求来源不受支持。'},403);
    const access=await getAccess(), {db,apiKey}=access;
    const params=new URL(request.url).searchParams;
    if(action==='status')return json({snapshots:await listInventory(db),configured:Boolean(apiKey)});
    if(action==='upload'){
      let filename;try{filename=decodeURIComponent(request.headers.get('X-File-Name')||'')}catch{throw new InventoryError('文件名编码无效。')}
      if(!filename||filename.length>200||/[\\/\x00-\x1f]/.test(filename)||!filename.toLowerCase().endsWith('.xlsx'))throw new InventoryError('请选择 .xlsx 文件。');
      if(![xlsxType,'application/octet-stream'].includes(request.headers.get('Content-Type')?.split(';')[0]))throw new InventoryError('请选择 .xlsx 文件。',415);
      const bytes=await limitedBytes(request,15*1024*1024);
      return json(await ingestInventory(access,bytes,filename,request.headers.get('X-Replace-Id')||''));
    }
    if(action==='detail'){
      const offset=Number(params.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>30000)throw new InventoryError('明细偏移量无效。');
      return json(await answerDetails(db,params.get('id'),{group:params.get('group'),offset}));
    }
    if(action==='export'){
      const {result,rows}=await exportData(db,params.get('id'));
      const bytes=await exportInventoryWorkbook(result,rows);
      const filename=encodeURIComponent('库存问数_'+result.snapshot.date+'_'+result.resultId.slice(0,8)+'.xlsx');
      return new Response(bytes,{headers:{...privateHeaders,'Content-Type':xlsxType,'Content-Disposition':"attachment; filename*=UTF-8''"+filename}});
    }
    return json(await query(await jsonInput(request),action,access));
  }catch(e){
    if(e instanceof InventoryError||e.name==='InventoryPlannerError')return json({error:e.message,...(e.details||{})},e.status||400);
    return json({error:'库存知识库暂时不可用，请稍后重试。'},503);
  }
}
