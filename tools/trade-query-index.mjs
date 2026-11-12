import {accountLabel} from './inventory-account.mjs';

const initialized=new WeakSet();
const schema=[
  `CREATE TABLE IF NOT EXISTS trade_query_rows (
     version TEXT NOT NULL, sourceRow INTEGER NOT NULL, day TEXT NOT NULL, code TEXT,
     cents INTEGER NOT NULL, issuer TEXT NOT NULL, branch TEXT NOT NULL, account TEXT NOT NULL,
     issuerKey TEXT NOT NULL, branchKey TEXT NOT NULL, accountKey TEXT NOT NULL,
     PRIMARY KEY (version,sourceRow)
   ) WITHOUT ROWID`,
  'CREATE INDEX IF NOT EXISTS trade_query_rows_day ON trade_query_rows(version,day)',
  'CREATE TABLE IF NOT EXISTS trade_query_ready (version TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS trade_query_progress (version TEXT PRIMARY KEY,nextBlock INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS trade_query_block_settlement (
     version TEXT NOT NULL, block INTEGER NOT NULL, firstDay TEXT, lastDay TEXT,
     PRIMARY KEY (version,block)
   ) WITHOUT ROWID`,
];

export async function ensureTradeIndexSchema(db){
  if(initialized.has(db))return;
  await db.batch(schema.map(sql=>db.prepare(sql)));
  initialized.add(db);
}

const insertRows=`INSERT INTO trade_query_rows
  (version, sourceRow, day, code, cents, issuer, branch, account, issuerKey, branchKey, accountKey)
  SELECT ?, value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6,
    value->>7, value->>8, value->>9 FROM json_each(?) WHERE true
  ON CONFLICT(version,sourceRow) DO NOTHING`;
const key=value=>value.normalize('NFKC').toLowerCase();
const cell=value=>String(value??'').trim();

export async function writeTradeIndexBlock(db,ledger,rows){
  await ensureTradeIndexSchema(db);
  const {id,headers}=ledger;
  const [day,code,cents,issuer,branch,account]=['交易日期','债券代码','名义本金','发行人全称','联动分行','会计分类']
    .map(h=>headers.indexOf(h));
  if(!id || [day,code,cents,issuer].some(i=>i<0) || !Array.isArray(rows))throw Error('交易索引缺少必要的来源字段。');
  // Bound each JSON binding and each D1 batch. Original files can contain long
  // labels, so a row-count limit alone does not bound a request.
  let payload=[],chars=0,statements=[];
  function flushPayload(){
    if(!payload.length)return;
    statements.push(db.prepare(insertRows).bind(id,'['+payload.join(',')+']'));
    payload=[];chars=0;
  }
  for(const row of rows){
    if(!Array.isArray(row) || row.length!==headers.length+1 || !Number.isSafeInteger(row.at(-1)) ||
      row.at(-1)<1 || !Number.isSafeInteger(row[cents]) || row[cents]<0 ||
      typeof row[day]!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[day]))throw Error('交易索引遇到无效的原表行。');
    const name=cell(row[issuer]),office=cell(row[branch]),subject=accountLabel(cell(row[account]));
    // The legacy distinct count adds String(code) only for truthy raw codes:
    // numeric zero is absent, while the string "0" and original whitespace count.
    const entry=JSON.stringify([row.at(-1),row[day],row[code]?String(row[code]):null,row[cents],
      name,office,subject,key(name),key(office),key(subject)]);
    if(chars+entry.length>48000){
      flushPayload();
      if(statements.length>=6){await db.batch(statements);statements=[];}
    }
    payload.push(entry);chars+=entry.length+1;
  }
  flushPayload();
  if(statements.length)await db.batch(statements);
}

export async function finishTradeIndex(db,ledger){
  await ensureTradeIndexSchema(db);
  if(!Number.isSafeInteger(ledger.rowCount) || ledger.rowCount<1 ||
    !Number.isSafeInteger(ledger.totalCents) || ledger.totalCents<0)throw Error('交易版本缺少可核对的总行数或本金。');
  // Require both the published manifest and the indexed rows to agree with
  // the expected integer totals in the statement that marks the index ready.
  const result=await db.prepare(`INSERT OR REPLACE INTO trade_query_ready(version)
    SELECT v.id FROM trade_ledger_versions v,
      (SELECT COUNT(*) AS n,SUM(cents) AS amount FROM trade_query_rows WHERE version=?) idx
    WHERE v.id=? AND json_extract(v.doc,'$.id')=v.id AND idx.n=? AND idx.amount=?
      AND idx.n=json_extract(v.doc,'$.rowCount') AND idx.amount=json_extract(v.doc,'$.totalCents')`)
    .bind(ledger.id,ledger.id,ledger.rowCount,ledger.totalCents).run();
  if(result.meta.changes!==1)throw Error('交易索引的行数或本金与原台账版本不符。');
  return true;
}

// The existing between predicate only compares strings. An odd *string* must
// retain the original scan, while a block without any strings has no matches.
function settlementBounds(ledger,rows){
  const col=ledger.headers.indexOf('交易交割日'),seen=new Set();
  let first=null,last=null;
  for(const row of rows){
    const day=row[col];
    if(typeof day!=='string' || day==='' || seen.has(day))continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day+'T00:00:00Z').toJSON()?.slice(0,10)!==day)return null;
    seen.add(day);
    if(first===null || day<first)first=day;
    if(last===null || day>last)last=day;
  }
  return [first,last];
}

export async function backfillTradeIndex({db,bucket},{id},{maxBlocks=Infinity}={}){
  if(maxBlocks!==Infinity && (!Number.isSafeInteger(maxBlocks) || maxBlocks<1))throw Error('无效的交易索引分块预算。');
  await ensureTradeIndexSchema(db);
  const manifest=await db.prepare(`SELECT v.doc, r.version AS ready, p.nextBlock
    FROM trade_ledger_versions v LEFT JOIN trade_query_ready r ON r.version=v.id
    LEFT JOIN trade_query_progress p ON p.version=v.id WHERE v.id=?`).bind(id).first();
  if(!manifest)throw Error('找不到指定的交易台账版本。');
  const ledger=JSON.parse(manifest.doc);
  if(ledger.id!==id || !Array.isArray(ledger.blocks))throw Error('交易台账版本与数据块清单不符。');
  if(manifest.ready)return true;
  const first=manifest.nextBlock??0, stop=Math.min(ledger.blocks.length,first+maxBlocks);
  for(let i=first;i<stop;i++){
    const object=await bucket.get('trade-ledgers/v1/'+id+'/block-'+i+'.json');
    if(!object)throw Error('该版本的交易数据块不可用。');
    const rows=await object.json();
    await writeTradeIndexBlock(db,ledger,rows);
    const bounds=settlementBounds(ledger,rows);
    const checkpoint=[];
    if(bounds)checkpoint.push(db.prepare(`INSERT OR REPLACE INTO trade_query_block_settlement
      (version,block,firstDay,lastDay) VALUES(?,?,?,?)`).bind(id,i,...bounds));
    // A retry can repeat inserts if a worker stops before this checkpoint.
    // A slower concurrent worker must never move the checkpoint backwards.
    checkpoint.push(db.prepare(`INSERT INTO trade_query_progress(version,nextBlock) VALUES(?,?)
      ON CONFLICT(version) DO UPDATE SET nextBlock=max(nextBlock,excluded.nextBlock)`).bind(id,i+1));
    await db.batch(checkpoint);
  }
  return stop===ledger.blocks.length ? finishTradeIndex(db,ledger) : false;
}
