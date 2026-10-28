import test from 'node:test';import assert from 'node:assert/strict';import {PDFDocument} from 'pdf-lib';
import {analyzePaymentReceiptPage,paymentReceiptRemittanceIncludesName} from '../payment-receipt-worker.js';

async function scan(){const doc=await PDFDocument.create(),page=doc.addPage([100,100]);
  const image=doc.context.stream(new Uint8Array([255,216,255,192,0,17,8,0,2,0,2,3,1,17,0,2,17,0,3,17,0,255,217]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'});
  page.node.newXObject('Scan',doc.context.register(image));return doc.save({useObjectStreams:false});}
const env={OCR_AI_PROVIDER:'deepseek',DEEPSEEK_OCR_API_KEY:'ocr-only-test-key-123456789'};
const first={classification:'receipt_start',confidence:.98,document_title:'广州市城市建设开发有限公司配售确认及缴款通知书',bond_short_name:'26广城08',security_code:'246100',payment_date:'2026-09-22',amount_text:'42000万元',remittance_name:'26广城07/08'};
function responses(t,outputs){let calls=0;t.mock.method(globalThis,'fetch',async()=>{const content=outputs[calls++];if(!content)throw Error('unexpected inference');return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});});return()=>calls;}

test('an explicit issue range in the generic payment memo includes its current table tranche only',()=>{
  assert.equal(paymentReceiptRemittanceIncludesName('26广城06','26广城05/06'),true);
  assert.equal(paymentReceiptRemittanceIncludesName('26广城06','26广城05/06认购资金'),true);
  assert.equal(paymentReceiptRemittanceIncludesName('26广城04','26广城05/06'),false);
  assert.equal(paymentReceiptRemittanceIncludesName('26广城06','25广城05/06'),false);
  assert.equal(paymentReceiptRemittanceIncludesName('26苏交通CP008','26苏交通SCP008'),false);
});

test('a clear current tranche and a shared 07/08 remittance instruction use one DeepSeek pass',async t=>{
  const calls=responses(t,[first]),result=await analyzePaymentReceiptPage(env,await scan(),1);
  assert.equal(calls(),1);assert.equal(result.classification,'receipt_start');assert.equal(result.fields.bondShortName,'26广城08');assert.equal(result.fields.securityCode,'246100');
});

test('genuine single-tranche product conflicts remain reviewable',async t=>{
  const calls=responses(t,[{...first,bond_short_name:'26苏交通CP008',security_code:'042680338',remittance_name:'26苏交通SCP008'},
    {nameField:'26苏交通CP008',remittanceName:'26苏交通SCP008',securityCode:'042680338',uncertainties:[]}]);
  const result=await analyzePaymentReceiptPage(env,await scan(),1);assert.equal(calls(),2);assert.equal(result.classification,'uncertain');assert.equal(result.identityReview.reason,'literal_name_conflict');
});

test('a clearly coded ABS notice keeps its literal plan/class name separately from conventional abbreviations',async t=>{
  const plan='长江证券-长投融资租赁1期资产支持专项计划优先A1级';
  const calls=responses(t,[{...first,confidence:.95,document_title:'长江证券-长投融资租赁1期资产支持专项计划资产支持证券配售确认及缴款通知书',bond_short_name:'26长投融资租赁1期优先A1级',security_code:'501286',remittance_name:'',amount_text:'20000000元'},
    {nameField:plan,remittanceName:'',securityCode:'501286',uncertainties:[]}]);
  const result=await analyzePaymentReceiptPage(env,await scan(),1);assert.equal(calls(),2);assert.equal(result.classification,'receipt_start');
  assert.equal(result.fields.bondShortName,'');assert.equal(result.fields.securityCode,'501286');assert.equal(result.fields.instrumentName,plan);assert.ok(result.recognizedText.includes(plan));
});

test('a code contradiction still prevents trusting a nonconventional ABS reading',async t=>{
  responses(t,[{...first,document_title:'长投1期资产支持专项计划配售确认及缴款通知书',bond_short_name:'26长投融资租赁1期优先A1级',security_code:'501286',remittance_name:''},
    {nameField:'26另一只01',remittanceName:'',securityCode:'501287',uncertainties:[]}]);
  const result=await analyzePaymentReceiptPage(env,await scan(),1);assert.equal(result.classification,'uncertain');assert.equal(result.fields.securityCode,'501286');
});
