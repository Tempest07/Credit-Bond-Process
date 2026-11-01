import assert from 'node:assert/strict';
import test from 'node:test';
import * as recognition from '../issuance-recognition.js';
import { issuanceModelInput } from '../functions/api/_issuance-model.js';
import { applySemanticIssuanceResult, normalizeProjectRecord } from '../lifecycle.js';

const PLAN = '吴都租赁-东吴第6期资产支持专项计划资产支持证券';
const SPECS = [
  { suffix: 'A1', rate: '1.45%', scale: '5亿', amount: 5, tenor: '0.98年', multiple: '3.40倍', code: '273407.SH' },
  { suffix: 'A2', rate: '1.55%', scale: '2.96亿', amount: 2.96, tenor: '1.73年', multiple: '3.65倍', code: '273408.SH' },
  { suffix: 'A3', rate: '1.70%', scale: '2.3亿', amount: 2.3, tenor: '3.23年', multiple: '2.40倍', code: '273409.SH' },
];
const PAYMENT = '【缴款日期】：2026年11月3日';
const START = '【起息日期】：2026年11月3日';
const cell = (raw, evidence = raw) => ({ raw, evidence });

function fixture({ selectedCount = 2, exactNames = false, knownCodes = false, start = true,
  title = '吴都租赁6期ABS簿记结果', sourcePrefix = '吴都6', sourceSpecs = SPECS } = {}) {
  const sources = sourceSpecs.map(row => {
    const name = `${sourcePrefix}${row.suffix}`;
    return { ...row, name, source: `【${name}】\n票面利率：${row.rate}\n发行规模：${row.scale}\n债券期限：${row.tenor}\n投标倍率：${row.multiple}\n债券简称：${name}\n债券代码：${row.code}` };
  });
  const footer = [PAYMENT, ...(start ? [START] : [])];
  const text = `------${title}------\n${sources.map(row => row.source).join('\n\n')}\n-----------------------------\n${footer.join('\n')}\n-----------------------------\n感谢投资者的大力支持！`;
  const request = {
    text, noticeDate: '2026-10-30',
    project: { instrumentType: 'ABS', planName: PLAN },
    tranches: SPECS.slice(0, selectedCount).map((row, index) => ({
      id: `selected-${index}`, shortName: `${exactNames ? '吴都' : '吴租'}6${row.suffix}`,
      securityCode: knownCodes ? row.code : '', durationText: row.tenor,
      issueScale: row.amount, absClassName: `优先${row.suffix}级`,
    })),
  };
  const model = {
    sharedEvidence: footer,
    items: sources.slice(0, selectedCount).map((row, index) => ({
      shortName: request.tranches[index].shortName, sourceText: row.source,
      outcome: 'issued', outcomeEvidence: '',
      fields: Object.fromEntries(Object.keys(recognition.ISSUANCE_FIELDS).map(field => [field, {
        securityCode: cell(row.code, `债券代码：${row.code}`),
        couponRate: cell(row.rate, `票面利率：${row.rate}`),
        issueScale: cell(row.scale, `发行规模：${row.scale}`),
        durationText: cell(row.tenor, `债券期限：${row.tenor}`),
        fullMarketMultiple: cell(row.multiple, `投标倍率：${row.multiple}`),
        paymentDate: cell('2026年11月3日', PAYMENT),
        startDate: start ? cell('2026年11月3日', START) : cell(null, ''),
      }[field] || cell(null, '')])),
    })),
  };
  return { request, model, sources };
}

const parse = ({ request, model }) => recognition.validateSemanticResult(recognition.validateRecognitionRequest(request), model);
const assertAccepted = parsed => assert.equal(parsed.canApply, true, parsed.errors.join('\n'));

test('ABS notice matches selected A1/A2 using the same plan, class, scale and tenor without changing project names', () => {
  const sample = fixture(), before = structuredClone(sample);
  const parsed = parse(sample);
  assertAccepted(parsed);
  assert.deepEqual(parsed.items.map(row => row.trancheId), ['selected-0', 'selected-1']);
  assert.deepEqual(parsed.items.map(row => row.shortName), ['吴租6A1', '吴租6A2']);
  assert.deepEqual(parsed.items.map(row => row.couponRate), [1.45, 1.55]);
  assert.deepEqual(parsed.items.map(row => row.issueScale), [5, 2.96]);
  assert.deepEqual(parsed.items.map(row => row.durationText), ['0.98年', '1.73年']);
  assert.deepEqual(parsed.items.map(row => row.securityCode), ['273407.SH', '273408.SH']);
  assert.deepEqual(parsed.items.map(row => row.fullMarketMultiple), [3.4, 3.65]);
  assert.deepEqual(parsed.items.map(row => row.marginalMultiple), [null, null]);
  assert.deepEqual(parsed.items.map(row => row.paymentDate), ['2026-11-03', '2026-11-03']);
  assert.deepEqual(parsed.items.map(row => row.startDate), ['2026-11-03', '2026-11-03']);
  assert.deepEqual(parsed.items.map(row => row.sourceText), sample.sources.slice(0, 2).map(row => row.source));
  assert.deepEqual(sample, before, 'recognition must leave request and model evidence intact');
});

test('ABS identities are stable when candidate order or model result order is reversed', () => {
  for (const reverseRequest of [false, true]) for (const reverseModel of [false, true]) {
    const sample = fixture();
    if (reverseRequest) sample.request.tranches.reverse();
    if (reverseModel) sample.model.items.reverse();
    const parsed = parse(sample);
    assertAccepted(parsed);
    const byId = Object.fromEntries(parsed.items.map(row => [row.trancheId, row]));
    assert.equal(byId['selected-0'].couponRate, 1.45);
    assert.equal(byId['selected-0'].securityCode, '273407.SH');
    assert.equal(byId['selected-1'].couponRate, 1.55);
    assert.equal(byId['selected-1'].securityCode, '273408.SH');
  }
});

test('a third notice class outside selected investment does not contaminate A2 or create an A3 result', () => {
  for (const knownCodes of [false, true]) {
    const sample = fixture({ exactNames: true, knownCodes });
    const parsed = parse(sample);
    assertAccepted(parsed);
    assert.equal(parsed.items.length, 2);
    assert.deepEqual(parsed.items.map(row => row.securityCode), ['273407.SH', '273408.SH']);
    assert.ok(!parsed.items.some(row => row.securityCode === '273409.SH'));
  }
});

test('all three selected ABS classes retain their own rates and codes', () => {
  const parsed = parse(fixture({ selectedCount: 3 }));
  assertAccepted(parsed);
  assert.deepEqual(parsed.items.map(row => row.couponRate), [1.45, 1.55, 1.7]);
  assert.deepEqual(parsed.items.map(row => row.securityCode), SPECS.map(row => row.code));
});

test('one selected ABS class receives an explicit document-wide date but never an unselected class private date', () => {
  const sample = fixture({ selectedCount: 1 });
  const common = parse(sample);
  assertAccepted(common);
  assert.equal(common.items[0].paymentDate, '2026-11-03');
  assert.equal(common.items[0].startDate, '2026-11-03');
  for (const owner of ['吴都6A3', 'A3']) {
    const privateSample = fixture({ selectedCount: 1 });
    privateSample.request.text = privateSample.request.text.replace(PAYMENT, `${owner}于2026年11月3日缴款`)
      .replace(START, `${owner}起息日期：2026年11月3日`);
    privateSample.model.sharedEvidence = [];
    privateSample.model.items[0].fields.paymentDate = cell(null, '');
    privateSample.model.items[0].fields.startDate = cell(null, '');
    const parsed = parse(privateSample);
    assertAccepted(parsed);
    assert.equal(parsed.items[0].paymentDate, '', owner);
    assert.equal(parsed.items[0].startDate, '', owner);
  }
});

test('an ordinary bond cannot use an ABS alias or a naked A1 suffix as identity', () => {
  for (const project of [undefined, { instrumentType: '', planName: PLAN }, { instrumentType: 'ABS', planName: '另一租赁第6期资产支持专项计划' }]) {
    const sample = fixture();
    sample.request.project = project;
    assert.equal(parse(sample).canApply, false, JSON.stringify(project));
  }
  const sample = fixture();
  sample.request.tranches[0].shortName = 'A1';
  assert.equal(parse(sample).canApply, false, 'class alone must not claim any A1 bond');
});

test('an ABS alias cannot cross a different plan family, issue number, class or missing combination evidence', () => {
  for (const change of [
    sample => { sample.request.project.planName = '苏州租赁-东吴第6期资产支持专项计划资产支持证券'; },
    sample => { sample.request.project.planName = '吴都租赁-东吴第7期资产支持专项计划资产支持证券'; },
    sample => { sample.request.tranches[0].absClassName = '优先A2级'; },
    sample => { sample.request.tranches[0].issueScale = 5.1; },
    sample => { sample.request.tranches[0].durationText = '0.75年'; },
    sample => { delete sample.request.tranches[0].issueScale; },
    sample => { sample.request.tranches[0].durationText = ''; },
  ]) {
    const sample = fixture(); change(sample);
    assert.equal(parse(sample).canApply, false, String(change));
  }
});

test('older same-plan project scale and tenor do not authorize current-plan alias matching', () => {
  const sample = fixture();
  sample.request.tranches[0].issueScale = 5.1;
  sample.request.tranches[0].durationText = '0.75年';
  sample.request.tranches[1].issueScale = 3;
  sample.request.tranches[1].durationText = '1.75年';
  assert.equal(parse(sample).canApply, false);
});

test('known code and market conflicts still veto an otherwise matching ABS context', () => {
  for (const code of ['273408.SH', '273407.SZ', '999999.SH']) {
    const sample = fixture({ knownCodes: true });
    sample.request.tranches[0].securityCode = code;
    const parsed = parse(sample);
    assert.equal(parsed.canApply, false, code);
    assert.ok(parsed.errors.length > 0);
  }
  const sample = fixture({ knownCodes: true });
  sample.model.items[0].fields.securityCode = cell('273408.SH', '债券代码：273408.SH');
  assert.equal(parse(sample).canApply, false, 'the model cannot borrow sibling code evidence');
});

test('an exact stored ABS name does not require new alias-only scale or tenor checks', () => {
  const sample = fixture({ exactNames: true });
  delete sample.request.project;
  for (const tranche of sample.request.tranches) {
    delete tranche.issueScale; delete tranche.absClassName; tranche.durationText = '';
  }
  assertAccepted(parse(sample));
});

test('the explicit common payment label does not fabricate an undisclosed start date', () => {
  const parsed = parse(fixture({ start: false }));
  assertAccepted(parsed);
  assert.deepEqual(parsed.items.map(row => row.paymentDate), ['2026-11-03', '2026-11-03']);
  assert.deepEqual(parsed.items.map(row => row.startDate), ['', '']);
});

test('a conflicting class-private payment date does not spread a shared date to its sibling', () => {
  const sample = fixture({ start: false });
  const privateDate = '【缴款日期】：2026年11月4日';
  const oldSource = sample.sources[0].source, newSource = `${oldSource}\n${privateDate}`;
  sample.request.text = sample.request.text.replace(oldSource, newSource);
  sample.model.items[0].sourceText = newSource;
  sample.model.items[0].fields.paymentDate = cell('2026年11月4日', privateDate);
  sample.model.items[1].fields.paymentDate = cell(null, '');
  const parsed = parse(sample);
  assert.equal(parsed.items.find(row => row.trancheId === 'selected-0')?.paymentDate, '2026-11-04');
  assert.equal(parsed.items.find(row => row.trancheId === 'selected-1')?.paymentDate, '');
});

test('ABS context is whitelisted in requests and model inputs without exposing bid positions', () => {
  const sample = fixture();
  sample.request.project.secret = 'DO_NOT_SEND_PROJECT_SECRET';
  sample.request.project.bidSubmissions = [{ bidAmount: 8.88 }];
  sample.request.tranches[0].bidRate = 1.45;
  sample.request.tranches[0].winningAmountWan = 5000;
  sample.request.tranches[0].privateSecret = 'DO_NOT_SEND_TRANCHE_SECRET';
  const validated = recognition.validateRecognitionRequest(sample.request);
  assert.deepEqual(validated.project, { instrumentType: 'ABS', planName: PLAN });
  assert.equal(validated.tranches[0].issueScale, 5);
  assert.equal(validated.tranches[0].absClassName, '优先A1级');
  assert.doesNotMatch(JSON.stringify(validated), /DO_NOT_SEND|bidSubmissions|bidRate|winningAmountWan/);
  const input = issuanceModelInput(validated), message = JSON.parse(input.messages.find(row => row.role === 'user').content);
  assert.deepEqual(message.candidates, ['吴租6A1', '吴租6A2'], 'existing candidate label array stays compatible');
  assert.deepEqual(message.project, validated.project);
  assert.ok(Array.isArray(message.candidateDetails));
  const detail = message.candidateDetails.find(row => row.shortName === '吴租6A1');
  assert.equal(detail.issueScale, 5); assert.equal(detail.durationText, '0.98年');
  assert.equal(detail.absClassName, '优先A1级');
  assert.doesNotMatch(JSON.stringify(message), /DO_NOT_SEND|bidSubmissions|bidRate|winningAmountWan/);
});

test('front-end ABS recognition context preserves only existing project tranche identities', () => {
  assert.equal(typeof recognition.issuanceRecognitionContext, 'function');
  const sample = fixture(), project = {
    id: 'project-current', instrumentType: 'ABS', shortName: '吴租6A1/2',
    absInfo: { planName: PLAN, tranches: SPECS.map(row => ({ id: `layer-${row.suffix}`,
      shortName: `吴租6${row.suffix}`, className: `优先${row.suffix}级`, scale: row.amount,
      expectedTerm: row.tenor, selected: row.suffix !== 'A3' })) },
    tranches: sample.request.tranches.map(({ issueScale, absClassName, ...row }) => row),
    bidSubmissions: [{ id: 'submission-preserved' }], notes: 'Do not send this note',
  };
  const before = structuredClone(project), context = recognition.issuanceRecognitionContext(project);
  assert.deepEqual(context.project, { instrumentType: 'ABS', planName: PLAN });
  assert.equal(context.tranches.length, 2);
  assert.deepEqual(context.tranches.map(row => row.id), ['selected-0', 'selected-1']);
  assert.equal(context.tranches[0].issueScale, 5); assert.equal(context.tranches[0].absClassName, '优先A1级');
  assert.equal(context.tranches[1].issueScale, 2.96); assert.equal(context.tranches[1].absClassName, '优先A2级');
  assert.ok(!context.tranches.some(row => /A3/.test(row.shortName)));
  assert.deepEqual(project, before);
  assert.doesNotMatch(JSON.stringify(context), /submission-preserved|Do not send this note/);
});

test('applying recognized ABS terms preserves original IDs, names, unrecognized results and independent projects', () => {
  const sample = fixture(), parsed = parse(sample); assertAccepted(parsed);
  const existing = normalizeProjectRecord({ id: 'project-current', instrumentType: 'ABS', shortName: '吴租6A1/2',
    paymentReceiptRequired: false, notes: '保留原备注', createdAt: '2026-10-29T13:46:27.045Z',
    absInfo: { planName: PLAN, tranches: SPECS.map(row => ({ className: `优先${row.suffix}级`,
      shortName: `吴租6${row.suffix}`, scale: row.amount, selected: row.suffix !== 'A3' })) },
    tranches: [...sample.request.tranches.map((row, index) => ({ ...row, bidLevels: [{ bidRate: index ? 1.55 : 1.45, bidAmount: 0.5 }] })),
      { id: 'unrecognized', shortName: '保留品种', winningRate: 2.1, winningAmountWan: 1200,
        paymentDate: '2026-09-08', paymentCompleted: true }],
  });
  const unrelated = normalizeProjectRecord({ id: 'project-other', shortName: '26其他MTN001', notes: '保留其他项目' });
  const state = { projects: [existing, unrelated] }, before = structuredClone(state);
  const applied = applySemanticIssuanceResult(state.projects[0], parsed, sample.request.text);
  assert.deepEqual(state, before, 'the applier returns a copy and does not mutate any original project');
  assert.deepEqual(applied.tranches.map(row => row.id), existing.tranches.map(row => row.id));
  assert.deepEqual(applied.tranches.map(row => row.shortName), existing.tranches.map(row => row.shortName));
  assert.deepEqual(applied.tranches[2], existing.tranches[2]);
  assert.equal(applied.notes, existing.notes); assert.equal(applied.paymentReceiptRequired, false);
  assert.equal(applied.tranches[0].winningRate, 1.45); assert.equal(applied.tranches[1].winningRate, 1.55);
  assert.equal(applied.tranches[0].issueScale, 5); assert.equal(applied.tranches[1].issueScale, 2.96);
  assert.equal(applied.tranches[0].winningAmountWan, 5000, 'own winning amount comes from its 0.5亿 bid, not the 5亿 issue scale');
  assert.equal(applied.tranches[1].winningAmountWan, 5000);
  assert.equal(applied.tranches.length, 3, 'the unselected notice A3 was never added');
});

test('cropping the unselected ABS class code cannot authorize mixed A1/A3 source evidence', () => {
  for (const padding of [0, 8, 20]) {
    const a = '【吴都6A1】\n票面利率：1.45%\n债券代码：273407.SH' + '\n其他说明'.repeat(padding);
    const other = '【吴都6A3】\n票面利率：1.70%\n债券代码：273409.SH';
    const text = `${a}\n\n${other}`;
    const request = recognition.validateRecognitionRequest({ text, noticeDate: '2026-10-30',
      tranches: [{ id: 'a', shortName: '吴都6A1', securityCode: '273407.SH' }] });
    // The original remains unchanged; the model merely crops before the A3 code.
    const sourceText = text.slice(0, text.indexOf('债券代码：273409.SH'));
    const model = { items: [{ shortName: '吴都6A1', sourceText, outcome: 'issued', fields: {
      securityCode: cell('273407.SH', '债券代码：273407.SH'),
      couponRate: cell('1.70%', '票面利率：1.70%'),
    } }] };
    const parsed = recognition.validateSemanticResult(request, model);
    assert.equal(parsed.canApply, false, `A1 cannot take A3 coupon when source has ${padding} extra lines`);
  }
});

test('a cropped quote or shared label cannot move an A3-private coupon into either selected class', () => {
  for (const sharedForm of ['cropped', 'whole-block']) for (const targetIndex of [0, 1]) {
    const sample = fixture({ exactNames: true });
    const privateQuote = '两个品种票面均1.70%';
    sample.request.text = sample.request.text.replace('票面利率：1.70%', privateQuote);
    const otherBlock = sample.sources[2].source.replace('票面利率：1.70%', privateQuote);
    sample.model.sharedEvidence.push(sharedForm === 'cropped' ? privateQuote : otherBlock);
    sample.model.items[targetIndex].fields.couponRate = cell('1.70%', privateQuote);
    const parsed = parse(sample);
    assert.equal(parsed.canApply, false, `${sharedForm}/${targetIndex}`);
    assert.notEqual(parsed.items.find(row => row.trancheId === `selected-${targetIndex}`)?.couponRate, 1.7, `${sharedForm}/${targetIndex}`);
  }
});

test('an ABS heading for another class or issue cannot become the selected class merely by reusing its code', () => {
  for (const name of ['吴都6A3', '吴都7A1']) {
    const sourceText = `【${name}】\n票面利率：1.70%\n债券简称：${name}\n债券代码：273407.SH`;
    const request = recognition.validateRecognitionRequest({ text: sourceText, noticeDate: '2026-10-30',
      tranches: [{ id: 'a', shortName: '吴都6A1', securityCode: '273407.SH' }] });
    const parsed = recognition.validateSemanticResult(request, { items: [{ shortName: '吴都6A1',
      sourceText, outcome: 'issued', fields: {
        securityCode: cell('273407.SH', '债券代码：273407.SH'), couponRate: cell('1.70%', '票面利率：1.70%'),
      } }] });
    assert.equal(parsed.canApply, false, name);
  }
});

test('an unselected A3 private closing date does not become a common payment or start date', () => {
  for (const [footer, field] of [
    ['吴都6A3于2026年11月3日缴款', 'paymentDate'], ['A3于2026年11月3日缴款', 'paymentDate'],
    ['吴都6A3起息日期：2026年11月3日', 'startDate'], ['A3起息日期：2026年11月3日', 'startDate'],
  ]) for (const quoted of [false, true]) {
    const sample = fixture({ exactNames: true, start: false });
    sample.request.text = sample.request.text.replace(PAYMENT, footer);
    sample.model.sharedEvidence = [footer];
    for (const item of sample.model.items) {
      item.fields.paymentDate = cell(null, '');
      if (quoted) item.fields[field] = cell('2026年11月3日', footer);
    }
    const parsed = parse(sample);
    assert.deepEqual(parsed.items.map(item => item[field]), ['', ''], `${footer}, quoted=${quoted}`);
    assert.equal(parsed.canApply, !quoted, `${footer}, quoted=${quoted}`);
  }
});
