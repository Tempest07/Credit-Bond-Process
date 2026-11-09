import {accountLabel} from './inventory-account.mjs';
import {InventoryError} from './inventory-workbook.mjs';
import {parseTradeWorkbook,exportTradeWorkbook} from './trade-workbook.mjs';
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

const derived=['交易年份','交易月份','交易季度','会计科目','台账年度','增减方向'];
const norm=v=>String(v??'').trim().normalize('NFKC').toLowerCase();
function validDate(v){if(v==null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)error('交易日期须为有效的 YYYY-MM-DD。');return v;}
function setup(plan,all){
 if(!plan||!['buy','sell','both'].includes(plan.direction)||!['buy','sell','net','gross','rows','bonds'].includes(plan.metric))error('交易查询方向或统计指标无效。');
 if(['net','gross'].includes(plan.metric)&&plan.direction!=='both'||plan.metric==='buy'&&plan.direction==='sell'||plan.metric==='sell'&&plan.direction==='buy')error('指标与所查询的增减方向不一致。');
 const start=validDate(plan.start),end=validDate(plan.end);
 if(start&&end&&start>end)error('起始交易日期不能晚于结束日期。');
 const groupBy=plan.groupBy??[],filters=plan.filters??[],limit=plan.limit??null,order=plan.order??'desc';
 if(!Array.isArray(groupBy)||groupBy.length>6||new Set(groupBy).size!==groupBy.length||!Array.isArray(filters)||filters.length>16||(limit!==null&&(!Number.isInteger(limit)||limit<1||limit>100))||!['asc','desc'].includes(order))error('交易分组、排序或筛选条件无效。');
 if(filters.some(f=>!f||!['eq','contains','in'].includes(f.op)||(f.op==='in'?(!Array.isArray(f.value)||!f.value.length||f.value.length>100||f.value.some(x=>typeof x!=='string'||x.length>1024)):(typeof f.value!=='string'||!f.value.trim()||f.value.length>1024))))error('交易筛选值或操作无效。');
 const directions=plan.direction==='both'?['buy','sell']:[plan.direction];
 const ledgerYearFilters=filters.filter(f=>f.field==='台账年度');
 const allowedYear=y=>ledgerYearFilters.every(f=>f.op==='eq'?String(y)===f.value:f.op==='in'?f.value.includes(String(y)):String(y).includes(f.value));
 const available=all.filter(v=>directions.includes(v.direction)&&allowedYear(v.year));
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
 const requestedYears=ledgerYearFilters.flatMap(f=>f.op==='eq'?[f.value]:f.op==='in'?f.value:[]).filter(y=>/^\d{4}$/.test(y)).map(Number);
 const firstYear=start?+start.slice(0,4):Math.min(...(requestedYears.length?requestedYears:all.map(v=>v.year))),lastYear=end?+end.slice(0,4):Math.max(...(requestedYears.length?requestedYears:all.map(v=>v.year)));
 if(Number.isFinite(firstYear)&&Number.isFinite(lastYear)&&lastYear-firstYear>100)error('单次查询请限制在 100 年以内。');
 if(Number.isFinite(firstYear)&&Number.isFinite(lastYear)){
   for(let y=firstYear;y<=lastYear;y++){
     if(!allowedYear(y))continue;
     const sides=[];
     for(const d of directions){
       const v=available.find(v=>v.year===y&&v.direction===d);
       if(!v){
         const absent=y+' 年'+dirName(d)+'累计表尚未导入，缺少的交易不能按 0 计算。';
         if(['net','gross'].includes(plan.metric))error(absent+'无法计算所问范围的双向结果。');
         warnings.push(absent);continue;
       }
       const until=end&&end<y+'-12-31'?end:y+'-12-31';
       sides.push(v.asOf<until?v.asOf:until);
       if(until>v.asOf)warnings.push(y+' 年'+dirName(d)+'仅覆盖至 '+v.asOf+'，此后交易不在本次结果内。');
     }
     if(['net','gross'].includes(plan.metric)&&new Set(sides).size>1)error(y+' 年增持、减持台账截止日不一致，无法计算完整区间的双向结果；请将截止日限定在两份表共同覆盖的日期内。');
   }
 }
 if(!all.length)error('尚未导入交易台账，无法计算。');
 if(!relevant.length)error('已导入的交易台账不覆盖所选方向及日期，不能据此断定金额为 0。');
 for(const v of available.filter(v=>v.outOfPeriodRows && (relevant.includes(v)||v.year>=firstYear&&v.year<=lastYear))){
   warnings.push(v.filename+' 有 '+v.outOfPeriodRows+' 笔跨期交易（'+(v.outOfPeriodCents/100).toLocaleString('zh-CN')+' 元）；按逐笔交易日期归期。');
 }
 return {plan:{direction:plan.direction,start,end,filters,groupBy,metric:plan.metric,limit,order},relevant,available,warnings};
}
function getter(v,f){
 const i=v.headers.indexOf(f),di=v.headers.indexOf('交易日期');
 if(f==='会计科目'||f==='会计分类'){const ac=v.headers.indexOf('会计分类');return r=>accountLabel(String(r[ac]??''));}
 if(f==='台账年度')return ()=>String(v.year);
 if(f==='交易年份')return r=>r[di].slice(0,4);
 if(f==='交易月份')return r=>r[di].slice(0,7);
 if(f==='交易季度')return r=>r[di].slice(0,4)+'Q'+Math.ceil(+r[di].slice(5,7)/3);
 if(f==='增减方向')return ()=>dirName(v.direction);
 return f==='名义本金'?r=>r[i]/100:r=>r[i];
}
async function* matches(bucket,scope){
 const {start,end,filters}=scope.plan;
 for(const v of scope.relevant){
   const di=v.headers.indexOf('交易日期'),ai=v.headers.indexOf('名义本金'),ci=v.headers.indexOf('债券代码');
   const tests=filters.map(f=>{
     const get=getter(v,f.field);
     const canonical=x=>norm(['会计科目','会计分类'].includes(f.field)&&f.op!=='contains'?accountLabel(String(x??'')):x);
     const val=f.op==='in'?new Set(f.value.map(canonical)):canonical(f.value);
     return f.op==='in'?r=>val.has(norm(get(r))):f.op==='contains'?r=>norm(get(r)).includes(val):r=>norm(get(r))===val;
   });
   for(const [i,[min,max]] of v.blocks.entries()){
     if(start&&max<start||end&&min>end)continue;
     const obj=await immutableIO(()=>bucket.get(root(v.id)+'block-'+i+'.json'));if(!obj)error('交易数据块不可用，请稍后重试。',503);
     const rows=await obj.json();if(!Array.isArray(rows))error('交易数据块校验失败。',503);
     for(const row of rows){if(start&&row[di]<start||end&&row[di]>end||!tests.every(t=>t(row)))continue;
       yield {v,row,cents:row[ai],code:row[ci]};
     }
   }
 }
}
const counter=()=>({buyCents:0,sellCents:0,rows:0,codes:new Set()});
function add(c,v,cents,code){c[v.direction+'Cents']+=cents;c.rows++;if(code)c.codes.add(String(code));}
function finish(c){const {buyCents,sellCents,rows,codes}=c;const grossCents=buyCents+sellCents;
 if(!Number.isSafeInteger(grossCents))error('所选范围的交易金额超过精确统计上限。');return {buyCents,sellCents,grossCents,netCents:buyCents-sellCents,rows,bonds:codes.size};}
async function aggregate(bucket,s){
 const t=counter(),groups=new Map(),getters=new Map(s.relevant.map(v=>[v.id,s.plan.groupBy.map(f=>getter(v,f))]));
 for await(const {v,row,cents,code} of matches(bucket,s)){
   add(t,v,cents,code);if(!s.plan.groupBy.length)continue;
   const values=getters.get(v.id).map(g=>String(g(row)??'').trim()||'（未填）'),key=JSON.stringify(values);
   let group=groups.get(key);if(!group){if(groups.size>=100000)error('分组过多，请缩小时间范围或减少分组列。');group={values,c:counter()};groups.set(key,group);}
   add(group.c,v,cents,code);
 }
 const field=['bonds','rows'].includes(s.plan.metric)?s.plan.metric:s.plan.metric+'Cents';
 const list=Array.from(groups.values(),({values,c})=>({values,...finish(c)}));
 list.sort((a,b)=>(s.plan.order==='asc'?1:-1)*(a[field]-b[field])||JSON.stringify(a.values).localeCompare(JSON.stringify(b.values),'zh-CN'));
 return {totals:finish(t),list};
}
export async function runTradeQuery({db,bucket},plan,versionIds){
 const s=setup(plan,await docs(db,versionIds)),{list,totals}=await aggregate(bucket,s);
 return {plan:s.plan,totals,groups:list.slice(0,s.plan.limit??100),groupCount:list.length,versions:s.relevant.map(pub),warnings:s.warnings};
}
export async function exportTradeQuery({db,bucket},plan,versionIds){
 const s=setup(plan,await docs(db,versionIds)),{totals,list}=await aggregate(bucket,s);
 const sourceHeaders=[...new Set(s.relevant.flatMap(v=>v.headers))];
 async function* detail(){
   const cols=new Map(s.relevant.map(v=>[v.id,sourceHeaders.map(h=>v.headers.indexOf(h))])),money=sourceHeaders.indexOf('名义本金');
   for await(const {v,row} of matches(bucket,s)){const values=cols.get(v.id).map(i=>i<0?'':row[i]??'');if(money>=0)values[money]/=100;yield [v.filename,v.sheet,row.at(-1),dirName(v.direction),...values];}
 }
 const summaryNumbers=g=>[g.buyCents/100,g.sellCents/100,g.netCents/100,g.grossCents/100,g.rows,g.bonds];
 const dims=s.plan.groupBy.length?s.plan.groupBy:['范围'];
 function* summary(){yield ['全部匹配',...dims.slice(1).map(()=>''),...summaryNumbers(totals)];for(const g of list)yield [...g.values,...summaryNumbers(g)];}
 return exportTradeWorkbook([
   {name:'交易汇总',headers:[...dims,'增持本金（元）','减持本金（元）','净增持本金（元）','双向合计（元）','交易笔数','不同券数'],rows:summary()},
   {name:'交易明细',headers:['来源文件','工作表','原表行号','增减方向',...sourceHeaders],rows:detail()},
   {name:'口径与来源',headers:['项目','内容'],rows:[['统计口径','名义本金单位为人民币元；按逐笔交易日期归期。净增持=增持−减持，不等同于库存余额变化。'],['查询条件',JSON.stringify(s.plan)],...s.warnings.map(w=>['覆盖提示',w]),...s.relevant.map(v=>[v.filename,v.id+' / 累计至 '+v.asOf])]}
 ]);
}
