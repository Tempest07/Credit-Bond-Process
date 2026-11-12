import {InventoryError, analysisMeasureLabel, parseInventoryWorkbook, inventoryDimensions as dimensions} from './inventory-workbook.mjs';
import {attachSourceColumns,readVerifiedRoleWorkbook} from './inventory-source-columns.mjs';
export {readVerifiedRoleWorkbook};
import {normalizeAnalysis,runAnalysis} from './inventory-analysis.mjs';
import {creditSourceTypes,creditScope,isCreditGroup} from './inventory-credit.mjs';
import {accountLabel,accountSqlFor} from './inventory-account.mjs';
import {lookupInventorySecurity,ambiguousSecurities,fullMarketCode} from './inventory-security.mjs';

const fieldNames=['institution','branch','portfolio','account','scope','issuer','code','name','marketType','maturity','expected','legal'];
const filterNames=['branch','issuer','portfolio','account','scope','code','marketType','sourceMarketType','holdingStatus','guarantor','attribution'];
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
const creditTypeSql=typeColumn+' IN ('+asSqlList(creditSourceTypes)+')';
function filtersCreditGroup(plan){
  return isCreditGroup(plan.filters.marketType) || plan.analysis?.some(s=>s.op==='filter'&&s.field==='marketType'&&isCreditGroup(s.value));
}
export async function initInventory(db){await db.batch(schema.map(sql=>db.prepare(sql)))}
export async function listInventory(db) {
  const {results}=await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id ORDER BY v.date DESC').all();
  return results.map(publicVersion);
}
async function active(db,date){
  return await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id WHERE a.date=?').bind(date).first();
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

// Check the full role columns independently of bond labels, which may be missing
// or unsuitable as evidence for the planner. Related names are choices only.
export async function reviewInventoryCompany(db,snapshot,bucket,name,field,filters,suggested){
  const overview=field==='overviewSubject';
  const issuer=overview || field==='issuer';
  const enhancement=overview || (field==='guarantor' && typeAliases.get(String(filters.marketType||'').toUpperCase())==='资产支持证券');
  if(!issuer && !enhancement && field!=='attribution')return null;
  const names=new Set();
  if(issuer){
    const rows=await db.prepare("SELECT DISTINCT issuer FROM inventory_rows WHERE version=? AND issuer<>''").bind(snapshot.id).all();
    for(const row of rows.results)names.add(row.issuer);
    if(names.has(name))return {exact:true};
  }
  let hasAttribution;
  if(enhancement || field==='attribution'){
    const meta=await loadRoleIndex(db,snapshot,bucket);
    hasAttribution=Boolean(meta.hasAttribution);
    if(hasAttribution){
      const typeFilter=enhancement?' AND '+classifiedType+"='资产支持证券'":'';
      const rows=await db.prepare("SELECT DISTINCT attribution FROM "+roleRows+" WHERE version=? AND attribution<>''"+typeFilter).bind(snapshot.id).all();
      for(const row of rows.results)names.add(row.attribution);
      if(names.has(name))return {exact:true};
    }
  }
  const sources=[];
  if(issuer)sources.push('发行人全称');
  if(hasAttribution)sources.push((enhancement?'ABS 的':'')+'“'+roleSource+'”');
  const stem=name.replace(/(?:股份有限公司|有限责任公司|有限公司)$/u,'').replace(/(?:产业|投资|控股|集团|发展|建设|管理|运营)+$/u,'');
  const related=new Set(suggested.filter(candidate=>names.has(candidate)));
  if(stem.length>=2){
    for(const candidate of [...names].sort((a,b)=>a.localeCompare(b,'zh-CN'))){
      if(candidate.includes(stem))related.add(candidate);
    }
  }
  const candidates=[...related].slice(0,8);
  let clarification=snapshot.date+' 库存中，';
  if(sources.length)clarification+='按'+sources.join('和')+'核对，未查到以“'+name+'”登记的持仓。';
  if(hasAttribution===false)clarification+='本期缺少“'+roleSource+'”列，无法核对'+(enhancement?' ABS 增信':'客户归属')+'。';
  if(candidates.length)clarification+='下列是本期台账中其他名称相近的主体，可单独查看。';
  return {exact:false,clarification,candidates};
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
export async function ingestInventory({db,bucket,owner}, bytes,filename,replaceId,expectedYear) {
  if(expectedYear!=null && !/^\d{4}$/.test(expectedYear))throw message('请选择四位数的库存年份。',400);
  const checkYear=date=>{
    if(expectedYear!=null && date.slice(0,4)!==expectedYear)
      throw message('表内业务日 '+date+' 与所选年份 '+expectedYear+' 不符。',422);
  };
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const identical=await db.prepare('SELECT v.* FROM inventory_versions v JOIN inventory_current a ON a.version=v.id WHERE v.sha=?').bind(sha).first();
  if(identical){checkYear(identical.date);return {...publicVersion(identical),reused:true};}
  const workbook=await parseInventoryWorkbook(bytes);
  const {date,sheet,rowCount,totalCents,rows}=workbook;
  checkYear(date);
  const before=await active(db,date);
  if(before?.sha===sha)return {...publicVersion(before),reused:true};
  const conflict=current=>message('同一业务日已有其他版本，请核对金额和行数后确认替换。',409,{
    code:'revision_required',date,previousId:current?.id,previousCount:current?.rowCount,previousCents:current?.totalCents,nextCount:rowCount,nextCents:totalCents});
  if((before?.id||'')!==(replaceId||''))throw conflict(before);
  const id=crypto.randomUUID(),createdAt=new Date().toISOString();
  const key='inventory/'+date+'/'+id+'.xlsx';
  let publishAttempted=false;
  try {
    await bucket.put(key,bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
      ...(typeof owner==='string'&&owner.length<=200?{customMetadata:{uploadedBy:owner}}:{})});
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
export function normalizePlan(input,normalizeTypes=true,accountRules=2) {
  if(!input || !Object.hasOwn(dimensions,input.group)||!['principal','count','securities'].includes(input.metric)||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!input.filters||typeof input.filters!=='object'||Array.isArray(input.filters))throw message('查询口径不受支持，请选择日期、指标和分组。',400);
  if(Object.keys(input.filters).some(k=>!filterNames.includes(k)))throw message('含不支持的筛选字段。',400);
  const filters={};
  for(const k of filterNames){
    const value=input.filters[k];
    if(value==null||value==='')continue;
    if(typeof value!=='string'||value.length>180||(k==='holdingStatus'&&value!=='存续'))throw message('筛选值无效。',400);
    if(k==='marketType'&&normalizeTypes){filters[k]=typeAliases.get(value.trim().toUpperCase())||value.trim();continue}
    if(k==='account'&&accountRules){filters[k]=accountLabel(value.trim(),accountRules);continue}
    filters[k]=value.trim();
  }
  const rank=input.rank;
  if(rank!=null && (typeof rank!=='object' || !Object.hasOwn(dimensions,rank.by) || rank.by==='none' ||
      rank.by===input.group || !Number.isSafeInteger(rank.limit) || rank.limit<1 || rank.limit>50))
    throw message('请选择有效的排名维度、分组及前 1 至 50 名。',400);
  if(input.analysis!=null && !Array.isArray(input.analysis))throw message('查询步骤格式无效。',400);
  const analysis=input.analysis?.length ? normalizeAnalysis(input.analysis,accountRules) : undefined;
  if(analysis && rank)throw message('组合查询须在步骤中排序和选取名单。',400);
  return {date:input.date,group:input.group,metric:input.metric,filters,...(analysis?{analysis}:{}),...(rank?{rank:{by:rank.by,limit:rank.limit}}:{})};
}
function groupLabel(field,{typeRules=true,accountRules=2}={}) {
  if(field==='none')return "'全部'";
  const expression=field==='sourceMarketType'?'marketType':field==='marketType'&&typeRules?classifiedType:field==='account'&&accountRules?accountSqlFor(accountRules):field;
  return "coalesce(nullif("+expression+",''),'未填写')";
}
function where(snapshot,plan,selectedGroup,evidence,options={}) {
  const {typeRules=true,accountRules=2,rankMembers}=options;
  const args=[snapshot.id],parts=['version=?'];
  if(options.sourceRows!==undefined){
    parts.push('sourceRow IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(options.sourceRows));
  }
  for(const [k,v] of Object.entries(plan.filters)){
    if(k==='guarantor' || k==='attribution')continue;
    if(k==='holdingStatus'){parts.push("cents>0 AND maturity>?");args.push(snapshot.date);continue}
    if(k==='scope'&&v==='委外'){parts.push("scope LIKE '委外%'");continue}
    if(k==='marketType' && options.creditRules!==false && isCreditGroup(v)){parts.push(creditTypeSql);continue}
    if(k==='marketType'&&typeRules){parts.push(classifiedType+'=?');args.push(v==='未填写'?'':v);continue}
    if(k==='sourceMarketType'){parts.push('marketType=?');args.push(v==='未填写'?'':v);continue}
    if(k==='account'&&accountRules){parts.push(groupLabel(k,options)+'=?');args.push(v);continue}
    if(k==='marketType'&&v==='资产支持证券'){parts.push("marketType IN ('资产支持证券','ABS')");continue}
    parts.push(k+'=?');args.push(v==='未填写'?'':v);
  }
  if(evidence?.attributionEntity){parts.push('attribution=?');args.push(evidence.attributionEntity)}
  if(evidence?.kind==='enhancement'){parts.push('attribution=?');args.push(evidence.entity)}
  if(evidence?.kind==='unknown')parts.push('0');
  if(evidence?.kind==='ledger'){parts.push(namedGuarantor);args.push(evidence.entity)}
  if(evidence?.kind==='candidate'){parts.push('guarantorKnown=0 AND attribution=?');args.push(evidence.entity)}
  if(rankMembers){
    parts.push(groupLabel(plan.rank.by,options)+' IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(rankMembers));
  }
  if(selectedGroup!=null && plan.rank){
    let labels;
    try {labels=JSON.parse(selectedGroup)} catch { /* Invalid group keys are rejected below. */ }
    if(!Array.isArray(labels)||labels.length!==2||labels.some(s=>typeof s!=='string'))throw message('排名分组标识无效。',400);
    parts.push(groupLabel(plan.rank.by,options)+'=?',groupLabel(plan.group,options)+'=?');
    args.push(...labels);
  } else if(selectedGroup!=null && plan.group!=='none'){
    parts.push(groupLabel(plan.group,options)+'=?');args.push(selectedGroup);
  }
  return {sql:parts.join(' AND '),args};
}
async function roleEvidence(db,snapshot,plan,bucket,sourceRows){
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
  const w=where(snapshot,plan,null,{attributionEntity},{sourceRows});
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
async function topMembers(db,snapshot,plan,evidence,sourceRows) {
  const w=where(snapshot,plan,null,evidence,{sourceRows});
  const source=evidence?roleRows:'inventory_rows';
  const sql='SELECT '+groupLabel(plan.rank.by)+' AS label FROM '+source+' WHERE '+w.sql+
    ' GROUP BY 1 ORDER BY sum(cents) DESC,label LIMIT ?';
  const {results}=await bind(db,sql,[...w.args,plan.rank.limit]).all();
  return results.map(row=>row.label);
}
async function sqlTotals(db,snapshot,plan,evidence,options) {
  const {rankMembers}=options;
  const w=where(snapshot,plan,null,evidence,options),source=evidence?roleRows:'inventory_rows';
  const group=groupLabel(plan.group,options);
  const order={principal:'cents',count:'count',securities:'securityCount'}[plan.metric];
  const ranking=plan.rank?groupLabel(plan.rank.by,options)+' AS rankName,':'';
  const batch=await db.batch([
    bind(db,'SELECT '+agg+',sum(CASE WHEN expected<>\'\' AND expected<=? AND legal>? THEN 1 ELSE 0 END) AS flagged FROM '+source+' WHERE '+w.sql,[snapshot.date,snapshot.date,...w.args]),
    bind(db,'SELECT '+ranking+group+' AS label,'+agg+(plan.group==='code'?',min(name) AS securityName':'')+' FROM '+source+' WHERE '+w.sql+' GROUP BY '+(ranking?'1,2':'1')+' ORDER BY '+order+' DESC,label',w.args),
  ]);
  const total=batch[0].results[0];
  const groups=batch[1].results.map(({label,...g})=>plan.rank
    ? {name:JSON.stringify([g.rankName,label]),bucketName:label,rankPosition:rankMembers.indexOf(g.rankName)+1,...g}
    : {name:label,...g});
  if(plan.rank)groups.sort((a,b)=>a.rankPosition-b.rankPosition);
  if(options.listedMembers){
    const byName=new Map(groups.map(g=>[g.name,g]));
    return {total,groups:options.listedMembers.map(name=>byName.get(name)??{name,cents:0,count:0,securityCount:0})};
  }
  return {total,groups};
}
async function loadRows(db,select,w) {
  const sql=select+w.sql+' AND sourceRow>? ORDER BY sourceRow LIMIT 1000',rows=[];
  let after=0;
  for(;;){
    const page=await bind(db,sql,[...w.args,after]).all();
    rows.push(...page.results);
    if(page.results.length<1000)return rows;
    after=page.results.at(-1).sourceRow;
  }
}
async function analyzeRows(db,snapshot,plan,evidence,options) {
  const fields=new Set(plan.analysis.flatMap(s=>[s.field,s.measure?.field,...(s.fields??[])]).filter(Boolean));
  const needsRoles=fields.has('attribution')||fields.has('guarantor');
  if(needsRoles){
    const meta=await loadRoleIndex(db,snapshot,options.bucket);
    if(fields.has('attribution')&&!meta.hasAttribution)throw message('此快照没有资产端损益还原客户名称列。',400);
    if(fields.has('guarantor')&&!meta.guarantorHeader)throw message('此快照没有台账列明担保人列。',400);
  }
  const w=where(snapshot,plan,null,evidence,options);
  const rows=await loadRows(db,detailQuery(evidence||needsRoles,plan,options),w);
  const extraFields=[...fields].filter(field=>field.startsWith('原表:'));
  if(extraFields.length)await attachSourceColumns(db,snapshot,rows,extraFields,options.bucket);
  return runAnalysis(rows,plan.analysis,options.accountRules,options.creditRules);
}
function analysisTotals(analysis,snapshot) {
  const groups=analysis.groups.map(({name,labels,principalCents,rowCount,securityCount,value,measureValue})=>
    ({name,labels,cents:principalCents,count:rowCount,securityCount,value,...(analysis.measure?{measureValue}:{})}));
  const total={cents:0,count:analysis.rows.length,flagged:0};
  const codes=new Set();
  for(const row of analysis.rows){
    total.cents+=row.cents;
    codes.add(row.code);
    if(row.expected && row.expected<=snapshot.date && row.legal>snapshot.date)total.flagged++;
  }
  total.securityCount=codes.size;
  return {total,groups};
}
function measureSummary({measure,measureTotal}) {
  const label=analysisMeasureLabel(measure);
  if(measureTotal==null)return label+' 暂无有效值';
  return label+' '+new Intl.NumberFormat('zh-CN',{maximumFractionDigits:8}).format(measureTotal);
}
async function compute(db,snapshot,plan,resultId,evidence,options={},analysisResult) {
  const {typeRules=true,rankMembers}=options;
  const analysis=plan.analysis?(analysisResult??await analyzeRows(db,snapshot,plan,evidence,options)):null;
  const {groups,total}=analysis?analysisTotals(analysis,snapshot):await sqlTotals(db,snapshot,plan,evidence,options);
  const warnings=[];
  if(options.creditRules!==false && filtersCreditGroup(plan))warnings.push(creditScope);
  if(plan.analysis?.some(step=>[step.field,step.measure?.field,...(step.fields??[])].some(field=>field?.startsWith('原表:'))))
    warnings.push('原表扩展列使用该快照记录值，未经市场数据核验。');
  const shortTypes=['短期融资券','超短期融资券'];
  if(typeRules&&(analysis?.rows.some(r=>shortTypes.includes(r.queryMarketType))||shortTypes.includes(plan.filters.marketType)||plan.group==='marketType'&&groups.some(g=>shortTypes.includes(g.bucketName??g.name))||
      plan.rank?.by==='marketType'&&rankMembers.some(type=>shortTypes.includes(type))))
    warnings.push('短融与超短融分列。原表列作短融、简称含 SCP 发行编号或“超短期融资券”的持仓计入超短融。');
  if(total.flagged)warnings.push(total.flagged+' 条持仓的 ABS 预计到期日已过、法定到期日尚未到，实际兑付待核。');
  if(plan.filters.holdingStatus)warnings.push('台账存续按正本金且表列到期日晚于业务日统计。');
  if(!total.count&&!evidence)warnings.push('当前筛选未匹配持仓，请检查日期和筛选名称。');
  const yuan=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(total.cents/1e10);
  let summary=analysis?.measure?measureSummary(analysis):plan.metric==='count'?total.count+' 条持仓记录':plan.metric==='securities'?total.securityCount+' 只不同券码':'名义本金 '+yuan+' 亿元';
  if(evidence){
    const {kind,entity,source,guarantorHeader,missingGuarantorRows,candidateCount,candidateCents}=evidence;
    if(evidence.basis==='enhancement'){
      summary=kind==='unknown'?'增信占用余额无法确认':!total.count?'按增信占用口径未匹配 '+entity+' 的 ABS 持仓':'按 '+entity+' 增信占用统计：'+summary;
      warnings.unshift('ABS 按“'+roleSource+'”列识别占用增信方。金额为我方库存名义本金，法律担保责任及金额须另核。');
      if(!evidence.hasAttribution)warnings.push('库存缺少“'+roleSource+'”列，无法识别占用增信方。');
      else if(evidence.missingAttributionRows)warnings.push('同范围有 '+evidence.missingAttributionRows+' 条持仓的增信占用归属未明确，已列金额仅覆盖可识别部分。');
    }
    if(plan.analysis&&(evidence.missingAttributionRows||missingGuarantorRows||candidateCount))
      warnings.push('主体归属与担保资料的覆盖条数按本次分组、排名之前的初始筛选范围计算。');
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
  return {resultId,summary,plan,snapshot:publicVersion(snapshot),totalCents:total.cents,rowCount:total.count,securityCount:total.securityCount,groups,warnings,
    ...(options.sourceRows!==undefined?{scopedToPrevious:true}:{}),...(analysis?{dimensions:analysis.dimensions,analysisMetric:analysis.metric}:{}),
    ...(analysis?.measure?{measure:analysis.measure,measureTotal:analysis.measureTotal}:{}),...(options.rankReused?{rankReused:true}:{}),...(evidence?{roleEvidence:evidence}:{})};
}
export async function newInventoryAnswer(db,snapshot,input,bucket,trace=[],fixedMembers,sourceRows,listedMembers){
  if(sourceRows!==undefined && (!Array.isArray(sourceRows)||sourceRows.length>30000||
     sourceRows.some(row=>!Number.isSafeInteger(row)||row<1)||new Set(sourceRows).size!==sourceRows.length))
    throw message('上次结果的持仓范围无效，请重新查询。',409);
  const plan=normalizePlan(input);
  if(listedMembers!==undefined && (!Array.isArray(sourceRows)||plan.rank||plan.analysis||plan.group==='none'||
      !Array.isArray(listedMembers)||!listedMembers.length||listedMembers.length>5000||
      listedMembers.some(name=>typeof name!=='string'||!name.trim())||new Set(listedMembers).size!==listedMembers.length))
    throw message('用于分组的台账名单无效，请重新取名单。',409);
  if(!snapshot||snapshot.date!==plan.date)throw message('指定日期没有可用库存快照。',404);
  const branch=plan.filters.branch;
  if(branch&&branch!=='未填写'&&!branch.endsWith('分行')){
    const city=branch.replace(/市$/,'');
    const candidates=await db.prepare('SELECT DISTINCT branch FROM inventory_rows WHERE version=? AND branch IN (?,?,?)')
      .bind(snapshot.id,branch,city+'分行',city+'市分行').all();
    const values=candidates.results.map(r=>r.branch);
    if(!values.includes(branch)&&values.length>1)return {clarification:'这期台账中“'+branch+'”可能指 '+values.join('、')+'，请指定分行全称。'};
    if(!values.includes(branch)&&values.length===1)plan.filters.branch=values[0];
  }
  const code=plan.filters.code;
  if(code && code!=='未填写'){
    const hits=await lookupInventorySecurity(db,snapshot,code);
    if(hits.length>1)return {clarification:ambiguousSecurities(code,hits)};
    if(hits.length)plan.filters.code=hits[0].code;
    else if(!fullMarketCode(code))return {clarification:'本期库存未查到简称或券码“'+code+'”，请核对完整券名或券码。'};
  }
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
  const evidence=await roleEvidence(db,snapshot,plan,bucket,sourceRows);
  if(evidence?.clarification)return evidence;
  // The HTTP service may carry the previously saved cohort into a follow-up.
  // It belongs to an earlier answer on this snapshot, never to a client list.
  let rankMembers;
  if(plan.rank){
    if(fixedMembers===undefined)rankMembers=await topMembers(db,snapshot,plan,evidence,sourceRows);
    else {
      if(!Array.isArray(fixedMembers)||fixedMembers.length>plan.rank.limit||
         fixedMembers.some(name=>typeof name!=='string')||new Set(fixedMembers).size!==fixedMembers.length)
        throw message('上次排名主体记录无效，请重新查询。',409);
      rankMembers=fixedMembers;
    }
  }
  const rankReused=Boolean(plan.rank && fixedMembers!==undefined);
  const id=crypto.randomUUID(),result=await compute(db,snapshot,plan,id,evidence,{rankMembers,rankReused,bucket,sourceRows,listedMembers});
  if(trace.length)result.trace=trace;
  const saved={...plan,typeRules:1,accountRules:2,...(filtersCreditGroup(plan)?{creditRules:1}:{}),...(sourceRows!==undefined?{sourceRows}:{}),...(listedMembers?{listedMembers}:{}),...(rankMembers?{rankMembers}:{}),...(rankReused?{rankReused:true}:{}),...(evidence?{roleEvidence:evidence}:{}),...(trace.length?{trace}:{})};
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
  const accountRules=[1,2].includes(saved.accountRules)?saved.accountRules:false;
  return {snapshot,plan:normalizePlan(saved,typeRules,accountRules),evidence:saved.roleEvidence,typeRules,accountRules,creditRules:saved.creditRules===1,trace:saved.trace,
    sourceRows:saved.sourceRows,listedMembers:saved.listedMembers,rankMembers:saved.rankMembers,rankReused:saved.rankReused===true};
}
function detailQuery(evidence,plan,{typeRules=true,accountRules=2}){
  const includeType=typeRules&&(plan.analysis||plan.group==='marketType'||plan.rank?.by==='marketType'||plan.filters.marketType);
  const includeAccount=accountRules&&(plan.analysis||plan.group==='account'||plan.rank?.by==='account'||plan.filters.account);
  return 'SELECT sourceRow,cents,'+fieldNames.join(',')+(evidence?',guarantor,attribution':'')+(includeType?','+classifiedType+' AS queryMarketType':'')+
    (includeAccount?','+accountSqlFor(accountRules)+' AS queryAccount':'')+' FROM '+(evidence?roleRows:'inventory_rows')+' WHERE ';
}
export async function answerDetails(db,id,{group=null,offset=0,limit=50}={}) {
  const context=await answerContext(db,id),{snapshot,plan,evidence}=context;
  if(plan.analysis){
    const analysis=await analyzeRows(db,snapshot,plan,evidence,context);
    let rows=analysis.rows;
    if(group!==null){
      const selected=analysis.groups.find(g=>g.name===group);
      const sourceRows=new Set(selected?.sourceRows);
      rows=rows.filter(row=>sourceRows.has(row.sourceRow));
    }
    return {rows:rows.slice(offset,offset+limit),total:rows.length};
  }
  const w=where(snapshot,plan,group,evidence,context);
  const [counts,records]=await db.batch([
    bind(db,'SELECT count(*) AS n FROM '+(evidence?roleRows:'inventory_rows')+' WHERE '+w.sql,w.args),
    bind(db,detailQuery(evidence,plan,context)+w.sql+' ORDER BY sourceRow LIMIT ? OFFSET ?',[...w.args,limit,offset]),
  ]);
  return {rows:records.results,total:counts.results[0].n};
}
export async function readInventoryAnswer(db,id){
  const context=await answerContext(db,id),{snapshot,plan,evidence,trace}=context;
  const result=await compute(db,snapshot,plan,id,evidence,context);
  if(trace)result.trace=trace;
  return result;
}
// Only the server may derive this cohort, after checking answer ownership and snapshot.
export async function answerSourceRows(db,id,expectedSnapshotId) {
  const context=await answerContext(db,id),{snapshot,plan,evidence}=context;
  if(expectedSnapshotId!==undefined && snapshot.id!==expectedSnapshotId)
    throw message('无法跨库存版本沿用持仓行集合。',409);
  if(plan.analysis){
    const analysis=await analyzeRows(db,snapshot,plan,evidence,context);
    return analysis.rows.map(row=>row.sourceRow);
  }
  const w=where(snapshot,plan,null,evidence,context);
  const select='SELECT sourceRow FROM '+(evidence?roleRows:'inventory_rows')+' WHERE ';
  return (await loadRows(db,select,w)).map(row=>row.sourceRow);
}
export async function exportData(db,id){
  const context=await answerContext(db,id),{snapshot,plan,evidence,trace}=context;
  const analysis=plan.analysis?await analyzeRows(db,snapshot,plan,evidence,context):null;
  const result=await compute(db,snapshot,plan,id,evidence,context,analysis);
  const w=where(snapshot,plan,null,evidence,context),rows=analysis?.rows??[];
  if(trace)result.trace=trace;
  for(let i=0;!analysis&&i<result.rowCount;i+=500){
    const page=await bind(db,detailQuery(evidence,plan,context)+w.sql+' ORDER BY sourceRow LIMIT 500 OFFSET ?',[...w.args,i]).all();
    rows.push(...page.results);
  }
  if(rows.length!==result.rowCount||rows.reduce((sum,r)=>sum+r.cents,0)!==result.totalCents)throw Error('export reconciliation failed');
  return {result,rows};
}
