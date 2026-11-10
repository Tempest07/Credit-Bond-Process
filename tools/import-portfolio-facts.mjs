// Prepare, publish or verify audited bond-date facts in the private inventory R2 bucket.
// prepare <duration.json> <ratings.json> <private-dir> [first-later-ratings.json]
// publish|verify <private-dir> <private wrangler config>
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {factsDigest,factsIndexKey,factsObjectKey,parseFactsIndex,parseFactsDocument} from './portfolio-facts.mjs';

const pairKey=(date,code)=>JSON.stringify([date,code]);
const JSONfile=async name=>JSON.parse(await readFile(name,'utf8'));
const toText=v=>v==null?'':String(v);
function check(ok,message){if(!ok)throw Error(message);}
function makeRows(durations,ratings,followups){
  const joined=new Map(),dates=new Map(),fallbacks=new Map();
  for(const r of ratings.rows){
    const key=pairKey(r.date,r.code);
    check(!joined.has(key),'重复的券码与评级日期');
    joined.set(key,r);
    if(r.included && !r.cdc && r.csi){
      const values=fallbacks.get(r.code)||[];
      values.push(r.date);fallbacks.set(r.code,values);
    }
  }
  const laterRatings=new Map();
  for(const r of followups){
    const targets=fallbacks.get(r.code)||[];
    const day=r.asOf || (targets.length===1?targets[0]:null);
    const key=pairKey(day,r.code);
    check(targets.includes(day) && r.date>day && r.grade && r.checked && !laterRatings.has(key),
      '期后评级需要唯一匹配的原始估值日及同券的后续估值日');
    laterRatings.set(key,r);
  }
  for(const d of durations.rows){
    const key=pairKey(d.date,d.code),r=joined.get(key);
    const excluded=String(d.decision).startsWith('剔除');
    check(r && r.included===!excluded && d.principal===r.principal,'两份核验明细的估值日、券码、持仓或信用事件不一致');
    joined.delete(key);
    const later=laterRatings.get(key);
    const duration=excluded || d.duration==null || d.duration===''?null:Number(d.duration);
    const rating=excluded?'':toText(r.grade);
    if(duration!==null)check((d.api==='cdcBondValuation' && d.src==='中债' && d.field==='val_modified_duration') ||
      (d.api==='csiBondValuation' && d.src==='中证' && ['modified_duration_maturity','modified_duration_exercise'].includes(d.field)),
      '修正久期来源或原始字段无法验证');
    const ratingRaw=rating?toText(r.cdc||r.csi):'';
    if(rating)check((ratingRaw===rating || (!r.cdc && ratingRaw==='AA2' && rating==='AA(2)')) &&
      (r.cdc ? r.api==='cdcBondValuation' && r.cite==='中债': r.api==='csiBondValuation' && r.cite==='中证补缺'),'评级原值、口径或机构不一致');
    const row={
      code:d.code,asOf:d.date,excluded,reason:toText(d.notes),
      duration,durationSource:duration===null?'':d.src,durationBasis:duration===null?'':d.decision,
      durationApi:duration===null?'':d.api,durationField:duration===null?'':d.field,durationCollectedAt:duration===null?'':d.time,
      rating,ratingRaw,ratingSource:rating?r.cite:'',ratingApi:rating?r.api:'',ratingCollectedAt:rating?r.timestamp:'',
      evidence:toText(d.ref),optionDate:toText(d.opdate),subsequentRating:toText(later?.grade),
      subsequentDate:toText(later?.date),subsequentCheckedAt:toText(later?.checked),
    };
    const list=dates.get(d.date)||[];list.push(row);dates.set(d.date,list);
  }
  check(!joined.size && dates.size>0,'两份核验明细的覆盖范围不完整');
  return dates;
}
export async function prepareFacts(durationFile,ratingFile,dir,laterFile){
  const repo=fileURLToPath(new URL('..',import.meta.url));
  const rel=path.relative(repo,path.resolve(dir));
  check(rel==='.local-data' || rel.startsWith('.local-data'+path.sep) || rel.startsWith('..'+path.sep) || path.isAbsolute(rel),
    '请将准备目录放在 .local-data 或仓库以外，确保逐券数据由私有存储保管');
  const [d,r,later]=await Promise.all([JSONfile(durationFile),JSONfile(ratingFile),laterFile?JSONfile(laterFile):[]]);
  const dates=makeRows(d,r,later),catalog={version:1,dates:{}};
  await mkdir(dir,{recursive:true});
  for(const [asOf,rows] of [...dates].sort(([a],[b])=>a.localeCompare(b))){
    rows.sort((a,b)=>a.code.localeCompare(b.code,'en'));
    const text=JSON.stringify({version:1,asOf,rows});
    parseFactsDocument(text,asOf);
    const bytes=Buffer.from(text),digest=await factsDigest(bytes);
    const key=factsObjectKey(asOf,digest),file=path.join(dir,key);
    await mkdir(path.dirname(file),{recursive:true});
    try{await writeFile(file,bytes,{flag:'wx'});}catch(e){
      if(e.code!=='EEXIST')throw e;
      check(await factsDigest(await readFile(file))===digest,'本地已有版本校验不符');
    }
    catalog.dates[asOf]=digest;
  }
  await writeFile(path.join(dir,'index.json'),JSON.stringify(catalog,null,2));
  return catalog.dates;
}
export async function syncFacts(bucket,dir,{publish=false}={}){
  const identity=await bucket.get('system/cloud-identity.txt');
  check((await identity?.text())==='bond-centre-inventory-qa-beta','私有库存桶身份校验失败');
  const expected=parseFactsIndex(await readFile(path.join(dir,'index.json'),'utf8'));
  check(Object.keys(expected).length>0,'本地清单为空');
  const initial=await bucket.get(factsIndexKey),active=initial?parseFactsIndex(await initial.text()):{};
  const contentType={contentType:'application/json',cacheControl:'private, no-store'};
  for(const [asOf,digest] of Object.entries(expected)){
    const key=factsObjectKey(asOf,digest);
    const bytes=await readFile(path.join(dir,key));
    check(await factsDigest(bytes)===digest,'本地版本指纹不一致');
    parseFactsDocument(bytes.toString('utf8'),asOf);
    let object=await bucket.get(key);
    if(!object && publish){
      await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:contentType,sha256:digest});
      object=await bucket.get(key);
    }
    check(object && await factsDigest(await object.arrayBuffer())===digest,'远端不可变对象缺失或校验失败');
  }
  if(Object.entries(expected).every(([date,sha])=>active[date]===sha))return expected;
  check(publish,'验证失败：已发布清单与目标数据不一致');
  const next={version:1,dates:{...active,...expected}};
  const onlyIf=initial?{etagMatches:initial.etag}:{etagDoesNotMatch:'*'};
  const modified=await bucket.put(factsIndexKey,JSON.stringify(next),{onlyIf,httpMetadata:contentType});
  check(modified,'导入过程中清单已由其他任务更新，请重新执行发布');
  const published=await bucket.get(factsIndexKey);
  const verified=published?parseFactsIndex(await published.text()):{};
  check(Object.entries(expected).every(([d,sha])=>verified[d]===sha),'发布后清单未通过复查');
  return expected;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [command,...args]=process.argv.slice(2);
  if(command==='prepare' && [3,4].includes(args.length)){
    console.log(JSON.stringify(await prepareFacts(...args)));
  }else if(['publish','verify'].includes(command) && args.length===2){
    const {getPlatformProxy}=await import('wrangler');
    const proxy=await getPlatformProxy({configPath:args[1],persist:false,remoteBindings:true});
    try{console.log(JSON.stringify(await syncFacts(proxy.env.INVENTORY_FILES,args[0],{publish:command==='publish'})));}
    finally{await proxy.dispose();}
  }else{throw Error('Usage: prepare <duration.json> <ratings.json> <private-dir> [later.json] | publish|verify <private-dir> <wrangler config>');}
}
