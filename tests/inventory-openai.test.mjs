import test from "node:test";
import assert from "node:assert/strict";
import { planInventoryQuestion } from "../tools/inventory-openai.mjs";

const dates = ["2026-04-30", "2026-04-15", "2026-04-30"];
const base = { question: "最新测试库存，甲分行按发行人分有多少？", dates, apiKey: "unit-test-only" };
const outcome = changes => ({ kind: "plan", reason: "none", changes });
const message = obj => ({ status: "completed", output: [
  { type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] },
] });
const respond = obj => async () => Response.json(message(obj));

test("one server-side call plans a Chinese query without disclosing unrelated context", async () => {
  let count = 0;
  const result = await planInventoryQuestion({ ...base, dates: [...dates].reverse(),
    previousPlan: { date: "2026-04-30", group: "none", metric: "principal", filters: {}, ledgerRows: ["private-row-probe"] },
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Authorization, "Bearer unit-test-only");
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(!options.body.includes("private-row-probe"));
      assert.ok(!options.body.includes("unit-test-only"));
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-6.1-terra");
      assert.equal(body.reasoning.effort, "high");
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.type, "json_schema");
      assert.deepEqual(JSON.parse(body.input).recentSnapshotDates, ["2026-04-15", "2026-04-30"]);
      return Response.json(message(outcome([{ field: "group", value: "issuer" }, { field: "branch", value: "甲分行" }])));
    } });
  assert.equal(count, 1);
  assert.deepEqual(result.plan, { date: "2026-04-30", metric: "principal", group: "issuer",
    filters: { issuer: null, guarantor: null, attribution: null, branch: "甲分行", portfolio: null, account: null, code: null, marketType: null, scope: null, holdingStatus: null } });
});

test("ambiguous company holdings select parallel views without setting an issuer filter",async()=>{
  const reply=await planInventoryQuestion({...base,question:"甲集团的债有哪些？",fetchImpl:respond(outcome([
    {field:"branch",value:"广州分行"},{field:"overviewSubject",value:"甲集团"}
  ]))});
  assert.equal(reply.overviewSubject,"甲集团");
  assert.equal(reply.plan.filters.branch,"广州分行");
  assert.equal(reply.plan.filters.issuer,null);
});

test("guarantee queries preserve the legal role and ABS scope through follow-ups", async () => {
  const subject = { ...base, question: "甲集团担保的 ABS 还剩多少？" };
  const wrong = await planInventoryQuestion({ ...subject, fetchImpl: respond(outcome([{ field:"issuer", value:"甲集团" }])) });
  assert.ok(wrong.clarification); assert.equal(wrong.plan, undefined);
  const lostType = await planInventoryQuestion({ ...subject, fetchImpl: respond(outcome([{ field:"guarantor", value:"甲集团" }])) });
  assert.ok(lostType.clarification); assert.equal(lostType.plan, undefined);
  const first = await planInventoryQuestion({ ...subject, fetchImpl:respond(outcome([
    {field:"marketType",value:"ABS"}, {field:"guarantor",value:"甲集团"}])) });
  const next = await planInventoryQuestion({ ...subject, question:"逐券列出，只看表内", previousPlan:first.plan,
    fetchImpl: respond(outcome([{field:"group",value:"code"},{field:"scope",value:"表内"}])) });
  assert.equal(next.plan.filters.marketType,"资产支持证券");
  assert.equal(next.plan.filters.guarantor,"甲集团"); assert.equal(next.plan.filters.issuer,null);
  assert.equal(next.plan.group,"code"); assert.equal(next.plan.filters.scope,"表内");
  const contract = await planInventoryQuestion({ ...subject, question:"这些券有连带责任保证吗？",
    previousPlan:first.plan, fetchImpl:respond(outcome([])) });
  assert.match(contract.clarification,/合同/); assert.equal(contract.plan,undefined);
  const allTypes = await planInventoryQuestion({ ...subject, question:"这家客户一共占了多少授信？按品种列。",
    previousPlan:first.plan, fetchImpl:respond(outcome([{field:"attribution",value:"甲集团"},
      {field:"guarantor",value:null},{field:"marketType",value:null},{field:"group",value:"marketType"}])) });
  assert.equal(allTypes.plan.filters.attribution,"甲集团");assert.equal(allTypes.plan.filters.guarantor,null);
  assert.equal(allTypes.plan.filters.marketType,null);assert.equal(allTypes.plan.group,"marketType");
  const unused = await planInventoryQuestion({ ...subject, question:"它还有多少剩余授信额度？",
    previousPlan:allTypes.plan, fetchImpl:respond(outcome([])) });
  assert.match(unused.clarification,/授信批复额度/); assert.equal(unused.plan,undefined);
});

test("follow-ups change or remove only requested conditions and preserve previous plan", async () => {
  const first = await planInventoryQuestion({ ...base, fetchImpl: respond(outcome([
    { field: "date", value: "2026-04-15" }, { field: "group", value: "issuer" },
    { field: "branch", value: "甲分行" }, { field: "scope", value: "表内" },
    { field: "holdingStatus", value: "存续" },
  ])) });
  const second = await planInventoryQuestion({ ...base, previousPlan: first.plan, question: "含委外，再按交易组合分",
    effort: "medium", fetchImpl: async (_, { body }) => {
      assert.equal(JSON.parse(body).reasoning.effort, "medium");
      return Response.json(message(outcome([{ field: "scope", value: null }, { field: "group", value: "portfolio" }])));
    } });
  assert.equal(second.plan.filters.scope, null);
  assert.equal(second.plan.filters.branch, "甲分行");
  assert.equal(second.plan.filters.holdingStatus, "存续");
  assert.equal(second.plan.date, "2026-04-15");
  assert.equal(second.plan.group, "portfolio");
  assert.equal(first.plan.filters.scope, "表内");
  const latest = await planInventoryQuestion({ ...base, previousPlan: second.plan,
    fetchImpl: respond(outcome([{ field: "date", value: "latest" }, { field: "metric", value: "securities" }])) });
  assert.equal(latest.plan.date, "2026-04-30");
  assert.equal(latest.plan.metric, "securities");
});

test("missing dates and unsupported finance questions produce clarification, never numeric results", async () => {
  const missing = await planInventoryQuestion({ ...base, fetchImpl: respond(outcome([{ field: "date", value: "2025-11-12" }])) });
  assert.match(missing.clarification, /2025-11-12/);
  assert.equal(missing.plan, undefined);
  for (const [reason, pattern] of [["transactions", /交易流水/], ["market", /市场数据/], ["comparison", /快照/]]) {
    const reply = await planInventoryQuestion({ ...base, fetchImpl: respond({ kind: "clarification", reason, changes: [] }) });
    assert.match(reply.clarification, pattern);
  }
  const empty = await planInventoryQuestion({ ...base, dates: [], fetchImpl() { assert.fail("must not call upstream"); } });
  assert.match(empty.clarification, /上传/);
});

test("invalid settings, stale context and a missing dedicated key never reach the upstream API", async () => {
  for (const [input, status] of [[{ question: " " }, 400], [{ question: "x".repeat(1201) }, 400],
    [{ effort: "unknown" }, 400], [{ dates: ["2025-02-30"] }, 400], [{ apiKey: "" }, 503],
    [{ previousPlan: { date: "2026-04-01", group: "none", metric: "principal" } }, 409]]) {
    await assert.rejects(planInventoryQuestion({ ...base, ...input, fetchImpl() { assert.fail("must not call upstream"); } }),
      error => error.status === status);
  }
});

test("untrusted output cannot inject SQL, arbitrary enums, duplicate operations or enormous literals", async () => {
  const invalid = [
    outcome([{ field: "sql", value: "SELECT * FROM positions" }]),
    outcome([{ field: "metric", value: "cashflow" }]),
    outcome([{ field: "holdingStatus", value: "法律上仍存续" }]),
    outcome([{ field: "scope", value: "x".repeat(161) }]),
    outcome([{ field: "group", value: "issuer" }, { field: "group", value: "none" }]),
    { kind: "clarification", reason: "__proto__", changes: [] },
  ];
  for (const obj of invalid) {
    await assert.rejects(planInventoryQuestion({ ...base, fetchImpl: respond(obj) }), error => error.status === 502);
  }
});

test("provider failures or refusals do not expose wire payload, model name, credentials or hallucinated answers", async () => {
  for (const [upstream, status] of [[400, 502], [401, 503], [403, 503], [404, 503], [429, 429], [500, 502]]) {
    const fetchImpl = async () => new Response('gpt-6.1-terra private upstream body', { status: upstream });
    await assert.rejects(planInventoryQuestion({ ...base, fetchImpl }), e => e.status === status && !/terra|private|unit-test/.test(e.message));
  }
  await assert.rejects(planInventoryQuestion({ ...base, fetchImpl: async () => Response.json({status:"incomplete"}) }), {status:502});
  await assert.rejects(planInventoryQuestion({ ...base, fetchImpl: async () => { throw new Error("unit-test-only"); } }),
    e => e.status === 502 && !e.message.includes("unit-test-only"));
  const refusal = await planInventoryQuestion({ ...base, fetchImpl: async () => Response.json({
    status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "upstream-specific-message" }] }],
  }) });
  assert.ok(refusal.clarification && !refusal.clarification.includes("upstream-specific-message"));
});
const lookup = (term, field = "overviewSubject", date = "2026-04-30") =>
  ({kind:"lookup",reason:"none",changes:[],lookup:{term,field,date}});
const ref = (name, basis, code="111.IB", bondName="26测试债") =>
  ({name,role:"issuer",code,bondName,basis});

function scripted(decisions, inspectEvidence) {
  let calls=0;
  const bodies=[];
  return {bodies,options:{inspectEvidence, fetchImpl:async (_url, options) => {
    const input=JSON.parse(JSON.parse(options.body).input);
    bodies.push(input);
    const step=decisions[calls++];
    assert.ok(step,"decision budget exceeded");
    return Response.json(message(typeof step==="function"?step(input):step));
  }}};
}

test("an ordinal follow-up can reference a displayed issuer after another turn, and verifies it again", async()=>{
  const name="乙方集团有限公司";
  const conversation=[{question:"这些机构的债有哪些？",dimension:"issuer",choices:["甲方集团有限公司",name],
    reply:"名义本金 private-row-probe 元",rows:["private-row-probe"],filters:{portfolio:"private-row-probe"}},
    {question:"只数和条数有什么区别？"}];
  const agent=scripted([lookup(name,"issuer"),outcome([{field:"issuer",value:name}])],async request=>{
    assert.equal(request.term,name);
    return {matches:[ref(name,"exact")]};
  });
  const result=await planInventoryQuestion({...base,question:"只看前面第二家",conversation,...agent.options});
  assert.equal(result.plan.filters.issuer,name);
  assert.deepEqual(agent.bodies[0].conversation[0].choices,conversation[0].choices);
  assert.ok(!JSON.stringify(agent.bodies).includes("private-row-probe"));
});

test("agent inspects an unfamiliar clue, can follow a real security code, and only sends whitelisted evidence back",async()=>{
  const question="林业集团有哪些债？";
  const name="甲林业集团有限公司";
  const evidence=ref(name,"bondStem");
  const checked=[];
  const agent=scripted([lookup("林业集团"),input=>{
    assert.equal(input.evidence[0].matches[0].name,name);
    assert.ok(!JSON.stringify(input).includes("private-row-probe"));
    return lookup(input.evidence[0].matches[0].code,"code");
  },input=>{
    assert.equal(input.evidence[1].matches[0].basis,"code");
    return outcome([{field:"overviewSubject",value:"林业集团"}]);
  }],async q=>{
    checked.push(q);
    return {rowDetails:"private-row-probe",matches:[{...evidence,basis:q.field==="code"?"code":"bondStem",cents:"private-row-probe"}]};
  });
  const answer=await planInventoryQuestion({...base,question,...agent.options});
  assert.deepEqual(checked.map(q=>q.term),["林业集团","111.IB"]);assert.equal(answer.trace.length,2);
  assert.equal(answer.overviewSubject,"林业集团");assert.equal(agent.bodies.length,3);
});

test("an early subject plan still needs a search and a second decision; absence never becomes a fabricated balance",async()=>{
  const plan=outcome([{field:"overviewSubject",value:"从未录入公司"}]);
  const agent=scripted([plan,lookup("假设全称有限公司"),outcome([{field:"overviewSubject",value:"假设全称有限公司"}])],
    async({term})=>({matches:term==="从未录入公司"?[]:[ref(term,"exact")]}));
  const answer=await planInventoryQuestion({...base,question:"从未录入公司有哪些债？",...agent.options});
  assert.equal(answer.overviewSubject,"从未录入公司");
  assert.deepEqual(answer.candidateNames,["假设全称有限公司"]);
  assert.match(answer.trace[0],/未匹配/);
});

test("a failed inspection, exhausted search budget or a dropped identity never widens to all holdings",async()=>{
  const run=(steps, inspectEvidence=async()=>({matches:[]}))=>planInventoryQuestion({...base,question:"甲集团有哪些债？",
    ...scripted(steps,inspectEvidence).options});
  const dropped=await run([lookup("甲集团"),outcome([])]);
  assert.ok(dropped.clarification);assert.equal(dropped.plan,undefined);
  const rounds=await run(["甲集团","甲类","甲公司","甲"].map(key=>lookup(key)));
  assert.equal(rounds.trace.length,3);assert.equal(rounds.plan,undefined);
  const repeated=await run([lookup("甲集团"),lookup("甲集团")]);assert.equal(repeated.plan,undefined);
  await assert.rejects(run([lookup("甲集团")],async()=>{throw Error("private-row-probe");}),error=>error.status===503&&!error.message.includes("private-row-probe"));
  const wrongDate=await run([lookup("甲集团","issuer","2026-02-03")]);
  assert.equal(wrongDate.plan,undefined);assert.match(wrongDate.clarification,/业务日/);
});

test("ordinary branch totals remain a single call without an evidence read",async()=>{
  const agent=scripted([outcome([{field:"branch",value:"甲分行"}])],()=>assert.fail("unexpected lookup"));
  const result=await planInventoryQuestion({...base,...agent.options});
  assert.equal(result.plan.filters.branch,"甲分行");assert.equal(agent.bodies.length,1);assert.deepEqual(result.trace,[]);
});

test("ranked breakdown preserves a previous branch, can change buckets, and can remove the ranking",async()=>{
  const previousPlan={date:"2026-04-30",group:"issuer",metric:"principal",filters:{branch:"北京分行"}};
  const question="前五大发行人，分别在不同的会计科目分类的持仓多少？";
  const conversation=[{question:"北京分行按发行人的库存有多少？",dimension:"issuer"},
    {question,reply:"当前 beta 可按已导入库存的日期、分行、发行人、组合等条件汇总名义本金、记录数或券数。这个问题还需要其他数据或指标。"}];
  const ranked=outcome([{field:"rank",value:{by:"issuer",limit:5,orderBy:"principal"}},{field:"group",value:"account"}]);
  const noLookup=()=>assert.fail("ranking is compiled against the snapshot and needs no issuer lookup");
  const selected=await planInventoryQuestion({...base,question,previousPlan,conversation,...scripted([ranked],noLookup).options});
  assert.deepEqual(selected.plan.rank,{by:"issuer",limit:5});
  assert.equal(selected.reuseRank,undefined);
  assert.equal(selected.plan.group,"account");
  assert.equal(selected.plan.filters.branch,"北京分行");
  const regrouped=await planInventoryQuestion({...base,question:"这几家再按券种拆",previousPlan:selected.plan,
    ...scripted([outcome([{field:"group",value:"marketType"}])],noLookup).options});
  assert.deepEqual(regrouped.plan.rank,selected.plan.rank);
  assert.equal(regrouped.reuseRank,true);
  const afs={field:"account",value:"AFS"};
  for(const [question,changes,reuse] of [
    ["这五家里只看 AFS",[afs],true],
    ["在 AFS 内重新排名，各家按券种列",[afs,{field:"rank",value:{by:"issuer",limit:5,orderBy:"principal"}}],undefined],
    ["看看 4 月 15 日那期",[ {field:"date",value:"2026-04-15"} ],undefined],
  ]){
    const follow=await planInventoryQuestion({...base,previousPlan:regrouped.plan,question,
      ...scripted([outcome(changes)],noLookup).options});
    assert.deepEqual(follow.plan.rank,selected.plan.rank);
    assert.equal(follow.reuseRank,reuse);
    assert.equal(follow.plan.filters.branch,"北京分行");
  }
  const cleared=await planInventoryQuestion({...base,question:"不要排名，统计全部发行人",previousPlan:regrouped.plan,
    ...scripted([outcome([{field:"rank",value:null},{field:"group",value:"issuer"}])],noLookup).options});
  assert.equal(cleared.plan.rank,undefined);
  assert.equal(cleared.plan.filters.branch,"北京分行");
});

test("invalid order or limits cannot become a principal ranking, and ranked explanations retain the scope",async()=>{
  for(const value of [{by:"issuer",limit:5,orderBy:"securities"},{by:"issuer",limit:51,orderBy:"principal"},
    {by:"sql",limit:5,orderBy:"principal"},{by:"issuer",limit:-3,orderBy:"principal"}]){
    const reply=await planInventoryQuestion({...base,fetchImpl:respond(outcome([{field:"rank",value},{field:"group",value:"account"}]))});
    assert.equal(reply.plan,undefined);assert.match(reply.clarification,/排名/);
  }
  const previousPlan={date:"2026-04-30",group:"account",metric:"principal",filters:{branch:"北京分行"},rank:{by:"issuer",limit:5}};
  const method=await planInventoryQuestion({...base,previousPlan,question:"刚才是怎么计算的？",
    ...scripted([{kind:"explain",reason:"method",changes:[],lookup:null}],()=>assert.fail()).options});
  assert.match(method.clarification,/北京分行.+发行人全称.+前5名.+会计科目/);
  const held=await planInventoryQuestion({...base,previousPlan:{...previousPlan,rankReused:true,
    filters:{...previousPlan.filters,account:"AFS"}},question:"为什么是这五家？",
    ...scripted([{kind:"explain",reason:"method",changes:[],lookup:null}],()=>assert.fail()).options});
  assert.match(held.clarification,/沿用上次.+名单内.+AFS/);
});

test("look up top issuer in scope, verify it by name, and keep the same branch in the final query",async()=>{
  const name="甲公司",question="广州分行持仓最多的发行人，我们持有它哪些债？";
  const steps=missing=>[lookup("广州分行","topIssuer"),lookup(name, "issuer"),
    outcome([{field:"issuer",value:name},{field:"group",value:"code"},...(!missing?[{field:"branch",value:"广州分行"}]:[])])];
  const inspect=async({field})=>({matches:[ref(name,field==="topIssuer"?"ranking":"exact")]});
  const selected=await planInventoryQuestion({...base,question,...scripted(steps(false),inspect).options});
  assert.equal(selected.plan.filters.issuer,name);assert.equal(selected.plan.filters.branch,"广州分行");assert.equal(selected.trace.length,2);
  const broad=await planInventoryQuestion({...base,question,...scripted(steps(true),inspect).options});assert.equal(broad.plan,undefined);
  const tie=await planInventoryQuestion({...base,question,...scripted(steps(false),async q=>({matches:q.field==="topIssuer"?
    [ref(name,"ranking"),ref("乙公司","ranking")]:[ref(name,"exact")]})).options});
  assert.equal(tie.plan,undefined);assert.match(tie.clarification,/多家/);
});
test("an unrelated or widened ranking scope cannot reach the database",async()=>{
  for (const term of ["北京分行","不限","广州分行|表内"]) {
    const result=await planInventoryQuestion({...base,question:"广州分行持仓最多的发行人有哪些债？",
      ...scripted([lookup(term,"topIssuer")],()=>assert.fail("unexpected ranking lookup")).options});
    assert.equal(result.plan,undefined);assert.match(result.clarification,/范围/);
  }
});
test("ABS enhancement inspects customer attribution, while an ordinary guarantee inspects the named guarantor",async()=>{
  for(const [question,searchField,marketType,role] of [
    ["格力集团担保的ABS还剩多少？","enhancement","ABS","attribution"],
    ["格力集团担保的中票有多少？","guarantor","中期票据","guarantor"],
  ]){
    const final=outcome([{field:"guarantor",value:"格力集团"},{field:"marketType",value:marketType}]);
    const looked=[];
    const result=await planInventoryQuestion({...base,question,...scripted([final,final],
      async q=>{looked.push(q.field);return {matches:[{...ref("珠海格力集团有限公司","nameFragment"),role}]};}).options});
    assert.deepEqual(looked,[searchField]);assert.equal(result.plan.filters.guarantor,"格力集团");
    assert.equal(result.plan.filters.marketType,marketType==="ABS"?"资产支持证券":marketType);
  }
});

test("composes reusable stages over published workbook columns, and can change display metric independently", async()=>{
  const field="原表:行业分类";
  const question="至少三只券的发行人里挑余额最大的五家，按各家行业和科目拆，只看持仓条数";
  const analysis=[
    {op:"group",fields:["issuer"]},
    {op:"having",metric:"securityCount",operator:"gte",value:3},
    {op:"sort",metric:"principalCents",descending:true},
    {op:"take",limit:5},{op:"expand"},{op:"group",fields:["issuer",field,"account"]},
  ];
  const previousPlan={date:"2026-04-15",group:"issuer",metric:"principal",filters:{branch:"北京分行"}};
  const answer=await planInventoryQuestion({...base,question,workbookFields:[field],previousPlan,
    inspectEvidence:()=>assert.fail("computed members do not require entity lookup"),
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body);
      assert.deepEqual(JSON.parse(body.input).workbookFields,[field]);
      assert.ok(JSON.stringify(body.text.format.schema).includes(field));
      return Response.json(message(outcome([{field:"analysis",value:analysis},{field:"metric",value:"count"}])));
    }});
  assert.deepEqual(answer.plan.analysis,analysis);
  assert.equal(answer.plan.metric,"count");
  assert.equal(answer.plan.filters.branch,"北京分行");
  assert.equal(answer.plan.date,"2026-04-15");
  const explanation=await planInventoryQuestion({...base,question:"刚才怎么算的？",previousPlan:answer.plan,
    ...scripted([{kind:"explain",reason:"method",changes:[],lookup:null}],()=>assert.fail()).options});
  assert.match(explanation.clarification,/北京分行.+不同券数不低于3.+前5组.+持仓明细.+发行人、行业分类、会计科目/);
});

test("repair invalid stages once without going to market data or widening a query", async()=>{
  const badPrograms=[
    [{op:"group",fields:["原表:未发布的列"]}],
    [{op:"take",limit:5}],
    [{op:"filter",field:"issuer",operator:"contains",value:"简称"},{op:"group",fields:["branch"]}],
  ];
  const ok=[{op:"group",fields:["branch","account"]}];
  for (const invalid of badPrograms) {
    let seen=0;
    const answer=await planInventoryQuestion({...base,fetchImpl:async (_url,options)=>{
      if (seen++) assert.ok(JSON.parse(JSON.parse(options.body).input).planFeedback);
      return Response.json(message(outcome([{field:"analysis",value:seen===1?invalid:ok}])));
    }});
    assert.equal(seen,2);
    assert.deepEqual(answer.plan.analysis,ok);
    const alwaysBad=respond(outcome([{field:"analysis",value:invalid}]));
    await assert.rejects(planInventoryQuestion({...base,fetchImpl:alwaysBad}),{status:502});
  }
});

test("a saved pipeline reuses local portfolio filters without disclosing their values, and can explicitly reset",async()=>{
  const value="private-portfolio-probe";
  const analysis=[{op:"filter",field:"portfolio",operator:"eq",value},{op:"group",fields:["account"]}];
  const previousPlan={date:"2026-04-30",group:"none",metric:"principal",filters:{portfolio:value},analysis};
  const answer=await planInventoryQuestion({...base,previousPlan,question:"改成按品种合计",fetchImpl:async (_url,options)=>{
    assert.ok(!options.body.includes(value));
    const current=JSON.parse(JSON.parse(options.body).input).currentPlan;
    return Response.json(message(outcome([{field:"analysis",value:[current.analysis[0],{op:"group",fields:["marketType"]}]}])));
  }});
  assert.equal(answer.plan.filters.portfolio,value);
  assert.deepEqual(answer.plan.analysis,[analysis[0],{op:"group",fields:["marketType"]}]);
  const reset=await planInventoryQuestion({...base,previousPlan:answer.plan,question:"另查全部余额",
    fetchImpl:respond(outcome([{field:"analysis",value:null},{field:"portfolio",value:null}]))});
  assert.equal(reset.plan.analysis,undefined);
  assert.equal(reset.plan.filters.portfolio,null);
});

test("derived workbook measures with separate thresholds, orders, and grouping stages use the available field catalog", async()=>{
  const rate="原表:票面利率", industry="原表:产业分类";
  const examples=[
    {question:"分行的账面票面利率按本金加权后，从高往低列出来",steps:[
      {op:"group",fields:["branch"],measure:{fn:"weightedAvg",field:rate}},
      {op:"sort",metric:"measure",descending:true},
    ]},
    {question:"选发行人至少四家的行业，再按科目看这些持仓的本金占比，留超过5.5%的科目",steps:[
      {op:"group",fields:[industry],measure:{fn:"distinct",field:"issuer"}},
      {op:"having",metric:"measure",operator:"gte",value:4},{op:"expand"},
      {op:"group",fields:["account"],measure:{fn:"principalShare",field:null}},
      {op:"having",metric:"measure",operator:"gt",value:5.5},
    ]},
  ];
  for (const {question,steps} of examples) {
    const result=await planInventoryQuestion({...base,question,workbookFields:[industry,rate],
      fetchImpl:respond(outcome([{field:"analysis",value:steps}]))});
    assert.deepEqual(result.plan.analysis,steps);
  }
  const unavailable=[{op:"group",fields:["account"],measure:{fn:"avg",field:"原表:未发布列"}}];
  await assert.rejects(planInventoryQuestion({...base,workbookFields:[rate],fetchImpl:respond(outcome([{field:"analysis",value:unavailable}]))}),{status:502});
});

test("one reconsideration can recover from an unnecessary unsupported decision",async()=>{
  let calls=0;
  const answer=await planInventoryQuestion({...base,fetchImpl:async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).input);
    if (calls++===0) return Response.json(message({kind:"clarification",reason:"unsupported",changes:[]}));
    assert.ok(input.planFeedback);
    return Response.json(message(outcome([{field:"analysis",value:[{op:"group",fields:["account","scope"]}]}])));
  }});
  assert.equal(calls,2);
  assert.deepEqual(answer.plan.analysis,[{op:"group",fields:["account","scope"]}]);
});

test("use prior answer's exact row set for follow-up analysis including historical fixed rankings, and detach explicitly",async()=>{
  const previousPlan={date:"2026-04-15",group:"account",metric:"principal",filters:{branch:"北京分行",account:"AFS"},
    rank:{by:"issuer",limit:5},rankReused:true,scopedToPrevious:true};
  const stages=[{op:"group",fields:["marketType"],measure:{fn:"principalShare",field:null}}];
  const result=await planInventoryQuestion({...base,previousPlan,hasPreviousResult:true,fetchImpl:async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).input);
    assert.equal(input.hasPreviousResult,true);
    assert.equal(input.currentPlan.scopedToPrevious,true);
    return Response.json(message(outcome([{field:"analysis",value:stages},{field:"inputRows",value:"previous"},
      {field:"scope",value:"表内"}])));
  }});
  assert.equal(result.inputRows,"previous");
  assert.equal(result.plan.inputRows,undefined);
  assert.equal(result.plan.scopedToPrevious,undefined);
  assert.equal(result.plan.rank,undefined);
  assert.equal(result.plan.filters.branch,null);
  assert.equal(result.plan.filters.account,null);
  assert.equal(result.plan.filters.scope,"表内");
  assert.deepEqual(result.plan.analysis,stages);
  assert.equal(result.reuseRank,undefined);
  const reset=await planInventoryQuestion({...base,previousPlan,hasPreviousResult:true,
    fetchImpl:respond(outcome([{field:"inputRows",value:"snapshot"},{field:"account",value:null}]))});
  assert.equal(reset.inputRows,"snapshot");
  assert.equal(reset.plan.filters.branch,"北京分行");
  assert.equal(reset.reuseRank,undefined);
  for (const [exists,changes] of [
    [false,[{field:"inputRows",value:"previous"}]],
    [true,[{field:"inputRows",value:"previous"},{field:"date",value:"latest"}]],
  ]) {
    await assert.rejects(planInventoryQuestion({...base,previousPlan,hasPreviousResult:exists,fetchImpl:respond(outcome(changes))}),{status:502});
  }
});
