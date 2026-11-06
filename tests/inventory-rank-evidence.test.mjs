import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readTopIssuer} from '../tools/inventory-rank-evidence.mjs';

test('rank evidence retains ties within the requested scope and returns identities only',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE inventory_rows(version,issuer,cents,branch,scope,maturity); INSERT INTO inventory_rows VALUES ('v','甲有限公司',50,'广州分行','表内','2030-01-01'), ('v','甲有限公司',50,'广州分行','表内','2030-01-01'), ('v','乙有限公司',100,'广州分行','表内','2030-01-01'), ('v','丙有限公司',1000,'北京分行','表内','2030-01-01'), ('v','丁有限公司',2000,'广州分行','委外','2030-01-01'), ('old','戊有限公司',3000,'广州分行','表内','2030-01-01')");
  const db={prepare:sql=>({bind:(...args)=>({all:async()=>({results:sqlite.prepare(sql).all(...args)})})})};
  const snapshot={id:'v',date:'2026-10-29'};
  const tied=await readTopIssuer(db,snapshot,'广州分行|表内|存续');
  assert.deepEqual(tied.matches.map(row=>row.name).sort(),['甲有限公司','乙有限公司'].sort());
  assert.ok(tied.matches.every(row=>row.basis==='ranking' && !('total' in row)));
  assert.deepEqual(await readTopIssuer(db,snapshot,'广州分行|ABS'),{matches:[]});
  sqlite.close();
});
