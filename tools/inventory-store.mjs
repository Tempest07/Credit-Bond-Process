import {InventoryError, parseInventoryWorkbook} from './inventory-workbook.mjs';

const fieldNames=['institution','branch','portfolio','account','scope','issuer','code','name','marketType','maturity','expected','legal'];
const dimensions={issuer:'发行人',branch:'联动分行',portfolio:'交易组合',account:'会计分类',scope:'表内/委外',marketType:'债券类型',none:'合计'};
const filterNames=['branch','issuer','portfolio','account','scope','code','marketType','holdingStatus'];
const schema=[
  'CREATE TABLE IF NOT EXISTS inventory_versions(id TEXT PRIMARY KEY,date TEXT NOT NULL,filename TEXT NOT NULL,sheet TEXT NOT NULL,rowCount INTEGER NOT NULL,totalCents INTEGER NOT NULL,sha TEXT NOT NULL,createdAt TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS inventory_current(date TEXT PRIMARY KEY, version TEXT NOT NULL REFERENCES inventory_versions(id))',
  'CREATE TABLE IF NOT EXISTS inventory_rows(version TEXT NOT NULL REFERENCES inventory_versions(id), sourceRow INTEGER NOT NULL, cents INTEGER NOT NULL,'+fieldNames.map(f=>f+' TEXT NOT NULL').join(',')+', PRIMARY KEY(version,sourceRow))',
  'CREATE INDEX IF NOT EXISTS inventory_by_branch ON inventory_rows(version,branch)',
  'CREATE TABLE IF NOT EXISTS inventory_answers(id TEXT PRIMARY KEY, version TEXT NOT NULL REFERENCES inventory_versions(id), plan TEXT NOT NULL, createdAt TEXT NOT NULL)',
];
const message=(s,status,more={})=>new InventoryError(s,status,more);
const bind=(db,sql,args=[])=>args.length?db.prepare(sql).bind(...args):db.prepare(sql);
const publicVersion=({sha,...r})=>r;
export async function initInventory(db){await db.batch(schema.map(sql=>db.prepare(sql)))}
export async function listInventory(db) {
  const {results}=await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id ORDER BY v.date DESC').all();
  return results.map(publicVersion);
}
async function active(db,date){
  return await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id WHERE a.date=?').bind(date).first();
}
export async function ingestInventory({db,bucket}, bytes,filename,replaceId) {
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const identical=await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id WHERE v.sha=?').bind(sha).first();
  if(identical)return {...publicVersion(identical),reused:true};
  const workbook=await parseInventoryWorkbook(bytes);
  const {date,sheet,rowCount,totalCents,rows}=workbook;
  const before=await active(db,date);
  if(before?.sha===sha)return {...publicVersion(before),reused:true};
  const conflict=current=>message('同一业务日已有其他版本，请核对金额和行数后确认替换。',409,{
    code:'revision_required',previousId:current?.id,previousCount:current?.rowCount,previousCents:current?.totalCents,nextCount:rowCount,nextCents:totalCents});
  if((before?.id||'')!==(replaceId||''))throw conflict(before);
  const id=crypto.randomUUID(),createdAt=new Date().toISOString();
  const key='inventory/'+date+'/'+id+'.xlsx';
  let publishAttempted=false;
  try {
    await bucket.put(key,bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    await db.prepare('INSERT INTO inventory_versions VALUES (?,?,?,?,?,?,?,?)').bind(id,date,filename,sheet,rowCount,totalCents,sha,createdAt).run();
    // Each SQL statement imports a bounded JSON array, well below the D1 bound-parameter limit.
    const selectFields=['sourceRow','cents',...fieldNames];
    const sql='INSERT INTO inventory_rows(version,'+selectFields.join(',')+') SELECT ?,'+selectFields.map(f=>"json_extract(value,'$."+f+"')").join(',')+' FROM json_each(?)';
    for(let i=0;i<rows.length;i+=500){
      const inserts=[];
      for(let j=i;j<Math.min(i+500,rows.length);j+=50)inserts.push(db.prepare(sql).bind(id,JSON.stringify(rows.slice(j,j+50))));
      await db.batch(inserts);
    }
    const counts=await db.prepare('SELECT count(*) AS n,sum(cents) AS s FROM inventory_rows WHERE version=?').bind(id).first();
    if(counts.n!==rowCount||counts.s!==totalCents)throw Error('cloud import reconciliation failed');
    publishAttempted=true;
    const switched=before
      ?await db.prepare('UPDATE inventory_current SET version=? WHERE date=? AND version=?').bind(id,date,before.id).run()
      :await db.prepare('INSERT INTO inventory_current(date,version) VALUES (?,?) ON CONFLICT(date) DO NOTHING').bind(date,id).run();
    if(switched.meta.changes!==1){
      publishAttempted=false;
      throw conflict(await active(db,date));
    }
    return {id,date,filename,sheet,rowCount,totalCents,createdAt};
  }catch(error){
    // A timeout during publication has an unknown outcome. Never erase a possibly published version.
    if(!publishAttempted){
      await db.batch([db.prepare('DELETE FROM inventory_rows WHERE version=?').bind(id),db.prepare('DELETE FROM inventory_versions WHERE id=?').bind(id)]).catch(()=>{});
      await bucket.delete(key).catch(()=>{});
    }
    throw error;
  }
}
export function normalizePlan(input) {
  if(!input || !Object.hasOwn(dimensions,input.group)||!['principal','count','securities'].includes(input.metric)||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!input.filters||typeof input.filters!=='object'||Array.isArray(input.filters))throw message('查询口径不受支持，请选择日期、指标和分组。',400);
  if(Object.keys(input.filters).some(k=>!filterNames.includes(k)))throw message('含不支持的筛选字段。',400);
  const filters={};
  for(const k of filterNames){
    const value=input.filters[k];
    if(value==null||value==='')continue;
    if(typeof value!=='string'||value.length>180||(k==='holdingStatus'&&value!=='存续'))throw message('筛选值无效。',400);
    filters[k]=value.trim();
  }
  return {date:input.date,group:input.group,metric:input.metric,filters};
}
function where(snapshot,plan,selectedGroup) {
  const args=[snapshot.id],parts=['version=?'];
  for(const [k,v] of Object.entries(plan.filters)){
    if(k==='holdingStatus'){parts.push("cents>0 AND maturity>?");args.push(snapshot.date);continue}
    if(k==='scope'&&v==='委外'){parts.push("scope LIKE '委外%'");continue}
    parts.push(k+'=?');args.push(v==='未填写'?'':v);
  }
  if(selectedGroup!=null && plan.group!=='none'){
    parts.push(plan.group+'=?');args.push(selectedGroup==='未填写'?'':selectedGroup);
  }
  return {sql:parts.join(' AND '),args};
}
const agg='coalesce(sum(cents),0) AS cents,count(*) AS count,count(distinct code) AS securityCount';
async function compute(db,snapshot,plan,resultId) {
  const w=where(snapshot,plan);
  const group=plan.group==='none'?"'全部'":"coalesce(nullif("+plan.group+",''),'未填写')";
  const order={principal:'cents',count:'count',securities:'securityCount'}[plan.metric];
  const batch=await db.batch([
    bind(db,'SELECT '+agg+',sum(CASE WHEN expected<>\'\' AND expected<=? AND legal>? THEN 1 ELSE 0 END) AS flagged FROM inventory_rows WHERE '+w.sql,[snapshot.date,snapshot.date,...w.args]),
    bind(db,'SELECT '+group+' AS label,'+agg+' FROM inventory_rows WHERE '+w.sql+' GROUP BY 1 ORDER BY '+order+' DESC,label',w.args),
  ]);
  const total=batch[0].results[0],groups=batch[1].results.map(({label,...g})=>({name:label,...g}));
  const warnings=[];
  if(total.flagged)warnings.push(total.flagged+' 条持仓的 ABS 预计到期日已过、法定到期日尚未到，实际兑付待核。');
  if(plan.filters.holdingStatus)warnings.push('台账存续按正本金且表列到期日晚于业务日统计。');
  if(!total.count)warnings.push('当前筛选未匹配持仓，请检查日期和筛选名称。');
  const yuan=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(total.cents/1e10);
  const summary=plan.metric==='count'?total.count+' 条持仓记录':plan.metric==='securities'?total.securityCount+' 只不同券码':'名义本金 '+yuan+' 亿元';
  return {resultId,summary,plan,snapshot:publicVersion(snapshot),totalCents:total.cents,rowCount:total.count,securityCount:total.securityCount,groups,warnings};
}
export async function newInventoryAnswer(db,snapshot,input){
  const plan=normalizePlan(input);
  if(!snapshot||snapshot.date!==plan.date)throw message('指定日期没有可用库存快照。',404);
  const id=crypto.randomUUID(),result=await compute(db,snapshot,plan,id);
  await db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind(id,snapshot.id,JSON.stringify(plan),new Date().toISOString()).run();
  return result;
}
export async function answerContext(db,id){
  if(typeof id!=='string'||!id||id.length>64)throw message('查询结果编号无效。',400);
  const a=await db.prepare('SELECT plan,version FROM inventory_answers WHERE id=?').bind(id).first();
  if(!a)throw message('该查询结果不存在。',404);
  const snapshot=await db.prepare('SELECT * FROM inventory_versions WHERE id=?').bind(a.version).first();
  return {snapshot,plan:normalizePlan(JSON.parse(a.plan))};
}
export async function answerDetails(db,id,{group=null,offset=0,limit=50}={}) {
  const {snapshot,plan}=await answerContext(db,id),w=where(snapshot,plan,group);
  const [counts,records]=await db.batch([
    bind(db,'SELECT count(*) AS n FROM inventory_rows WHERE '+w.sql,w.args),
    bind(db,'SELECT sourceRow,cents,'+fieldNames.join(',')+' FROM inventory_rows WHERE '+w.sql+' ORDER BY sourceRow LIMIT ? OFFSET ?',[...w.args,limit,offset]),
  ]);
  return {rows:records.results,total:counts.results[0].n};
}
export async function exportData(db,id){
  const {snapshot,plan}=await answerContext(db,id),result=await compute(db,snapshot,plan,id),w=where(snapshot,plan),rows=[];
  for(let i=0;i<result.rowCount;i+=500){
    const page=await bind(db,'SELECT sourceRow,cents,'+fieldNames.join(',')+' FROM inventory_rows WHERE '+w.sql+' ORDER BY sourceRow LIMIT 500 OFFSET ?',[...w.args,i]).all();
    rows.push(...page.results);
  }
  if(rows.length!==result.rowCount||rows.reduce((sum,r)=>sum+r.cents,0)!==result.totalCents)throw Error('export reconciliation failed');
  return {result,rows};
}
