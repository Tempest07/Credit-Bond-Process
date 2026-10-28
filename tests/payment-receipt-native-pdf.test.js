import test from 'node:test';import assert from 'node:assert/strict';
import {PDFDocument,PDFName} from 'pdf-lib';
import {extractPaymentReceiptNativeText,paymentReceiptNativeFields,paymentReceiptNativePageAnalysis} from '../payment-receipt-native-pdf.js';
import {analyzePaymentReceiptPage} from '../payment-receipt-worker.js';
import {recognizePaymentReceiptText} from '../payment-receipts.js';

// A small native Type0-font PDF, with an embedded Unicode character map and no
// scan image. This reproduces the real missing-page path without client data.
async function nativePdf(lines){
  const doc=await PDFDocument.create(),page=doc.addPage([600,800]),chars=[...new Set(lines.join(''))];
  const code=char=>(chars.indexOf(char)+1).toString(16).padStart(4,'0');
  const cmap=`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /TestUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chars.length} beginbfchar\n${chars.map(char=>'<'+code(char)+'> <'+char.charCodeAt(0).toString(16).padStart(4,'0')+'>').join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const descriptor=doc.context.register(doc.context.obj({Type:'FontDescriptor',FontName:'TestNativeFont',Flags:4,FontBBox:[0,-200,1000,900],ItalicAngle:0,Ascent:900,Descent:-200,CapHeight:700,StemV:80}));
  const descendant=doc.context.register(doc.context.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:'TestNativeFont',CIDSystemInfo:{Registry:'Adobe',Ordering:'Identity',Supplement:0},FontDescriptor:descriptor,DW:1000,CIDToGIDMap:'Identity'}));
  const font=doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type0',BaseFont:'TestNativeFont',Encoding:'Identity-H',DescendantFonts:[descendant],ToUnicode:doc.context.register(doc.context.flateStream(cmap))}));
  page.node.set(PDFName.of('Resources'),doc.context.obj({Font:{FNative:font}}));
  page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream('BT /FNative 9 Tf 20 760 Td\n'+lines.map((line,index)=>(index?'0 -14 Td\n':'')+'<'+[...line].map(code).join('')+'> Tj').join('\n')+'\nET')));
  return doc.save({useObjectStreams:false});
}

const lines=['配售确认及缴款通知书','公司债券简称(代码) 26 测试 01（245733）','缴款日期 2026 年 07 月 24 日','票面利率 1.79%','获配面值(元) 100,000,000.00','应缴款金额(元) 100,000,000.00'];

test('combined native bond-name/code fields are separated without losing the issuer or inventing a market',()=>{
  const fields=paymentReceiptNativeFields(lines.join('\n'));
  assert.equal(fields.bondShortName,'26测试01');assert.equal(fields.securityCode,'245733');assert.equal(fields.paymentDate,'2026-07-24');
  assert.equal(fields.amountFen,10000000000);assert.equal(fields.couponRate,'1.79%');
});

test('native allocation tables keep their literal bond and paid amount rather than a conflicting remittance example',()=>{
  const text='配售确认及缴款通知书\n债券简称 债券代码 发行规模\n（万元） 期限 票面利率/\n价格\n获配面值\n（万元）\n缴款金额\n（万元）\n26 测试 08 245694.SH 270,000.00 5+2 年 2.20% 30,000.00 30,000.00\n请将款项于2026年07月17日支付\n附言示例25测试07/08缴款';
  const fields=paymentReceiptNativeFields(text);assert.equal(fields.bondShortName,'26测试08');assert.equal(fields.securityCode,'245694.SH');assert.equal(fields.amountFen,30000000000);
});

test('a real text-only Chinese PDF is extracted locally through its Unicode mapping',async()=>{
  const result=await extractPaymentReceiptNativeText(await nativePdf(lines));
  assert.equal(result.status,'ok');assert.match(result.text,/公司债券简称/);assert.equal(result.fields.bondShortName,'26测试01');assert.equal(result.fields.securityCode,'245733');
});

test('the actual page reader recovers a native first page without a vision call or legacy upload',async()=>{
  let calls=0;const result=await analyzePaymentReceiptPage({AI:{async run(){calls++;throw Error('must not infer native text');},async toMarkdown(){calls++;throw Error('must not upload native PDF');}}},await nativePdf(lines),1);
  assert.equal(calls,0);assert.equal(result.analysisSource,'pdf-text-layer');assert.equal(result.classification,'receipt_start');
  const receipt=recognizePaymentReceiptText(result.recognizedText,result.fields);assert.equal(receipt.bondShortName,'26测试01');assert.equal(receipt.amountFen,10000000000);
});

test('native boundary decisions keep code conflicts uncertain and split distinct named bonds',()=>{
  const native={status:'ok',text:lines.join('\n'),fields:paymentReceiptNativeFields(lines.join('\n'))};
  assert.equal(paymentReceiptNativePageAnalysis(native,1).classification,'receipt_start');
  assert.equal(paymentReceiptNativePageAnalysis(native,2,{classification:'receipt_start',fields:{bondShortName:'26测试01',securityCode:'245734'}}).classification,'uncertain');
  assert.equal(paymentReceiptNativePageAnalysis(native,2,{classification:'receipt_start',fields:{bondShortName:'26另一家01',securityCode:'245734'}}).classification,'receipt_start');
});

test('unreadable, blank, oversized and multipage inputs do not become confident empty receipts',async()=>{
  const empty=await PDFDocument.create();empty.addPage();
  assert.equal((await extractPaymentReceiptNativeText(await empty.save())).status,'unavailable');
  assert.equal((await extractPaymentReceiptNativeText(new Uint8Array([1,2,3]))).status,'unavailable');
  assert.equal((await extractPaymentReceiptNativeText(new Uint8Array(20*1024*1024+1))).status,'unavailable');
  const multi=await PDFDocument.create();multi.addPage();multi.addPage();assert.equal((await extractPaymentReceiptNativeText(await multi.save())).status,'unavailable');
  assert.equal(paymentReceiptNativePageAnalysis({status:'unavailable',text:''},1),null);
});
