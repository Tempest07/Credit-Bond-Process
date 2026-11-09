import test from 'node:test';
import assert from 'node:assert/strict';
import {planFlowQuestion} from '../tools/flow-planner.mjs';

const ledgers=['buy','sell'].map(direction=>({year:2026,direction,start:'2026-01-05',end:'2026-10-30',
  headers:['发行人全称','会计分类','交易组合','债券简称','联动分行','债券代码','交易日期']}));
const base={kind:'plan',direction:'both',start:'2026-01-01',end:'2026-10-31',filters:[],groupBy:['发行人全称'],metric:'net',limit:null,order:'desc',selections:[]};
function mock(resolve) {
  let calls=0;
  return async (url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(request.body);
    assert.equal(body.store,false);
    assert.equal(body.reasoning.effort,'high');
    const decision=resolve(JSON.parse(body.input),calls++);
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision})}]}]});
  };
}
test('交易查询先取真实入选发行人，再在同一答案按会计科目拆分，不向模型发送本金',async()=>{
  const groups=[{values:['甲股份有限公司'],netCents:817000011},{values:['乙股份有限公司'],netCents:194000011}];
  const result=await planFlowQuestion({question:'净增持最大的两家按会计科目拆分',ledgers,apiKey:'test',
    runQuery:async p=>{assert.deepEqual(p.groupBy,['发行人全称']);assert.equal(p.limit,2);return {groups,groupCount:7};},
    fetchImpl:mock((input,turn)=>{
      if (!turn) return {...base,kind:'probe',limit:2};
      assert.equal(JSON.stringify(input).includes('817000011'),false);
      assert.deepEqual(input.sets.probe1.choices[1].values,['乙股份有限公司']);
      return {...base,groupBy:['发行人全称','会计分类'],selections:[{source:'probe1',field:'发行人全称',indices:[]}]};
    })});
  assert.deepEqual(result.plan.filters,[{field:'发行人全称',op:'in',value:['甲股份有限公司','乙股份有限公司']}]);
});
test('可以按上轮真实名次追问，保留本地投组筛选和上期范围',async()=>{
  const previousPlan={...base,filters:[{field:'交易组合',op:'eq',value:'内部组合X'}],limit:3};
  const result=await planFlowQuestion({question:'第二家分券看',ledgers,apiKey:'test',previousPlan,previousGroups:[{values:['甲集团']},{values:['乙集团']}],
    fetchImpl:mock(input=>{
      assert.equal(JSON.stringify(input).includes('内部组合X'),false);
      return {...base,filters:input.previous.plan.filters,groupBy:['债券代码'],selections:[{source:'previous',field:'发行人全称',indices:[2]}]};
    })});
  assert.deepEqual(result.plan.filters,[previousPlan.filters[0],{field:'发行人全称',op:'in',value:['乙集团']}]);
});
test('字段不存在、单边冒充净额或臆测机构时反馈给模型，不能执行错误本金查询',async()=>{
  const result=await planFlowQuestion({question:'今年海运的净增持?',ledgers,apiKey:'test',
    fetchImpl:mock((input,turn)=>{
      if (turn===0) return {...base,groupBy:['错别字']};
      if (turn===1) {assert.match(input.feedback,/字段/);return {...base,direction:'sell'};}
      if (turn===2) {assert.match(input.feedback,/矛盾/);return {...base,filters:[{field:'发行人全称',op:'eq',value:'未核证的海运有限公司'}]};}
      assert.match(input.feedback,/未经核对/);
      return {kind:'clarification',reason:'entity'};
    })});
  assert.match(result.clarification,/机构名称/);
});
test('导入同批文件时区分按交易日的自然年和文件年度，参考日期使用上海日期',async()=>{
  const result=await planFlowQuestion({question:'2026 减持整张表，含跨年交易',today:'2026-11-09',ledgers,apiKey:'test',fetchImpl:mock(input=>{
    assert.equal(input.today,'2026-11-09');
    assert.ok(input.fields.includes('台账年度'));
    return {...base,direction:'sell',start:null,end:null,metric:'sell',groupBy:[],filters:[{field:'台账年度',op:'eq',value:'2026'}]};
  })});
  assert.equal(result.plan.start,null);
  assert.deepEqual(result.plan.filters,[{field:'台账年度',op:'eq',value:'2026'}]);
});
