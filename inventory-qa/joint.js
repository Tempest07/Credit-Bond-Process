import {setupJointInventory,showJointSnapshots,renderInventoryLedger,renderInventoryIdentity,openInventoryDetail} from "./inventory.js?v=5.5.2";
import {setupJointTrades,showJointLedgers,renderTradeLedger} from "./trades.js?v=5.5.2";
import {presentAnswer} from "./answer-presentation.js?v=5.5.2";

const $ = id => document.getElementById(id);
const money = new Intl.NumberFormat("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const smallMoney = new Intl.NumberFormat("zh-CN",{maximumSignificantDigits:3});
function yi(cents){
  if(!Number.isSafeInteger(cents))return "—";
  return (cents!==0 && Math.abs(cents)<1e8?smallMoney:money).format(cents / 1e10);
}
const key = "bond-centre.joint.last-chat";
const state = {snapshots:[],ledgers:[],selected:"",configured:false,turns:[],chat:null,origin:null,selectedManually:false,busy:true,retry:null};
const newExamples = ["按发行人列出最新库存前五名","广州分行上月净增持多少？","OCI 组合久期较年初变化多少？","今年全账户的周均规模是多少？"];
const followExamples = ["只看广州分行","按会计科目拆分","把涉及的债券逐只列出"];
const types = {joint:"台账问数",inventory:"库存问数",trade:"增减持问数"};
const routes = {joint:"joint-",inventory:"",trade:"flow-"};
function el(tag,value,cls) {
  const node = document.createElement(tag);
  if(value != null) node.textContent=value;
  if(cls) node.className=cls;
  return node;
}
function button(title,run,cls) {
  const b=el("button",title,cls); b.type="button"; b.addEventListener("click",run);return b;
}
function notice(id,text="",error=false) {
  const n=$(id);n.textContent=text;n.hidden=!text;n.dataset.level=error?"error":"info";
}
async function request(path,options) {
  const r=await fetch("../api/inventory/"+path,{cache:"no-store",credentials:"same-origin",...options});
  if (!r.ok) {
    const body=await r.json().catch(()=>({}));
    const err=new Error(body.error || "读取台账失败，请重试。");
    err.status=r.status;err.code=body.code;throw err;
  }
  return r;
}
async function json(path,options) {return (await request(path,options)).json();}
function legacyLink(type,id) {
  return (type==="trade"?"./trades.html":"./inventory.html")+"?"+new URLSearchParams({chat:id});
}
function remember(id) {
  const url=new URL(location.href);
  url.searchParams.delete("id");url.searchParams.delete("from");url.searchParams.set("chat",id);
  history.replaceState(null,"",url);
  try { localStorage.setItem(key,id); } catch {}
}
function currentReference() { return state.snapshots.find(s=>s.id===state.selected); }
function controls() {
  const ready=state.snapshots.length+state.ledgers.length>0, busy=state.busy;
  $("query-workspace").hidden=!ready && !state.turns.length;
  $("empty").hidden=ready||state.turns.length>0||busy;
  $("question").disabled=busy||!ready||!state.configured;
  $("submit").disabled=$("question").disabled;
  $("effort").disabled=busy;
  $("snapshot-picker").disabled=busy||!state.snapshots.length;
  $("open-chats").disabled=busy;
  $("reset").disabled=busy||!state.chat&&!state.origin;
  $("refresh").disabled=busy;
  const follow=state.turns.length>0 || state.origin;
  $("compose-heading").textContent=follow?"继续追问":"向台账提问";
  $("submit").textContent=busy?"处理中…":follow?"追问 ↑":"提问 ↑";
  $("ai-status").textContent=!busy && !state.configured?"问数专用 API Key 待配置。":"";
  const last=state.turns.at(-1)?.answer.steps?.at(-1);
  const examples=last?.source==="portfolio"?["只看广州分行","用全账户重新计算"]:(follow?followExamples:newExamples);
  $("suggestions").replaceChildren(...examples.map(q=>{
    const b=button(q,()=>draft(q)); b.disabled=$("question").disabled;return b;
  }));
  if (state.origin) {
    const a=el("a","查看完整记录");a.href=legacyLink(state.origin.source,state.origin.id);
    const title=state.origin.title?"「"+state.origin.title+"」":types[state.origin.source];
    $("origin-context").replaceChildren(el("span","接续"+title+"　"),a);
  }
  $("origin-context").hidden=!state.origin;
  if(!state.origin)$("snapshot-picker").querySelector('option[value="origin"]')?.remove();
}
function draft(question) {$("question").value=question;$("question").focus();}
function showTab(data) {
  $("data-pane").hidden=!data;$("ask-pane").hidden=data;
  for(const b of document.querySelectorAll("[data-tab]")){
    if (b.dataset.tab===(data?"data":"ask")) b.setAttribute("aria-current","page");
    else b.removeAttribute("aria-current");
  }
}
function tab(data) {
  const url=new URL(location.href);url.hash=data?"upload-form":"";
  history.replaceState(null,"",url);showTab(data);
}
function newChat() {
  state.chat=null;state.turns=[];state.retry=null;state.origin=null;state.selectedManually=true;
  if(!currentReference()){state.selected=state.snapshots[0]?.id||"";$("snapshot-picker").value=state.selected;}
  $("question").value="";remember("new");notice("query-notice");renderTurns();controls();
}
function useSnapshot(id) {
  // The chosen date is just a reference for future turns. Historical answers keep their own sources.
  state.selectedManually=id!=="origin";state.selected=id==="origin"?"":id;$("snapshot-picker").value=id;
  tab(false);controls();$("question").focus();
}
async function refresh() {
  const data=await json("joint-status");
  state.snapshots=data.snapshots.filter(s=>s.isActive!==false).sort((a,b)=>b.date.localeCompare(a.date));
  state.ledgers=data.ledgers;state.configured=Boolean(data.configured);
  if(!currentReference())state.selected=state.snapshots[0]?.id||"";
  showJointSnapshots(state.snapshots,state.selected,useSnapshot);
  showJointLedgers(state.ledgers);showOriginReference();
  const asOf=state.ledgers.map(l=>l.asOf||l.end).filter(Boolean).sort().at(-1);
  $("snapshot-context").textContent=[
    state.snapshots.length?"余额快照 "+state.snapshots.length+" 期":"尚未导入余额快照",
    state.ledgers.length?"交易流水 "+state.ledgers.length+" 份"+(asOf?" · 累计至 "+asOf:""):"尚未导入交易流水"
  ].join("　/　");
  controls();notice("status-error");
}
async function refreshWithFeedback() {
  try { await refresh(); } catch(err) { notice("status-error",err.message,true); }
}
async function download(answerId,stepId,trigger) {
  const label=trigger.textContent;trigger.disabled=true;trigger.textContent="正在生成 Excel…";
  try {
    const params=new URLSearchParams({id:answerId});if(stepId)params.set("step",stepId);
    const r=await request("joint-export?"+params);
    if(!/spreadsheetml|octet-stream|application\/zip/i.test(r.headers.get("content-type")||""))throw Error("未收到有效的 Excel 文件，请重试。");
    const link=el("a");link.href=URL.createObjectURL(await r.blob());
    link.download="台账问数_"+answerId.slice(0,8)+(stepId?"_"+stepId:"")+".xlsx";
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(link.href),60000);
  }catch(err){notice("query-notice",err.message,true);}
  finally{trigger.disabled=false;trigger.textContent=label;}
}
function compareBlock(c) {
  const section=el("section",null,"joint-summary");
  section.append(el("h3",c.kind==="reconcile"?"余额变动与净增持核对":"余额变动"));
  const values=[["期初余额",c.openingCents],["期末余额",c.closingCents],["余额变动",c.changeCents],
    ["期间净增持",c.netCents],["余额变动减净增持",c.gapCents]];
  const dl=el("dl",null,"joint-metrics");
  for(const [title,cents] of values) {
    if(!Number.isSafeInteger(cents))continue;
    const pair=el("div"),value=el("dd",yi(cents));value.append(el("small"," 亿元"));
    pair.append(el("dt",title),value);dl.append(pair);
  }
  if(dl.childElementCount)section.append(dl);
  if(c.note)section.append(el("p",c.note,"meta"));
  return section;
}
function alignmentChart(rows,columns) {
  const chart=el("div",null,"joint-chart");
  const cents=rows.flatMap(row=>row.values.filter(Number.isSafeInteger));
  const min=Math.min(0,...cents),max=Math.max(0,...cents),range=max-min||1;
  const zero=100*(-min)/range;
  for(const row of rows){
    const item=el("section",null,"chart-group");
    item.append(el("h4",row.name));
    columns.forEach((column,i)=>{
      const value=row.values[i];
      const line=el("div",null,"chart-series");
      const label=el("span",column.label,"meta"),track=el("div",null,"chart-track");
      const axis=el("span",null,"chart-axis");axis.style.left=zero+"%";track.append(axis);
      track.setAttribute("aria-hidden","true");
      if(Number.isSafeInteger(value)){
        const fill=el("span",null,"series-bar");
        fill.dataset.series=String(i%3);
        fill.style.left=100*(Math.min(0,value)-min)/range+"%";
        fill.style.width=100*Math.abs(value)/range+"%";track.append(fill);
      }
      line.append(label,track,el("span",yi(value)+(Number.isSafeInteger(value)?" 亿":""),"num"));item.append(line);
    });
    chart.append(item);
  }
  return chart;
}
function alignedBlock(a) {
  const section=el("section",null,"joint-summary");
  const head=el("div",null,"result-head"),toggle=el("div",null,"mode-switch");
  const tableButton=button("表格",()=>{view="table";draw();});
  const chartButton=button("图表",()=>{view="chart";draw();});
  toggle.append(tableButton,chartButton);head.append(el("h3","按"+a.field+"对照"),toggle);
  section.append(head);
  const wrap=el("div",null,"flow-scroll");
  let expanded=false,view="table";
  const more=button("",()=>{expanded=!expanded;draw();});
  function draw(){
    const rows=expanded?a.rows:a.rows.slice(0,10);
    tableButton.setAttribute("aria-pressed",String(view==="table"));
    chartButton.setAttribute("aria-pressed",String(view==="chart"));
    if(view==="chart")wrap.replaceChildren(alignmentChart(rows,a.columns));
    else {
      const t=el("table"),header=t.createTHead().insertRow();header.append(el("th",a.field));
      for(const col of a.columns)header.append(el("th",col.label+"（亿元）","num"));
      const body=t.createTBody();
      for(const item of rows){
        const row=body.insertRow();row.append(el("th",item.name));
        for(const v of item.values)row.append(el("td",yi(v),"num"));
      }
      wrap.replaceChildren(t);
    }
    more.textContent=expanded?"收起":"展开 "+a.rows.length+" 组";
  }
  draw();section.append(wrap);
  if(a.rows.length>10)section.append(more);
  if(a.note)section.append(el("p",a.note,"meta"));
  return section;
}
function stockView(data,title,card,actions,chatId,mayContinue){
  if(data.resultId){
    const target=el("div");card.append(target);
    renderInventoryLedger({label:title,data},target,{view:"table",expanded:false,chatId,download:actions});
    return;
  }
  if(data.identity && mayContinue){
    const target=el("div");card.append(target);
    const snapshot=state.snapshots.find(s=>s.id===data.resume?.snapshotId);
    renderInventoryIdentity(data,title,{
      target,snapshot,resolve:(value,scope)=>draft("沿用上一问的范围，"+(scope?.field==="issuer"?"按发行人查":"查")+value+"。"),
    });
    return;
  }
  if(data.clarification)for(const line of data.clarification.split("\n"))card.append(el("p",line));
  if(data.identity?.candidates?.length)card.append(el("p",data.identity.candidates.join("、"),"meta"));
  for(const item of data.overview||[]){
    const sub=el("section");sub.append(el("h3",item.title));stockView(item.result,item.title,sub,actions,chatId,mayContinue);card.append(sub);
  }
}
function portfolioView(data,card,stepDownload){
  if(data.clarification)card.append(el("p",data.clarification,"summary"));
  if(!data.headline)return;
  card.append(el("p",data.headline,"summary"));
  const {rows=[],columns=[],notes=[]}=data;
  if(rows.length && columns.length){
    const weekly=data.spec?.metric==="weeklyMean";
    const wrap=el("div",null,"rank-table");
    const table=el("table"),head=table.createTHead().insertRow(),body=table.createTBody();
    for(const column of columns){const th=el("th",column);th.scope="col";head.append(th);}
    function renderRows(items){
      body.replaceChildren();
      for(const cells of items){
        const tr=body.insertRow();
        cells.forEach((value,i)=>{
          const numeric=typeof value==="number"||typeof value==="string"&&/^[+-]?[\d,]+(?:\.\d+)?$/.test(value);
          const cell=el(i?"td":"th",value??"—",numeric?"num":undefined);
          if(!i)cell.scope="row";
          tr.append(cell);
        });
      }
    }
    const preview=weekly?rows.slice(-5):rows.slice(0,5);
    renderRows(preview);
    wrap.append(table);card.append(wrap);
    if(preview.length<rows.length){
      let expanded=false;
      const expandLabel="查看全部 "+rows.length+(weekly?" 周":" 行");
      const more=button(expandLabel,()=>{
        expanded=!expanded;renderRows(expanded?rows:preview);
        more.setAttribute("aria-expanded",String(expanded));
        more.textContent=expanded?"收起":expandLabel;
      });
      more.setAttribute("aria-expanded","false");card.append(more);
    }
  }
  if(notes.length){
    const evidence=el("details",null,"record");evidence.append(el("summary","计算口径与来源"));
    for(const note of notes)evidence.append(el("p",note,"meta"));
    card.append(evidence);
  }
  const actions=el("div",null,"view-actions");
  const exportButton=button("下载完整 Excel",()=>stepDownload(exportButton));
  actions.append(exportButton);card.append(actions);
}
function canDownload(steps){
  return steps.some(s=>s.data && (s.data.result||s.data.resultId||s.data.overview?.some(p=>p.result?.resultId)||s.source==="portfolio"&&s.data.headline));
}
function turnView({question,answer},mayContinue){
  const box=el("article",null,"joint-turn");
  box.append(el("h2",question,"user-question"));
  const steps=answer.steps||[];
  const panel=presentAnswer(answer,()=>{
    const controls=[];
    const step=steps.length===1?steps[0]:null;
    if(step?.source==="inventory" && step.data?.resultId){
      controls.push(button("查看匹配明细",()=>openInventoryDetail(step.data,null)));
    }
    if(canDownload(steps)){
      const b=button(step?"下载完整 Excel":"下载完整联合 Excel",()=>download(answer.id,null,b),"secondary");
      controls.push(b);
    }
    return controls;
  },()=>turnEvidence(question,answer,mayContinue));
  box.append(panel||turnEvidence(question,answer,mayContinue));
  return box;
}
function turnEvidence(question,answer,mayContinue){
  const box=el("div");
  if(answer.clarification)box.append(el("p",answer.clarification,"summary"));
  for(const note of answer.methodNotes||[])box.append(el("p",note,"summary"));
  if(answer.arithmetic?.rows?.length || answer.arithmetic?.missing){
    const section=el("section",null,"joint-summary");section.append(el("h3","计算结果"));
    for(const row of answer.arithmetic.rows||[]){
      const value=row.value===null?"无法计算（分母为零或上一步无有效值）":row.value.toLocaleString("zh-CN",{maximumFractionDigits:6})+" "+row.unit;
      section.append(el("p",row.label+"："+value,"summary"));
      if(row.flowDirection && row.value!==null){
        section.append(el("p",row.value===0?row.flowDirection:row.flowDirection+" "+Math.abs(row.value).toLocaleString("zh-CN",{maximumFractionDigits:6})+" "+row.unit,"meta"));
      }else if(["difference","absoluteDifference"].includes(row.op)&&row.inputs.length===2&&row.value!==null){
        const [first,second]=row.inputs;
        section.append(el("p",row.value===0?"两项相同。":"较高项："+(first.value>second.value?first.label:second.label),"meta"));
      }
      const details=el("details");details.append(el("summary","计算依据"));
      for(const a of row.inputs)details.append(el("p",a.label+"："+(a.value??"无有效值")+" "+a.unit));
      section.append(details);
    }
    if(answer.arithmetic.missing)section.append(el("p",answer.arithmetic.missing,"meta"));
    box.append(section);
  }
  if(answer.memberSets){
    const sets=answer.memberSets,section=el("section",null,"joint-summary");
    section.append(el("h3",sets.field+"名单对照"));
    sets.labels.forEach((label,i)=>section.append(el("p","范围 "+(i+1)+"："+label,"meta")));
    if(sets.note)section.append(el("p",sets.note));
    else{
      for(const [label,names] of [["两边都有",sets.both],["仅范围 1",sets.leftOnly],["仅范围 2",sets.rightOnly]]){
        const details=el("details");
        details.append(el("summary",label+"："+names.length),el("p",names.join("、")||"无"));
        section.append(details);
      }
      section.append(el("p","两边合并去重（并集）："+sets.total,"summary"));
    }
    box.append(section);
  }
  if(answer.comparison)box.append(compareBlock(answer.comparison));
  if(answer.alignment)box.append(alignedBlock(answer.alignment));
  const steps=answer.steps||[];
  if(steps.length>1 && canDownload(steps)){
    const b=button("下载完整联合 Excel",()=>download(answer.id,null,b),"secondary");box.append(b);
  }
  const grid=el("div",null,"joint-steps");
  for(const step of steps){
    const card=el("section",null,"joint-step");
    const type={inventory:"余额台账",trade:"增减持流水",portfolio:"组合指标"}[step.source];
    card.append(el("h3",type,"step-type"));
    const subquestion=step.question===question && steps.length===1?"":step.question;
    const data=step.data,stepDownload=trigger=>download(answer.id,step.id,trigger);
    if(!data)card.append(el("p",step.question));
    else if(step.source==="inventory")stockView(data,subquestion,card,stepDownload,state.chat.id,mayContinue);
    else if(step.source==="portfolio")portfolioView(data,card,stepDownload);
    else card.append(renderTradeLedger({question:subquestion,answer:data},stepDownload));
    grid.append(card);
  }
  box.append(grid);return box;
}
function renderTurns(){
  const history=$("history");history.replaceChildren();$("current-answer").replaceChildren();
  state.turns.forEach((turn,i)=>{
    if(i===state.turns.length-1){$("current-answer").append(turnView(turn,true));return;}
    const d=el("details",null,"record");d.append(el("summary",turn.question));
    d.addEventListener("toggle",()=>{if(d.open && d.childElementCount===1)d.append(turnView(turn,false));});
    history.append(d);
  });
}
function syncReference(answer) {
  const dates=(answer?.steps||[]).map(s=>s.source==="portfolio" ? {date:s.spec?.end||s.data?.spec?.end}
    : s.data?.snapshot||s.data?.overview?.find(o=>o.result?.snapshot)?.result.snapshot)
    .filter(Boolean);
  const snap=dates.at(-1), day=snap?.date||answer?.referenceDate;
  if(!day)return;
  const current=state.snapshots.find(s=>s.date===day);
  if(snap?.id && snap.id!==current?.id){
    const picker=$("snapshot-picker");
    if(!Array.from(picker.options).some(o=>o.value===snap.id))picker.add(new Option(day+" · 对话保存版本",snap.id));
    state.selected=snap.id;
  }else if(current)state.selected=current.id;
  $("snapshot-picker").value=state.selected;
}
async function restore(id){
  const {chat,turns}=await json("joint-chat?"+new URLSearchParams({id}));
  if(chat?.id!==id||!Array.isArray(turns))throw Error("对话读取不完整，请重试。");
  state.chat=chat;state.turns=turns;state.retry=null;state.origin=null;
  state.selectedManually=false;syncReference(turns.at(-1)?.answer);
  remember(chat.id);renderTurns();controls();
}
function showOriginReference() {
  if(state.origin?.source==="inventory" && !state.selectedManually){
    const picker=$("snapshot-picker");
    if(!Array.from(picker.options).some(o=>o.value==="origin"))picker.add(new Option("沿用原对话","origin"));
    state.selected="";picker.value="origin";
  }else if(state.origin && !state.selectedManually){
    state.selected=state.snapshots[0]?.id||"";$("snapshot-picker").value=state.selected;
  }
}
async function ask(event){
  event.preventDefault();
  const question=$("question").value.trim();
  if(!question||state.busy||$("submit").disabled)return;
  const version=state.chat?.version||0,effort=$("effort").value;
  const signature=JSON.stringify([question,effort,state.chat?.id,version,state.selected,state.origin]);
  if(state.retry?.signature!==signature)state.retry={signature,chatId:state.chat?.id||crypto.randomUUID(),requestId:crypto.randomUUID()};
  const {requestId,chatId}=state.retry;
  state.busy=true;controls();notice("query-notice","正在核对台账…");
  try {
    const body={chatId,version,requestId,question,effort};
    if(state.selected && state.selectedManually)body.snapshotId=state.selected;
    if(state.origin && !state.chat)body.originChat={source:state.origin.source,id:state.origin.id};
    const {chat,answer}=await json("joint-ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(chat?.id!==chatId||!answer)throw Error("服务未确认本轮已保存，请重试。");
    state.chat=chat;state.turns.push({question,answer});state.retry=null;state.origin=null;state.selectedManually=false;syncReference(answer);remember(chat.id);
    $("question").value="";notice("query-notice");renderTurns();
    $("current-answer").scrollIntoView({block:"start"});
  } catch(err) {
    if(err.code==="chat_conflict"){
      try{await restore(chatId);notice("query-notice","已载入这段对话的最新内容，可继续追问。");}
      catch(e){notice("query-notice",e.message,true);}
    }else notice("query-notice",err.message,true);
  }finally{state.busy=false;controls();}
}
const collections=Object.keys(routes);
let historyVersion=0, entries=[], cursors={};
function drawHistory(){
  const list=$("chat-list");list.replaceChildren();
  for(const {chat,source} of [...entries].sort((a,b)=>b.chat.updatedAt.localeCompare(a.chat.updatedAt))){
    const choose=async()=>{
      if(state.busy)return;
      if(source!=="joint"){
        state.chat=null;state.turns=[];state.retry=null;state.selectedManually=false;
        state.origin={source,id:chat.id,title:chat.title};
        const url=new URL(location.href);
        url.searchParams.delete("chat");url.searchParams.set("from",source);url.searchParams.set("id",chat.id);
        history.replaceState(null,"",url);
        $("question").value="";notice("query-notice");showOriginReference();renderTurns();controls();
        $("chat-dialog").close();$("question").focus();return;
      }
      state.busy=true;controls();
      try{await restore(chat.id);$("question").value="";notice("query-notice");$("chat-dialog").close();}
      catch(err){$("chat-list-status").textContent=err.message;}
      finally{state.busy=false;controls();}
    };
    const row=button("",choose);
    const date=new Date(chat.updatedAt);
    row.append(el("strong",chat.title||"台账问数"),el("small",types[source]+" · "+date.toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"}),"meta"));
    if(source==="joint" && chat.id===state.chat?.id)row.setAttribute("aria-current","true");
    list.append(row);
  }
}
async function listChats(append=false){
  const seq=++historyVersion;
  if(!append){entries=[];cursors={};$("chat-list").replaceChildren();}
  $("chat-list-status").textContent="正在读取…";$("more-chats").hidden=true;
  const sources=collections.filter(k=>!append||cursors[k]!==null);
  const pages=await Promise.allSettled(sources.map(k=>json(routes[k]+"chats"+(cursors[k]?"?"+new URLSearchParams({cursor:cursors[k]}):""))));
  if(seq!==historyVersion)return;
  const errors=[];
  pages.forEach((r,i)=>{
    const source=sources[i];
    if(r.status==="rejected"){errors.push(types[source]+"："+r.reason.message);return;}
    cursors[source]=r.value.nextCursor||null;
    for(const chat of r.value.chats)entries.push({chat,source});
  });
  drawHistory();$("more-chats").hidden=collections.every(k=>cursors[k]===null);
  $("chat-list-status").textContent=errors.join("　")||(!entries.length?"还没有已保存的对话。":"");
}
async function initialize(){
  setupJointInventory(refreshWithFeedback);setupJointTrades(refreshWithFeedback);
  showTab(["#upload-form","#trade-upload-form"].includes(location.hash));controls();
  try {await refresh();}catch(e){notice("status-error",e.message,true);}
  const url=new URL(location.href),from=url.searchParams.get("from"),id=url.searchParams.get("id");
  const requested=url.searchParams.get("chat");
  if(["inventory","trade"].includes(from)&&id){state.origin={source:from,id};showOriginReference();}
  else{
    let last=null;try{last=localStorage.getItem(key);}catch{}
    const chatId=requested||last;
    if(chatId && chatId!=="new"){
      try{await restore(chatId);}
      catch(err){
        if(err.status===404 && requested){location.replace(legacyLink("inventory",chatId));return;}
        if(err.status===404)remember("new");else notice("query-notice",err.message,true);
      }
    }
  }
  let draftText="";
  try{draftText=sessionStorage.getItem("bond-centre.trade.draft")||"";sessionStorage.removeItem("bond-centre.trade.draft");}catch{}
  if(requested==="new"&&draftText)$("question").value=draftText;
  state.busy=false;controls();
}
$("ask-form").addEventListener("submit",ask);
$("question").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(!$("submit").disabled)$("ask-form").requestSubmit();}
});
$("snapshot-picker").addEventListener("change",event=>useSnapshot(event.target.value));
$("open-chats").addEventListener("click",()=>{$("chat-dialog").showModal();listChats();});
$("more-chats").addEventListener("click",()=>listChats(true));
$("close-chats").addEventListener("click",()=>$("chat-dialog").close());
$("reset").addEventListener("click",()=>{newChat();$("question").focus();});
$("refresh").addEventListener("click",async()=>{
  state.busy=true;controls();try{await refreshWithFeedback();}finally{state.busy=false;controls();}
});
$("open-upload").addEventListener("click",()=>{tab(true);$("upload-form").scrollIntoView({block:"start"});});
for(const b of document.querySelectorAll("[data-tab]"))b.addEventListener("click",()=>tab(b.dataset.tab==="data"));
window.addEventListener("hashchange",()=>showTab(["#upload-form","#trade-upload-form"].includes(location.hash)));
initialize().catch(err=>{state.busy=false;controls();notice("status-error",err.message,true);});
