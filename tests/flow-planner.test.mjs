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
test('信用债台账总体、真实券种及明确逐行比对使用不同的筛选字段',async()=>{
 const books=ledgers.map(b=>({...b,filename:'信用债'+(b.direction==='buy'?'增':'减')+'持台账2601-2610.xlsx',headers:[...b.headers,'债券类型']}));
 for(const [question,value,field] of [['全账户信用债今年买多少','信用债','台账类别'],['债券类型等于信用债的买多少','信用债','债券类型'],['只看中期票据的本金','中期票据','债券类型']]){
   const hit=await planFlowQuestion({question,ledgers:books,apiKey:'test',fetchImpl:mock((ctx,n)=>{
     assert.equal(ctx.coverage[0].category,'信用债');
     if(!n)return {kind:'clarification',reason:'scope'};
     assert.match(ctx.feedback,/单边/);
     return {...base,metric:'buy',direction:'buy',filters:[{field:'债券类型',op:'eq',value}]};
   })});
   assert.deepEqual(hit.plan.filters,[{field,op:'eq',value}]);
 }
});
test('业务口径、目标粒度、非空及跨年季度转为实际可执行的列和值',async()=>{
 const books=ledgers.map(l=>({...l,headers:[...l.headers,'表内/委外']}));
 async function plan(question,d){
   return (await planFlowQuestion({question,ledgers:books,apiKey:'test',fetchImpl:mock(()=>({...base,...d}))})).plan;
 }
 const filters=[{field:'表内/委外',op:'eq',value:'委外专户'},{field:'交易季度',op:'eq',value:'第二季度'},
                {field:'联动分行',op:'notEmpty',value:''}];
 const hit=await plan('以交易日归期，委外专户二季度有哪些非空分行',{filters});
 assert.deepEqual(hit.filters,[{field:'会计分类',op:'eq',value:'委外（专户）'},{field:'交易季度',op:'eq',value:'Q2'},filters[2]]);
 for(const value of ['OCI（AFS）','AFS/OCI','OCI(AFS)'])
   assert.deepEqual((await plan('只看OCI',{filters:[{field:'会计分类',op:'eq',value}]})).filters,[{field:'会计分类',op:'eq',value:'AFS'}]);
 assert.equal((await plan('两类另行核对',{filters:[{field:'会计分类',op:'eq',value:'AFS(Trading)'}]})).filters[0].value,'AFS(Trading)');
 assert.deepEqual((await plan('按交易日统计，这两个月哪一月更多？',{groupBy:['交易日期']})).groupBy,['交易月份']);
 assert.deepEqual((await plan('以交易日期统计哪个科目最多？',{groupBy:['交易日期','会计分类']})).groupBy,['会计分类']);
 assert.deepEqual((await plan('按交易日列出每日各科目的买入明细',{groupBy:['交易日期','会计分类']})).groupBy,['交易日期','会计分类']);
});
test('交割日归期的子步骤可提交独立日期闭区间，歧义反馈可恢复到实际流水查询',async()=>{
 const books=ledgers.map(l=>({...l,headers:[...l.headers,'交易交割日']}));
 const settlement={field:'交易交割日',op:'between',value:['2026-05-03','2026-06-11']};
 const hit=await planFlowQuestion({question:'分别汇总5月3日至6月11日交割的买卖本金，比较按成交日的数据。',ledgers:books,apiKey:'test',fetchImpl:mock((input,n)=>{
   if(!n)return {kind:'clarification',reason:'measure'};
   assert.match(input.feedback,/交易交割日 between/);
   return {...base,start:null,end:null,filters:[settlement],groupBy:[]};
 })});
 assert.deepEqual(hit.plan.filters,[settlement]);
 assert.equal(hit.plan.start,null);
 assert.equal(hit.plan.end,null);
});
test('完整区间在累计日以后，直接说明流水缺失及余额边界',async()=>{
 const hit=await planFlowQuestion({question:'对这个区间能否查净买入？',ledgers:ledgers.map(l=>({...l,asOf:'2026-05-31'})),
   periodHint:{start:'2026-06-01',end:'2026-06-15'},fetchImpl:()=>assert.fail('out-of-coverage lookup should not call the planner')});
 assert.match(hit.clarification,/2026-05-31.*2026-06-01.*不能代替净买入/);
});
test('canonical bond code is independent of the chosen source column, while explicit raw-column selection is preserved',async()=>{
 const books=ledgers.map(l=>({...l,headers:[...l.headers,'债券标准代码']}));
 for(const [question,field] of [['买入 234567.IB 多少？','券码'],['原表债券标准代码列等于 234567.IB 的交易有多少？','债券标准代码']]){
   const {plan}=await planFlowQuestion({question,apiKey:'test',ledgers:books,fetchImpl:mock(()=>({...base,filters:[{field:'债券标准代码',op:'eq',value:'234567.IB'}]}))});
   assert.equal(plan.filters[0].field,field);
 }
 const nested=await planFlowQuestion({question:'按债券标准代码列统计 234567.IB',originalQuestion:'这只券今年买了多少',priorUserQuestions:['持仓里有 234567.IB 吗？'],apiKey:'test',ledgers:books,
   fetchImpl:mock(()=>({...base,filters:[{field:'债券标准代码',op:'eq',value:'234567.IB'}]}))});
 assert.equal(nested.plan.filters[0].field,'券码');
});
test('same-security name and qualified code are checked on one source row; a conflicting name cannot be dropped',async()=>{
 const planner=async(question,decision)=>planFlowQuestion({question,apiKey:'test',ledgers,
   runQuery:async p=>{assert.deepEqual(p.groupBy,['债券简称']);assert.deepEqual(p.filters,[{field:'券码',op:'eq',value:'12345.IB'}]);return {groups:[{values:['24示例A']}],groupCount:1};},
   fetchImpl:mock((input,i)=>{
     assert.deepEqual(input.securityEvidence.observedNames,['24示例A']);
     if(!i)return {kind:'clarification',reason:'scope'};return {...base,...decision};
   })});
 const ok=await planner('简称24示例A和券码12345.IB是同一只，买入本金只算一次',{direction:'buy',metric:'buy',groupBy:[],filters:[]});
 assert.match(ok.evidence.join(''),/同笔流水核对一致/);
 assert.deepEqual(ok.plan.filters,[{field:'券码',op:'eq',value:'12345.IB'},{field:'债券简称',op:'eq',value:'24示例A'}]);
 const conflict=await planner('简称24示例B和券码12345.IB，核对同一只券的买入',{filters:[{field:'债券简称',op:'eq',value:'24示例B'}]});
 assert.match(conflict.clarification,/24示例A.*未核对到同一笔/);
});
test('share of all re-plans a restricted denominator and uses selected groups only for display',async()=>{
 const books=ledgers.map(l=>({...l,headers:[...l.headers,'债券类型']}));
 const p={...base,direction:'buy',metric:'buy',groupBy:['债券类型'],share:'matched',showGroups:['类型甲']};
 const answer=await planFlowQuestion({question:'类型甲占全部买入多少？',apiKey:'test',ledgers:books,
   fetchImpl:mock((ctx,i)=>{if(!i)return {...p,filters:[{field:'债券类型',op:'eq',value:'类型甲'}]};assert.match(ctx.feedback,/分母/);return p;})});
 assert.equal(answer.plan.share,'matched');assert.deepEqual(answer.plan.filters,[]);assert.deepEqual(answer.plan.showGroups,['类型甲']);
});
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
test('外部名单已生效时把期末持仓排名作为已知范围，并对旧的库存分流回复重新规划',async()=>{
 const boundScope={source:'trade',start:'2026-10-01',end:'2026-10-31',members:{field:'发行人全称',count:5,alreadyApplied:true}};
 const result=await planFlowQuestion({question:'按广州分行期末持仓前五发行人，查10月份对这五家各自净买入多少',ledgers,apiKey:'test',boundScope,
   fetchImpl:mock((input,n)=>{
     assert.deepEqual(input.boundScope,boundScope);
     if(!n)return {kind:'clarification',reason:'inventory'};
     assert.match(input.feedback,/名单|排名/);
     return {...base,start:boundScope.start,end:boundScope.end,filters:[{field:'联动分行',op:'eq',value:'广州分行'}]};
   })});
 assert.equal(result.plan.metric,'net');assert.deepEqual(result.plan.groupBy,['发行人全称']);
});

test('part-year ranking needs no issuer and inventory verification of an alias stays separate from trade amounts',async()=>{
 const ranked=await planFlowQuestion({question:'如果全年没齐，给已覆盖期买入最多的几家。',ledgers,apiKey:'test',
   fetchImpl:mock((ctx,i)=>{if(!i)return {kind:'clarification',reason:'entity'};assert.match(ctx.feedback,/排名结果/);return {...base,direction:'buy',metric:'buy',limit:3};})});
 assert.deepEqual(ranked.plan.groupBy,['发行人全称']);
 const realName='国家开发银行',question='国开行在九十两月买了多少？';
 const settings={question,originalQuestion:question,ledgers,apiKey:'test',lookupIssuer:async alias=>{assert.equal(alias,'国开行');return {date:'2026-11-05',names:[realName]};}};
 const verified=await planFlowQuestion({...settings,fetchImpl:mock((ctx,i)=>{
   if(!i)return {kind:'verifyIssuer',alias:'国开行'};
   assert.deepEqual(ctx.sets.issuerLookup.choices[0].values,[realName]);
   return {...base,direction:'buy',metric:'buy',groupBy:['交易月份'],filters:[{field:'发行人全称',op:'eq',value:realName}]};
 })});assert.equal(verified.plan.filters[0].value,realName);assert.match(verified.evidence[0],/2026-11-05.*国开行.*国家开发银行/);
 const ambiguous=await planFlowQuestion({...settings,lookupIssuer:async()=>({names:['甲一行','甲二行'],date:'2026-11-05'}),
   fetchImpl:mock(()=>({kind:'verifyIssuer',alias:'国开行'}))});assert.match(ambiguous.clarification,/多个候选/);
});

test('the final proposed issuer expansion is actively checked even if the model did not request a lookup',async()=>{
 const name='国家开发银行',plan={...base,filters:[{field:'发行人全称',op:'eq',value:name}]};
 let calls=0;
 const hit=await planFlowQuestion({question:'查询国开行自己发的债。',originalQuestion:'国开行自己发行的债在两个月买了多少？',
   ledgers,apiKey:'test',lookupIssuer:async word=>{calls++;assert.equal(word,'国开行');return {names:[name],date:'2026-11-05'};},fetchImpl:mock(()=>plan)});
 assert.equal(calls,1);assert.equal(hit.plan.filters[0].value,name);assert.match(hit.evidence[0],/国开行/);
 const unconfirmed=await planFlowQuestion({question:'国开行买了多少？',ledgers,apiKey:'test',
   lookupIssuer:async()=>({names:[name,'国际开发银行'],date:'2026-11-05'}),fetchImpl:mock(()=>plan)});
 assert.equal(unconfirmed.plan,undefined);
 const follow=await planFlowQuestion({question:'两只现在卖了多少？',priorUserQuestions:['中国银行股份有限公司的前两只券'],ledgers,apiKey:'test',
   fetchImpl:mock(()=>({...base,filters:[{field:'发行人全称',op:'eq',value:'中国银行股份有限公司'}]}))});
 assert.equal(follow.plan.filters[0].value,'中国银行股份有限公司');
});

test('verified issuer clue is passed to the planner on its very first call and cannot be silently omitted from the final plan',async()=>{
 for(const question of ['今年，国开行自己发行的债在两个月买多少？','查一下国开行发的债券当月买了多少？','国开行今年买入多少？']){
   const answer=await planFlowQuestion({question,apiKey:'test',ledgers,
     lookupIssuer:async alias=>{assert.equal(alias,'国开行');return {date:'2026-11-05',names:['国家开发银行']};},
     fetchImpl:mock((input,i)=>{
       assert.equal(input.issuerScope.name,'国家开发银行');
       if(!i)return {kind:'clarification',reason:'entity'};
       return {...base,direction:'buy',metric:'buy',groupBy:['交易月份'],filters:[]};
     })});
   assert.deepEqual(answer.plan.filters,[{field:'发行人全称',op:'eq',value:'国家开发银行'}]);assert.match(answer.evidence[0],/国开行.*国家开发银行/);
 }
});
