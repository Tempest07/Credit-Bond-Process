import test from 'node:test';
import assert from 'node:assert/strict';
import {answerViewModels} from '../inventory-qa/answer-view-data.js';
import {buildTradeMatrix} from '../tools/trade-matrix.mjs';
import {buildMemberReport} from '../tools/inventory-member-analysis.mjs';

const number = (key,label,unit) => ({kind:'number',key,label,unit});
const cat = (key,label) => ({kind:'category',key,label});
function display(report, data={}, question='', source='inventory') {
  return answerViewModels({question,answer:{steps:[{source,data}],ledgerReport:report}});
}

test('monthly chart and table share a short lead in requested units while retaining peak and gap information',()=>{
  const spec={layout:'monthsRows',metrics:['buy'],shares:false,compare:'none',question:'哪月最高？'};
  const series=[{label:'甲账户',start:'2025-01-01',end:'2025-02-28',sources:[],notes:[],total:{buy:3e10},
    cells:[{month:'2025-01',buy:1e10},{month:'2025-02',buy:2e10}]}];
  const report=buildTradeMatrix(spec,series);
  const models=display(report,{flowMatrixSpec:{...spec,series}},'请用万元显示月度走势，保留两位小数','trade');
  assert.equal(models.length,2);
  for(const m of models) {
    assert.deepEqual(m.displayLead.metrics,[{label:'期间买入本金',unit:'万元',value:30000,digits:2}]);
    assert.equal(m.displayLead.notes[0],'甲账户买入本金最高为 2025-02，20,000.00 万元。');
    assert.match(m.answer,/甲账户（2025-01-01/);
  }
  series[0].cells[1].buy=null;
  series[0].total.buy=null;
  const missing=buildTradeMatrix(spec,series);
  const [chart,table]=display(missing,{flowMatrixSpec:{...spec,series}},'月度走势','trade');
  assert.deepEqual(chart.displayLead.metrics,[]);
  assert.match(chart.result.note,/2025-02/);
  assert.match(table.displayLead.notes.join(' '),/已核月份内/);
  assert.match(table.displayLead.notes.join(' '),/待核/);
});

test('period delta retains negative sign, true zero and unknown instead of treating missing sales as zero',()=>{
  const spec={layout:'periodRows',metrics:['buy','sell','rows'],shares:false,compare:'difference'};
  const series=[['甲组',2e10,null,3],['乙组',5e10,2e10,3]].map(([label,buy,sell,rows],i)=>({
    label,start:'2025-0'+(i+1)+'-01',end:'2025-0'+(i+1)+'-02',sources:[],notes:[],cells:[{month:'月份',buy,sell,rows}],total:{buy,sell,rows},
  }));
  const report=buildTradeMatrix(spec,series);
  const [m]=display(report,{flowMatrixSpec:{...spec,series}},'以万元显示','trade');
  assert.equal(m.displayLead.title,'甲组 减 乙组');
  assert.deepEqual(m.displayLead.metrics.map(x=>[x.label,x.value,x.unit]),[
    ['买入本金差额',-30000,'万元'],['卖出本金差额','待核',''],['交易笔数差额',0,'笔']]);
  assert.match(m.displayLead.notes.join(' '),/2025-01-01 至 2025-01-02/);
  assert.match(m.displayLead.notes.join(' '),/待核/);
  const changed={...report,summary:'还有一项未核。'+report.summary};
  assert.equal(display(changed,{flowMatrixSpec:{...spec,series}},'','trade')[0].displayLead,undefined);
});

test('rank ties and the cutoff gap remain visible when the first sentence becomes a figure',()=>{
  const report={title:'具名发行人本金排名',columns:[cat('name','发行人'),number('rank','名次','名'),number('principal','本金','亿元')],
    rows:[{name:'样例甲',rank:1,principal:2},{name:'样例乙',rank:1,principal:2},{name:'样例丙',rank:3,principal:1}],
    summary:'具名发行人本金前 3 名中，第一名为样例甲、样例乙，本金 2 亿元。第 1 名与第 3 名的差额为 1 亿元。',note:'仅纳入当前筛选范围。'};
  const [m]=display(report,{profileSpec:{stat:'ranking',limit:3}},'请用万元显示');
  assert.equal(m.displayLead.title,'2 个发行人并列第 1 名');
  assert.equal(m.displayLead.metrics[0].value,20000);
  assert.match(m.displayLead.notes[0],/10,000 万元/);
  assert.equal(m.result.note,report.note);
  assert.equal(m.displayLead.foldNote,false);
});

test('snapshot lead pins the old version, distinguishes source and filtered counts, and retains contextual answers',()=>{
  const sourceEvidence={id:'fixture-original',active:false,date:'2025-02-20',file:'样例.xlsx',sheet:'持仓',uploadedBy:'样例账号'};
  const report={title:'来源与原表持仓样例',columns:[number('principal','名义本金','元')],rows:[{principal:1}],
    summary:'原表共 8 条持仓；本次筛选有 2 条，本金 3.5 亿元。 本对话锁定 2025-02-20 的《样例.xlsx》，工作表“持仓”，快照版本 fixture-original。该日已发布了其他版本，旧对话和下载继续使用此处锁定的版本。',
    note:'同一台账空间使用共同发布的版本。该版本上传账号为 样例账号。 下载中的“来源与口径”记录同一文件、业务日和快照版本。'};
  const data={snapshot:{...sourceEvidence,rowCount:8},sourceEvidence,rowCount:2,totalCents:35e9};
  const [m]=display(report,data,'注明业务日期，用万元显示。');
  assert.deepEqual(m.displayLead.metrics.map(x=>x.value),[35000,2,8]);
  assert.match(m.displayLead.notes.join(' '),/已锁定旧版/);
  assert.match(m.displayLead.notes.join(' '),/共享台账/);
  assert.match(m.displayLead.notes.join(' '),/上传账号 样例账号/);
  assert.match(m.answer,/fixture-original/);
  const unverified={...data,sourceEvidence:{...sourceEvidence,id:'another-version'}};
  assert.equal(display(report,unverified)[0].displayLead,undefined);
});

test('full common-member totals survive a truncated saved preview',()=>{
  const fixture=(date,amounts)=>({snapshot:{date,filename:'示例.xlsx'},plan:{filters:{}},totalCents:amounts.reduce((a,n)=>a+n,0)*1e10,
    rowCount:amounts.length,groups:amounts.map((n,i)=>({name:'样例'+i,count:1,cents:n*1e10,securityCount:1}))});
  const report=buildMemberReport({analysisMode:'commonMovers',field:'issuer',limit:2},[
    fixture('2025-01-01',[1,3,2,4]),fixture('2025-02-01',[2,5,1,1])]);
  const [m]=display(report);
  assert.deepEqual(m.displayLead.metrics.map(x=>x.value),['10','9','-1']);
  assert.deepEqual(m.displayLead.notes,['增加 2 个，减少 2 个。']);
  const [preview]=display({...report,rows:report.rows.slice(0,1)});
  assert.deepEqual(preview.displayLead.metrics,m.displayLead.metrics);
  assert.match(preview.displayLead.notes[0],/减少榜/);
});

test('ratio table retains additional unsummarised calculations and never invents a percent from a zero denominator',()=>{
  const report={title:'占比与分母对照',summary:'样例甲：1 亿元。范围乙：2 亿元。范围丙：4 亿元。样例甲 占 范围乙 的 50%。 样例甲 占 范围丙 的 25%。',
    columns:[cat('numerator','分子范围'),number('top','分子','亿元'),cat('denominator','分母范围'),number('bottom','分母','亿元'),number('ratio','占比','%')],
    rows:[{numerator:'样例甲',top:1,denominator:'范围乙',bottom:2,ratio:50},{numerator:'样例甲',top:1,denominator:'范围丙',bottom:4,ratio:25}]};
  assert.deepEqual(display(report)[0].displayLead.metrics.map(x=>x.value),[50,25]);
  assert.equal(display({...report,summary:report.summary+'另计差额 1 亿元。'})[0].displayLead,undefined);
  assert.equal(display({...report,rows:[report.rows[0],{...report.rows[1],ratio:null,bottom:0}]})[0].displayLead,undefined);
});

test('partial reconciliation exposes the covered period and precisely identifies the missing days',()=>{
  const change='2025-01-01 至 2025-02-04',covered='2025-01-02 至 2025-01-31';
  const report={title:'余额变动与已覆盖的买卖流水',columns:[cat('item','项目'),cat('period','期间'),number('amount','本金','亿元')],rows:[
    {item:'余额变动',period:change,amount:1},{item:'已覆盖的净买入',period:covered,amount:-2},{item:'完整期间对账差额',amount:null}],
    summary:'样例账户 在 '+change+' 的余额变动为 1 亿元。'+covered+' 可核净买入 -2 亿元。2025-02-01 至 2025-02-04 的买卖流水尚未覆盖，完整期间净买入及对账差额待核。'};
  const [m]=display(report);
  assert.deepEqual(m.displayLead.metrics.map(x=>x.value),[1,-2]);
  assert.match(m.displayLead.notes[0],/2025-01-31/);
  assert.match(m.displayLead.notes[1],/2025-02-01 至 2025-02-04/);
  assert.equal(m.result.rows.at(-1).amount,null);
});

test('a second saved flow report compares two of the months shown in the primary net row',()=>{
  const periods=[1,2,3].map((month,i)=>{
    const value=[-1e10,2e10,null][i];
    return {label:month+'月',start:'2025-0'+month+'-01',end:'2025-0'+month+'-02',sources:[],notes:[],
      cells:[{month:'2025-0'+month,net:value}],total:{net:value}};
  });
  const spec={series:periods,metrics:['net'],layout:'periodRows',shares:false,compare:'none'};
  const compare={...spec,series:[periods[2],periods[1]],compare:'difference'};
  const primary=buildTradeMatrix(spec,periods), secondary=buildTradeMatrix(compare,compare.series);
  const steps=[{source:'trade',data:{flowMatrixSpec:spec}},{source:'trade',data:{flowMatrixSpec:compare,ledgerReport:secondary}}];
  const [m]=answerViewModels({question:'三个月各自的净买入是多少，后两个月差多少？',answer:{ledgerReport:primary,steps}});
  assert.match(m.displayLead.title,/3月 减 2月.*待核/);
  assert.deepEqual(m.displayLead.metrics.map(x=>x.value),[-1,2,'待核']);
});

test('both independent ranks and the fixed list show their own percentages before member details',()=>{
  const ranges=['2025-01-02 示例范围','2025-02-02 示例范围'];
  const rows=[[0,0,25],[1,1,30],[0,1,20]].map(([rank,date,ratio])=>({
    basis:ranges[rank]+' 前 2 名',period:ranges[date],members:rank?'样例乙、样例丙':'样例甲、样例乙',ratio,
  }));
  const report={title:'当期前列与固定名单的占比',rows,columns:[cat('basis','名单'),cat('period','计量日'),cat('members','成员'),number('ratio','占比','%')],
    summary:rows.map(r=>r.basis+' 在 '+r.period+' 占 '+r.ratio.toFixed(6)+'%').join('；')+'。当期新进：样例丙；掉出：样例甲。'};
  const [m]=display(report);
  assert.deepEqual(m.displayLead.metrics.map(x=>x.value),[25,30,20]);
  assert.equal(m.displayLead.metrics[2].label,'首期名单 · '+ranges[1]);
  assert.deepEqual(m.displayLead.notes,[]);
  assert.match(display(report,{},'谁进榜，谁掉出？')[0].displayLead.notes[0],/样例甲/);
});

test('group breakdown pairs each parent with its leading named child and gives missing amounts for every parent',()=>{
  const rows=[{name:'样例甲',child:'甲地',principal:3},{name:'样例甲',child:'未填写',principal:1},
    {name:'样例乙',child:'乙地',principal:2},{name:'样例乙',child:'丙地',principal:2}];
  const report={title:'按发行人核对持仓',columns:[cat('name','发行人'),cat('child','联动分行'),number('principal','本金','亿元')],rows,
    summary:'按本金选取前 2 个具名发行人，再按联动分行拆分。样例甲：首位 甲地各 3 亿元，未填写联动分行 1 亿元；样例乙：首位 乙地、丙地各 2 亿元，未填写联动分行 0 亿元'};
  const [m]=display(report,{profileSpec:{stat:'breakdown',limit:2}});
  assert.deepEqual(m.displayLead.metrics.map(x=>[x.label,x.value]),[['样例甲 · 甲地',3],['样例乙 · 乙地、丙地',2]]);
  assert.match(m.displayLead.notes[0],/样例甲 1 亿元、样例乙 0 亿元/);
  assert.equal(m.result.rows.length,4);
});
