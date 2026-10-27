import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { analyzePaymentReceiptPage, paymentReceiptWorkerReadiness, processPaymentReceiptFile } from '../payment-receipt-worker.js';
import { groupPaymentReceiptPages } from '../payment-receipts.js';

async function scan() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([100, 100]);
  const image = pdf.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 0xff, 0xd9]), {
    Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2,
    ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
  });
  page.node.newXObject('Image', pdf.context.register(image));
  return pdf.save({ useObjectStreams: false });
}

const primary = (name = '26苏交CP008', code = '042680338', rest = {}) => ({
  classification: 'receipt_start', confidence: 0.96,
  document_title: '江苏交通控股有限公司配售确认及缴款通知书',
  bond_short_name: name, security_code: code, payment_date: '2026-10-15',
  amount_text: '42,000万元', ...rest,
});
const literal = (name = '26苏交通CP008', code = '042680338', rest = {}) => ({
  nameField: name, remittanceName: name, securityCode: code, uncertainties: [], ...rest,
});

function stages(first, second) {
  const requests = [];
  return {
    requests,
    env: { AI: { async run(model, input) {
      requests.push({ model, input });
      if (requests.length === 1) return { response: first };
      if (second instanceof Error) throw second;
      return { response: second };
    } } },
  };
}

test('a current-page independent read restores a missing issuer tail and keeps primary evidence', async () => {
  const ai = stages(primary(), literal());
  const page = await analyzePaymentReceiptPage(ai.env, await scan(), 9, {
    classification: 'receipt_start', fields: { bondShortName: '26上一页MTN002B', securityCode: '102683999' },
  });
  assert.equal(ai.requests.length, 2);
  assert.equal(page.analysisVersion, 7);
  assert.equal(page.analysisSource, 'workers-ai-page-image');
  assert.equal(page.fields.bondShortName, '26苏交通CP008');
  assert.equal(page.fields.securityCode, '042680338');
  assert.equal(page.identityReview.status, 'verified');
  assert.equal(page.identityReview.applied, true);
  assert.equal(page.identityReview.readings.nameField, '26苏交通CP008');
  assert.equal(page.primaryRecognition.bondShortName, '26苏交CP008');
  assert.match(page.primaryRecognition.recognizedText, /债券简称 26苏交CP008/);
  assert.match(page.recognizedText, /债券简称 26苏交通CP008/);
  const independentPrompt = ai.requests[1].input.messages[0].content[0].text;
  assert.doesNotMatch(independentPrompt, /26苏交CP008|26上一页MTN002B|102683999|042680338/);
  assert.equal(ai.requests[1].input.messages[0].content[1].image_url.url,
    ai.requests[0].input.messages[0].content[1].image_url.url);
});

test('clear same-code literal readings correct earlier OCR products, tranches, years, issues and issuer typos', async () => {
  for (const [first, second] of [
    [primary(), literal('26苏交通SCP008')],
    [primary('26越秀租赁MTN002A', '102683999'), literal('26越秀租赁MTN002B', '102683999')],
    [primary(), literal('25苏交通CP008')],
    [primary(), literal('26苏交通CP009')],
    [primary('26九川通SCP003', '012682438'), literal('26九州通SCP003(支持养老产业)', '012682438')],
    [primary('福建高速MTN005', '102683994'), literal('26闽高速MTN005', '102683994')],
  ]) {
    const ai = stages(first, second);
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 1);
    assert.equal(page.classification, 'receipt_start', JSON.stringify(second));
    assert.equal(page.identityReview.status, 'verified');
    assert.equal(page.identityReview.applied, true);
    assert.equal(page.fields.bondShortName, second.nameField);
    assert.equal(page.primaryRecognition.bondShortName, first.bond_short_name);
    assert.equal(page.fields.securityCode, first.security_code);
  }
});

test('a conflicting security code or market stays reviewable', async () => {
  const cases = [
    [primary(), literal('26苏交通CP008', '042680339'), '26苏交CP008'],
    [primary('26示例01', '246129.SH'), literal('26示例01', '246129.SZ'), '26示例01'],
  ];
  for (const [first, second, original] of cases) {
    const ai = stages(first, second);
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 1);
    assert.equal(page.classification, 'uncertain', JSON.stringify(second));
    assert.equal(page.identityReview.status, 'conflict');
    assert.equal(page.identityReview.applied, false);
    assert.equal(page.fields.bondShortName, original);
    assert.equal(page.fields.securityCode, first.security_code);
  }
});

test('independent disagreement or inability to read never overwrites primary fields', async () => {
  for (const second of [
    literal('26苏交通CP008', '042680338', { remittanceName: '26苏交通SCP008' }),
    literal('26苏交通CP008', '042680338', { uncertainties: ['简称字段模糊'] }),
    literal('', '042680338', { remittanceName: '' }),
    'not valid JSON',
    new Error('private service details'),
  ]) {
    const ai = stages(primary(), second);
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 1);
    assert.equal(page.classification, 'uncertain');
    assert.equal(page.identityReview.applied, false);
    assert.equal(page.fields.bondShortName, '26苏交CP008');
    assert.doesNotMatch(JSON.stringify(page), /private service details/);
  }
});

test('one clearly printed literal name is enough when the other field is absent', async () => {
  for (const second of [literal('26苏交通CP008', '042680338', { remittanceName: '' }),
    literal('', '042680338', { remittanceName: '26苏交通CP008' })]) {
    const ai = stages(primary(), second);
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 1);
    assert.equal(page.classification, 'receipt_start');
    assert.equal(page.identityReview.status, 'verified');
    assert.equal(page.identityReview.applied, true);
    assert.equal(page.fields.bondShortName, '26苏交通CP008');
  }
});

test('a response without any literal readings cannot masquerade as successful corroboration', async () => {
  const ai = stages(primary(), primary());
  const page = await analyzePaymentReceiptPage(ai.env, await scan(), 1);
  assert.equal(page.identityReview.status, 'unavailable');
  assert.equal(page.identityReview.reason, 'missing_literal_reading');
  assert.equal(page.classification, 'uncertain');
  assert.equal(page.fields.bondShortName, '26苏交CP008');
});

test('three distinct original bond identities form three page groups instead of polluting one receipt', async () => {
  const pdf = await scan();
  const inputs = [
    [primary(), literal()],
    [primary('乌鲁木齐城市建设投资（集团）有限公司2026年度第一期定向债务融资工具', '032680566', {
      classification: 'uncertain', document_title: '乌鲁木齐城市建设投资（集团）有限公司配售确认及缴款通知书',
    }), literal('26乌城投PPN001', '032680566')],
    [primary('26闽高速MTN005', '102683994', {
      classification: 'uncertain', document_title: '福建省高速公路集团有限公司配售确认及缴款通知书',
    }), literal('26闽高速MTN005', '102683994')],
  ];
  const pages = [];
  let previous = { classification: 'receipt_start', fields: { bondShortName: '26越秀租MTN002B', securityCode: '102683999' } };
  for (let i = 0; i < inputs.length; i++) {
    const ai = stages(...inputs[i]);
    const page = await analyzePaymentReceiptPage(ai.env, pdf, i + 9, previous);
    assert.equal(page.classification, 'receipt_start');
    assert.equal(page.identityReview.status, 'verified');
    pages.push(page);
    previous = { classification: page.classification, fields: page.fields };
  }
  assert.deepEqual(pages.map(page => page.fields.bondShortName), ['26苏交通CP008', '26乌城投PPN001', '26闽高速MTN005']);
  const grouped = groupPaymentReceiptPages(pages.map(page => ({
    pageNumber: page.pageNumber, text: page.recognizedText, startsReceipt: page.classification === 'receipt_start',
  })));
  assert.deepEqual(grouped.groups.map(group => group.pageNumbers), [[9], [10], [11]]);
  assert.deepEqual(grouped.uncertainPages, []);
});

test('a distinct verified current page starts after a prior page with no usable name, but requires its own notice title', async () => {
  for (const [title, expected] of [['配售确认及缴款通知书', 'receipt_start'], ['', 'uncertain']]) {
    const ai = stages(primary('26闽高速MTN005', '102683994', { classification: 'uncertain', document_title: title }),
      literal('26闽高速MTN005', '102683994'));
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 11, {
      classification: 'uncertain', fields: { securityCode: '032680566', bondShortName: '' },
    });
    assert.equal(page.classification, expected);
  }
});

test('same-name code drift cannot become a new receipt even after current-page corroboration', async () => {
  for (const [before, current] of [
    ['26示例MTN001', '26示例MTN001'],
    ['26示例MTN001', '26示例MTN001(绿色)'],
    ['26苏交CP008', '26苏交通CP008'],
    ['26苏交CP008', '26苏交通控CP008'],
    ['26苏交通控CP008', '26苏交CP008'],
  ]) {
    const ai = stages(primary(current, '102600002'), literal(current, '102600002'));
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 2, {
      classification: 'receipt_start', fields: { bondShortName: before, securityCode: '102600001' },
    });
    assert.equal(page.identityReview.status, 'verified');
    assert.equal(page.classification, 'uncertain', current);
  }
});

test('distinct same-series issuers and explicit year or tranche changes do not become same-page name variants', async () => {
  for (const [before, current] of [
    ['26示例MTN001', '26另一家MTN001'],
    ['25示例MTN001', '26示例MTN001'],
    ['26示例MTN001A', '26示例MTN001B'],
    ['26苏交CP008', '26苏交通控股CP008'],
  ]) {
    const ai = stages(primary(current, '102600002', { classification: 'uncertain' }), literal(current, '102600002'));
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 2, {
      classification: 'receipt_start', fields: { bondShortName: before, securityCode: '102600001' },
    });
    assert.equal(page.identityReview.status, 'verified');
    assert.equal(page.classification, 'receipt_start', `${before} -> ${current}`);
  }
});

test('explicit continuation and missing or invalid codes do not trigger another paid request', async () => {
  for (const first of [
    primary('26示例MTN001', '102600002', { classification: 'continuation', prepayment_number: 'W2026072100001' }),
    primary('26示例MTN001', ''),
    primary('26示例MTN001', '6222123456789012'),
  ]) {
    const ai = stages(first, new Error('must not request review'));
    const page = await analyzePaymentReceiptPage(ai.env, await scan(), 2, {
      classification: 'receipt_start', fields: { bondShortName: '26示例MTN001', securityCode: '102600001', prepaymentNumber: 'W2026072100001' },
    });
    assert.equal(ai.requests.length, 1);
    assert.equal(page.identityReview, undefined);
    if (first.classification === 'continuation') assert.equal(page.classification, 'continuation');
  }
});

const deepseekEnv = { OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_OCR_API_KEY: 'ocr-only-test-key-123456789', AI_PROCESSING_APPROVED: 'true' };

test('DeepSeek handles page extraction and independent identity review with its actual model metadata', async t => {
  const requests = [];
  let legacyCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    requests.push({ url: String(url), input });
    const output = requests.length === 1 ? primary() : literal();
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
  });
  const page = await analyzePaymentReceiptPage({ ...deepseekEnv, AI: {
    async run() { legacyCalls++; throw Error('legacy must not run'); },
    async toMarkdown() { legacyCalls++; throw Error('legacy fallback must not run'); },
  } }, await scan(), 9);
  assert.equal(requests.length, 2);
  assert.equal(legacyCalls, 0);
  assert.equal(page.model, 'deepseek-flash');
  assert.equal(page.analysisSource, 'deepseek-page-image');
  assert.equal(page.identityReview.model, 'deepseek-flash');
  assert.equal(page.identityReview.status, 'verified');
  assert.equal(page.fields.bondShortName, '26苏交通CP008');
  assert.equal(page.primaryRecognition.bondShortName, '26苏交CP008');
  for (const request of requests) {
    assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(request.input.headers.Authorization, `Bearer ${deepseekEnv.DEEPSEEK_OCR_API_KEY}`);
    assert.equal(JSON.parse(request.input.body).model, 'deepseek-flash');
  }
});

test('DeepSeek authentication and throttling fail fast in either OCR pass without a legacy call', async t => {
  const pdf = await scan();
  for (const failAt of [1, 2]) for (const status of [401, 429]) {
    let requests = 0, legacyCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return requests === failAt ? new Response('private-vendor-details', { status })
        : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(primary()) } }] });
    });
    await assert.rejects(() => analyzePaymentReceiptPage({ ...deepseekEnv, AI: {
      async run() { legacyCalls++; }, async toMarkdown() { legacyCalls++; },
    } }, pdf, 9), error => error.nonRetryable === true && error.httpStatus === (status === 429 ? 429 : 503)
      && !error.message.includes('private-vendor-details'));
    assert.equal(requests, failAt);
    assert.equal(legacyCalls, 0);
    t.mock.restoreAll();
  }
});

test('DeepSeek does not hand unsupported PDF pages to the legacy text service', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([100, 100]);
  let legacyCalls = 0;
  const page = await analyzePaymentReceiptPage({ ...deepseekEnv, AI: {
    async run() { legacyCalls++; }, async toMarkdown() { legacyCalls++; },
  } }, await pdf.save(), 1);
  assert.equal(page.classification, 'uncertain');
  assert.equal(page.analysisSource, 'unavailable');
  assert.equal(legacyCalls, 0);
});

test('explicit OCR configuration is checked before file processing writes or legacy service selection', async () => {
  let accesses = 0;
  await assert.rejects(() => processPaymentReceiptFile({ OCR_AI_PROVIDER: 'deepseek', AI_PROCESSING_APPROVED: 'true',
    DEEPSEEK_API_KEY: 'issuance-only-key-123456789', AI: { async run() { accesses++; } },
    DB: { prepare() { accesses++; throw Error('must not write'); } },
  }), error => error.code === 'DEEPSEEK_OCR_CONFIG' && error.httpStatus === 503);
  assert.equal(accesses, 0);
  const bindings = { ...deepseekEnv, DB: {}, PAYMENT_RECEIPTS: {}, RECEIPT_QUEUE: {},
    ALLOWED_SENDERS: 'sender@example.com', EXPECTED_RECIPIENT: 'receipts@example.com' };
  assert.equal(paymentReceiptWorkerReadiness(bindings).ready, true);
  assert.equal(paymentReceiptWorkerReadiness({ ...bindings, DEEPSEEK_OCR_API_KEY: undefined, AI: {} }).ready, false);
});
