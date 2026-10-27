import assert from 'node:assert/strict';
import test from 'node:test';
import {validateProjectIntake,projectIntakeMessages,projectIntakeCutoff} from '../project-intake-ai.js';
const text='请支持26示例MTN001，发行人为示例有限公司；广州分行联动。发行规模50000万元，期限3+2年，询价区间1.3%至1.9%，市场估值1.62%。银行间公募，主承销商兴业银行，我行联席。截标2026年10月30日17:00。';
const field=(raw,evidence)=>({raw,evidence});
const output=()=>({projects:[{sourceText:text,fields:{
 shortName:field('26示例MTN001','请支持26示例MTN001'),issuerName:field('示例有限公司','发行人为示例有限公司'),
 branch:field('广州分行','广州分行联动'),issueScale:field('50000万元','发行规模50000万元'),durationText:field('3+2年','期限3+2年'),
 inquiryRange:field('1.3%至1.9%','询价区间1.3%至1.9%'),marketValuation:field('1.62%','市场估值1.62%'),
 venue:field('银行间','银行间公募'),offeringType:field('公募','银行间公募'),leadUnderwriter:field('兴业银行','主承销商兴业银行'),
 sponsorStatus:field('我行联席','我行联席'),cutoffAt:field('2026年10月30日17:00','截标2026年10月30日17:00')},tranches:[]}],warnings:[]});
test('semantic intake preserves literal evidence and normalizes units, dates and call structure',()=>{
 const draft=validateProjectIntake(text,output()).projects[0];
 assert.equal(draft.patch.shortName,'26示例MTN001');assert.equal(draft.patch.issueScale,5);assert.equal(draft.patch.durationText,'3+2年');
 assert.equal(draft.patch.valuation,1.62);assert.equal(draft.patch.inquiryLow,1.3);assert.equal(draft.patch.inquiryHigh,1.9);
 assert.equal(draft.patch.cutoffAt,'2026-10-30T17:00');assert.equal(draft.patch.offeringType,'公募');assert.equal(draft.patch.sponsorStatus,'联席');
 assert.equal(draft.sourceText,text);assert.ok(projectIntakeMessages(text)[0].content.includes('不能'));
});
test('intake rejects invented literals, cross-project field borrowing and unsupported keys',()=>{
 const guessed=output();guessed.projects[0].fields.shortName.raw='26示例SCP001';assert.throws(()=>validateProjectIntake(text,guessed),/依据/);
 const crossed=output();crossed.projects[0].sourceText='请支持26示例MTN001';assert.throws(()=>validateProjectIntake(text,crossed),/依据/);
 const extra=output();extra.projects[0].fields.securityCode=field('12345','12345');assert.throws(()=>validateProjectIntake(text,extra),/结构/);
});
test('ambiguous scale, valuation labels and incomplete cutoff dates stay empty with warnings',()=>{
 const material='26示例MTN001，规模50000，票面1.62%，截标10月30日17:00。';
 const result=validateProjectIntake(material,{projects:[{sourceText:material,fields:{shortName:field('26示例MTN001','26示例MTN001'),
 issueScale:field('50000','规模50000'),marketValuation:field('1.62%','票面1.62%'),cutoffAt:field('10月30日17:00','截标10月30日17:00')},tranches:[]}],warnings:[]}).projects[0];
 assert.equal(result.patch.issueScale,undefined);assert.equal(result.patch.valuation,null);assert.equal(result.patch.cutoffAt,undefined);assert.equal(result.warnings.length,3);
});
test('each tranche keeps its own term, quote range and valuation',()=>{
 const a='26示例MTN001A，期限3年，询价区间1.3-1.6，估值1.5%。',b='26示例MTN001B，期限5年，询价区间1.5-1.9，估值1.7%。',source=a+b;
 const result=validateProjectIntake(source,{projects:[{sourceText:source,fields:{shortName:field('26示例MTN001A',a)},tranches:[
 {sourceText:a,fields:{shortName:field('26示例MTN001A',a),durationText:field('3年',a),inquiryRange:field('1.3-1.6',a),marketValuation:field('1.5%',a)}},
 {sourceText:b,fields:{shortName:field('26示例MTN001B',b),durationText:field('5年',b),inquiryRange:field('1.5-1.9',b),marketValuation:field('1.7%',b)}},
 ]}],warnings:[]}).projects[0];
 assert.deepEqual(result.patch.shortNames,['26示例MTN001A','26示例MTN001B']);assert.deepEqual(result.patch.valuations,[1.5,1.7]);
 assert.deepEqual(result.patch.inquiryRanges,[{low:1.3,high:1.6},{low:1.5,high:1.9}]);
});

test('a missing tranche field keeps its position and never inherits its neighbor',()=>{
 const a='26示例MTN001A，估值1.5%。',b='26示例MTN001B，期限5年，询价区间1.5-1.9。',source=a+b;
 const result=validateProjectIntake(source,{projects:[{sourceText:source,fields:{shortName:field('26示例MTN001A',a)},tranches:[
  {sourceText:a,fields:{shortName:field('26示例MTN001A',a),marketValuation:field('1.5%',a)}},
  {sourceText:b,fields:{shortName:field('26示例MTN001B',b),durationText:field('5年',b),inquiryRange:field('1.5-1.9',b)}},
 ]}],warnings:[]}).projects[0];
 assert.deepEqual(result.patch.durationParts,['','5年']);assert.deepEqual(result.patch.valuations,[1.5,null]);
 assert.deepEqual(result.patch.inquiryRanges,[{low:null,high:null},{low:1.5,high:1.9}]);
});

test('overlapping tranche excerpts cannot borrow another tranche term',()=>{
 const a='26示例MTN001A，期限3年。',b='26示例MTN001B，期限5年。',source=a+b;
 assert.throws(()=>validateProjectIntake(source,{projects:[{sourceText:source,fields:{},tranches:[
  {sourceText:source,fields:{shortName:field('26示例MTN001A',a),durationText:field('5年',b)}},
  {sourceText:b,fields:{shortName:field('26示例MTN001B',b),durationText:field('5年',b)}},
 ]}],warnings:[]}),/混合|重叠/);
});
test('another bank lead role is never converted into our own lead or joint role',()=>{
 for(const role of ['牵头','联席']){
  const source=`26示例MTN001，甲银行${role}。`;
  const draft=validateProjectIntake(source,{projects:[{sourceText:source,fields:{shortName:field('26示例MTN001','26示例MTN001'),sponsorStatus:field(role,`甲银行${role}`)},tranches:[]}],warnings:[]}).projects[0];
  assert.equal(draft.patch.sponsorStatus,undefined);assert.equal(draft.warnings.length,1);
 }
});
test('verified intake cutoff is retained without overriding existing projects or explicit day choices',()=>{
 const project={shortName:'26示例MTN001',intakeCutoff:{shortName:'26示例MTN001',at:'2026-10-30T17:00'}};
 assert.equal(projectIntakeCutoff(project).cutoffAt,'2026-10-30T17:00');
 assert.equal(projectIntakeCutoff(project,{dayMode:'today'}),null);
 assert.equal(projectIntakeCutoff(project,{existingProject:{cutoffAt:'2026-10-31T18:00'}}),null);
 assert.equal(projectIntakeCutoff({...project,shortName:'26其他MTN001'}),null);
});
test('asset-backed notes retain their separate instrument and approval flow',()=>{
 const source='26示例ABN001，资产支持票据发行规模5亿元。';
 const result=validateProjectIntake(source,{projects:[{sourceText:source,fields:{shortName:field('26示例ABN001',source),issueScale:field('5亿元',source)},tranches:[]}],warnings:[]}).projects[0];
 assert.equal(result.patch.instrumentType,'ABN');assert.match(result.warnings.join(''),/授信/);
});
