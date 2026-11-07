import {InventoryError, parseInventoryWorkbook} from './inventory-workbook.mjs';

const fieldNames=['institution','branch','portfolio','account','scope','issuer','code','name','marketType','maturity','expected','legal'];
const dimensions={issuer:'发行人',branch:'联动分行',portfolio:'交易组合',account:'会计分类',scope:'表内/委外',marketType:'债券类型',code:'券码',none:'合计'};
const filterNames=['branch','issuer','portfolio','account','scope','code','marketType','holdingStatus','guarantor','attribution'];
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
const roleSource='资产端损益还原客户名称';
const roleRows='inventory_rows JOIN inventory_role_rows USING(version,sourceRow)';
const namedGuarantor='EXISTS (SELECT 1 FROM json_each(guarantors) WHERE value=?)';
const aliasesByType={
  '资产支持证券':['资产支持证券','ABS','资产证券化'],
  '中期票据':['中期票据','中票','MTN'],
  '短期融资券':['短期融资券','短融','短期融资债券','CP'],
  '超短期融资券':['超短期融资券','超短期融资债券','超短融','超短期融资','SCP'],
};
const typeAliases=new Map(Object.entries(aliasesByType).flatMap(([type,aliases])=>aliases.map(alias=>[alias,type])));
// All SQL literals below come from this fixed vocabulary. Keep foreign-market
// English product labels separate, and split tagged SCPs out of the source's CP bucket.
const typeColumn='upper(trim(marketType))';
const asSqlList=values=>values.map(value=>"'"+value+"'").join(',');
const classifiedType='(CASE WHEN '+typeColumn+' IN ('+asSqlList(aliasesByType['短期融资券'])+") AND (upper(name) GLOB '*SCP[0-9]*' OR instr(name,'超短期融资券')>0) THEN '超短期融资券' "+
  Object.entries(aliasesByType).map(([type,aliases])=>'WHEN '+typeColumn+' IN ('+asSqlList(aliases)+") THEN '"+type+"'").join(' ')+' ELSE marketType END)';
const broadCredit=/^(?:信用债(?:券|类)?|信用类(?:债券|债))$/;
const explainCredit='库存按具体券种记录。请指定要纳入的品种（如中票、短融、超短融、公司债、企业债），或先按债券类型分组查看。金融债和 ABS 如需纳入，请单独说明。';
export async function initInventory(db){await db.batch(schema.map(sql=>db.prepare(sql)))}
export async function listInventory(db) {
  const {results}=await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id ORDER BY v.date DESC').all();
  return results.map(publicVersion);
}
async function active(db,date){
  return await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id WHERE a.date=?').bind(date).first();
}
export async function readVerifiedRoleWorkbook(db,snapshot,bucket){
  const key='inventory/'+snapshot.date+'/'+snapshot.id+'.xlsx';
  let bytes;
  for(let attempt=0;attempt<2;attempt++){
    try {
      const object=await bucket?.get(key);
      if(object)bytes=new Uint8Array(await object.arrayBuffer());
      break;
    }catch{ /* Retry a failed R2 read once; an absent object is not retried. */ }
  }
  if(!bytes)throw message('无法读取此版本的云端库存原件，暂时无法核对担保和客户归属，请稍后重试。',503);
  const version=await db.prepare('SELECT sha FROM inventory_versions WHERE id=?').bind(snapshot.id).first();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(version?.sha!==digest)throw message('库存原件与已发布快照校验不符，不能核对担保和客户归属。',503);
  const original=await parseInventoryWorkbook(bytes);
  if(original.date!==snapshot.date || original.rowCount!==snapshot.rowCount || original.totalCents!==snapshot.totalCents)throw message('原件行数、日期或金额与已发布快照不符。',503);
  return original;
}

export function ledgerGuarantors(guarantor){
  const unknown=/^(?:[-—/\s]*|未知|待核(?:实)?|未填写|不详|暂无|N\/?A|null)$/i.test(guarantor);
  const guarantors=unknown || /^(?:无|无担保|无保证人|不适用)$/.test(guarantor) ? [] : guarantor.split(/[、；;，,\n]+/).map(s=>s.trim()).filter(Boolean);
  return {guarantors,guarantorKnown:unknown?0:1};
}

// Isolate supplemental columns from already published inventory_rows. A version's
// marker is written only after its immutable source has been indexed completely.
async function loadRoleIndex(db,snapshot,bucket){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS inventory_role_rows(version TEXT NOT NULL, sourceRow INTEGER NOT NULL, attribution TEXT NOT NULL, guarantor TEXT NOT NULL, guarantors TEXT NOT NULL, guarantorKnown INTEGER NOT NULL, PRIMARY KEY(version,sourceRow))'),
    db.prepare('CREATE TABLE IF NOT EXISTS inventory_role_sources(version TEXT PRIMARY KEY, guarantorHeader TEXT NOT NULL, hasAttribution INTEGER NOT NULL)'),
  ]);
  const meta=await db.prepare('SELECT * FROM inventory_role_sources WHERE version=?').bind(snapshot.id).first();
  if(meta)return meta;
  const original=await readVerifiedRoleWorkbook(db,snapshot,bucket);
  const insert="INSERT OR IGNORE INTO inventory_role_rows SELECT ?,json_extract(value,'$.sourceRow'),json_extract(value,'$.attribution'),json_extract(value,'$.guarantor'),json_extract(value,'$.guarantors'),json_extract(value,'$.guarantorKnown') FROM json_each(?)";
  const records=original.rows.map(({sourceRow,attribution,guarantor})=>{
    return {sourceRow,attribution,guarantor,...ledgerGuarantors(guarantor)};
  });
  for(let i=0;i<records.length;i+=500){
    const batch=[];
    for(let j=i;j<Math.min(i+500,records.length);j+=50)batch.push(db.prepare(insert).bind(snapshot.id,JSON.stringify(records.slice(j,j+50))));
    await db.batch(batch);
  }
  const count=await db.prepare('SELECT count(*) AS n FROM inventory_rows JOIN inventory_role_rows USING(version,sourceRow) WHERE version=?').bind(snapshot.id).first();
  if(count.n!==snapshot.rowCount)throw message('角色索引行数与已发布快照不符。',503);
  const {guarantorHeader,hasAttribution}=original;
  await db.prepare('INSERT OR IGNORE INTO inventory_role_sources VALUES (?,?,?)').bind(snapshot.id,guarantorHeader,Number(hasAttribution)).run();
  return {guarantorHeader,hasAttribution};
}

// Match a full legal name or one unambiguous abbreviated name. Only drop a
// known location prefix (branch cities in this snapshot, plus major cities).
// A group and a subsidiary with a different legal stem never share an alias.
function askIdentity(field,query,candidates){
  const choices=[...new Set(candidates)].sort((a,b)=>a.localeCompare(b,'zh-CN')).slice(0,8);
  const clarification=choices.length
    ? '请确认“'+query+'”对应的主体：'+choices.join('、')+'。'
    : '本期没有匹配到可确认的“'+query+'”。请补充主体全称或一只相关债券的完整券码。';
  return {clarification,identity:{field,query,candidates:choices}};
}
const codeWithMarket=/^[A-Z0-9-]+\.[A-Z]{2,5}$/i;
async function resolveEntity(db,snapshot,field,query,names,places,codeSource){
  const key=query.trim();
  if(codeWithMarket.test(key)){
    const {results}=await db.prepare(codeSource+' WHERE version=? AND upper(code)=?')
      .bind(snapshot.id,key.toUpperCase()).all();
    const candidates=results.map(row=>row.entity).filter(n=>names.includes(n));
    return askIdentity(field,key,candidates);
  }
  if(names.includes(key))return {entity:key};
  const stem=s=>s.replace(/(?:股份有限公司|有限责任公司|有限公司)$/,'');
  const geographic=new Set(['北京','天津','上海','重庆','珠海','广州','深圳','香港','澳门',...places]);
  const possible=names.filter(name=>{
    const nameStem=stem(name);
    if(nameStem===key)return true;
    if(key.length<4 || !nameStem.endsWith(key))return false;
    return geographic.has(nameStem.slice(0,-key.length).replace(/市$/,''));
  });
  if(possible.length===1)return {entity:possible[0]};
  const fragment=stem(key);
  if(possible.length>1)return askIdentity(field,key,possible);
  if(fragment.length<2 || /^(?:公司|集团|投资|控股|建设|有限|股份|中票|短融|债券|ABS|MTN)$/i.test(fragment))
    return askIdentity(field,key,[]);
  const suggestions=names.filter(name=>stem(name).includes(fragment));
  // A bond abbreviation supplies leads only. Its issuer and credit-support
  // customer may differ, so use the same source as the selected role.
  const {results}=await db.prepare(codeSource+' WHERE version=? AND instr(upper(name),upper(?))>0')
    .bind(snapshot.id,fragment).all();
  const leads=results.map(row=>row.entity).filter(name=>names.includes(name));
  return askIdentity(field,key,[...suggestions,...leads]);
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
export function normalizePlan(input,normalizeTypes=true) {
  if(!input || !Object.hasOwn(dimensions,input.group)||!['principal','count','securities'].includes(input.metric)||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!input.filters||typeof input.filters!=='object'||Array.isArray(input.filters))throw message('查询口径不受支持，请选择日期、指标和分组。',400);
  if(Object.keys(input.filters).some(k=>!filterNames.includes(k)))throw message('含不支持的筛选字段。',400);
  const filters={};
  for(const k of filterNames){
    const value=input.filters[k];
    if(value==null||value==='')continue;
    if(typeof value!=='string'||value.length>180||(k==='holdingStatus'&&value!=='存续'))throw message('筛选值无效。',400);
    if(k==='marketType'&&normalizeTypes){filters[k]=typeAliases.get(value.trim().toUpperCase())||value.trim();continue}
    filters[k]=value.trim();
  }
  return {date:input.date,group:input.group,metric:input.metric,filters};
}
function where(snapshot,plan,selectedGroup,evidence,typeRules=true) {
  const args=[snapshot.id],parts=['version=?'];
  for(const [k,v] of Object.entries(plan.filters)){
    if(k==='guarantor' || k==='attribution')continue;
    if(k==='holdingStatus'){parts.push("cents>0 AND maturity>?");args.push(snapshot.date);continue}
    if(k==='scope'&&v==='委外'){parts.push("scope LIKE '委外%'");continue}
    if(k==='marketType'&&typeRules){parts.push(classifiedType+'=?');args.push(v==='未填写'?'':v);continue}
    if(k==='marketType'&&v==='资产支持证券'){parts.push("marketType IN ('资产支持证券','ABS')");continue}
    parts.push(k+'=?');args.push(v==='未填写'?'':v);
  }
  if(evidence?.attributionEntity){parts.push('attribution=?');args.push(evidence.attributionEntity)}
  if(evidence?.kind==='enhancement'){parts.push('attribution=?');args.push(evidence.entity)}
  if(evidence?.kind==='unknown')parts.push('0');
  if(evidence?.kind==='ledger'){parts.push(namedGuarantor);args.push(evidence.entity)}
  if(evidence?.kind==='candidate'){parts.push('guarantorKnown=0 AND attribution=?');args.push(evidence.entity)}
  if(selectedGroup!=null && plan.group!=='none'){
    parts.push((plan.group==='marketType'&&typeRules?classifiedType:plan.group)+'=?');args.push(selectedGroup==='未填写'?'':selectedGroup);
  }
  return {sql:parts.join(' AND '),args};
}
async function roleEvidence(db,snapshot,plan,bucket){
  if(!plan.filters.guarantor&&!plan.filters.attribution)return null;
  const meta=await loadRoleIndex(db,snapshot,bucket);
  const enhancement=Boolean(plan.filters.guarantor && plan.filters.marketType==='资产支持证券');
  if(!meta.hasAttribution && plan.filters.attribution)return {clarification:'此快照没有“'+roleSource+'”列，无法按客户归属查询。'};
  if(enhancement && !meta.hasAttribution)return {kind:'unknown',basis:'enhancement',entity:plan.filters.guarantor,source:roleSource,hasAttribution:false};
  const orgNames="SELECT DISTINCT attribution AS entity FROM inventory_role_rows WHERE version=? AND attribution<>''";
  const orgQuery=enhancement||!plan.filters.guarantor?db.prepare(orgNames).bind(snapshot.id):
    db.prepare(orgNames+" UNION SELECT DISTINCT value AS entity FROM inventory_role_rows,json_each(guarantors) WHERE version=?").bind(snapshot.id,snapshot.id);
  const [orgs,locations]=await db.batch([
    orgQuery,
    db.prepare("SELECT DISTINCT branch FROM inventory_rows WHERE version=? AND branch LIKE '%分行'").bind(snapshot.id),
  ]);
  const names=orgs.results.map(r=>r.entity).filter(name=>name && !/^(?:[-—/\s]+|未知|待核(?:实)?|未填写|不详|暂无|无|N\/?A|null)$/i.test(name));
  const places=locations.results.map(r=>r.branch.replace(/分行$/,'').replace(/市$/,''));
  const customerByCode='SELECT DISTINCT attribution AS entity FROM '+roleRows;
  const attribution=plan.filters.attribution && await resolveEntity(db,snapshot,'attribution',plan.filters.attribution,names,places,customerByCode);
  if(attribution?.clarification)return attribution;
  const attributionEntity=attribution?.entity||'';
  if(!plan.filters.guarantor){
    return {kind:'attribution',entity:attributionEntity,source:roleSource,attributionEntity};
  }
  const guarantorByCode='SELECT DISTINCT value AS entity FROM '+roleRows+',json_each(guarantors)';
  const guarantor=await resolveEntity(db,snapshot,'guarantor',plan.filters.guarantor,names,places,enhancement?customerByCode:guarantorByCode);
  if(guarantor.clarification)return guarantor;
  const {entity}=guarantor;
  const w=where(snapshot,plan,null,{attributionEntity});
  if(enhancement){
    const stats=await bind(db,"SELECT count(*) FILTER (WHERE attribution=?) AS matchCount,count(*) FILTER (WHERE trim(attribution) IN ('','-','--','—','未知','待核','未填写','不详','N/A')) AS missingAttributionRows FROM "+roleRows+" WHERE "+w.sql,[entity,...w.args]).first();
    const unknown=!meta.hasAttribution || (stats.matchCount===0 && stats.missingAttributionRows>0);
    return {kind:unknown?'unknown':'enhancement',basis:'enhancement',entity,source:roleSource,hasAttribution:Boolean(meta.hasAttribution),attributionEntity,...stats};
  }
  const matches=await bind(db,'SELECT count(*) FILTER (WHERE '+namedGuarantor+') AS explicitCount,'+
    'count(*) FILTER (WHERE guarantorKnown=0) AS missingGuarantorRows,'+
    'count(*) FILTER (WHERE guarantorKnown=0 AND attribution=?) AS candidateCount,'+
    'coalesce(sum(cents) FILTER (WHERE guarantorKnown=0 AND attribution=?),0) AS candidateCents FROM '+roleRows+' WHERE '+w.sql,
    [entity,entity,entity,...w.args]).first();
  const kind=matches.explicitCount?'ledger':matches.candidateCount?'candidate':'unknown';
  return {kind,entity,source:kind==='ledger'?meta.guarantorHeader:kind==='candidate'?roleSource:'',attributionEntity,
    guarantorHeader:meta.guarantorHeader,hasAttribution:Boolean(meta.hasAttribution),...matches};
}
const agg='coalesce(sum(cents),0) AS cents,count(*) AS count,count(distinct code) AS securityCount';
async function compute(db,snapshot,plan,resultId,evidence,typeRules=true) {
  const w=where(snapshot,plan,null,evidence,typeRules),source=evidence?roleRows:'inventory_rows';
  const dimension=plan.group==='marketType'&&typeRules?classifiedType:plan.group;
  const group=plan.group==='none'?"'全部'":"coalesce(nullif("+dimension+",''),'未填写')";
  const order={principal:'cents',count:'count',securities:'securityCount'}[plan.metric];
  const batch=await db.batch([
    bind(db,'SELECT '+agg+',sum(CASE WHEN expected<>\'\' AND expected<=? AND legal>? THEN 1 ELSE 0 END) AS flagged FROM '+source+' WHERE '+w.sql,[snapshot.date,snapshot.date,...w.args]),
    bind(db,'SELECT '+group+' AS label,'+agg+(plan.group==='code'?',min(name) AS securityName':'')+' FROM '+source+' WHERE '+w.sql+' GROUP BY 1 ORDER BY '+order+' DESC,label',w.args),
  ]);
  const total=batch[0].results[0],groups=batch[1].results.map(({label,...g})=>({name:label,...g}));
  const warnings=[];
  const shortTypes=['短期融资券','超短期融资券'];
  if(typeRules&&(shortTypes.includes(plan.filters.marketType)||plan.group==='marketType'&&groups.some(g=>shortTypes.includes(g.name))))
    warnings.push('短融与超短融分列。原表列作短融、简称含 SCP 发行编号或“超短期融资券”的持仓计入超短融。');
  if(total.flagged)warnings.push(total.flagged+' 条持仓的 ABS 预计到期日已过、法定到期日尚未到，实际兑付待核。');
  if(plan.filters.holdingStatus)warnings.push('台账存续按正本金且表列到期日晚于业务日统计。');
  if(!total.count&&!evidence)warnings.push('当前筛选未匹配持仓，请检查日期和筛选名称。');
  const yuan=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(total.cents/1e10);
  let summary=plan.metric==='count'?total.count+' 条持仓记录':plan.metric==='securities'?total.securityCount+' 只不同券码':'名义本金 '+yuan+' 亿元';
  if(evidence){
    const {kind,entity,source,guarantorHeader,missingGuarantorRows,candidateCount,candidateCents}=evidence;
    if(evidence.basis==='enhancement'){
      summary=kind==='unknown'?'增信占用余额无法确认':!total.count?'按增信占用口径未匹配 '+entity+' 的 ABS 持仓':'按 '+entity+' 增信占用统计：'+summary;
      warnings.unshift('ABS 按“'+roleSource+'”列识别占用增信方。金额为我方库存名义本金，法律担保责任及金额须另核。');
      if(!evidence.hasAttribution)warnings.push('库存缺少“'+roleSource+'”列，无法识别占用增信方。');
      else if(evidence.missingAttributionRows)warnings.push('同范围有 '+evidence.missingAttributionRows+' 条持仓的增信占用归属未明确，已列金额仅覆盖可识别部分。');
    }
    if(kind==='attribution'){
      summary='按 '+entity+' 授信占用归集：'+summary;
      warnings.unshift('以“'+roleSource+'”列认定授信占用客户，以“债券类型”区分品种。自发债另按“发行人全称”查询。');
    }
    if(kind==='ledger'){
      summary='台账列明担保人 '+entity+' · '+summary;
      warnings.unshift('按“'+source+'”列汇总账面持仓，担保责任及范围未经独立核实。');
      if(missingGuarantorRows)warnings.push('同范围另有 '+missingGuarantorRows+' 条持仓担保人未明确，无法确定完整担保余额。');
      if(candidateCount)warnings.push('其中 '+candidateCount+' 条按客户归属匹配，名义本金 '+(candidateCents/1e10).toLocaleString('zh-CN',{maximumFractionDigits:8})+' 亿元，仅为待核候选，未计入上面的结果。');
    }
    if((kind==='unknown'||kind==='candidate') && evidence.basis!=='enhancement'){
      summary=kind==='candidate'?'担保余额待核。按客户归属匹配的候选持仓：'+summary:'担保余额无法确认';
      warnings.unshift((guarantorHeader?'在所选范围内未找到“'+guarantorHeader+'”列明确记载该主体的持仓。':'此快照没有明确的担保人列。')+
        (kind==='candidate'?'候选按“'+roleSource+'”匹配 '+entity+'，仅反映账面持仓。':'现有资料不足以认定担保余额为零。')+'需按券核对担保合同或发行文件。');
    }
  }
  return {resultId,summary,plan,snapshot:publicVersion(snapshot),totalCents:total.cents,rowCount:total.count,securityCount:total.securityCount,groups,warnings,...(evidence?{roleEvidence:evidence}:{})};
}
export async function newInventoryAnswer(db,snapshot,input,bucket,trace=[]){
  const plan=normalizePlan(input);
  if(!snapshot||snapshot.date!==plan.date)throw message('指定日期没有可用库存快照。',404);
  if(broadCredit.test(plan.filters.marketType||''))return {clarification:explainCredit};
  const issuer=plan.filters.issuer;
  if(issuer&&issuer!=='未填写'){
    const [issuers,branches]=await db.batch([
      db.prepare("SELECT DISTINCT issuer FROM inventory_rows WHERE version=? AND issuer<>''").bind(snapshot.id),
      db.prepare("SELECT DISTINCT branch FROM inventory_rows WHERE version=? AND branch LIKE '%分行'").bind(snapshot.id),
    ]);
    const names=issuers.results.map(r=>r.issuer),places=branches.results.map(r=>r.branch.replace(/市?分行$/,''));
    const resolved=await resolveEntity(db,snapshot,'issuer',issuer,names,places,'SELECT DISTINCT issuer AS entity FROM inventory_rows');
    if(resolved.clarification)return resolved;
    plan.filters.issuer=resolved.entity;
  }
  const evidence=await roleEvidence(db,snapshot,plan,bucket);
  if(evidence?.clarification)return evidence;
  const id=crypto.randomUUID(),result=await compute(db,snapshot,plan,id,evidence);
  if(trace.length)result.trace=trace;
  const saved={...plan,typeRules:1,...(evidence?{roleEvidence:evidence}:{}),...(trace.length?{trace}:{})};
  await db.prepare('INSERT INTO inventory_answers VALUES(?,?,?,?)').bind(id,snapshot.id,JSON.stringify(saved),new Date().toISOString()).run();
  return result;
}
export async function answerContext(db,id){
  if(typeof id!=='string'||!id||id.length>64)throw message('查询结果编号无效。',400);
  const a=await db.prepare('SELECT plan,version FROM inventory_answers WHERE id=?').bind(id).first();
  if(!a)throw message('该查询结果不存在。',404);
  const snapshot=await db.prepare('SELECT * FROM inventory_versions WHERE id=?').bind(a.version).first();
  const saved=JSON.parse(a.plan);
  const typeRules=saved.typeRules===1;
  return {snapshot,plan:normalizePlan(saved,typeRules),evidence:saved.roleEvidence,typeRules,trace:saved.trace};
}
function detailQuery(evidence,plan,typeRules){
  const includeType=typeRules&&(plan.group==='marketType'||plan.filters.marketType);
  return 'SELECT sourceRow,cents,'+fieldNames.join(',')+(evidence?',guarantor,attribution':'')+(includeType?','+classifiedType+' AS queryMarketType':'')+' FROM '+(evidence?roleRows:'inventory_rows')+' WHERE ';
}
export async function answerDetails(db,id,{group=null,offset=0,limit=50}={}) {
  const {snapshot,plan,evidence,typeRules}=await answerContext(db,id),w=where(snapshot,plan,group,evidence,typeRules);
  const [counts,records]=await db.batch([
    bind(db,'SELECT count(*) AS n FROM '+(evidence?roleRows:'inventory_rows')+' WHERE '+w.sql,w.args),
    bind(db,detailQuery(evidence,plan,typeRules)+w.sql+' ORDER BY sourceRow LIMIT ? OFFSET ?',[...w.args,limit,offset]),
  ]);
  return {rows:records.results,total:counts.results[0].n};
}
export async function readInventoryAnswer(db,id){
  const {snapshot,plan,evidence,typeRules,trace}=await answerContext(db,id);
  const result=await compute(db,snapshot,plan,id,evidence,typeRules);
  if(trace)result.trace=trace;
  return result;
}
export async function exportData(db,id){
  const {snapshot,plan,evidence,typeRules,trace}=await answerContext(db,id),result=await compute(db,snapshot,plan,id,evidence,typeRules),w=where(snapshot,plan,null,evidence,typeRules),rows=[];
  if(trace)result.trace=trace;
  for(let i=0;i<result.rowCount;i+=500){
    const page=await bind(db,detailQuery(evidence,plan,typeRules)+w.sql+' ORDER BY sourceRow LIMIT 500 OFFSET ?',[...w.args,i]).all();
    rows.push(...page.results);
  }
  if(rows.length!==result.rowCount||rows.reduce((sum,r)=>sum+r.cents,0)!==result.totalCents)throw Error('export reconciliation failed');
  return {result,rows};
}
