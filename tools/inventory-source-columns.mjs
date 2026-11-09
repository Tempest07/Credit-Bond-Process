import {InventoryError,parseInventoryWorkbook} from './inventory-workbook.mjs';

export async function readVerifiedRoleWorkbook(db,snapshot,bucket,sourceKeys){
  const key='inventory/'+snapshot.date+'/'+snapshot.id+'.xlsx';
  let bytes;
  for(let attempt=0;attempt<2;attempt++){
    try {
      const object=await bucket?.get(key);
      if(object)bytes=new Uint8Array(await object.arrayBuffer());
      break;
    }catch{ /* Retry a failed R2 read once; an absent object is not retried. */ }
  }
  if(!bytes)throw new InventoryError(sourceKeys?'暂时无法读取所选快照的云端原表字段，请稍后重试。':'无法读取此版本的云端库存原件，暂时无法核对担保和客户归属，请稍后重试。',503);
  const version=await db.prepare('SELECT sha FROM inventory_versions WHERE id=?').bind(snapshot.id).first();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(version?.sha!==digest)throw new InventoryError('库存原件与已发布快照校验不符，不能核对担保和客户归属。',503);
  const original=await parseInventoryWorkbook(bytes,sourceKeys);
  if(original.date!==snapshot.date || original.rowCount!==snapshot.rowCount || original.totalCents!==snapshot.totalCents)throw new InventoryError('原件行数、日期或金额与已发布快照不符。',503);
  return original;
}

// Keys are immutable workbook revisions, never dates. SQL only sees bound values.
const initialized = new WeakSet();
async function init(db) {
  if (initialized.has(db)) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS inventory_source_fields(version TEXT PRIMARY KEY, fields TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS inventory_source_chunks(version TEXT NOT NULL,field TEXT NOT NULL,page INTEGER NOT NULL,contents TEXT NOT NULL,PRIMARY KEY(version,field,page))'),
  ]);
  initialized.add(db);
}
export async function sourceFields(db,snapshot,bucket) {
  await init(db);
  const known = await db.prepare('SELECT fields FROM inventory_source_fields WHERE version=?').bind(snapshot.id).first();
  if (known) return JSON.parse(known.fields);
  if (!bucket) return [];
  const original = await readVerifiedRoleWorkbook(db,snapshot,bucket,new Set());
  await db.prepare('INSERT OR IGNORE INTO inventory_source_fields VALUES(?,?)')
    .bind(snapshot.id,JSON.stringify(original.sourceFields)).run();
  return original.sourceFields;
}
async function saveField(db,version,field,rows) {
  const insert = db.prepare('INSERT OR IGNORE INTO inventory_source_chunks VALUES(?,?,?,?)');
  let page=0, pairs=[], chars=0, statements=[];
  function flush() {
    if (!pairs.length) return;
    statements.push(insert.bind(version,field,page++,'['+pairs.join(',')+']'));
    pairs=[]; chars=0;
  }
  for (const row of rows) {
    const pair=JSON.stringify([row.sourceRow,row[field]]);
    if (chars+pair.length>48000) flush();
    pairs.push(pair); chars+=pair.length+1;
    if (statements.length>=8) {await db.batch(statements);statements=[];}
  }
  flush();
  // A reader can only use the mapping once all immutable pages are present.
  statements.push(insert.bind(version,field,-1,String(page)));
  await db.batch(statements);
}
export async function attachSourceColumns(db,snapshot,rows,keys,bucket) {
  const fields=[...new Set(keys)];
  if (!fields.length) return;
  const catalog=await sourceFields(db,snapshot,bucket);
  if (fields.some(key=>!catalog.includes(key))) throw new InventoryError('所选库存快照缺少查询使用的原表列，请核对表头。');
  const requested=new Map(rows.map(row=>[row.sourceRow,row]));
  const missing=[];
  for (const field of fields) {
    const marker=await db.prepare('SELECT contents FROM inventory_source_chunks WHERE version=? AND field=? AND page=-1')
      .bind(snapshot.id,field).first();
    if (!marker) {missing.push(field);continue;}
    const pages=Number(marker.contents);
    let matched=0;
    for (let start=0;start<pages;start+=8) {
      const {results}=await db.prepare('SELECT contents FROM inventory_source_chunks WHERE version=? AND field=? AND page BETWEEN ? AND ? ORDER BY page')
        .bind(snapshot.id,field,start,start+7).all();
      for (const part of results) for (const [sourceRow,value] of JSON.parse(part.contents)) {
        const row=requested.get(sourceRow);
        if (row) {row[field]=value;matched++;}
      }
    }
    if (matched!==rows.length) throw new InventoryError('原表列与持仓行未能完整对应，请重试。',503);
  }
  if (!missing.length) return;
  const original=await readVerifiedRoleWorkbook(db,snapshot,bucket,new Set(missing));
  for (const field of missing) {
    await saveField(db,snapshot.id,field,original.rows);
    for (const source of original.rows) {
      const row=requested.get(source.sourceRow);
      if (row) row[field]=source[field];
    }
  }
}
