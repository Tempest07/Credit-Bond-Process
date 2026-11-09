import { InventoryError, exportInventoryWorkbook } from './inventory-workbook.mjs';
import { listInventory, ingestInventory, answerContext, answerSourceRows, answerDetails, newInventoryAnswer, readInventoryAnswer, exportData, reviewInventoryCompany } from './inventory-store.mjs';
import {initChats,listChats,readChat,checkChatResult,checkResultOwner,appendChatTurn} from './inventory-chats.mjs';
import { planInventoryQuestion } from './inventory-openai.mjs';
import { issuerHints } from './inventory-issuer-hints.mjs';
import { isFullLedgerName, readInventoryEvidence } from './inventory-evidence.mjs';
import { sourceFields } from './inventory-source-columns.mjs';
import { readTopIssuer } from './inventory-rank-evidence.mjs';

import {flowAction} from './flow-dialog.mjs';

const methods = {status:'GET', upload:'POST', ask:'POST', manual:'POST', detail:'GET', export:'GET',
  'flow-status':'GET','flow-upload':'POST','flow-ask':'POST','flow-chat':'GET','flow-chats':'GET','flow-export':'GET',
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
  let plan, subject, fixedMembers, scopeRef, sourceRows, trace=[], suggested=[];
  const snapshotFor = date => date===base.date ? base : snapshots.find(s=>s.date===date);
  if(action==='manual'){
    plan={date:base.date,group:input.group||'issuer',metric:input.metric||'principal',filters:input.filters||{},
      ...(input.rank ? {rank:input.rank} : {}), ...(input.analysis ? {analysis:input.analysis} : {})};
    if(input.scopeAnswerId){
      const source=await answerContext(db,input.scopeAnswerId);
      if(source.snapshot.id!==base.id)throw new InventoryError('入选持仓属于另一份快照。',409);
      if(!['previous','base'].includes(input.scopeMode))throw new InventoryError('查询范围无效。');
      scopeRef={scopeAnswerId:input.scopeAnswerId,scopeMode:input.scopeMode};
      sourceRows=input.scopeMode==='previous'?await answerSourceRows(db,input.scopeAnswerId,base.id):source.sourceRows;
    }
    if(input.identityValue!==undefined){
      if(typeof input.identityValue!=='string'||!input.identityValue.trim()||input.identityValue.length>160||
          !['overviewSubject','issuer','guarantor','attribution'].includes(input.field))
        throw new InventoryError('请提供主体全称或一只相关债券的完整券码。');
      if(input.field==='overviewSubject')subject=input.identityValue.trim();
      else plan.filters={...plan.filters,[input.field]:input.identityValue.trim()};
    }
  }else{
    const previousPlan=previous?{...previous.plan,date:base.date,scopedToPrevious:Array.isArray(previous.sourceRows),...(previous.rankReused?{rankReused:true}:{})}:
      {date:base.date,group:'none',metric:'principal',filters:{}};
    const inspectEvidence=async request=>{
      const snapshot=snapshotFor(request.date);
      if(!snapshot)throw new InventoryError('所选日期没有可用快照。');
      if(request.field==='topIssuer')return readTopIssuer(db,snapshot,request.term,previousPlan.filters);
      return readInventoryEvidence({db,bucket},snapshot,request);
    };
    const workbookFields=await sourceFields(db,base,bucket);
    const outcome=await planInventoryQuestion({hasPreviousResult:Boolean(previous),workbookFields,question:input.question,conversation:input.conversation,previousPlan,effort:input.effort,dates:snapshots.map(s=>s.date),apiKey,inspectEvidence});
    if(outcome.clarification)return outcome;
    plan=outcome.plan;
    subject=outcome.overviewSubject;
    trace=outcome.trace||[];
    suggested=outcome.candidateNames||[];
    if(outcome.inputRows==='previous'){
      if(!previous || previous.snapshot.id!==snapshotFor(plan.date)?.id)
        throw new InventoryError('上次入选持仓与本次快照不同，请选择同一期或重新查询。',409);
      sourceRows=await answerSourceRows(db,input.previousResultId,previous.snapshot.id);
      scopeRef={scopeAnswerId:input.previousResultId,scopeMode:'previous'};
    }else if(outcome.inputRows!=='snapshot' && previous?.snapshot.id===snapshotFor(plan.date)?.id && Array.isArray(previous?.sourceRows)){
      sourceRows=previous.sourceRows;
      scopeRef={scopeAnswerId:input.previousResultId,scopeMode:'base'};
    }
    if(outcome.reuseRank && Array.isArray(previous?.rankMembers) && previous.snapshot.id===snapshotFor(plan.date)?.id &&
        plan.rank?.by===previous.plan.rank?.by && plan.rank?.limit===previous.plan.rank?.limit) {
      fixedMembers=previous.rankMembers;
      trace.push('沿用上次按本金排名选出的名单，在名单内应用本次筛选与分组。');
    }
  }
  const snapshot=snapshotFor(plan.date);
  if(Array.isArray(sourceRows))trace.push('从前次查询锁定的 '+sourceRows.length+' 条原表持仓继续计算。');
  const question=action==='manual'?input.identityValue:input.question;
  const answer=await executeInventoryPlan({db,bucket},snapshot,plan,subject,suggested,trace,fixedMembers,sourceRows,scopeRef,question);
  return trace.length ? {...answer,trace} : answer;
}
async function executeInventoryPlan({db,bucket}, snapshot, plan, subject, suggested, trace, fixedMembers, sourceRows, scopeRef, question) {
  const resume=(field,filters)=>({...scopeRef,snapshotId:snapshot.id,group:plan.group,metric:plan.metric,filters,field,
    ...(plan.rank?{rank:plan.rank}:{}),...(plan.analysis?{analysis:plan.analysis}:{})});
  const review=async(query,field,filters,candidates)=>{
    if(!isFullLedgerName(query) || typeof question!=='string' || !question.includes(query))return null;
    return reviewInventoryCompany(db,snapshot,bucket,query,field,filters,candidates);
  };
  const absent=(checked,query,field,filters)=>({
    clarification:checked.clarification,resume:resume(field,filters),
    ...(checked.candidates.length?{identity:{query,field,candidates:checked.candidates,hints:[],fullNameMiss:true}}:{}),
  });
  const identityReply=async(query,field,filters,candidates)=>{
    candidates=[...new Set([...candidates,...suggested])].slice(0,12);
    const hints=['issuer','overviewSubject'].includes(field)?await issuerHints(db,snapshot,query,filters,candidates):[];
    return {clarification:hints.length?'按本期库存的发行人和券简称，找到以下相关持仓。':
      candidates.length?'请从本期台账的主体全称中选择。':'本期台账无法从这个称呼确认主体，请补充全称或相关券码。',
      identity:{query,field,candidates,hints},
      resume:resume(field,filters)};
  };
  if(subject){
      const filters={...plan.filters};
      for(const key of ['issuer','attribution','guarantor','marketType'])delete filters[key];
      const checked=await review(subject,'overviewSubject',filters,suggested);
      if(checked && !checked.exact)return absent(checked,subject,'overviewSubject',filters);
      if(suggested.length && !checked?.exact)return identityReply(subject,'overviewSubject',filters,suggested);
      const lookup=extra=>newInventoryAnswer(db,snapshot,{...plan,group:'code',metric:'principal',filters:{...filters,...extra}},bucket,trace,undefined,sourceRows);
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
  const field=['guarantor','attribution','issuer'].find(key=>plan.filters[key]);
  if(suggested.length && field){
    const checked=await review(plan.filters[field],field,plan.filters,suggested);
    if(checked && !checked.exact)return absent(checked,plan.filters[field],field,plan.filters);
    if(!checked?.exact)return identityReply(plan.filters[field],field,plan.filters,suggested);
  }
  const result=await newInventoryAnswer(db,snapshot,plan,bucket,trace,fixedMembers,sourceRows);
  if(result.identity){
    const {query,field,candidates}=result.identity;
    const checked=await review(query,field,plan.filters,candidates);
    if(checked && !checked.exact)return absent(checked,query,field,plan.filters);
    return identityReply(query,field,plan.filters,candidates);
  }
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
    if(action.startsWith('flow-') && action!=='flow-upload'){
      const out=await flowAction({...access,owner},action,{params,input:action==='flow-ask'?await jsonInput(request):null});
      if(action==='flow-export')return new Response(out,{headers:{...privateHeaders,'Content-Type':xlsxType,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('交易流水_'+params.get('id').slice(0,8)+'.xlsx')}});
      return json(out);
    }
    if(action==='status')return json({snapshots:await listInventory(db),configured:Boolean(apiKey)});
    if(['chats','chat','answer'].includes(action)){
      await initChats(db,owner);
      if(action==='chats')return json(await listChats(db,owner,params.get('cursor')));
      if(action==='chat')return json(await readChat(db,owner,params.get('id')));
      await checkChatResult(db,owner,params.get('id'),params.get('chatId'));
      return json(await readInventoryAnswer(db,params.get('id')));
    }
    if(action==='upload'||action==='flow-upload'){
      let filename;try{filename=decodeURIComponent(request.headers.get('X-File-Name')||'')}catch{throw new InventoryError('文件名编码无效。')}
      if(!filename||filename.length>200||/[\\/\x00-\x1f]/.test(filename)||!filename.toLowerCase().endsWith('.xlsx'))throw new InventoryError('请选择 .xlsx 文件。');
      if(![xlsxType,'application/octet-stream'].includes(request.headers.get('Content-Type')?.split(';')[0]))throw new InventoryError('请选择 .xlsx 文件。',415);
      const bytes=await limitedBytes(request,15*1024*1024);
      if(action==='flow-upload')return json(await flowAction({...access,owner},action,{upload:{bytes,filename}}));
      return json(await ingestInventory(access,bytes,filename,request.headers.get('X-Replace-Id')||'',request.headers.get('X-Inventory-Year')));
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
    if(input.scopeAnswerId){
      if(action!=='manual')throw new InventoryError('查询范围无效。');
      await initChats(db,owner);
      if(input.chatId)await checkChatResult(db,owner,input.scopeAnswerId,input.chatId);
      else await checkResultOwner(db,owner,input.scopeAnswerId);
    }
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
    return json({error:action.startsWith('flow-')?'交易问数服务暂时不可用，请稍后重试。':'库存知识库暂时不可用，请稍后重试。'},503);
  }
}
