import { InventoryError, exportInventoryWorkbook } from './inventory-workbook.mjs';
import { listInventory, ingestInventory, answerContext, answerDetails, newInventoryAnswer, readInventoryAnswer, exportData } from './inventory-store.mjs';
import {initChats,listChats,readChat,checkChatResult,checkResultOwner,appendChatTurn} from './inventory-chats.mjs';
import { planInventoryQuestion } from './inventory-openai.mjs';
import { issuerHints } from './inventory-issuer-hints.mjs';
import { readInventoryEvidence } from './inventory-evidence.mjs';
import { readTopIssuer } from './inventory-rank-evidence.mjs';

const methods = {status:'GET', upload:'POST', ask:'POST', manual:'POST', detail:'GET', export:'GET',
  chats:'GET',chat:'GET',answer:'GET',select:'POST'};
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
  const bytes=await limitedBytes(request,64000);
  try {
    const input=JSON.parse(new TextDecoder().decode(bytes));
    if(!input || typeof input!=='object'|| Array.isArray(input)) throw Error();
    return input;
  } catch {throw new InventoryError('请求格式无效。')}
}
async function query(input, action, {db,bucket,apiKey}, pinned=null) {
  const snapshots=await listInventory(db);
  if(!snapshots.length)return {clarification:'请先上传完整库存快照。'};
  const previous=action==='ask'&&input.previousResultId ? await answerContext(db,input.previousResultId) : null;
  const selected=pinned || (input.snapshotId ? snapshots.find(s=>s.id===input.snapshotId)||(previous?.snapshot.id===input.snapshotId?previous.snapshot:null) : null);
  if(input.snapshotId&&!selected)throw new InventoryError('所选库存快照已修订，请刷新数据台账。',409);
  const base=selected||previous?.snapshot||snapshots[0];
  let plan, subject, fixedMembers, trace=[], suggested=[];
  const snapshotFor = date => date===base.date ? base : snapshots.find(s=>s.date===date);
  if(action==='manual'){
    plan={date:base.date,group:input.group||'issuer',metric:input.metric||'principal',filters:input.filters||{},
      ...(input.rank ? {rank:input.rank} : {})};
    if(input.identityValue!==undefined){
      if(typeof input.identityValue!=='string'||!input.identityValue.trim()||input.identityValue.length>160||
          !['overviewSubject','issuer','guarantor','attribution'].includes(input.field))
        throw new InventoryError('请提供主体全称或一只相关债券的完整券码。');
      if(input.field==='overviewSubject')subject=input.identityValue.trim();
      else plan.filters={...plan.filters,[input.field]:input.identityValue.trim()};
    }
  }else{
    const previousPlan=previous?{...previous.plan,date:base.date,...(previous.rankReused?{rankReused:true}:{})}:
      {date:base.date,group:'none',metric:'principal',filters:{}};
    const inspectEvidence=async request=>{
      const snapshot=snapshotFor(request.date);
      if(!snapshot)throw new InventoryError('所选日期没有可用快照。');
      if(request.field==='topIssuer')return readTopIssuer(db,snapshot,request.term,previousPlan.filters);
      return readInventoryEvidence({db,bucket},snapshot,request);
    };
    const outcome=await planInventoryQuestion({question:input.question,conversation:input.conversation,previousPlan,effort:input.effort,dates:snapshots.map(s=>s.date),apiKey,inspectEvidence});
    if(outcome.clarification)return outcome;
    plan=outcome.plan;
    subject=outcome.overviewSubject;
    trace=outcome.trace||[];
    suggested=outcome.candidateNames||[];
    if(outcome.reuseRank && Array.isArray(previous?.rankMembers) && previous.snapshot.id===snapshotFor(plan.date)?.id &&
        plan.rank?.by===previous.plan.rank?.by && plan.rank?.limit===previous.plan.rank?.limit) {
      fixedMembers=previous.rankMembers;
      trace.push('沿用上次按本金排名选出的名单，在名单内应用本次筛选与分组。');
    }
  }
  const snapshot=snapshotFor(plan.date);
  const answer=await executeInventoryPlan({db,bucket},snapshot,plan,subject,suggested,trace,fixedMembers);
  return trace.length ? {...answer,trace} : answer;
}
async function executeInventoryPlan({db,bucket}, snapshot, plan, subject, suggested, trace, fixedMembers) {
  const identityReply=async(query,field,filters,candidates)=>{
    candidates=[...new Set([...candidates,...suggested])].slice(0,12);
    const hints=['issuer','overviewSubject'].includes(field)?await issuerHints(db,snapshot,query,filters,candidates):[];
    return {clarification:hints.length?'按本期库存的发行人和券简称，找到以下相关持仓。':
      candidates.length?'请从本期台账的主体全称中选择。':'本期台账无法从这个称呼确认主体，请补充全称或相关券码。',
      identity:{query,field,candidates,hints},
      resume:{snapshotId:snapshot.id,group:plan.group,metric:plan.metric,filters,field,...(plan.rank?{rank:plan.rank}:{})}};
  };
  if(subject){
      const filters={...plan.filters};
      for(const key of ['issuer','attribution','guarantor','marketType'])delete filters[key];
      if(suggested.length)return identityReply(subject,'overviewSubject',filters,suggested);
      const lookup=extra=>newInventoryAnswer(db,snapshot,{...plan,group:'code',metric:'principal',filters:{...filters,...extra}},bucket,trace);
      const [issued,enhanced]=await Promise.all([lookup({issuer:subject}),lookup({guarantor:subject,marketType:'资产支持证券'})]);
      const choices=new Set([...(issued.identity?.candidates||[]),...(enhanced.identity?.candidates||[])]);
      const exact=issued.plan?.filters.issuer===subject || (enhanced.resultId && enhanced.roleEvidence?.entity===subject);
      if(!exact && (issued.identity||enhanced.identity) && (choices.size || (!issued.resultId&&!enhanced.resultId))){
        if(issued.resultId)choices.add(issued.plan.filters.issuer);
        if(enhanced.resultId&&enhanced.roleEvidence?.entity)choices.add(enhanced.roleEvidence.entity);
        return identityReply(subject,'overviewSubject',filters,[...choices]);
      }
      if(issued.resultId && enhanced.rowCount && issued.plan.filters.issuer!==enhanced.roleEvidence.entity)
        return identityReply(subject,'overviewSubject',filters,[issued.plan.filters.issuer,enhanced.roleEvidence.entity]);
      const missingRole=(result,source)=>exact && result.identity
        ? {clarification:'本期“'+source+'”未匹配该主体全称。'} : result;
      return {clarification:'按“'+subject+'”分别查看自发债和增信 ABS。',overview:[
        {title:'自己发行的债券',result:missingRole(issued,'发行人全称')},{title:'占用其授信的 ABS',result:missingRole(enhanced,'资产端损益还原客户名称')}]};
  }
  if(suggested.length){
    const field=['guarantor','attribution','issuer'].find(key=>plan.filters[key]);
    if(field)return identityReply(plan.filters[field],field,plan.filters,suggested);
  }
  const result=await newInventoryAnswer(db,snapshot,plan,bucket,trace,fixedMembers);
  if(result.identity)return identityReply(result.identity.query,result.identity.field,plan.filters,result.identity.candidates);
  return result;
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
    const owner=access.owner || (allowCli ? 'local-inventory-beta' : null);
    const params=new URL(request.url).searchParams;
    if(action==='status')return json({snapshots:await listInventory(db),configured:Boolean(apiKey)});
    if(['chats','chat','answer'].includes(action)){
      await initChats(db,owner);
      if(action==='chats')return json(await listChats(db,owner,params.get('cursor')));
      if(action==='chat')return json(await readChat(db,owner,params.get('id')));
      await checkChatResult(db,owner,params.get('id'),params.get('chatId'));
      return json(await readInventoryAnswer(db,params.get('id')));
    }
    if(action==='upload'){
      let filename;try{filename=decodeURIComponent(request.headers.get('X-File-Name')||'')}catch{throw new InventoryError('文件名编码无效。')}
      if(!filename||filename.length>200||/[\\/\x00-\x1f]/.test(filename)||!filename.toLowerCase().endsWith('.xlsx'))throw new InventoryError('请选择 .xlsx 文件。');
      if(![xlsxType,'application/octet-stream'].includes(request.headers.get('Content-Type')?.split(';')[0]))throw new InventoryError('请选择 .xlsx 文件。',415);
      const bytes=await limitedBytes(request,15*1024*1024);
      return json(await ingestInventory(access,bytes,filename,request.headers.get('X-Replace-Id')||''));
    }
    if(action==='detail'||action==='export'){
      await initChats(db,owner);
      await checkResultOwner(db,owner,params.get('id'));
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
    const input=await jsonInput(request);
    if(action==='select'||['chatId','version','requestId'].some(key=>Object.hasOwn(input,key))){
      await initChats(db,owner);
      return json(await appendChatTurn({db,owner},input,action,pinned=>query(input,action,access,pinned)));
    }
    if(input.previousResultId){
      await initChats(db,owner);
      await checkResultOwner(db,owner,input.previousResultId);
    }
    return json(await query(input,action,access));
  }catch(e){
    if(e instanceof InventoryError||e.name==='InventoryPlannerError')return json({error:e.message,...(e.details||{})},e.status||400);
    return json({error:'库存知识库暂时不可用，请稍后重试。'},503);
  }
}
