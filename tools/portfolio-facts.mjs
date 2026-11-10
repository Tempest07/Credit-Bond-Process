import {InventoryError} from './inventory-workbook.mjs';

// The catalogue points at content-addressed objects in the private inventory bucket.
// Only catalogue entries saved with a conversation can be used to answer its follow-ups.
export const factsIndexKey = 'portfolio-facts/v1/index.json';
const invalid = () => new InventoryError('逐券市场资料版本或校验信息异常，请核对私有数据导入记录。',503);
const validDay = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().startsWith(value+'T');
const validDigest = value => typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
export function factsObjectKey(asOf,digest) {
  if(!validDay(asOf) || !validDigest(digest))throw invalid();
  return 'portfolio-facts/v1/'+asOf+'/'+digest+'.json';
}
export async function factsDigest(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
export function parseFactsIndex(text) {
  let data;
  try {data=JSON.parse(text);}catch{throw invalid();}
  if(data?.version!==1 || !data.dates || typeof data.dates!=='object' || Array.isArray(data.dates))throw invalid();
  for(const [date,digest] of Object.entries(data.dates))factsObjectKey(date,digest);
  return data.dates;
}
export async function getPortfolioMarketPins({bucket},snapshots) {
  if(!bucket || !snapshots.length)return {};
  const object=await bucket.get(factsIndexKey);
  if(!object)return {};
  const catalog=parseFactsIndex(await object.text());
  return Object.fromEntries([...new Set(snapshots.map(s=>s.date))].filter(d=>Object.hasOwn(catalog,d)).map(d=>[d,catalog[d]]));
}
export function parseFactsDocument(text,asOf) {
  let data;
  try {data=JSON.parse(text);}catch{throw invalid();}
  if(!validDay(asOf) || data?.version!==1 || data.asOf!==asOf || !Array.isArray(data.rows) || !data.rows.length)throw invalid();
  const byCode=new Map();
  for(const row of data.rows){
    if(!row || row.asOf!==asOf || typeof row.code!=='string' || !row.code.trim() || row.code!==row.code.trim() ||
      byCode.has(row.code) || typeof row.excluded!=='boolean' || typeof row.reason!=='string' ||
      (row.duration!==null && !Number.isFinite(row.duration)) || typeof row.rating!=='string' ||
      typeof row.durationSource!=='string' || typeof row.durationBasis!=='string' || typeof row.ratingSource!=='string')throw invalid();
    if(row.excluded && (!row.reason || row.duration!==null || row.rating) ||
      row.duration!==null && (!row.durationSource || !row.durationBasis || !row.durationApi || !row.durationField || !row.durationCollectedAt) ||
      row.rating && (!row.ratingSource || !row.ratingRaw || !row.ratingApi || !row.ratingCollectedAt))throw invalid();
    if(row.subsequentRating && (!validDay(row.subsequentDate) || row.subsequentDate<=asOf || !row.subsequentCheckedAt))throw invalid();
    byCode.set(row.code,row);
  }
  return byCode;
}
export async function readPortfolioFacts({bucket},snapshot,pins={}) {
  const day=snapshot.date;
  if(!validDay(day))throw invalid();
  const digest=pins && Object.hasOwn(pins,day) && pins[day];
  if(!digest)return {byCode:new Map(),note:day+' 没有锁定已核验的同日逐券市场资料。'};
  const key=factsObjectKey(day,digest);
  const object=await bucket?.get(key);
  if(!object)throw new InventoryError(day+' 已锁定的逐券市场资料暂时无法读取。',503);
  const bytes=await object.arrayBuffer();
  if(await factsDigest(bytes)!==digest)throw invalid();
  return {byCode:parseFactsDocument(new TextDecoder().decode(bytes),day)};
}
