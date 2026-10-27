import assert from 'node:assert/strict';
import test from 'node:test';
import {createProjectIntakeController} from '../project-intake-ai-ui.js';
function element(){return {value:'',textContent:'',innerHTML:'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(){}};}
function setup(fetchImpl){const input=element(),button=element(),results=element(),applied=[];
 const controller=createProjectIntakeController({container:{querySelector(selector){return selector.includes('material')?input:selector.includes('recognize')?button:results;}},fetchImpl,onApply:value=>applied.push(value)});
 return {input,button,results,applied,controller};}
const reply=()=>Response.json({ok:true,projects:[{patch:{shortName:'26测试MTN001',issueScale:10},sourceText:'原文',fields:{},tranches:[],warnings:[]}],warnings:[]});
test('intake is explicit, single request and applies only after the user adopts a draft',async()=>{
 let calls=0;const h=setup(async()=>{calls++;return reply();});h.input.value='一份非标准项目材料，发行规模10亿元。';
 assert.equal(calls,0);await h.controller.run();assert.equal(calls,1);assert.equal(h.applied.length,0);
 assert.match(h.results.innerHTML,/载入草稿/);
 await h.results.listeners.click({target:{closest:()=>({dataset:{intakeApply:'0'}})}});
 assert.equal(h.applied.length,1);assert.equal(h.applied[0].patch.shortName,'26测试MTN001');
});
test('editing the material aborts stale recognition and ignores its late response',async()=>{
 let finish;const h=setup(()=>new Promise(resolve=>{finish=resolve;}));h.input.value='第一份非标准材料需要智能摘录。';
 const pending=h.controller.run();h.input.value='第二份材料，原文已变化。';h.input.listeners.input();finish(reply());await pending;
 assert.equal(h.results.innerHTML,'');assert.equal(h.applied.length,0);assert.equal(h.button.disabled,false);
});
test('logout reset clears private source and pending proposals even if transport ignores abort',async()=>{
 let finish;const h=setup(()=>new Promise(resolve=>{finish=resolve;}));h.input.value='包含私有数据的项目材料原文。';
 const pending=h.controller.run();h.controller.reset();finish(reply());await pending;
 assert.equal(h.input.value,'');assert.equal(h.results.innerHTML,'');assert.equal(h.applied.length,0);
});
test('complete standard briefs retain their local parser without a paid request',async()=>{
 let calls=0;const h=setup(async()=>{calls++;throw Error('unnecessary');});
 h.input.value='26测试MTN001 非我行主承 广州分行\n3Y 规模10亿 AAA(联合资信)/隐含AA+\n询价区间1.3-1.9 银行间 中信银行';
 await h.controller.run();assert.equal(calls,0);assert.match(h.results.innerHTML,/载入草稿/);
});
