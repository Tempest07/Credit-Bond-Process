import test from 'node:test';
import assert from 'node:assert/strict';
import {planInventoryQuestion} from '../tools/inventory-openai.mjs';

const selected='2026-10-29', latest='2026-11-05', earlier='2026-10-23';
const previousPlan={date:selected,group:'none',metric:'principal',filters:{}};
const issuer='甲集团有限公司';
function reply(decision) {
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(decision)}]}]});
}
async function ask(question, requestedDate, conversation) {
  const requests=[], inputs=[];
  const decisions=[
    {kind:'lookup',reason:'none',changes:[],lookup:{term:issuer,field:'issuer',date:requestedDate}},
    {kind:'plan',reason:'none',changes:[{field:'date',value:requestedDate},{field:'issuer',value:issuer}],lookup:null}
  ];
  const answer=await planInventoryQuestion({question,previousPlan,dates:[earlier,selected,latest],apiKey:'test',conversation,
    fetchImpl:async(_url,{body})=>{inputs.push(JSON.parse(JSON.parse(body).input));return reply(decisions.shift());},
    inspectEvidence:async request=>{requests.push(request.date);return {matches:[{name:issuer,role:'issuer',basis:'exact',code:'001',bondName:'甲01'}]};}});
  return {requests,answer,inputs};
}

test('lookup and answer use the selected historic snapshot for plain company and bond maturity questions',async()=>{
  for(const question of ['甲集团有限公司 有债券吗？','甲集团有限公司在11月5日到期的债有哪些？',
    '甲集团有限公司到期日在2026年11月1日至2026年11月5日之间的有哪些？',
    '甲集团有限公司明年到期、按最新评级统计','甲集团有限公司上周五到期的债',
    '甲集团有限公司在2026-11-05发行的债有哪些']){
    const {requests,answer,inputs}=await ask(question,latest);
    assert.deepEqual(requests,[selected],question);
    assert.equal(answer.plan.date,selected,question);
    assert.equal(inputs[0].pinnedSnapshot,selected);
  }
});
test('explicit latest, historic dates and references to the previous period are allowed for evidence and answers',async()=>{
  for(const [question,date] of [['最新一期甲集团有限公司的库存','latest'],['看10月23日的甲集团有限公司',earlier],['回到刚才的那期看甲集团有限公司',earlier]]){
    const {requests,answer}=await ask(question,date,[{question:'看10月23日的库存'}]);
    assert.deepEqual(requests,[date==='latest'?latest:date],question);
    assert.equal(answer.plan.date,requests[0],question);
  }
});
