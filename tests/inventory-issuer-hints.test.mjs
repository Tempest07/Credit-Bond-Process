import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {issuerHints} from '../tools/inventory-issuer-hints.mjs';

test('names and bond stems rank issuers; totals include other bonds without mixing issuers, branches or versions',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE inventory_rows(version,issuer,name,code,cents,branch,scope,maturity)');
  const insert=sqlite.prepare('INSERT INTO inventory_rows VALUES(?,?,?,?,?,?,?,?)');
  const north='国家电网有限公司',south='中国南方电网有限责任公司',regional='内蒙古电力公司';
  for (const [issuer,name,code,cents,branch,version] of [
    [north,'26电网MTN001','123456.IB',210,'广州','now'], [north,'26电网MTN001','123456.IB',90,'广州','now'],
    [north,'25特殊名称','123457.IB',50,'广州','now'],[north,'26电网MTN002','123458.IB',800,'北京','now'],
    [north,'26电网MTN001','123456.IB',80,'广州','old'], [south,'26南电MTN001','123459.IB',130,'广州','now'],
    [regional,'26内蒙电网SCP004','123460.IB',110,'广州','now'],
    ['国网租赁公司','26国网租赁SCP001','123461.IB',100,'广州','now'],
  ])insert.run(version,issuer,name,code,cents,branch,'表内','2027-07-21');
  const db={prepare:sql=>({bind:(...args)=>({all:async()=>({results:sqlite.prepare(sql).all(...args)})})})};
  const snapshot={id:'now',date:'2026-10-29'};
  const hints=await issuerHints(db,snapshot,'电网',{branch:'广州',holdingStatus:'存续'});
  assert.deepEqual(hints.map(({name,totalCents,securityCount,primary})=>[name,totalCents,securityCount,primary]),
    [[north,350,2,true],[south,130,1,false],[regional,110,1,false]]);
  assert.match(hints[0].source,/26电网MTN001/);
  assert.deepEqual(hints[0].securities.map(s=>s.code),['123456.IB','123457.IB']);
  const code=await issuerHints(db,snapshot,'123459.ib',{},[north]);
  assert.deepEqual(code.map(h=>h.name),[south]);
  assert.equal(code[0].primary,true);
  assert.deepEqual(await issuerHints(db,snapshot,'电网',{marketType:'短融'}),[]);
  assert.deepEqual(await issuerHints(db,snapshot,'电网',{guarantor:'电网'}),[]);
  sqlite.close();
});
