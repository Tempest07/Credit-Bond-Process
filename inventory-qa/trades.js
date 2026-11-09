"use strict";

const joint = document.body.dataset.workspace === "joint";
const uploadIds = new Set(["file","upload","upload-form","upload-list","upload-notice"]);
const byId = id => document.getElementById(joint && uploadIds.has(id) ? "trade-"+id : id);
const nf = new Intl.NumberFormat("zh-CN");
const formatter = new Intl.NumberFormat("zh-CN", {minimumFractionDigits:2, maximumFractionDigits:2});
const amount = cents => Number.isSafeInteger(cents) ? formatter.format(cents/1e10) : "—";
const integer = n => Number.isSafeInteger(n) ? nf.format(n) : "—";
const metricNames = {buy:"增持", sell:"减持", net:"净增持", gross:"增减持合计", rows:"交易笔数", bonds:"不同券数"};
const moneyFields = {buy:"buyCents", sell:"sellCents", net:"netCents", gross:"grossCents"};
const excelType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const state = {books:[], configured:false, loading:true, asking:false, uploading:false, files:[], turns:[], chat:null, retry:null, cursor:null};
const chatKey = "bond-centre.trade.last-chat";
function el(tag, value, cls) {
  const n = document.createElement(tag);
  if (value != null) n.textContent = value;
  if (cls) n.className = cls;
  return n;
}
function action(text, run, cls) {
  const n = el("button", text, cls);
  n.type = "button";
  n.addEventListener("click",run);
  return n;
}
function notice(id, value = "", error = false) {
  const n = byId(id);
  n.textContent = value;
  n.hidden = !value;
  n.dataset.level = error ? "error" : "info";
}
async function request(path, options = {}) {
  const response = await fetch("../api/inventory/flow-" + path, {cache:"no-store", credentials:"same-origin", ...options});
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || body.message || "交易服务暂时无法完成请求。");
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return response;
}
async function json(path, options) { return (await request(path, options)).json(); }
function displayTab() {
  const data = location.hash === "#upload-form";
  byId("ask-pane").hidden = data;
  byId("data-pane").hidden = !data;
  byId(data ? "books-tab" : "ask-tab").setAttribute("aria-current","page");
  byId(data ? "ask-tab" : "books-tab").removeAttribute("aria-current");
}
function remember(id) {
  const url = new URL(location.href);
  url.searchParams.set("chat",id);
  history.replaceState(null,"",url);
  try {localStorage.setItem(chatKey,id);} catch {}
}
function controls() {
  if (joint) return;
  byId("continue-joint").href = state.chat ? "./?" + new URLSearchParams({from:"trade",id:state.chat.id}) : "./?chat=new";
  const busy = state.loading || state.asking;
  byId("reset").disabled = busy || !state.turns.length;
  byId("open-chats").disabled = busy;
  byId("refresh").disabled = busy || state.uploading;
  byId("composer").hidden = !state.books.length;
  byId("question").disabled = busy || !state.configured;
  byId("submit").disabled = busy || !state.configured || !state.books.length;
  byId("effort").disabled = busy;
  byId("submit").textContent = state.asking ? "查询中…" : state.turns.length ? "追问 ↑" : "提问 ↑";
  byId("compose-heading").textContent = state.turns.length ? "继续追问" : "向交易流水提问";
  byId("ai-status").textContent = state.configured ? "" : "问数专用 API Key 待配置。";
  const examples = state.turns.length ? ["改为按月看","列出这批交易的发行人","只看广州分行"] :
    ["按年比较增持、减持和净增持金额","今年各月增持了多少？","去年净增持最多的五家发行人是哪些？"];
  byId("suggestions").replaceChildren(...examples.map(text => {
    const b = action(text, () => {byId("question").value = text;byId("question").focus();});
    b.disabled = busy || !state.configured;
    return b;
  }));
}
function bookLabel(book) { return book.year + " 年" + (book.direction === "buy" ? "增持" : "减持"); }
function renderBooks() {
  const books = [...state.books].sort((a,b) => b.year-a.year || a.direction.localeCompare(b.direction));
  const years = [...new Set(books.map(b => b.year))].reverse();
  const latest = books.map(b => b.asOf || b.end).filter(Boolean).sort().at(-1);
  if (!joint) {
  byId("empty").hidden = !!books.length;
  byId("coverage").textContent = books.length ? years.join("、") + " 年 · " + books.length + " 份累计台账" + (latest ? " · 最晚一期 " + latest : "") : "暂无已上传的交易台账";
  }
  byId("book-count").textContent = books.length + " 份";
  byId("book-list").replaceChildren(...books.map(b => {
    const item = el("div",null,"snap-row"), info = el("div");
    info.append(el("h3",bookLabel(b)),el("p",b.filename),el("p","交易日 " + b.start + " 至 " + b.end + " · " + integer(b.rowCount) + " 笔 · 名义本金 " + amount(b.totalCents) + " 亿元","meta"));
    item.append(info);
    if (b.outOfPeriodRows) info.append(el("p","含 " + integer(b.outOfPeriodRows) + " 笔交易日在文件标示期间之外，按交易日查询时归入实际发生日。","meta"));
    if (b.asOf) item.append(el("span","截至 " + b.asOf,"meta"));
    return item;
  }));
}
async function loadStatus() {
  const v = await json("status");
  state.books = v.ledgers; state.configured = v.configured;
  renderBooks();
  notice("status-error");
}
function showTurns() {
  const history = byId("history"); history.replaceChildren();
  state.turns.forEach((turn,i) => {
    if (i === state.turns.length - 1) {history.append(renderTurn(turn));return;}
    const folded = el("details",null,"record");
    folded.append(el("summary",turn.question));
    folded.addEventListener("toggle",() => {
      if (folded.open && folded.childElementCount === 1) folded.append(renderTurn(turn));
    });
    history.append(folded);
  });
  controls();
}
function renderTurn({question,answer}, downloadOverride) {
  const article = el("article",null,"answer");
  article.append(el("p",question,"question"));
  if (answer.clarification) article.append(el("p",answer.clarification,"summary"));
  if (answer.trace?.length) {
    const details = el("details",null,"source query-trace"), steps = el("ol");
    details.append(el("summary","查证过程"));
    for (const item of answer.trace) steps.append(el("li",item));
    details.append(steps);article.append(details);
  }
  if (!answer.result) return article;
  const {result,plan} = answer;
  const metric = plan.metric, key = moneyFields[metric] || metric;
  const unit = moneyFields[metric] ? "亿元" : metric === "bonds" ? "只" : "笔";
  const format = moneyFields[metric] ? amount : integer;
  const range = [plan.start || "最早一期", plan.end || "已上传最新一期"].join(" 至 ");
  const criteria = plan.filters.map(f => f.field + "：" + (Array.isArray(f.value) ? f.value.join("、") : f.value));
  const label = plan.groupBy.length ? "全部匹配交易 · " + metricNames[metric] : metricNames[metric];
  article.append(el("p",[label,range,...criteria].join(" · "),"meta"));
  const headline = el("div",format(result.totals[key]),"metric"); headline.append(el("small",unit));article.append(headline);
  const totals = el("p",null,"tagline flow-totals");
  const included = plan.direction === "both" ? ["buy","sell","net","rows","bonds"] : [plan.direction,"rows","bonds"];
  for (const m of included.filter(m => m !== metric)) {
    const txt = moneyFields[m] ? amount(result.totals[moneyFields[m]])+" 亿元" : integer(result.totals[m])+(m==="rows"?" 笔":" 只");
    totals.append(el("span",metricNames[m] + " " + txt));
  }
  article.append(totals);
  for (const message of result.warnings || []) article.append(el("p",message,"warning"));
  if (plan.groupBy.length && result.groups.length) article.append(renderGroups(result,plan));
  const commands = el("div",null,"view-actions");
  const download = action("下载完整 Excel",() => downloadOverride ? downloadOverride(download) : downloadAnswer(answer.id,download));
  commands.append(download);
  article.append(commands);
  const sources = el("details",null,"source");
  sources.append(el("summary","口径与来源"));
  sources.append(el("p","按交易流水名义本金统计。净增持＝增持－减持。"));
  const sourceList = el("ul",null,"flow-sources");
  for (const s of answer.sources || []) {
    const oldVersion = state.books.some(b=>b.year===s.year && b.direction===s.direction && b.id!==s.id);
    sourceList.append(el("li",s.filename + (s.sheet ? " · " + s.sheet : "") + (s.asOf ? " · 截至 " + s.asOf : "") + (oldVersion ? " · 修订前版本" : "")));
  }
  sources.append(sourceList);
  if ((answer.sources || []).some(s => state.books.some(b => b.year===s.year && b.direction===s.direction && b.id!==s.id)))
    sources.append(el("p","本段对话沿用首次查询的台账版本。新开对话可使用更新后的台账。"));
  article.append(sources);
  return article;
}
function renderGroups(result,plan) {
  const part = el("section"), head = el("div",null,"result-head");
  const title = plan.groupBy.join(" / ");
  head.append(el("h3",title));
  const views = el("div",null,"mode-switch");
  let chart = false, expanded = false;
  const wrap = el("div",null,"flow-scroll"), more = action("",() => {expanded = !expanded;draw();});
  const tabButton = action("表格",() => {chart = false;draw();});
  const chartButton = action("图表",() => {chart = true;draw();});
  views.append(tabButton,chartButton);head.append(views);part.append(head,wrap,more);
  function draw() {
    tabButton.setAttribute("aria-pressed",String(!chart)); chartButton.setAttribute("aria-pressed",String(chart));
    const groups = expanded ? result.groups : result.groups.slice(0,8);
    head.firstChild.textContent = title + " · " + (groups.length < result.groupCount ? "前 " + integer(groups.length) + " 组，共 " : "共 ") + integer(result.groupCount) + " 组";
    more.hidden = result.groups.length <= 8;
    more.textContent = expanded ? "收起" : "展开 " + integer(result.groups.length) + " 组";
    wrap.replaceChildren(chart ? groupChart(groups,plan.metric) : groupTable(groups,plan));
  }
  draw(); return part;
}
function groupTable(groups,plan) {
  const tbl = el("table"), header = tbl.createTHead().insertRow(), body = tbl.createTBody();
  const cols = [...new Set([plan.metric, ...(plan.direction==="both" ? ["buy","sell","net"] : []),"rows"])];
  for (const field of plan.groupBy) header.append(el("th",field));
  for (const m of cols) header.append(el("th",metricNames[m] + (moneyFields[m] ? "（亿元）" : ""),"num"));
  for (const group of groups) {
    const row = body.insertRow();
    for (const label of group.values) row.append(el("td",label || "未填写"));
    for (const m of cols) row.append(el("td",moneyFields[m] ? amount(group[moneyFields[m]]) : integer(group[m]),"num"));
  }
  return tbl;
}
function groupChart(groups,metric) {
  const chart = el("div",null,"viz");
  chart.setAttribute("aria-label",metricNames[metric]+"分组图");
  const key = moneyFields[metric] || metric;
  const values = groups.map(g => g[key]), min = Math.min(0,...values), max = Math.max(0,...values), range = max-min || 1;
  for (const group of groups) {
    const row = el("div",null,"bar-row"), track = el("div",null,"bars"), v = group[key];
    const fill = el("div",null,"bar-fill" + (v<0 ? " negative" : ""));
    fill.style.left = 100*(Math.min(0,v)-min)/range + "%";
    fill.style.width = 100*Math.abs(v)/range + "%";
    track.setAttribute("aria-hidden","true");track.append(fill);
    row.append(el("span",group.values.map(s=>s||"未填写").join(" / ")),track,el("span",moneyFields[metric] ? amount(v)+" 亿元" : integer(v)+(metric==="rows"?" 笔":" 只"),"num"));
    chart.append(row);
  }
  return chart;
}
async function downloadAnswer(id,trigger) {
  trigger.disabled = true;trigger.textContent = "正在生成 Excel…";
  try {
    const response = await request("export?" + new URLSearchParams({id}));
    if (!/spreadsheetml|octet-stream|application\/zip/i.test(response.headers.get("Content-Type") || "")) throw new Error("导出未返回 Excel 文件。");
    const href = URL.createObjectURL(await response.blob());
    const a = el("a");a.href = href;a.download = "交易问数_"+id.slice(0,8)+".xlsx";
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),60000);
  } catch (error) {notice("query-notice",error.message,true);}
  finally {trigger.disabled=false;trigger.textContent="下载完整 Excel";}
}
async function restore(id) {
  const {chat,turns} = await json("chat?" + new URLSearchParams({id}));
  state.chat = chat;state.turns = turns;state.retry = null;
  remember(chat.id);showTurns();
}
async function openHistory(append = false) {
  if (!append) {
    byId("chat-dialog").showModal();
    state.cursor=null;
  }
  const more=byId("more-chats");more.hidden=true;
  const status = byId("chat-list-status"), list = byId("chat-list");
  status.textContent = "正在读取…";if (!append) list.replaceChildren();
  try {
    const {chats,nextCursor} = await json("chats" + (append && state.cursor ? "?" + new URLSearchParams({cursor:state.cursor}) : ""));
    state.cursor=nextCursor;more.hidden=!nextCursor;
    status.textContent = chats.length ? "" : "还没有已保存的交易对话。";
    for (const chat of chats) {
      const b = action("",async () => {
        if (state.loading) return;
        state.loading = true;controls();
        status.textContent = "正在读取对话…";
        try {
          await restore(chat.id);
          byId("question").value="";notice("query-notice");byId("chat-dialog").close();
        } catch(error) {status.textContent = error.message;}
        finally {state.loading = false;controls();}
      });
      if (chat.id === state.chat?.id) b.setAttribute("aria-current","true");
      b.append(el("strong",chat.title || "交易问数"));
      if (chat.updatedAt) b.append(el("span",String(chat.updatedAt).replace("T"," ").slice(0,16),"meta"));
      list.append(b);
    }
  } catch(error) {status.textContent = error.message;more.hidden=!state.cursor;}
}
async function ask(event) {
  event.preventDefault();
  const input = byId("question"), question = input.value.trim();
  if (!question || state.loading || state.asking || !state.configured) return;
  const version = state.chat?.version || 0, effort = byId("effort").value;
  const signature = JSON.stringify([question,effort,state.chat?.id,version]);
  if (signature !== state.retry?.signature) state.retry = {signature,requestId:crypto.randomUUID(),chatId:state.chat?.id || crypto.randomUUID()};
  const {requestId,chatId} = state.retry;
  state.asking = true;controls();notice("query-notice","正在核对交易流水…");
  try {
    const {chat,answer} = await json("ask",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({question,chatId,requestId,version,effort})});
    if (chat?.id !== chatId || !answer) throw new Error("服务未确认对话已保存，请重试。");
    state.chat=chat;state.retry=null;state.turns.push({question,answer});remember(chat.id);
    input.value="";showTurns();notice("query-notice");
  } catch(error) {
    if (error.status===409 && error.code==="chat_conflict") {
      try {await restore(chatId);notice("query-notice","这段对话已有更新，已载入最新内容。可以继续提问。");}
      catch(restoreError) {notice("query-notice",restoreError.message,true);}
    } else notice("query-notice",error.message,true);
  } finally {state.asking=false;controls();if (!input.value) input.focus({preventScroll:true});}
}
function renderUploads() {
  const list = byId("upload-list");list.replaceChildren();
  list.hidden = !state.files.length;
  for (const f of state.files) {
    const item = el("li",null,"upload-item"), info = el("div");
    item.dataset.state = f.state;
    info.append(el("strong",f.file.name),el("p",f.message,"meta"));item.append(info);
    if (!state.uploading && f.state === "failed") {
      item.append(action("重试",() => {f.state="pending";f.message="待上传";uploadFiles();}));
    }
    list.append(item);
  }
  byId("file").disabled = state.uploading;
  byId("upload").disabled = state.uploading || !state.files.some(f => f.state==="pending");
  byId("upload").textContent = state.uploading ? "上传中…" : "上传并生效";
}
async function uploadFiles(event) {
  event?.preventDefault();
  if (state.uploading) return;
  state.uploading=true;controls();notice("upload-notice");
  try {
    for (const item of state.files.filter(f=>f.state==="pending")) {
      item.state = "uploading";item.message="正在核对报表…";renderUploads();
      try {
        const {ledger,unchanged} = await json("upload",{method:"POST",body:item.file,
          headers:{"Content-Type":excelType,"X-File-Name":encodeURIComponent(item.file.name)}});
        item.state = "done";
        item.message = (unchanged ? "相同版本已生效" : "已生效") + " · " + bookLabel(ledger) + " · " + integer(ledger.rowCount) + " 笔";
      } catch(error) {item.state="failed";item.message=error.message;}
    }
    const failed = state.files.filter(f=>f.state==="failed").length;
    notice("upload-notice",failed ? failed+" 份未完成，原因见文件列表。" : "本批文件已核对完成。",Boolean(failed));
    await refreshAfterTradeUpload();
  } catch(error) {notice("status-error",error.message,true);}
  finally {state.uploading=false;renderUploads();controls();}
}
async function initialize() {
  displayTab();controls();
  try {
    const draft = sessionStorage.getItem("bond-centre.trade.draft");
    if (draft && new URL(location.href).searchParams.get("chat") === "new") byId("question").value=draft;
    sessionStorage.removeItem("bond-centre.trade.draft");
  } catch {}
  try {await loadStatus();}
  catch(error) {notice("status-error",error.message,true);byId("coverage").textContent="尚未读到交易台账";}
  try {
    const requested = new URL(location.href).searchParams.get("chat");
    let last;try {last = localStorage.getItem(chatKey);} catch {}
    const id = requested || last;
    if (id && id !== "new") {
      try {await restore(id);}
      catch(error) {
        if (error.status!==404 || requested) throw error;
        remember("new");
      }
    }
  } catch(error) {notice("query-notice",error.message,true);}
  finally {state.loading=false;controls();}
}
let refreshAfterTradeUpload = loadStatus;
function bindTradePage(){
byId("open-chats").addEventListener("click",()=>openHistory());
byId("more-chats").addEventListener("click",()=>openHistory(true));
byId("close-chats").addEventListener("click",()=>byId("chat-dialog").close());
byId("reset").addEventListener("click",()=>location.assign("./?chat=new"));
byId("refresh").addEventListener("click",async ()=>{
  state.loading=true;controls();
  try {await loadStatus();} catch(error) {notice("status-error",error.message,true);}
  finally {state.loading=false;controls();}
});
byId("ask-form").addEventListener("submit",ask);
byId("question").addEventListener("keydown",event=>{
  if ((event.ctrlKey || event.metaKey) && event.key==="Enter" && !event.isComposing) {event.preventDefault();byId("ask-form").requestSubmit();}
});
}
function bindTradeUpload(){
byId("file").addEventListener("change",event=>{
  state.files=state.files.filter(f=>f.state==="pending");
  for (const file of event.target.files) {
    if (!state.files.some(f=>f.file.name===file.name && f.file.size===file.size && f.file.lastModified===file.lastModified))
      state.files.push({file,state:"pending",message:"待上传"});
  }
  event.target.value="";notice("upload-notice");renderUploads();
});
byId("upload-form").addEventListener("submit",uploadFiles);
}

export function setupJointTrades(onUpload) {
  refreshAfterTradeUpload = onUpload;
  bindTradeUpload();
}
export function showJointLedgers(ledgers) {
  state.books = ledgers;
  renderBooks();
}
export {renderTurn as renderTradeAnswer};

if (!joint) {
  const url = new URL(location.href);
  const id = url.searchParams.get("chat");
  if (!id || id === "new") {
    location.replace("./" + (id ? "?chat=new" : "") + (url.hash === "#upload-form" ? "#trade-upload-form" : ""));
  } else {
    bindTradePage();
    bindTradeUpload();
    window.addEventListener("hashchange",displayTab);
    initialize();
  }
}
