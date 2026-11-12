import {accountLabel} from './inventory-account.mjs';
import {InventoryError} from './inventory-workbook.mjs';
import {parseTradeWorkbook,exportTradeWorkbook,ledgerCategory} from './trade-workbook.mjs';
import {periodFields as timeFields,periodLabel,periodMatches,tradeCodeLookup,bondCodeFields,groupedTradeCode,validTradeDateRange} from './trade-fields.mjs';
const error=(message,status=400)=>{throw new InventoryError(message,status)};
const schema=[
 'CREATE TABLE IF NOT EXISTS trade_ledger_versions(id TEXT PRIMARY KEY, doc TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS trade_ledger_current(year INTEGER NOT NULL,direction TEXT NOT NULL,id TEXT NOT NULL REFERENCES trade_ledger_versions(id),PRIMARY KEY(year,direction))'
];
const initialized=new WeakSet();
async function init(db){if(!initialized.has(db)){await db.batch(schema.map(sql=>db.prepare(sql)));initialized.add(db);}}
const pub=({blocks,...v})=>v;
const dirName=d=>d==='buy'?'增持':'减持';
async function docs(db,ids){
 await init(db);
 if(ids!==undefined && (!Array.isArray(ids)||ids.length>120||ids.some(id=>typeof id!=='string'||id.length>120)))error('流水版本列表无效。');
 if(ids && !ids.length)return [];
 const sql=ids?'SELECT doc FROM trade_ledger_versions WHERE id IN ('+ids.map(()=>'?').join(',')+')':
 'SELECT v.doc FROM trade_ledger_versions v JOIN trade_ledger_current c ON c.id=v.id ORDER BY c.year,c.direction';
 const q=db.prepare(sql),r=await (ids?q.bind(...ids):q).all();
 if(ids && r.results.length!==new Set(ids).size)error('找不到当时使用的完整交易台账版本。',409);
 const vs=r.results.map(x=>JSON.parse(x.doc));
 if(new Set(vs.map(v=>v.year+v.direction)).size!==vs.length)error('同一年度及方向不能同时使用两个版本。');
 return vs.sort((a,b)=>a.year-b.year||a.direction.localeCompare(b.direction));
}
export async function listTradeLedgers(db){return (await docs(db)).map(pub);}
export async function loadTradeLedgers(db,ids){return (await docs(db,ids)).map(pub);}
async function immutableIO(operation){
 // R2 reads and writes of identical bytes under a fresh immutable key can be
 // safely retried once after a transient service error; pointer updates cannot.
 try{return await operation();}catch(e){
   if(!/503|502|504|500|service unavailable|server error|timed? ?out|network|connection reset/i.test(String(e?.message??e)))throw e;
   return await operation();
 }
}
const root=id=>'trade-ledgers/v1/'+id+'/';
export async function ingestTradeLedger({db,bucket},bytes,filename){
 if(typeof filename!=='string'||filename.length>220||/[\\/\u0000-\u001f]/.test(filename)||!filename.toLowerCase().endsWith('.xlsx'))error('请上传 .xlsx 交易表。');
 const parsed=parseTradeWorkbook(bytes,filename,{compact:true}),{chunks,...meta}=parsed;
 const {year,direction}=meta;
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),c=>c.toString(16).padStart(2,'0')).join('');
 await init(db);
 const before=await db.prepare('SELECT v.doc FROM trade_ledger_current c JOIN trade_ledger_versions v ON v.id=c.id WHERE c.year=? AND c.direction=?').bind(year,direction).first();
 const old=before?JSON.parse(before.doc):null;
 if(old?.sha===sha)return {ledger:pub(old),duplicate:true};
 if(old && (meta.asOf<old.asOf || meta.declaredEnd<old.declaredEnd || meta.reportDate && old.reportDate && meta.reportDate<old.reportDate))error('这份累计表的覆盖期间或报表日期更早，不能覆盖当前版本。',409);
 const previous=await db.prepare("SELECT id FROM trade_ledger_versions WHERE json_extract(doc,'$.sha')=? AND json_extract(doc,'$.year')=? AND json_extract(doc,'$.direction')=? LIMIT 1").bind(sha,year,direction).first();
 if(previous)error('同一份历史文件已经被更新版本替代，未覆盖现行累计表。',409);
 const id=crypto.randomUUID(),prefix=root(id),blocks=[],uploaded=[];
 let publishAttempted=false;
 try{
   await immutableIO(()=>bucket.put(prefix+'source.xlsx',bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}}));uploaded.push(prefix+'source.xlsx');
   for(const {range,bytes:block} of chunks){
     const key=prefix+'block-'+blocks.length+'.json';
     await immutableIO(()=>bucket.put(key,block,{httpMetadata:{contentType:'application/json'}}));
     blocks.push(range);uploaded.push(key);
   }
   const doc={id,sha,createdAt:new Date().toISOString(),...meta,blocks};
   // Old versions and source objects stay addressable by saved answers. The
   // manifest and compare-and-swap activation share one DB transaction.
   const activate=old?db.prepare('UPDATE trade_ledger_current SET id=? WHERE year=? AND direction=? AND id=?').bind(id,year,direction,old.id):
    db.prepare('INSERT INTO trade_ledger_current(year,direction,id) VALUES(?,?,?) ON CONFLICT(year,direction) DO NOTHING').bind(year,direction,id);
   publishAttempted=true;
   const [,switched]=await db.batch([db.prepare('INSERT INTO trade_ledger_versions(id,doc) VALUES(?,?)').bind(id,JSON.stringify(doc)),activate]);
   if(switched.meta.changes!==1){
     await db.prepare('DELETE FROM trade_ledger_versions WHERE id=?').bind(id).run();publishAttempted=false;error('另一个上传已先更新该年度及方向，请刷新后重试。',409);
   }
   return {ledger:pub(doc),duplicate:false};
 }catch(e){if(!publishAttempted)await Promise.allSettled(uploaded.map(k=>bucket.delete(k)));throw e;}
}

const derived=[...timeFields,'会计科目','台账年度','台账类别','增减方向','券码'];
const norm=v=>String(v??'').trim().normalize('NFKC').toLowerCase();
const canonical=(f,v)=>norm(['会计科目','会计分类'].includes(f.field)&&f.op!=='contains'?accountLabel(String(v??'')):v);
function predicate(f){
 if(f.op==='notEmpty')return v=>String(v??'').trim()!=='';
 if(f.op==='between')return v=>typeof v==='string'&&v>=f.value[0]&&v<=f.value[1];
 if(timeFields.includes(f.field)&&['eq','in'].includes(f.op))return v=>[].concat(f.value).some(x=>periodMatches(f.field,String(v),x));
 const values=f.op==='in'?new Set(f.value.map(value=>canonical(f,value))):canonical(f,f.value);
 return v=>f.op==='in'?values.has(canonical(f,v)):f.op==='contains'?canonical(f,v).includes(values):canonical(f,v)===values;
}
function validDate(v){if(v==null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)error('交易日期须为有效的 YYYY-MM-DD。');return v;}
// Coverage is checked in the requested date basis. A settlement filter can span
// two trade years, so it never restricts which stored trade blocks are scanned.
function settlementWindow(filters) {
 const dateFilters=filters.filter(f=>f.field==='交易交割日');
 const windows=[];
 for(const f of dateFilters){
   if(f.op==='between'){windows.push(f.value);continue;}
   const bounds=[];
   for(const v of [].concat(f.value||[])){
     if(['eq','in','contains'].includes(f.op)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&validDate(v))bounds.push([v,v]);
     else if(f.op==='contains'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(v)){
       const [y,m]=v.split('-').map(Number);
       bounds.push([v+'-01',new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)]);
     }else if(f.op==='contains'&&/^\d{4}$/.test(v))bounds.push([v+'-01-01',v+'-12-31']);
     else break;
   }
   if(bounds.length && bounds.length===[].concat(f.value||[]).length)
     windows.push([bounds.map(x=>x[0]).sort()[0],bounds.map(x=>x[1]).sort().at(-1)]);
 }
 if(!windows.length)return null;
 return {start:windows.map(b=>b[0]).sort().at(-1),end:windows.map(b=>b[1]).sort()[0]};
}
function setup(plan,all,verifiedMembers){
 const withinListLimit=f=>f.value.length<=100 || f.value.length<=5000 && f.field===verifiedMembers?.field &&
   f.value.length===verifiedMembers.names.length && f.value.every((name,index)=>name===verifiedMembers.names[index]);
 if(!plan||!['buy','sell','both'].includes(plan.direction)||!['buy','sell','net','gross','rows','bonds','dateRange','average'].includes(plan.metric))error('交易查询方向或统计指标无效。');
 if(['net','gross'].includes(plan.metric)&&plan.direction!=='both'||plan.metric==='buy'&&plan.direction==='sell'||plan.metric==='sell'&&plan.direction==='buy')error('指标与所查询的增减方向不一致。');
 const start=validDate(plan.start),end=validDate(plan.end);
 if(start&&end&&start>end)error('起始交易日期不能晚于结束日期。');
 const groupBy=plan.metric==='dateRange'&&(!plan.groupBy||!plan.groupBy.length)?['台账年度','增减方向']:plan.groupBy??[];
 const filters=plan.filters??[],limit=plan.limit??null,order=plan.order??'desc';
 if(plan.share!=null&&(plan.share!=='matched'||groupBy.length!==1||!['buy','sell','gross','rows'].includes(plan.metric)))error('交易占比的指标或分组无效。');
 if(plan.showGroups!=null&&(!plan.share||!Array.isArray(plan.showGroups)||plan.showGroups.length>100||!plan.showGroups.every(v=>typeof v==='string'&&v.trim()&&v.length<=250)))error('交易占比的展示分组无效。');
 if(!Array.isArray(groupBy)||groupBy.length>6||new Set(groupBy).size!==groupBy.length||!Array.isArray(filters)||filters.length>16||(limit!==null&&(!Number.isInteger(limit)||limit<1||limit>100))||!['asc','desc'].includes(order))error('交易分组、排序或筛选条件无效。');
 if(filters.some(f=>{
   if(f?.op==='between')return !validTradeDateRange(f.field,f.value);
   return !f||!['eq','contains','in','notEmpty'].includes(f.op)||(f.op==='notEmpty'?f.value!=='':f.op==='in'?(!Array.isArray(f.value)||!f.value.length||!withinListLimit(f)||f.value.some(x=>typeof x!=='string'||x.length>1024)):(typeof f.value!=='string'||!f.value.trim()||f.value.length>1024));
 }))error('交易筛选值或操作无效。');
 const directions=plan.direction==='both'?['buy','sell']:[plan.direction];
 const ledgerYearFilters=filters.filter(f=>f.field==='台账年度');
 const allowedYear=y=>ledgerYearFilters.every(f=>f.op==='eq'?String(y)===f.value:f.op==='in'?f.value.includes(String(y)):String(y).includes(f.value));
 const categories=filters.filter(f=>f.field==='台账类别').map(predicate);
 const available=all.filter(v=>directions.includes(v.direction)&&allowedYear(v.year)&&categories.every(test=>test(ledgerCategory(v.filename))));
 const overlaps=(lo,hi)=>(!end||lo<=end)&&(!start||hi>=start);
 // Include valid zero-trade days within the declared accounting period. Cross-year
 // trades are included even if their declared ledger year differs from the trade date.
 const relevant=available.filter(v=>overlaps(v.year+'-01-01',v.asOf)||overlaps(v.start,v.end));
 const fields=[...groupBy,...filters.map(f=>f.field)];
 for(const field of fields){
   if(typeof field!=='string'||(!derived.includes(field)&&!all.some(v=>v.headers.includes(field))))error('所选交易台账没有字段“'+String(field)+'”。');
   const missing=relevant.find(v=>field==='会计科目'?!v.headers.includes('会计分类'):!derived.includes(field)&&!v.headers.includes(field));
   if(missing)error(missing.filename+' 缺少“'+field+'”列，不能作为该范围内完整的分类或筛选依据。');
 }
 const warnings=[];
 let completeCoverage=true;
 const bothRequired=plan.direction==='both'&&['net','gross','average'].includes(plan.metric);
 const requestedYears=ledgerYearFilters.flatMap(f=>f.op==='eq'?[f.value]:f.op==='in'?f.value:[]).filter(y=>/^\d{4}$/.test(y)).map(Number);
 const settlement=settlementWindow(filters);
 // An explicit trade interval is still checked in full when both bases are constrained.
 const coverageStart=start||settlement?.start,coverageEnd=end||settlement?.end;
 if(settlement)warnings.push('按已入账流水的交易交割日归属核对 '+settlement.start+' 至 '+settlement.end+'；未入账事项不在统计内。');
 const firstYear=coverageStart?+coverageStart.slice(0,4):Math.min(...(requestedYears.length?requestedYears:all.map(v=>v.year))),lastYear=coverageEnd?+coverageEnd.slice(0,4):Math.max(...(requestedYears.length?requestedYears:all.map(v=>v.year)));
 if(Number.isFinite(firstYear)&&Number.isFinite(lastYear)&&lastYear-firstYear>100)error('单次查询请限制在 100 年以内。');
 if(Number.isFinite(firstYear)&&Number.isFinite(lastYear)){
   for(let y=firstYear;y<=lastYear;y++){
     if(!allowedYear(y))continue;
     const sides=[];
     for(const d of directions){
       const v=available.find(v=>v.year===y&&v.direction===d);
       if(!v){
         completeCoverage=false;
         const absent=y+' 年'+dirName(d)+'累计表尚未导入，缺少的交易不能按 0 计算。';
         if(bothRequired)error(absent+'无法计算所问范围的双向结果。');
         warnings.push(absent);continue;
       }
       const until=coverageEnd&&coverageEnd<y+'-12-31'?coverageEnd:y+'-12-31';
       sides.push(v.asOf<until?v.asOf:until);
       if(until>v.asOf){completeCoverage=false;warnings.push(y+' 年'+dirName(d)+'仅覆盖至 '+v.asOf+'，此后交易不在本次结果内。');}
     }
     if(bothRequired&&new Set(sides).size>1)error(y+' 年增持、减持台账截止日不一致，无法计算完整区间的双向结果；请将截止日限定在两份表共同覆盖的日期内。');
   }
 }
 if(!all.length)error('尚未导入交易台账，无法计算。');
 if(!relevant.length){
   const through=available.map(v=>v.asOf).sort().at(-1);
   error('已导入的交易台账不覆盖所选方向及日期'+(through?'，流水累计至 '+through:'')+'，无法确定所问期间的交易额。余额变动受兑付、摊还和划转等影响，不能替代净买入。');
 }
 for(const v of available.filter(v=>v.outOfPeriodRows && (relevant.includes(v)||v.year>=firstYear&&v.year<=lastYear))){
   warnings.push(v.filename+' 有 '+v.outOfPeriodRows+' 笔跨期交易（'+(v.outOfPeriodCents/100).toLocaleString('zh-CN')+' 元）；按逐笔交易日期归期。');
 }
 const codeFilters=filters.filter(f=>f.field==='券码');
 if(codeFilters.length)warnings.push('按债券代码和债券标准代码逐行核对，含市场后缀的券码保持市场限定。');
 return {plan:{direction:plan.direction,start,end,filters,groupBy,metric:plan.metric,limit,order,...(plan.share?{share:plan.share,showGroups:plan.showGroups??[]}: {})},relevant,available,warnings,completeCoverage,
   codeLookup:codeFilters.length?tradeCodeLookup(codeFilters):null};
}
function getter(v,f){
 const i=v.headers.indexOf(f),di=v.headers.indexOf('交易日期');
 if(f==='券码'){const ci=v.headers.indexOf('债券代码'),si=v.headers.indexOf('债券标准代码');return r=>groupedTradeCode(r[ci],r[si]);}
 if(f==='会计科目'||f==='会计分类'){const ac=v.headers.indexOf('会计分类');return r=>accountLabel(String(r[ac]??''));}
 if(f==='台账年度')return ()=>String(v.year);
 if(f==='台账类别')return ()=>ledgerCategory(v.filename);
 if(timeFields.includes(f))return r=>periodLabel(f,r[di]);
 if(f==='增减方向')return ()=>dirName(v.direction);
 return f==='名义本金'?r=>r[i]/100:r=>r[i];
}
async function* matches(bucket,scope,observed){
 const {start,end,filters}=scope.plan;
 const lookup=scope.codeLookup;
 for(const v of scope.relevant){
   const di=v.headers.indexOf('交易日期'),ai=v.headers.indexOf('名义本金'),ci=v.headers.indexOf('债券代码');
   const si=v.headers.indexOf('债券标准代码');
   const tests=filters.filter(f=>!['台账类别','券码'].includes(f.field)).map(f=>{
     const get=getter(v,f.field),test=predicate(f);
     return r=>test(get(r));
   });
   for(const [i,[min,max]] of v.blocks.entries()){
     if(start&&max<start||end&&min>end)continue;
     const obj=await immutableIO(()=>bucket.get(root(v.id)+'block-'+i+'.json'));if(!obj)error('交易数据块不可用，请稍后重试。',503);
     const rows=await obj.json();if(!Array.isArray(rows))error('交易数据块校验失败。',503);
     const samples=observed?[...observed.entries()].map(([field,set])=>[getter(v,field),set]):[];
     for(const row of rows){if(start&&row[di]<start||end&&row[di]>end)continue;
       for(const [get,set] of samples){const value=String(get(row)??'').trim();if(value&&set.size<200)set.add(value);}
       if(lookup&&!lookup.test(row[ci],row[si]))continue;
       if(!tests.every(t=>t(row)))continue;
       yield {v,row,cents:row[ai],code:row[ci]};
     }
   }
 }
 if(lookup)lookup.verify();
}
const counter=()=>({buyCents:0,sellCents:0,rows:0,codes:new Set()});
function add(c,v,cents,code,dates,average){
 c[v.direction+'Cents']+=cents;c.rows++;if(code)c.codes.add(String(code));
 if(average&&v.direction==='buy')c.buyRows=(c.buyRows||0)+1;
 if(!dates)return;
 const bounds=c.dates??={firstTrade:'',lastTrade:'',firstSettlement:'',lastSettlement:'',missingSettlement:0};
 for(const [kind,day] of dates){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){if(kind==='Settlement')bounds.missingSettlement++;continue;}
   if(!bounds['first'+kind]||day<bounds['first'+kind])bounds['first'+kind]=day;
   if(day>bounds['last'+kind])bounds['last'+kind]=day;
 }
}
function finish(c,average){const {buyCents,sellCents,rows,codes}=c;const grossCents=buyCents+sellCents;
 if(!Number.isSafeInteger(grossCents))error('所选范围的交易金额超过精确统计上限。');
 const buyRows=c.buyRows||0,sellRows=rows-buyRows;
 return {buyCents,sellCents,grossCents,netCents:buyCents-sellCents,rows,bonds:codes.size,...(c.dates?{dates:c.dates}:{}),
   ...(average?{buyRows,sellRows,averageCents:rows?grossCents/rows:null,buyAverageCents:buyRows?buyCents/buyRows:null,sellAverageCents:sellRows?sellCents/sellRows:null}:{})};}
// Enumerate the requested periods independently of whether the ledger had any trades.
function calendarGroups(field,start,end,filters){
 const labels=new Set();
 const calendarTests=filters.filter(f=>timeFields.includes(f.field)).map(f=>[f.field,predicate(f)]);
 for(let year=+start.slice(0,4);year<=+end.slice(0,4);year++){
   const first=year===+start.slice(0,4)?+start.slice(5,7):1;
   const last=year===+end.slice(0,4)?+end.slice(5,7):12;
   for(let month=first;month<=last;month++){
     const day=year+'-'+String(month).padStart(2,'0')+'-01';
     if(calendarTests.every(([f,match])=>match(periodLabel(f,day))))labels.add(periodLabel(field,day));
   }
 }
 return [...labels];
}
function addEmptyGroups(scope,groups){
 const {groupBy,start,end,filters}=scope.plan;
 if(!scope.completeCoverage)return;
 // If every non-period label is fixed, one verified, complete time series is
 // still defined even when none of the rows matched in some or all periods.
 const periodIndex=groupBy.findIndex(field=>timeFields.includes(field));
 if(groupBy.length>1 && periodIndex>=0 && groupBy.filter(field=>timeFields.includes(field)).length===1 &&
     start && end && !filters.some(f=>f.field==='台账年度')){
   const dimensions=groupBy.map((field,index)=>{
     if(index===periodIndex)return '';
     const predicates=filters.filter(f=>f.field===field);
     const exact=predicates.find(f=>f.op==='eq');
     if(!exact||!predicates.every(f=>predicate(f)(exact.value)))return null;
     const observed=new Set([...groups.values()].map(group=>group.values[index]));
     if(observed.size===1)return [...observed][0];
     if(observed.size>1)return null;
     if(field==='券码'&&scope.codeLookup){
       const labels=scope.codeLookup.groupLabels(exact.value,field);
       return labels.size===1?[...labels][0]:null;
     }
     return ['会计分类','会计科目'].includes(field)?accountLabel(exact.value):exact.value.trim();
   });
   if(dimensions.every(label=>label!==null)){
     const field=groupBy[periodIndex];
     const populated=new Set([...groups.values()].map(group=>group.values[periodIndex]));
     for(const period of calendarGroups(field,start,end,filters)){
       if(populated.has(period))continue;
       const labels=dimensions.slice();labels[periodIndex]=period;
       groups.set(JSON.stringify(labels),{values:labels,c:counter()});
     }
   }
   return;
 }
 if(scope.plan.direction==='both' && scope.plan.metric==='rows' && groupBy.length===2 && groupBy.includes('增减方向')){
   const side=groupBy.indexOf('增减方向'),member=1-side,field=groupBy[member];
   const values=new Set([...groups.values()].map(g=>g.values[member]));
   const memberFilters=filters.filter(f=>f.field===field);
   const set=memberFilters.find(f=>f.op==='in');
   if(set){
     for(const name of set.value){
       let labels=[name];
       if(field==='券码'&&scope.codeLookup)labels=scope.codeLookup.groupLabels(name,field);
       if(!memberFilters.every(f=>predicate(f)(name)))continue;
       for(const label of labels)values.add(label);
     }
   }
   const sides=filters.filter(f=>f.field==='增减方向').map(predicate);
   for(const value of values)for(const direction of ['增持','减持']){
     if(!sides.every(test=>test(direction)))continue;
     const labels=side===0?[direction,value]:[value,direction],key=JSON.stringify(labels);
     if(!groups.has(key))groups.set(key,{values:labels,c:counter()});
   }
   return;
 }
 if(groupBy.length!==1)return;
 const field=groupBy[0],criteria=filters.filter(f=>f.field===field);
 if(bondCodeFields.includes(field)&&scope.codeLookup&&filters.some(f=>f.field==='券码'&&f.op==='in')){
   const codeCriteria=filters.filter(f=>f.field===field||f.field==='券码');
   const sets=codeCriteria.filter(f=>['eq','in'].includes(f.op)).map(f=>{
     const labels=[].concat(f.value).flatMap(value=>f.field==='券码'?[...scope.codeLookup.groupLabels(value,field)]:[value]);
     return new Set(labels.map(label=>String(label).trim().normalize('NFKC').toUpperCase()));
   });
   const existing=new Set(Array.from(groups.values(),g=>norm(g.values[0])));
   const partial=codeCriteria.filter(f=>f.op==='contains'||f.op==='notEmpty').map(predicate);
   for(const label of sets[0]){
     if(existing.has(norm(label))||!sets.every(set=>set.has(label))||!partial.every(test=>test(label)))continue;
     existing.add(norm(label));groups.set(JSON.stringify([label]),{values:[label],c:counter()});
   }
   return;
 }
 const members=criteria.find(f=>f.op==='in');
 let names=members?.value;
 if(timeFields.includes(field)&&start&&end&&!filters.some(f=>f.field==='台账年度'))names=calendarGroups(field,start,end,filters);
 if(!names)return;
 const tests=criteria.map(predicate);
 const existing=new Set(Array.from(groups.values(),g=>norm(g.values[0])));
 for(const name of names){
   const label=['会计科目','会计分类'].includes(field)?accountLabel(name):name.trim();
   if(existing.has(norm(label))||!tests.every(test=>test(label)))continue;
   existing.add(norm(label));groups.set(JSON.stringify([label]),{values:[label],c:counter()});
 }
}
function periodHighlights(scope,list,field){
 const {groupBy,limit,metric}=scope.plan;
 if(['dateRange','average'].includes(metric)||!scope.completeCoverage||groupBy.length!==1||!timeFields.includes(groupBy[0])||list.length<2||(limit&&limit<list.length))return [];
 const unit=['rows','bonds'].includes(metric)?(metric==='rows'?'笔':'只'):'分';
 const label={buy:'增持',sell:'减持',net:'净增持',gross:'双边成交',rows:'交易笔数',bonds:'不同券数'}[metric];
 const extremes=[Math.max(...list.map(g=>g[field])),Math.min(...list.map(g=>g[field]))];
 const results=extremes.map((value,i)=>({label:label+(i?'最低':'最高')+' · '+list.filter(g=>g[field]===value).map(g=>g.values[0]).sort().join('、'),value,unit}));
 if(list.length===2){
   const [a,b]=[...list].sort((a,b)=>a.values[0].localeCompare(b.values[0]));
   const delta=b[field]-a[field];
   if(!Number.isSafeInteger(delta))error('期间差额超出精确统计上限。');
   results.unshift({label:b.values[0]+' 比 '+a.values[0]+(delta>0?' 增加':delta<0?' 减少':' 持平'),value:Math.abs(delta),unit});
 }
 return results;
}
async function aggregate(bucket,s){
 const t=counter(),groups=new Map(),getters=new Map(s.relevant.map(v=>[v.id,s.plan.groupBy.map(f=>getter(v,f))]));
 const observed=new Map(s.plan.filters.filter(f=>['表内/委外','会计分类','会计科目','债券类型','交易市场(一级/二级)'].includes(f.field)&&f.op!=='notEmpty').map(f=>[f.field,new Set()]));
 const dayColumns=s.plan.metric==='dateRange'?new Map(s.relevant.map(v=>[v.id,['交易日期','交易交割日'].map(f=>v.headers.indexOf(f))])):null;
 const average=s.plan.metric==='average';
 for await(const {v,row,cents,code} of matches(bucket,s,observed)){
   const days=dayColumns?.get(v.id), dates=days&&[['Trade',row[days[0]]],['Settlement',row[days[1]]]];
   add(t,v,cents,code,dates,average);if(!s.plan.groupBy.length)continue;
   const values=getters.get(v.id).map(g=>String(g(row)??'').trim()||'（未填）'),key=JSON.stringify(values);
   let group=groups.get(key);if(!group){if(groups.size>=100000)error('分组过多，请缩小时间范围或减少分组列。');group={values,c:counter()};groups.set(key,group);}
   add(group.c,v,cents,code,dates,average);
 }
 if(!t.rows)for(const f of s.plan.filters){
   const seen=observed.get(f.field), matches=predicate(f);
   if(seen?.size&&seen.size<200&&![...seen].some(matches)){
     error('所选期间的“'+f.field+'”没有找到筛选值“'+[].concat(f.value).join('、')+'”。已见取值包括 '+[...seen].slice(0,12).join('、')+'。请核对列名或取值。',422);
   }
 }
 if(!t.rows&&s.plan.filters.some(f=>f.field==='券码')){
   if(!s.completeCoverage)error('已覆盖的交易明细中未见该券码，所问期间流水尚不完整，无法确认全期是否成交。',422);
   s.warnings.push('两个券码列均已检查，所问期间和筛选范围内没有匹配交易。');
 }
 addEmptyGroups(s,groups);
 const field=s.plan.metric==='dateRange'?'rows':['bonds','rows'].includes(s.plan.metric)?s.plan.metric:s.plan.metric+'Cents';
 const totals=finish(t,average),groupKey=v=>canonical({field:s.plan.groupBy[0],op:'eq'},v);
 const wanted=new Set((s.plan.showGroups||[]).map(groupKey));
 const list=Array.from(groups.values(),({values,c})=>({values,...finish(c,average)})).filter(g=>!wanted.size||wanted.has(groupKey(g.values[0])));
 if(s.plan.share)for(const g of list)g.share=totals[field]?g[field]/totals[field]:null;
 if(wanted.size){
   for(const name of s.plan.showGroups)if(!list.some(g=>groupKey(g.values[0])===groupKey(name)))s.warnings.push('展示范围内没有“'+name+'”的匹配交易。');
 }
 list.sort((a,b)=>Number(a[field]==null)-Number(b[field]==null)||(s.plan.order==='asc'?1:-1)*(a[field]-b[field])||JSON.stringify(a.values).localeCompare(JSON.stringify(b.values),'zh-CN'));
 const highlights=periodHighlights(s,list,field);
 const {limit,metric}=s.plan;
 if(metric==='net' && s.completeCoverage && s.plan.groupBy.length===1 &&
    !timeFields.includes(s.plan.groupBy[0]) && !wanted.size && !limit){
   const key=s.plan.groupBy[0];
   let bought=0,sold=0;
   for(const group of list){
     if(group.netCents>0)bought+=group.netCents;
     else sold+=group.netCents;
   }
   if(![bought,sold,bought+sold].every(Number.isSafeInteger) || bought+sold!==totals.netCents)error('交易分组净额未与全范围合计对齐。');
   highlights.push({label:'净买入的'+key+'合计贡献',value:bought,unit:'分'},
     {label:'净卖出的'+key+'合计抵消（有符号）',value:sold,unit:'分'},
     {label:'两类分组净额合计（含未填写组）',value:bought+sold,unit:'分'});
   const blank=list.find(g=>g.values[0]==='（未填）');
   if(blank)highlights.push({label:key+'未填写组净额（已纳入上述合计）',value:blank.netCents,unit:'分'});
 }
 if(metric==='net' && !s.plan.groupBy.length && s.completeCoverage){
   const label=totals.netCents<0?'按交易本金净流出（净减持）':totals.netCents>0?'按交易本金净流入（净增持）':'交易买卖本金相抵';
   highlights.push({label,value:Math.abs(totals.netCents),unit:'分'});
 }
 const additiveLabels={buy:'增持本金',sell:'减持本金',net:'净增持本金',gross:'双边成交本金',rows:'交易笔数'};
 if(limit>1 && list.length>1 && Object.hasOwn(additiveLabels,metric)){
   const ranked=list.slice(0,limit);
   const value=ranked.reduce((total,row)=>total+row[field],0);
   if(!Number.isSafeInteger(value))error('已列分组合计超出精确统计上限。');
   highlights.push({label:'已列 '+ranked.length+' 组'+additiveLabels[metric]+'合计',value,unit:metric==='rows'?'笔':'分'});
 }
 return {totals,list,highlights};
}
export async function runTradeQuery({db,bucket},plan,versionIds,{collectMembers=false,verifiedMembers}={}){
 const s=setup(plan,await docs(db,versionIds),verifiedMembers),{list,totals,highlights}=await aggregate(bucket,s);
 return {plan:s.plan,totals,completeCoverage:s.completeCoverage,
   ...(collectMembers?{memberNames:list.filter(group=>group.rows>0).map(group=>group.values[0]),
     memberAmounts:list.filter(group=>group.rows>0).map(group=>({name:group.values[0],buy:group.buyCents,sell:group.sellCents}))}:{}),
   groups:list.slice(0,s.plan.limit??100),groupCount:list.length,versions:s.relevant.map(pub),warnings:s.warnings,highlights};
}
export async function tradeExportSheets({db,bucket},plan,versionIds,verifiedMembers){
 const s=setup(plan,await docs(db,versionIds),verifiedMembers),{totals,list,highlights}=await aggregate(bucket,s);
 const sourceHeaders=[...new Set(s.relevant.flatMap(v=>v.headers))];
 async function* detail(){
   const cols=new Map(s.relevant.map(v=>[v.id,sourceHeaders.map(h=>v.headers.indexOf(h))])),money=sourceHeaders.indexOf('名义本金');
   for await(const {v,row} of matches(bucket,s)){const values=cols.get(v.id).map(i=>i<0?'':row[i]??'');if(money>=0)values[money]/=100;yield [v.filename,v.sheet,row.at(-1),dirName(v.direction),...values];}
 }
 const isDateRange=s.plan.metric==='dateRange';
 const average=s.plan.metric==='average',toYuan=v=>v==null?'':v/100;
 const shareKey=s.plan.metric==='rows'?'rows':s.plan.metric+'Cents';
 const summaryNumbers=g=>[g.buyCents/100,g.sellCents/100,g.netCents/100,g.grossCents/100,g.rows,g.bonds,
   ...(average?[g.buyRows,g.sellRows,toYuan(g.buyAverageCents),toYuan(g.sellAverageCents),toYuan(g.averageCents)]:[]),
   ...(s.plan.share?[totals[shareKey]?g[shareKey]/totals[shareKey]:'']:[]),
   ...(isDateRange?[g.dates?.firstTrade||'',g.dates?.lastTrade||'',g.dates?.firstSettlement||'',g.dates?.lastSettlement||'',g.dates?.missingSettlement||0]:[])];
 const dims=s.plan.groupBy.length?s.plan.groupBy:['范围'];
 function* summary(){
   const numbers=summaryNumbers(totals);
   if(!s.completeCoverage&&!totals.rows)yield ['覆盖不足，无法确认交易本金和笔数',...dims.slice(1).map(()=>''),...numbers.map(()=>'')];
   else yield ['全部匹配',...dims.slice(1).map(()=>''),...numbers];
   for(const g of list)yield [...g.values,...summaryNumbers(g)];
 }
 return [
   {name:'交易汇总',headers:[...dims,'增持本金（元）','减持本金（元）','净增持本金（元）','双向合计（元）','交易笔数','不同券数',
     ...(average?['买入笔数','卖出笔数','每笔买入平均本金（元）','每笔卖出平均本金（元）','全部匹配交易每笔平均本金（元）']:[]),
     ...(s.plan.share?['占全部匹配交易的比重（比例）']:[]),...(isDateRange?['首个交易日','最后交易日','首个交割日','最后交割日','缺失交割日笔数']:[])],rows:summary()},
   ...(highlights.length?[{name:'期间比较',headers:['比较项','数值','单位'],rows:highlights.map(h=>[h.label,h.unit==='分'?h.value/100:h.value,h.unit==='分'?'元':h.unit])}]:[]),
   {name:'交易明细',headers:['来源文件','工作表','原表行号','增减方向',...sourceHeaders],rows:detail()},
   {name:'口径与来源',headers:['项目','内容'],rows:[['统计口径','名义本金单位为人民币元。'+(s.plan.filters.some(f=>f.field==='交易交割日')?'已入账流水按指定的交易交割日筛选。':'按逐笔交易日期归期。')+'净增持=增持−减持，不等同于库存余额变化。'],['查询条件',JSON.stringify(s.plan)],...s.warnings.map(w=>['覆盖提示',w]),...s.relevant.map(v=>[v.filename,v.id+' / 累计至 '+v.asOf])]}
 ];
}
export async function exportTradeQuery(resources,plan,versionIds){
 return exportTradeWorkbook(await tradeExportSheets(resources,plan,versionIds));
}
