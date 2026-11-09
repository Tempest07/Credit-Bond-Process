import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {parseInventoryWorkbook,exportInventoryWorkbook} from '../tools/inventory-workbook.mjs';

const headers=['机构名称','联动分行','会计分类','交易组合','表内/委外','债券代码','债券简称','名义本金','发行人全称','数据业务日期','到期日期','ABS预计到期日','法定到期日'];
async function makeFixture() {
  const wb=new ExcelJS.Workbook();
  wb.properties.date1904=true;
  const hidden=wb.addWorksheet('旧表',{state:'hidden'});
  hidden.addRow(headers).getCell(8).value='名义本金';
  const sheet=wb.addWorksheet('本期 & 明细');
  sheet.addRow([null,null,'标题']);
  sheet.addRow(headers);
  sheet.addRow(['中心','广州分行','AFS','组合甲','表内','001.IB','第一券',{formula:'1+1',result:100.25},{richText:[{text:'甲 & '},{text:'乙'}]},new Date('2026-10-29T00:00:00Z'),new Date('2030-01-01T00:00:00Z')]);
  sheet.addRow(['中心','广州分行','AFS','组合乙','委外(公募)','001.IB','第一券','-1,000.02','=1+1','2026/10/29']);
  sheet.addRow(['小计',null,null,null,null,null,null,123]);
  return wb.xlsx.writeBuffer();
}
function aggregate(parsed) {
  const result={resultId:'sample',snapshot:{id:'snap',sheet:parsed.sheet,date:parsed.date,filename:'来源.xlsx'},
    plan:{metric:'principal'},totalCents:parsed.totalCents,rowCount:parsed.rowCount,securityCount:1,
    groups:[{name:'全部',cents:parsed.totalCents,count:parsed.rowCount,securityCount:1}],warnings:[]};
  return result;
}
test('named sheets, date1904 dates, cached formula, rich and inline strings, subtotal and literal exported strings',async()=>{
  const raw=await makeFixture();
  const zip=new PizZip(raw);
  const part=zip.file('xl/worksheets/sheet2.xml').asText();
  zip.file('xl/worksheets/sheet2.xml',part.replace(/<c r="G3"[^>]*>.*?<\/c>/,'<c r="G3" t="inlineStr"><is><r><t>第</t></r><r><t>一券</t></r></is></c>'));
  const parsed=await parseInventoryWorkbook(zip.generate({type:'uint8array'}));
  assert.equal(parsed.sheet,'本期 & 明细');assert.equal(parsed.date,'2026-10-29');
  assert.equal(parsed.rowCount,2);assert.equal(parsed.totalCents,-89977);
  assert.equal(parsed.rows[0].issuer,'甲 & 乙');assert.equal(parsed.rows[0].name,'第一券');assert.equal(parsed.rows[0].maturity,'2030-01-01');
  assert.deepEqual(parsed.rows.map(r=>r.sourceRow),[3,4]);
  const out=new ExcelJS.Workbook();await out.xlsx.load(await exportInventoryWorkbook(aggregate(parsed),parsed.rows));
  assert.deepEqual(out.worksheets.map(s=>s.name),['分组汇总','持仓明细','计算口径']);
  assert.equal(out.worksheets[1].getCell('A3').value,'=1+1');
  assert.equal(out.worksheets[1].getCell('D3').value,-1000.02);
  assert.equal(out.worksheets[1].getCell('D3').numFmt,'#,##0.00');
  assert.equal(out.worksheets[0].getCell('C2').numFmt,'#,##0.00000000');
  assert.equal(out.worksheets[1].autoFilter,'A1:N3');
  assert.equal(out.worksheets[1].views[0].state,'frozen');
});
test('a malformed part or DTD fails closed instead of executing document content',async()=>{
  const zip=new PizZip(await makeFixture());
  zip.file('xl/sharedStrings.xml','<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "Injected">]><sst><si><t>&a;</t></si></sst>');
  await assert.rejects(parseInventoryWorkbook(zip.generate({type:'uint8array'})),e=>e.status===400);
});
test('the browser bundle parses and exports inside a pure workerd isolate',async()=>{
  const code=[
    'import {parseInventoryWorkbook,exportInventoryWorkbook} from "./tools/inventory-workbook.mjs";',
    'export default {async fetch(req){',
    'if(typeof Buffer!=="undefined"||typeof DOMParser!=="undefined")throw Error("Unexpected Node or DOM globals");',
    'const p=await parseInventoryWorkbook(new Uint8Array(await req.arrayBuffer()));',
    'const result={resultId:"test",snapshot:{sheet:p.sheet,date:p.date,filename:"测试",id:"x"},plan:{},groups:[],warnings:[],totalCents:p.totalCents,rowCount:p.rowCount,securityCount:0};',
    'return new Response(await exportInventoryWorkbook(result,p.rows),{headers:{"x-row-count":String(p.rowCount),"x-total-cents":String(p.totalCents)}});}};',
  ].join('');
  const out=await build({stdin:{contents:code,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',minify:true});
  const config={name:'inventory-workbook-test',type:'worker',compatibilityDate:'2026-06-09',
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:out.outputFiles[0].text}}}};
  const mf=new Miniflare({workers:[{config}]});
  try {
    const real=process.env.INVENTORY_WORKBOOK_FIXTURE;
    const res=await mf.dispatchFetch('http://test/import',{method:'POST',body:real?await readFile(real):await makeFixture()});
    assert.equal(res.status,200);
    const wb=new ExcelJS.Workbook();await wb.xlsx.load(await res.arrayBuffer());
    const count=real?3713:2,cents=real?30381736165554:-89977;
    assert.equal(Number(res.headers.get('x-row-count')),count);
    assert.equal(Number(res.headers.get('x-total-cents')),cents);
    assert.equal(wb.getWorksheet('持仓明细').rowCount,count+1);
    assert.equal(wb.getWorksheet('分组汇总').getCell('B2').value,cents/100);
  } finally {await mf.dispose();}
});

test('distant empty formatted rows do not count as holdings',async()=>{
  const zip=new PizZip(await makeFixture());
  const sheet='xl/worksheets/sheet2.xml';
  zip.file(sheet,zip.file(sheet).asText().replace('</sheetData>','<row r="65000"><c r="A65000" s="1"/></row></sheetData>'));
  const snap=await parseInventoryWorkbook(zip.generate({type:'uint8array'}));
  assert.equal(snap.rowCount,2);
});

test('a named current ledger accepts a proven subset and rejects extra or repeated holdings in another sheet',async()=>{
  const wb=new ExcelJS.Workbook(),extract=wb.addWorksheet('Sheet1'),ledger=wb.addWorksheet('本期底稿');
  const row=['中心','北京分行','AFS','组合','表内','001','甲债',20,'甲公司','2026-01-15'];
  for(const sheet of [extract,ledger]){sheet.addRow(headers);sheet.addRow(row);}
  ledger.addRow([...row.slice(0,5),'002',...row.slice(6)]);
  ledger.addRow([...row.slice(0,5),'003',...row.slice(6)]);
  const snap=await parseInventoryWorkbook(await wb.xlsx.writeBuffer());
  assert.deepEqual([snap.sheet,snap.rowCount,snap.totalCents],['本期底稿',3,6000]);
  extract.addRow(row);
  await assert.rejects(parseInventoryWorkbook(await wb.xlsx.writeBuffer()),e=>e.status===400);
});
