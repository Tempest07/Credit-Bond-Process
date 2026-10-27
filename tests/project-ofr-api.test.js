import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createMemoryD1} from './helpers/d1-memory.js';
import {onRequestGet,onRequestPost} from '../functions/api/bond-list/project-offers.js';

const BASE='http://127.0.0.1:8838';
const sections=[{title:'广东（广州）',text:'原有手工内容必须保留\n012690001.IB，26测试SCP001，1.1*bid\n'},
  {title:'浙江（杭州）',text:'123456.SH，另一只券，净价100*ofr'}];
const project=(extra={})=>({id:'p',status:'待缴款',resultConfirmed:true,branch:'广州分行',venue:'银行间',
  tranches:[{id:'t',shortName:'26测试SCP001',resultStatus:'中标',winningAmountWan:3000,securityCode:'012690001.IB',
    marketValuation:9.9,initialMarketValuation:1.6,initialMarketValuationAt:'2026-10-27T00:00:00Z'}],...extra});

async function fixture(t, initial=project()) {
  const DB=createMemoryD1(); t.after(()=>DB.sql.close());
  const original=DB.prepare;
  const wrap=statement=>({...statement,bind(...args){return wrap(statement.bind(...args));},async all(){return statement.execute();}});
  DB.prepare=query=>wrap(original(query));
  DB.sql.exec('CREATE TABLE user_app_state (user_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,revision INTEGER)');
  function store(value,owner='admin',revision=10){DB.sql.prepare('INSERT INTO user_app_state VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=excluded.revision')
    .run(owner,JSON.stringify({issuers:[],projects:[value]}),'2026-10-27T00:00:00Z',revision);}
  store(initial);
  const get=async(options={})=>onRequestGet({env:{DB,...options.env},request:new Request((options.base||BASE)+'/api/bond-list/project-offers',{headers:options.headers})});
  const post=async(body={action:'add',projectId:'p',trancheId:'t'},options={})=>onRequestPost({env:{DB,...options.env},request:new Request((options.base||BASE)+'/api/bond-list/project-offers',{
    method:'POST',headers:{Origin:options.origin||BASE,'Content-Type':'application/json','X-Bond-List':'1',...options.headers},body:typeof body==='string'?body:JSON.stringify(body)})});
  await get();
  DB.sql.prepare('UPDATE bond_list_drafts SET sections=?,revision=7 WHERE user_id=?').run(JSON.stringify(sections),'admin');
  return {DB,get,post,store,draft(owner='admin'){const row=DB.sql.prepare('SELECT * FROM bond_list_drafts WHERE user_id=?').get(owner);return {...row,sections:JSON.parse(row.sections)};},state(){return DB.sql.prepare('SELECT * FROM user_app_state ORDER BY user_id').all();},offers(){return DB.sql.prepare('SELECT * FROM bond_list_project_offers ORDER BY created_at,id').all();}};
}

test('adds an owned award in the correct branch while preserving every old quote and the whole project state',async t=>{
  const h=await fixture(t),before=h.state(),response=await h.post();assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.added,true);assert.equal(result.transfer.ofrYield,1.55);
  assert.equal(result.transfer.baseValuation,1.6);assert.equal(result.transfer.seenAt,null);
  assert.equal(result.transfer.valuationSource,'project-entry');assert.equal(result.revision,8);
  assert.equal(h.draft().sections[0].text,sections[0].text+'012690001.IB，26测试SCP001，1.55*ofr');
  assert.deepEqual(h.draft().sections[1],sections[1]);assert.deepEqual(h.state(),before);
  const list=await(await h.get()).json();assert.equal(list.transfers[0].present,true);assert.equal(list.transfers[0].seenAt,null);
  assert.equal(list.branches.includes('广东（广州）'),true);
});

test('repeat and concurrent clicks are idempotent and preserve manually changed OFR prices',async t=>{
  const h=await fixture(t);
  const all=await Promise.all(Array.from({length:8},()=>h.post()));const payload=await Promise.all(all.map(r=>r.json()));
  assert.equal(payload.filter(r=>r.added).length,1);assert.equal(h.offers().length,1);assert.equal(h.draft().revision,8);
  const value=h.draft();value.sections[0].text=value.sections[0].text.replace('1.55*ofr','1.58*ofr');
  h.DB.sql.prepare('UPDATE bond_list_drafts SET sections=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(value.sections),'admin');
  const result=await(await h.post()).json();assert.equal(result.alreadyExists,true);assert.equal(h.offers().length,1);
  assert.match(h.draft().sections[0].text,/1\.58\*ofr/);
});

test('removal followed by explicit addition creates a new pending reminder without losing the old audit row',async t=>{
  const h=await fixture(t),first=await(await h.post()).json();
  await h.post({action:'seen',ids:[first.transfer.id]});
  h.DB.sql.prepare('UPDATE bond_list_drafts SET sections=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(sections),'admin');
  assert.equal((await(await h.get()).json()).transfers[0].present,false);
  const second=await(await h.post()).json();assert.equal(second.added,true);assert.notEqual(second.transfer.id,first.transfer.id);
  assert.equal(second.transfer.seenAt,null);assert.equal(h.offers().length,2);
  const current=(await(await h.get()).json()).transfers;
  assert.equal(current.find(value=>value.id===second.transfer.id).present,true);
  assert.equal(current.find(value=>value.id===first.transfer.id).present,false,'old source history must not regain presence when the same identity is re-added');
});

test('an unseen deleted generation cannot inflate a re-added reminder even when timestamps and id ordering tie against the newest',async t=>{
  const h=await fixture(t),first=await(await h.post()).json();
  assert.equal(first.transfer.seenAt,null);
  h.DB.sql.prepare('UPDATE bond_list_drafts SET sections=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(sections),'admin');
  const second=await(await h.post()).json();
  assert.equal(second.added,true);assert.equal(second.transfer.seenAt,null);
  const stamp='2026-10-27T00:00:00.000Z';
  h.DB.sql.prepare('UPDATE bond_list_project_offers SET id=?,created_at=? WHERE id=?').run('zz-older-unseen',stamp,first.transfer.id);
  h.DB.sql.prepare('UPDATE bond_list_project_offers SET id=?,created_at=? WHERE id=?').run('aa-newer-unseen',stamp,second.transfer.id);
  const transfers=(await(await h.get()).json()).transfers;
  assert.equal(transfers.length,2,'both source generations remain in the audit history');
  assert.ok(transfers.every(value=>value.seenAt===null),'no reminder was pre-consumed');
  const pending=transfers.filter(value=>value.present&&!value.seenAt);
  assert.equal(pending.length,1);assert.equal(pending[0].id,'aa-newer-unseen');
  assert.equal(transfers.find(value=>value.id==='zz-older-unseen').present,false);
  const repeat=await(await h.post()).json();
  assert.equal(repeat.alreadyExists,true);assert.equal(repeat.transfer.id,'aa-newer-unseen');assert.equal(h.offers().length,2);
});

test('legacy prices need explicit confirmation, unknown branches require a real existing title, and snapshots cannot be overridden',async t=>{
  const legacy=project({branch:'厦门分行'});delete legacy.tranches[0].initialMarketValuation;delete legacy.tranches[0].initialMarketValuationAt;
  const h=await fixture(t,legacy),before=h.state();let result=await h.post();assert.equal(result.status,422);
  const missing=await result.json();assert.equal(missing.code,'confirmation_required');assert.deepEqual(missing.requiredFields,['valuation','branch']);
  assert.equal(h.draft().revision,7);assert.equal(h.offers().length,0);
  result=await h.post({action:'add',projectId:'p',trancheId:'t',branchTitle:'浙江（杭州）',confirmedValuation:1.7893});
  const added=await result.json();assert.equal(added.transfer.ofrYield,1.7393);assert.equal(added.transfer.branchTitle,'浙江（杭州）');
  assert.equal(added.transfer.valuationSource,'manual-confirmed-entry');assert.deepEqual(h.state(),before);
  const frozen=await fixture(t);const price=await(await frozen.post({action:'add',projectId:'p',trancheId:'t',confirmedValuation:5})).json();assert.equal(price.transfer.baseValuation,1.6);
});

test('a manual existing OFR is neither overwritten nor highlighted as new; an existing BID does not block OFR',async t=>{
  const h=await fixture(t),draft=h.draft();draft.sections[0].text+='012690001.IB，26测试SCP001，1.44*ofr';
  h.DB.sql.prepare('UPDATE bond_list_drafts SET sections=? WHERE user_id=?').run(JSON.stringify(draft.sections),'admin');
  const result=await(await h.post()).json();assert.equal(result.added,false);assert.equal(result.alreadyExists,true);assert.equal(result.transfer,null);
  assert.equal(h.offers().length,0);assert.equal(h.draft().revision,7);assert.match(h.draft().sections[0].text,/1\.44\*ofr$/);
});

test('CAS conflicts append to the new latest draft and batch errors roll back both quote and source metadata',async t=>{
  const h=await fixture(t),batch=h.DB.batch;let once=true;
  h.DB.batch=async statements=>{if(once){once=false;const next=h.draft();next.sections[1].text+='\n其他窗口的新内容';h.DB.sql.prepare('UPDATE bond_list_drafts SET sections=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(next.sections),'admin');}return batch(statements);};
  const result=await(await h.post()).json();assert.equal(result.added,true);assert.match(h.draft().sections[1].text,/其他窗口的新内容/);assert.equal(h.offers().length,1);
  const failed=await fixture(t);failed.DB.setFail('UPDATE bond_list_drafts');
  const response=await failed.post();assert.equal(response.status,503);assert.equal(failed.offers().length,0);assert.equal(failed.draft().revision,7);
  assert.doesNotMatch(await response.text(),/private-database/);
});

test('a project result changed by another writer before append cannot publish a sale listing',async t=>{
  const h=await fixture(t),batch=h.DB.batch;let once=true;
  h.DB.batch=async statements=>{if(once){once=false;h.store(project({resultConfirmed:false}),'admin',11);}return batch(statements);};
  assert.equal((await h.post()).status,422);assert.equal(h.offers().length,0);assert.equal(h.draft().revision,7);
});

test('ownership, auth, origin and input bounds protect all source and reminder operations',async t=>{
  const h=await fixture(t);const added=await(await h.post()).json();
  assert.equal((await h.post(undefined,{origin:'https://evil.example'})).status,403);
  assert.equal((await h.get({base:'https://credit-bond-process.pages.dev'})).status,401);
  assert.equal((await h.post('x'.repeat(4097))).status,400);
  assert.equal((await h.post({action:'seen',ids:Array.from({length:51},(_,i)=>String(i))})).status,400);
  const secret='test-only-key',payload=Buffer.from(JSON.stringify({sub:'second',username:'admin',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const headers={'X-Tempest-Auth':payload+'.'+createHmac('sha256',secret).update(payload).digest('hex')};
  const options={base:'https://tempest07.com',origin:'https://tempest07.com',headers,env:{GATEWAY_AUTH_SECRET:secret}};
  h.store(project({id:'p2'}),'second');
  assert.equal((await h.post({action:'add',projectId:'p',trancheId:'t'},options)).status,404);
  assert.deepEqual((await(await h.get(options)).json()).transfers,[]);
  assert.equal((await h.post({action:'seen',ids:[added.transfer.id]},options)).status,200);
  assert.equal(h.offers()[0].seen_at,null,'another account cannot consume this reminder');
  await h.post({action:'seen',ids:[added.transfer.id]});const seen=h.offers()[0].seen_at;
  await h.post({action:'seen',ids:[added.transfer.id]});assert.equal(h.offers()[0].seen_at,seen);
});

test('zero, outsourced-only, cancelled, unidentified, and invalid-valued entries cannot add an OFR',async t=>{
  for(const change of [{winningAmountWan:0},{winningAmountWan:null,outsourcedBids:[{winningAmountWan:3000}]},
    {allocationNote:'全部回拨至另一品种'},{shortName:'26测试MTN001A/B'},{initialMarketValuation:0},{initialMarketValuation:NaN}]){
    const p=project();Object.assign(p.tranches[0],change);const h=await fixture(t,p);
    const response=await h.post();assert.equal(response.status,422,JSON.stringify(change));assert.equal(h.offers().length,0);assert.equal(h.draft().revision,7);
  }
});
