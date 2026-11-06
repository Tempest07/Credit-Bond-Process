import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { readInventoryEvidence } from '../tools/inventory-evidence.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE inventory_rows(version,sourceRow,issuer,name,code,marketType,totalCents,portfolio);
    CREATE TABLE inventory_role_rows(version,sourceRow,attribution,guarantors);
    CREATE TABLE inventory_role_sources(version);
    INSERT INTO inventory_role_sources VALUES ('now');
  `);
  const db = {prepare(sql) {
    // The verification API is read-only even on a version with no role index.
    assert.match(sql, /^SELECT /);
    const statement = sqlite.prepare(sql);
    const bound = args => ({first:async()=>statement.get(...args), all:async()=>({results:statement.all(...args)})});
    return {...bound([]), bind:(...args) => bound(args)};
  }};
  const add = (version, row, issuer, name, code, type, owner, guarantor) => {
    sqlite.prepare('INSERT INTO inventory_rows VALUES(?,?,?,?,?,?,?,?)').run(version,row,issuer,name,code,type,987654321,'机密组合名称');
    sqlite.prepare('INSERT INTO inventory_role_rows VALUES(?,?,?,?)').run(version,row,owner,JSON.stringify([guarantor]));
  };
  return {sqlite, db, add};
}

test('issuer, customer, ABS credit exposure and named guarantee are separate dated evidence', async () => {
  const {sqlite, db, add} = fixture();
  const issuer='金元证券股份有限公司', owner='珠海格力集团有限公司', guarantor='其他担保有限公司';
  for (const n of [1,2]) add('now',n,issuer,'横琴7A2','123456.SZ','资产支持证券',owner,guarantor);
  add('now',3,owner,'24格力MTN004','100001.IB','中期票据',owner,'无');
  add('now',4,issuer,'26金元MTN001','100002.IB','中期票据',owner,guarantor);
  add('old',1,'旧发行人有限公司','横琴7A2','123456.SZ','资产支持证券','旧客户有限公司','旧担保有限公司');
  const run = (term,field) => readInventoryEvidence({db}, {id:'now'}, {term,field});
  const code = (await run('123456.sz','code')).matches;
  assert.deepEqual(new Set(code.map(({name,role}) => name+role)), new Set([issuer+'issuer',owner+'attribution',guarantor+'guarantor']));
  assert.equal(code.length,3);
  assert.ok(code.every(row => row.basis==='code' && Object.keys(row).sort().join(',')==='basis,bondName,code,name,role'));
  assert.deepEqual((await run('100001.IB','enhancement')).matches,[]);
  assert.equal((await run('123456.SZ','enhancement')).matches[0].name,owner);
  assert.deepEqual((await run('格力','guarantor')).matches,[]);
  assert.equal((await run('格力','issuer')).matches[0].basis,'bondStem');
  assert.equal((await run('金元','issuer')).matches[0].basis,'bondStem');
  assert.deepEqual((await run('金元','guarantor')).matches.map(m=>[m.name,m.basis]),[[guarantor,'bondFragment']]);
  assert.deepEqual((await run('金元','attribution')).matches.map(m=>[m.name,m.basis]),[[owner,'bondFragment']]);
  assert.equal((await run('26金元MTN001','guarantor')).matches[0].basis,'bondFragment');
  const overview=(await run('123456.SZ','overviewSubject')).matches;
  assert.deepEqual(new Set(overview.map(r=>r.role)),new Set(['attribution','issuer']));
  assert.deepEqual((await run('机密','portfolio')).matches,[]);
  assert.doesNotMatch(JSON.stringify(code),/987654321|机密|旧发行人/);
  sqlite.close();
});

test('caps candidates, prefers exact coupon stem, and rejects unsafe labels and unknown terms', async () => {
  const {db,sqlite,add} = fixture();
  add('now',1,'国家电网有限公司','26电网MTN002','000001.IB','中期票据','','无');
  for (let i=2;i<=12;i++) add('now',i,'电网'+i+'有限公司','26分电网MTN002',i+'.IB','中期票据','','无');
  add('now',13,'个人甲','26电网MTN004','000013.IB','中期票据','','无');
  const run = term => readInventoryEvidence({db}, {id:'now'}, {term,field:'issuer'});
  const {matches}=await run('电网');
  assert.equal(matches.length,8); assert.equal(matches[0].name,'国家电网有限公司');
  assert.equal(matches[0].basis,'bondStem');assert.ok(!matches.some(row=>row.name==='个人甲'));
  assert.deepEqual((await run('不在本期')).matches,[]);
  assert.deepEqual((await run("' OR 1=1 --")).matches,[]);
  sqlite.close();
});

test('unindexed original provides verified role evidence without changing the database', async () => {
  const {db,sqlite}=fixture();sqlite.exec('DROP TABLE inventory_role_sources; DROP TABLE inventory_role_rows; CREATE TABLE inventory_versions(id,sha)');
  const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('本期底稿');
  s.addRow(['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','债券类型','到期日期','数据业务日期','保证人全称','资产端损益还原客户名称']);
  s.addRow(['机构','广州分行','AFS','组合甲','表内','001234.SZ','横琴7A2',4710,'金元证券股份有限公司','资产支持证券','2030-10-20','2026-10-29','责任保证有限公司','珠海格力集团有限公司']);
  const bytes=await wb.xlsx.writeBuffer();
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  sqlite.prepare('INSERT INTO inventory_versions VALUES(?,?)').run('v1',hash);
  let gets=0;
  const bucket={get:async key=>{assert.equal(key,'inventory/2026-10-29/v1.xlsx');gets++;return new Response(bytes)}};
  const version={id:'v1',date:'2026-10-29',rowCount:1,totalCents:471000};
  const read = field=>readInventoryEvidence({db,bucket},version,{field,term:'001234.SZ'});
  assert.equal((await read('guarantor')).matches[0].name,'责任保证有限公司');
  assert.equal((await read('enhancement')).matches[0].name,'珠海格力集团有限公司');
  assert.equal(gets,1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='inventory_role_rows'").get().n,0);
  sqlite.close();
});
