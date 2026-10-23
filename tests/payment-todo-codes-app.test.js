import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
function harness({refresh=async()=>({total:2,failed:0}),empty=false}={}) {
  const button={disabled:false,textContent:'刷新缴款债券代码'},toasts=[],calls=[];
  const state={projects:[{id:'original',prepaymentNumber:'W202610230001'}]};
  const context=vm.createContext({state,cloudAvailable:true,document:{hidden:false},
    $:()=>button,showToast:message=>toasts.push(message),
    getPaymentTodos:()=>empty?[]:[{project:{shortName:'26测试MTN001'},tranche:{}},{project:{shortName:'整期项目'},tranche:{shortName:'26测试MTN002B'}}],
    paymentTodoCodes:{refresh:names=>{calls.push(names);return refresh(names);},ensure:names=>calls.push(names)},
    persistState(){throw Error('code refresh must not write business data');},
  });
  for(const name of ['refreshPaymentTodoCodes','recheckPaymentTodoCodesOnReturn']) {
    const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));
    const tail=app.slice(start),end=tail.slice(1).search(/\n(?:async )?function /);
    assert.ok(start>=0&&end>0);vm.runInContext(tail.slice(0,end+1),context);
  }
  return {context,button,toasts,calls,state};
}

test('workspace force refresh uses only payment todo names and blocks duplicate clicks',async()=>{
  let finish;
  const ui=harness({refresh:()=>new Promise(resolve=>{finish=resolve;})});
  const original=JSON.stringify(ui.state);
  const pending=ui.context.refreshPaymentTodoCodes();
  assert.equal(ui.button.disabled,true);
  await ui.context.refreshPaymentTodoCodes();
  assert.equal(ui.calls.length,1);
  assert.deepEqual(Array.from(ui.calls[0]),['26测试MTN001','26测试MTN002B']);
  finish({total:2,failed:0});await pending;
  assert.equal(ui.button.disabled,false);
  assert.equal(ui.button.textContent,'刷新缴款债券代码');
  assert.match(ui.toasts[0],/已刷新 2/);
  assert.equal(JSON.stringify(ui.state),original);
  assert.match(html,/<button[^>]+id="refreshPaymentTodoCodesButton"[^>]*>刷新缴款债券代码<\/button>/);
});

test('empty, cancelled and failed manual refreshes do not announce success or leave the button disabled',async()=>{
  for(const options of [{empty:true},{refresh:async()=>({cancelled:true})},{refresh:async()=>{throw Error('private details');}}]) {
    const ui=harness(options);await ui.context.refreshPaymentTodoCodes();
    assert.equal(ui.button.disabled,false);
    assert.ok(ui.toasts.every(message=>!message.includes('已刷新')&&!message.includes('private')));
    if(options.empty)assert.equal(ui.calls.length,0);
  }
});

test('returning to a visible authenticated page checks the existing cache; hidden or locked pages do not query',()=>{
  const ui=harness();
  ui.context.document.hidden=true;ui.context.recheckPaymentTodoCodesOnReturn();
  ui.context.document.hidden=false;ui.context.cloudAvailable=false;ui.context.recheckPaymentTodoCodesOnReturn();
  assert.equal(ui.calls.length,0);
  ui.context.cloudAvailable=true;ui.context.recheckPaymentTodoCodesOnReturn();
  assert.deepEqual(Array.from(ui.calls[0]),['26测试MTN001','26测试MTN002B']);
});
