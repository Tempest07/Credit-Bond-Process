import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticCases } from './fixtures/issuance-semantic-cases.js';
import { ISSUANCE_FIELDS, validateRecognitionRequest, validateSemanticResult } from '../issuance-recognition.js';

const cell = (raw, evidence = raw) => ({ raw, evidence });
const fields = values => Object.fromEntries(Object.keys(ISSUANCE_FIELDS).map(name => [name, values[name] || cell(null, '')]));
function oldModel(sample, dates) {
  const metric = sample.id === 'metric-first', lines = sample.text.split('\n');
  const specs = metric ? [
    ['102683475','1.59%','边际1.59%','3.86倍','全场3.86倍','2.86倍','边际2.86倍','3年'],
    ['102683476','1.70%','边际1.70%','3.26倍','全场3.26倍','1倍','边际1倍','5年'],
  ] : [
    ['102682949','1.7%','最终结果1.7%','3.1倍','全场3.1倍','1','边际倍数1'],
    ['102682950','2.46%','最终结果2.46%','1.47倍','全场1.47倍','1.4','边际倍数1.4'],
  ];
  const dateEvidence = metric ? '明天缴款' : '明日配售缴款';
  return { sharedEvidence: dates ? [dateEvidence] : [], items: specs.map((row, index) => ({
    shortName: sample.tranches[index].shortName, sourceText: lines[index + (metric ? 1 : 0)], outcome: 'issued', outcomeEvidence: '',
    fields: fields({ securityCode: cell(row[0]), couponRate: cell(row[1],row[2]),
      fullMarketMultiple: cell(row[3],row[4]), marginalMultiple: cell(row[5],row[6]),
      ...(metric ? { issueScale: cell('5.00亿'), durationText: cell(row[7]) } : {}),
      ...(dates ? { paymentDate: cell(metric ? '明天' : '明日',dateEvidence) } : {}) }),
  })) };
}

for (const id of ['metric-first','final-result']) for (const dates of ['quoted','omitted','quoted-without-shared']) {
  test(`${id}: original closing payment date applies to both varieties when model date is ${dates}`, () => {
    const sample = semanticCases.find(value => value.id === id);
    const model=oldModel(sample, dates !== 'omitted');
    if(dates==='quoted-without-shared')model.sharedEvidence=[];
    const result = validateSemanticResult(validateRecognitionRequest(sample), model);
    assert.equal(result.canApply,true,JSON.stringify(result.errors));
    assert.deepEqual(result.items.map(item => item.paymentDate), sample.expected.map(item => item.paymentDate));
    for (const item of result.items) assert.ok(sample.text.includes(item.evidence.paymentDate));
    assert.deepEqual(result.items.map(item => item.couponRate),sample.expected.map(item => item.couponRate));
  });
}

const names = ['26验收甲MTN001A','26验收甲MTN001B'];
function fixture(footer = '明日配售缴款。', { extra = '', noticeDate = '2026-10-27', rows } = {}) {
  rows ||= names.map((name,index) => `${name}，实际发行${index + 3}亿元，票面${index ? '1.80' : '1.60'}%。`);
  const text = [...rows,extra,footer].filter(Boolean).join('\n');
  const request = validateRecognitionRequest({text,noticeDate,tranches:names.map((shortName,index) => ({id:String(index),shortName}))});
  const model = {sharedEvidence:[],items:rows.map((sourceText,index)=>({shortName:names[index],sourceText,outcome:'issued',outcomeEvidence:'',
    fields:fields({couponRate:cell(index?'1.80%':'1.60%',`票面${index?'1.80%':'1.60%'}`),issueScale:cell(`${index+3}亿元`,`实际发行${index+3}亿元`)})}))};
  return {request,model};
}

test('an absolute closing date and an explicitly scoped same day agree after normalization', () => {
  const {request,model}=fixture('2026年10月28日缴款。',{rows:[`${names[0]}，实际发行3亿元，票面1.60%，2026年10月28日缴款。`,`${names[1]}，实际发行4亿元，票面1.80%。`]});
  const result=validateSemanticResult(request,model);
  assert.deepEqual(result.items.map(item=>item.paymentDate),['2026-10-28','2026-10-28']);
});

test('a complete three-variety notice can use one original closing payment arrangement', () => {
  const {request,model}=fixture('明日缴款。');
  const third='26验收甲MTN001C', row=`${third}，实际发行5亿元，票面1.90%。`;
  request.text=request.text.replace('\n明日缴款。',`\n${row}\n明日缴款。`);
  request.tranches.push({id:'2',shortName:third,securityCode:'',durationText:''});
  model.items.push({shortName:third,sourceText:row,outcome:'issued',outcomeEvidence:'',fields:fields({couponRate:cell('1.90%','票面1.90%'),issueScale:cell('5亿元','实际发行5亿元')})});
  const result=validateSemanticResult(request,model);
  assert.equal(result.canApply,true,JSON.stringify(result.errors));
  assert.deepEqual(result.items.map(item=>item.paymentDate),['2026-10-28','2026-10-28','2026-10-28']);
});

test('inferred footer evidence retains the original whitespace and punctuation', () => {
  const footer='明日 配售 缴款！';
  const {request,model}=fixture(footer);
  const result=validateSemanticResult(request,model);
  assert.equal(result.canApply,true);
  for(const item of result.items){assert.equal(item.paymentDate,'2026-10-28');assert.equal(item.evidence.paymentDate,footer);}
});

test('a B-only date never becomes an A payment date', () => {
  for(const footer of ['B于2026年10月28日缴款。',`${names[1]}于明日缴款。`,'长端明日缴款。','本品种明日配售缴款。','仅B品种明日缴款。','分别于明日缴款。']){
    const {request,model}=fixture(footer);model.sharedEvidence=[footer];
    model.items[0].fields.paymentDate=cell(footer.includes('2026')?'2026年10月28日':'明日',footer);
    const result=validateSemanticResult(request,model);
    assert.equal(result.items[0].paymentDate,'',footer);
    assert.equal(result.canApply,false,footer);
  }
});

test('conflicting private dates prevent a later unscoped date from spreading to other varieties', () => {
  const {request,model}=fixture('明日缴款。',{rows:[`${names[0]}，实际发行3亿元，票面1.60%，2026年10月29日缴款。`,`${names[1]}，实际发行4亿元，票面1.80%。`]});
  const result=validateSemanticResult(request,model);
  assert.equal(result.items[1].paymentDate,'');
  model.sharedEvidence=['明日缴款。'];model.items[1].fields.paymentDate=cell('明日','明日缴款');
  assert.equal(validateSemanticResult(request,model).canApply,false);
});

test('a correct explicit private date survives a conflicting closing payment arrangement', () => {
  const {request,model}=fixture('明日10月28日缴款。',{rows:[`${names[0]}，实际发行3亿元，票面1.60%，2026年10月29日缴款。`,`${names[1]}，实际发行4亿元，票面1.80%。`]});
  model.items[0].fields.paymentDate=cell('2026年10月29日','2026年10月29日缴款');
  const result=validateSemanticResult(request,model);
  assert.equal(result.canApply,true,JSON.stringify(result.errors));
  assert.deepEqual(result.items.map(item=>item.paymentDate),['2026-10-29','']);
  assert.equal(result.items[0].evidence.paymentDate,'2026年10月29日缴款');
  assert.ok(result.warnings.some(warning=>warning.startsWith(names[1])&&warning.includes('未识别出明确缴款日')));
});

test('an unresolved date elsewhere vetoes shared inference without erasing a valid private date', () => {
  const {request,model}=fixture('明日配售缴款。',{rows:[`${names[0]}，实际发行3亿元，票面1.60%，2026年10月29日缴款。`,`${names[1]}，实际发行4亿元，票面1.80%。`]});
  request.text='参考安排：明日10月30日缴款。\n'+request.text;
  model.items[0].fields.paymentDate=cell('2026年10月29日','2026年10月29日缴款');
  const result=validateSemanticResult(request,model);
  assert.equal(result.canApply,true,JSON.stringify(result.errors));
  assert.deepEqual(result.items.map(item=>item.paymentDate),['2026-10-29','']);
});

test('unknown bonds, unowned codes and missing varieties block inferred common payment dates', () => {
  for(const extra of ['26验收乙MTN002，票面1.70%。','债券代码102699999。']){
    const {request,model}=fixture('明日缴款。',{extra});
    assert.deepEqual(validateSemanticResult(request,model).items.map(item=>item.paymentDate),['','']);
  }
  const {request,model}=fixture('明日缴款。');
  request.tranches.push({id:'2',shortName:'26验收甲MTN001C',securityCode:'',durationText:''});
  assert.deepEqual(validateSemanticResult(request,model).items.map(item=>item.paymentDate),['','']);
});

test('private labels between results and an unscoped closing date retain the ambiguity', () => {
  for(const extra of ['B品种安排如下：','本品种后续安排如下：','长端安排如下：','仅以下品种适用：','分别安排如下：']){
    const {request,model}=fixture('明日缴款。',{extra});
    assert.deepEqual(validateSemanticResult(request,model).items.map(item=>item.paymentDate),['',''],extra);
  }
});

test('relative closing dates without a notice date fail rather than use the machine date', () => {
  for(const quoted of [false,true]){
    const {request,model}=fixture('明日配售缴款。',{noticeDate:''});
    if(quoted){model.sharedEvidence=['明日配售缴款。'];for(const item of model.items)item.fields.paymentDate=cell('明日','明日配售缴款');}
    const result=validateSemanticResult(request,model);
    assert.equal(result.canApply,false);
    assert.deepEqual(result.items.map(item=>item.paymentDate),['','']);
  }
});

test('payment footer inference cannot authorize common coupon, scale or start dates', () => {
  const footer='票面1.70%，发行规模5亿元，明日配售缴款。';
  for(const [field,value,evidence] of [['couponRate','1.70%','票面1.70%'],['issueScale','5亿元','发行规模5亿元'],['startDate','明日','明日配售缴款']]){
    const {request,model}=fixture(footer);model.sharedEvidence=[footer];model.items[0].fields[field]=cell(value,evidence);
    const result=validateSemanticResult(request,model);
    assert.equal(result.canApply,false,field);
    assert.equal(result.items[0][field],field==='startDate'?'':null,field);
    assert.deepEqual(result.items.map(item=>item.paymentDate),['2026-10-28','2026-10-28']);
  }
});

test('invented date evidence remains invalid even beside a genuine common footer', () => {
  const {request,model}=fixture('明日缴款。');
  model.sharedEvidence=['后天缴款。'];model.items[0].fields.paymentDate=cell('后天','后天缴款');
  const result=validateSemanticResult(request,model);
  assert.equal(result.canApply,false);
  assert.ok(result.errors.some(error=>error.includes('摘录与原文不符')));
});

test('cancelled or reallocated varieties do not inherit a common payment date', () => {
  for(const outcome of ['cancelled','reallocated']){
    const prefix=outcome==='cancelled'?'取消发行':'全部回拨至B';
    const {request,model}=fixture('明日缴款。',{rows:[`${names[0]}，${prefix}。`,`${names[1]}，实际发行4亿元，票面1.80%。`]});
    model.items[0]={...model.items[0],outcome,outcomeEvidence:prefix,fields:fields({})};
    const result=validateSemanticResult(request,model);
    assert.equal(result.items[0].paymentDate,'');
    assert.equal(result.items[1].paymentDate,'2026-10-28');
  }
});
