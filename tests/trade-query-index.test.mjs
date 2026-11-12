import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryD1} from './helpers/d1-memory.js';
import {backfillTradeIndex,finishTradeIndex,writeTradeIndexBlock} from '../tools/trade-query-index.mjs';

const headers=['联动分行','交易日期','名义本金','债券代码','发行人全称','会计分类'];
const day='2024-03-05';
const rows=[
  ['　ＡＢ分行 ',day,120,' 001 ',' 甲　集团 ',' OＣＩ ',5],
  [null,day,0,0,'乙','AC',7],
  [null,day,31,'0','乙','公募',12],
  [null,day,49,2345,'乙','其他户 ',15],
];
const ledger={id:'version-a',headers,blocks:[[day,day],[day,day]],rowCount:4,totalCents:200};
function published(...versions){
  const db=createMemoryD1();
  db.sql.exec('CREATE TABLE trade_ledger_versions(id TEXT PRIMARY KEY,doc TEXT NOT NULL)');
  const insert=db.sql.prepare('INSERT INTO trade_ledger_versions VALUES(?,?)');
  for(const v of versions)insert.run(v.id,JSON.stringify(v));
  return db;
}
const count=(db,table,id)=>db.sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE version=?').get(id).n;
const block=(id,i)=>'trade-ledgers/v1/'+id+'/block-'+i+'.json';
const bucketFixture=()=>({
  data:new Map([[block(ledger.id,0),rows.slice(0,2)],[block(ledger.id,1),rows.slice(2)]]),
  reads:[],
  async get(key){
    this.reads.push(key);
    return this.data.has(key)?new Response(JSON.stringify(this.data.get(key))):null;
  },
});

test('index rows preserve source identifiers and keep display labels separate from filter keys',async()=>{
  const db=published(ledger);
  await writeTradeIndexBlock(db,ledger,rows);
  const result=db.sql.prepare('SELECT sourceRow,code,issuer,issuerKey,branch,branchKey,account,accountKey FROM trade_query_rows ORDER BY sourceRow').all();
  assert.deepEqual(result.map(row=>[row.sourceRow,row.code,row.account]),[
    [5,' 001 ','AFS'],[7,null,'Receivable'],[12,'0','委外（公募）'],[15,'2345','其他户']]);
  assert.deepEqual([result[0].issuer,result[0].issuerKey,result[0].branch,result[0].branchKey,result[0].accountKey],
    ['甲　集团','甲 集团','ＡＢ分行','ab分行','afs']);
  assert.equal(result[1].branch,'');
  assert.equal(count(db,'trade_query_ready',ledger.id),0);
  await assert.rejects(finishTradeIndex(db,{...ledger,totalCents:199}),/本金/);
  await assert.rejects(finishTradeIndex(db,{...ledger,rowCount:3}),/行数/);
  assert.equal(count(db,'trade_query_ready',ledger.id),0);
  await writeTradeIndexBlock(db,ledger,rows);
  assert.equal(await finishTradeIndex(db,ledger),true);
  assert.equal(count(db,'trade_query_rows',ledger.id),4);
  assert.equal(count(db,'trade_query_ready',ledger.id),1);
});

test('invalid source positions or amounts cannot publish a partial index; optional columns can be absent',async()=>{
  const narrow={...ledger,headers:['名义本金','交易日期','发行人全称','债券代码'],rowCount:1,totalCents:125};
  const db=published(narrow);
  for(const bad of [[125,day,'甲','1',null],[-125,day,'甲','1',2],['125',day,'甲','1',2]]){
    await assert.rejects(writeTradeIndexBlock(db,narrow,[bad]),/原表行/);
  }
  assert.equal(count(db,'trade_query_ready',ledger.id),0);
  await writeTradeIndexBlock(db,narrow,[[125,day,'甲','1',21]]);
  await finishTradeIndex(db,narrow);
  const row=db.sql.prepare('SELECT branch,account FROM trade_query_rows').get();
  assert.equal(row.branch,'');assert.equal(row.account,'');
});

test('backfill reads only the requested version and resumes after a missing immutable block',async()=>{
  const db=published(ledger),bucket=bucketFixture();
  const finalKey=block(ledger.id,1),last=bucket.data.get(finalKey);bucket.data.delete(finalKey);
  // Caller data can be public, stale, or forged. Only the ID selects a manifest.
  const publicVersion={id:ledger.id,headers:[],blocks:[],rowCount:1,totalCents:0};
  await assert.rejects(backfillTradeIndex({db,bucket},{...ledger,id:'unpublished'}),/找不到/);
  await assert.rejects(backfillTradeIndex({db,bucket},publicVersion),/数据块/);
  assert.equal(count(db,'trade_query_rows',ledger.id),2);
  assert.equal(count(db,'trade_query_ready',ledger.id),0);
  assert.equal(db.sql.prepare('SELECT nextBlock FROM trade_query_progress').get().nextBlock,1);
  bucket.data.set(finalKey,last);
  assert.equal(await backfillTradeIndex({db,bucket},publicVersion),true);
  assert.equal(await backfillTradeIndex({db,bucket},publicVersion),true);
  assert.deepEqual(bucket.reads,[block(ledger.id,0),finalKey,finalKey]);
});

test('capped concurrent fills and retry after a lost checkpoint never duplicate rows or regress progress',async()=>{
  const other={...ledger,id:'version-b'};
  const db=published(ledger,other),bucket=bucketFixture(),resources={db,bucket};
  db.setFail('INSERT INTO trade_query_progress');
  await assert.rejects(backfillTradeIndex(resources,ledger,{maxBlocks:1}),/private-database-failure/);
  assert.equal(count(db,'trade_query_rows',ledger.id),2);
  assert.equal(count(db,'trade_query_ready',ledger.id),0);
  await assert.rejects(finishTradeIndex(db,{...ledger,rowCount:2,totalCents:120}),/行数或本金/);
  assert.equal(count(db,'trade_query_block_settlement',ledger.id),0);
  db.setFail('');
  assert.equal(await backfillTradeIndex(resources,ledger,{maxBlocks:1}),false);
  assert.deepEqual(await Promise.all([backfillTradeIndex(resources,ledger),backfillTradeIndex(resources,ledger)]),[true,true]);
  assert.equal(count(db,'trade_query_rows',ledger.id),4);
  assert.equal(db.sql.prepare('SELECT nextBlock FROM trade_query_progress').get().nextBlock,2);
  assert.equal(count(db,'trade_query_rows',other.id),0);
  await writeTradeIndexBlock(db,other,rows);await finishTradeIndex(db,other);
  assert.equal(count(db,'trade_query_ready',other.id),1);
  assert.equal(count(db,'trade_query_rows',other.id),4);
});

test('settlement range metadata distinguishes a verified empty block from an uncomparable source string',async()=>{
  const blocks=[['2024-03-07','2024-02-29',null,'2024-02-29'],[null,'',0],['2024-03-02','2024-02-30'],['2024-03-05T00:00:00Z']];
  const size=blocks.flat().length, version={...ledger,id:'dates',headers:[...headers,'交易交割日'],blocks:blocks.map(()=>[day,day]),rowCount:size,totalCents:size};
  const db=published(version);
  let pos=1;
  const data=blocks.map(dates=>dates.map(date=>['',day,1,'1','甲','AC',date,++pos]));
  const bucket={async get(path){return new Response(JSON.stringify(data[Number(path.match(/block-(\d+)/)[1])]));}};
  assert.equal(await backfillTradeIndex({db,bucket},version,{maxBlocks:2}),false);
  assert.deepEqual(db.sql.prepare('SELECT block,firstDay,lastDay FROM trade_query_block_settlement ORDER BY block').all().map(Object.values),[
    [0,'2024-02-29','2024-03-07'],[1,null,null]]);
  assert.equal(await backfillTradeIndex({db,bucket},version),true);
  assert.equal(count(db,'trade_query_block_settlement',version.id),2);
  assert.equal(count(db,'trade_query_rows',version.id),size);
});
