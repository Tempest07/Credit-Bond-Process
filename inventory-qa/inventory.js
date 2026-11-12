"use strict";

import {presentAnswer} from "./answer-presentation.js?v=5.5.3-ui2";

const $ = (id) => document.getElementById(id);
const api = "../api/inventory/";
const groupNames = { issuer: "发行人", branch: "联动分行", portfolio: "交易组合", scope: "持仓范围", account: "会计科目", marketType: "债券类型", sourceMarketType: "原表债券类型", code: "逐券", none: "全部持仓" };
const filterNames = { ...groupNames, code: "券码", sourceMarketType: "原表债券类型", holdingStatus: "台账状态", guarantor: "查询担保人", attribution: "损益还原客户" };
const evidenceLabels = { enhancement: "增信占用 · 按损益还原客户统计", candidate: "待核实 · 损益还原客户匹配", unknown: "台账信息不足", ledger: "台账列明的担保人", attribution: "客户占用 · 按损益还原客户统计" };
const number = new Intl.NumberFormat("zh-CN");
const decimal = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yuan = (cents) => Number.isFinite(cents) ? decimal.format(cents / 100) : "—";
const billions = (cents) => Number.isFinite(cents) ? decimal.format(cents / 1e10) : "—";
const count = (n) => Number.isFinite(n) ? number.format(n) : "—";
const state = {
  snapshots: [], configured: false, selected: "", current: null, pending: null, conversation: [],
  chat:null, chatSnapshot:null, loadingChat:true, navigation:0, retry:null, currentTurn:null,
  chatListVersion:0, nextCursor:null,
  statusVersion: 0, askController: null, uploading: false, uploads: [], view: "table", expanded: false,
  detailController: null, detailGroup: null, offsets: [0], detailRows: 0,
};

function node(tag, value, cls) {
  const el = document.createElement(tag);
  if (value !== undefined && value !== null) el.textContent = value;
  if (cls) el.className = cls;
  return el;
}
function button(label, action, cls) {
  const b = node("button", label, cls);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}
function notice(id, message = "", error = false) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
  el.dataset.level = error ? "error" : "info";
}
class ApiError extends Error {
  constructor(response, payload) {
    const value = typeof payload?.error === "string" ? payload.error : payload?.message;
    super(typeof value === "string" && value.length < 350 ? value : "请求未完成，请刷新状态后重试。");
    this.status = response.status;
    this.data = payload || {};
  }
}
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(api + path, { credentials: "same-origin", cache: "no-store", ...options });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("无法连接库存问数服务，请检查网络后重试。");
  }
  if (!response.ok) throw new ApiError(response, await response.json().catch(() => null));
  return response;
}
async function json(path, options) {
  const res = await request(path, options);
  try { return await res.json(); }
  catch { throw new Error("问数服务没有返回有效数据，请刷新后重试。"); }
}
function switchTab(tab) {
  $("ask-pane").hidden = tab !== "ask";
  $("data-pane").hidden = tab !== "data";
  for (const b of document.querySelectorAll(".workhead [data-tab]")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  const url = new URL(location.href);
  url.hash = tab === "data" ? "upload-form" : "";
  if (url.href !== location.href) history.replaceState(null, "", url);
}
function resetConversation() {
  state.askController?.abort();
  state.askController = null;
  state.current = null;
  state.pending = null;
  state.conversation = [];
  state.currentTurn = null;
  state.chat = null;
  state.chatSnapshot = null;
  state.retry = null;
  state.expanded = false;
  state.view = "table";
  if ($("detail").open) $("detail").close();
  $("question").value = "";
  $("current-answer").replaceChildren();
  $("history").replaceChildren();
  notice("query-notice");
  renderControls();
}
const lastChatKey = "bond-centre.inventory.last-chat";
function markChat(id) {
  const url = new URL(location.href);
  url.searchParams.set("chat",id);
  history.replaceState(null,"",url);
  try { localStorage.setItem(lastChatKey,id); } catch {}
}
function newChat(snapshotId) {
  ++state.navigation;
  state.loadingChat = false;
  resetConversation();
  state.selected = snapshotId || state.snapshots[0]?.id || "";
  markChat("new");
  showSnapshots();
  renderControls();
}
function chooseSnapshot(id) {
  if (state.selected !== id) newChat(id);
  $("snapshot-picker").value = id;
  renderControls();
}
function renderControls() {
  showTradeShortcut();
  if ($("continue-joint")) $("continue-joint").href = state.chat ? "./?" + new URLSearchParams({from:"inventory",id:state.chat.id}) : "./?chat=new";
  const snap = currentSnapshot();
  const busy = Boolean(state.askController) || state.loadingChat;
  $("snapshot-context").textContent = snap
    ? snap.filename + " · " + count(snap.rowCount) + " 条持仓" + (state.snapshots.some(s=>s.id===snap.id) ? "" : " · 修订前版本")
    : "当前没有可查询的有效快照。";
  $("query-workspace").hidden = !snap;
  $("empty").hidden = Boolean(snap);
  $("snapshot-picker").disabled = !snap || busy;
  $("submit").disabled = busy || !snap || !state.configured;
  $("question").disabled = !snap || !state.configured || state.loadingChat;
  $("effort").disabled = busy || !state.configured;
  $("reset").disabled = !snap || busy;
  $("open-chats").disabled = busy;
  $("submit").textContent = state.loadingChat ? "读取中…" : busy ? "查询中…" : state.current || state.pending ? "追问 ↑" : "提问 ↑";
  $("compose-heading").textContent = state.current || state.pending ? "继续追问" : "向库存提问";
  $("ai-status").textContent = !state.configured ? "问数专用 API Key 待配置。你可以先使用手动查询。" : "";
  for (const el of $("manual-form").elements) el.disabled = busy || !snap;
  for (const el of $("current-answer").querySelectorAll(".identity-choice button, .identity-choice input")) el.disabled = busy;
  $("suggestions").replaceChildren();
  if (state.configured && state.pending?.kind !== "identity") {
    const suggestions = state.current?.data.roleEvidence
      ? ["逐券列出", "只看表内", "这个客户一共占了多少授信？按品种列"]
      : state.current
      ? ["只看表内", "按交易组合分", "改为按发行人分"]
      : ["广州分行的库存按发行人分有多少亿元？", "哪些联动分行持仓最多？", "按会计分类汇总库存"];
    for (const q of suggestions) {
      const b = button(q, () => { $("question").value = q; $("question").focus(); });
      b.disabled = busy;
      $("suggestions").append(b);
    }
  }
}
function currentSnapshot() {
  return state.snapshots.find(s=>s.id===state.selected) || (state.chatSnapshot?.id===state.selected ? state.chatSnapshot : null);
}
function showSnapshots(onSelect = id => {chooseSnapshot(id); switchTab("ask");}) {
  const select = $("snapshot-picker");
  select.replaceChildren();
  const list = $("snapshot-list");
  list.replaceChildren();
  $("snapshot-count").textContent = state.snapshots.length + " 个业务日";
  for (const snapshot of state.snapshots) {
    const opt = node("option", snapshot.date); opt.value = snapshot.id; select.append(opt);
    const item = node("div", null, "snap-row"), info = node("div");
    info.append(node("strong", snapshot.date), node("p", snapshot.filename), node("p", count(snapshot.rowCount) + " 条 · 名义本金 " + billions(snapshot.totalCents) + " 亿元", "meta"));
    item.append(info, button("用此快照问数", () => onSelect(snapshot.id)));
    list.append(item);
  }
  if (state.chatSnapshot && !state.snapshots.some(s=>s.id===state.chatSnapshot.id)) {
    const opt = node("option",state.chatSnapshot.date + " · 修订前版本");
    opt.value = state.chatSnapshot.id;
    select.append(opt);
  }
  if (!state.snapshots.length) { list.append(node("p", "尚无已发布快照。", "meta")); if (!state.chatSnapshot) select.append(node("option", "暂无快照")); }
  select.value = state.selected;
}
async function refresh(preferredId) {
  const version = ++state.statusVersion;
  $("refresh").disabled = true;
  try {
    const data = await json("status");
    if (version !== state.statusVersion) return;
    const previousConfig = state.configured;
    state.configured = data.configured === true;
    state.snapshots = data.snapshots.filter((s) => s.isActive !== false).sort((a, b) => b.date.localeCompare(a.date));
    const wanted = preferredId || state.selected;
    const selected = state.snapshots.some((s) => s.id === wanted) || state.chatSnapshot?.id === wanted ? wanted : state.snapshots[0]?.id || "";
    if (selected !== state.selected) {
      if (preferredId && state.chat) newChat(selected);
      else state.selected = selected;
    }
    if (!state.configured) $("manual").open = true;
    else if (!previousConfig) $("manual").open = false;
    showSnapshots(); renderControls(); notice("status-error");
  } catch (error) {
    if (version === state.statusVersion) notice("status-error", error.message, true);
  } finally {
    if (version === state.statusVersion) $("refresh").disabled = false;
  }
}
function amountValue(metric, data, isGroup = false) {
  if (metric === "count") return { value: isGroup ? data.count : data.rowCount, display: count(isGroup ? data.count : data.rowCount), unit: "条" };
  if (metric === "securities") return { value: data.securityCount, display: count(data.securityCount), unit: "只" };
  const cents = isGroup ? data.cents : data.totalCents;
  return { value: cents, display: billions(cents), unit: "亿元" };
}
function filterText(filters, kind) {
  return Object.entries(filters || {}).filter(([, v]) => v != null && String(v) !== "").map(([k, v]) =>
    (k === "guarantor" && kind === "enhancement" ? "增信方" : filterNames[k] || k) + "：" + v).join("　");
}
function table(headers, rows, numeric = []) {
  const el = node("table"), head = el.createTHead().insertRow();
  for (const [idx, label] of headers.entries()) {
    const th = node("th", label, numeric.includes(idx) ? "num" : ""); th.scope = "col"; head.append(th);
  }
  const body = el.createTBody();
  for (const values of rows) {
    const tr = body.insertRow();
    for (const [idx, value] of values.entries()) {
      const td = tr.insertCell();
      if (numeric.includes(idx)) td.className = "num";
      if (value instanceof Node) td.append(value); else td.textContent = value ?? "—";
    }
  }
  return el;
}
function groupName(name) { return name === "" || name == null ? "未填写" : String(name); }
function groupLabel(g) {
  if (Array.isArray(g.labels)) return g.labels.map(groupName).join(" · ") || "合计";
  if (g.rankName != null) return g.rankName + " · " + (g.securityName || g.bucketName);
  return g.securityName ? g.securityName + " · " + g.name : groupName(g.name);
}
const analysisNames = {...filterNames, attribution:"资产端损益还原客户名称", guarantor:"台账列明担保人", institution:"机构名称", name:"债券简称", maturity:"到期日期", expected:"ABS 预计到期日", legal:"法定到期日", cents:"名义本金", principalCents:"名义本金", rowCount:"持仓行数", securityCount:"不同券数"};
function fieldLabel(field) { return analysisNames[field] || field.replace(/^原表:/,""); }
const aggregateLabels={distinct:"不同取值数",sum:"合计",avg:"平均值",weightedAvg:"本金加权平均值",min:"最小值",max:"最大值",principalShare:"本金占比"};
const aggregateNumber=new Intl.NumberFormat("zh-CN",{maximumSignificantDigits:10});
function measureLabel(measure) {
  return (measure.field ? fieldLabel(measure.field)+" · " : "")+aggregateLabels[measure.fn];
}
function displayMetric(data, group) {
  if (!data.measure) return amountValue(data.plan.metric,group || data,Boolean(group));
  const value=group ? group.measureValue : data.measureTotal;
  return {value,display:Number.isFinite(value) ? aggregateNumber.format(value) : "—",
    unit:data.measure.fn==="principalShare" ? "%" : data.measure.fn==="distinct" ? "个" : ""};
}
function analysisTable(data, groups) {
  const dimensions=data.dimensions;
  const headers=[...(dimensions.length ? dimensions.map(fieldLabel) : ["分组"]), ...(data.measure ? [measureLabel(data.measure)] : []), "本金（亿元）", "不同券数", "持仓行数"];
  const rows=groups.map(g=>{
    const labels=g.labels.length ? g.labels.map(groupName) : ["合计"];
    labels[labels.length-1]=button(labels.at(-1),()=>openDetail(data,g.name),"row-link");
    const m=displayMetric(data,g);
    return [...labels,...(data.measure ? [m.display+m.unit] : []),billions(g.cents),count(g.securityCount),count(g.count)];
  });
  return table(headers,rows,headers.map((_,i)=>i).slice(Math.max(1,dimensions.length)));
}
function analysisTrace(steps) {
  const operators={eq:"等于",neq:"不等于",gt:"大于",gte:"至少",lt:"小于",lte:"至多",contains:"包含"};
  let measure;
  return steps.map(step=>{
    switch(step.op) {
      case "group":
        measure=step.measure;
        return (step.fields.length ? "按"+step.fields.map(fieldLabel).join("、")+"汇总" : "汇总全部入选持仓")+(measure ? "，计算"+measureLabel(measure) : "");
      case "expand": return "取出入选分组对应的原表持仓，继续查询";
      case "sort": return "按"+(step.metric==="measure" ? measureLabel(measure) : fieldLabel(step.metric))+(step.descending?"从高到低":"从低到高")+"排序";
      case "take": return "保留前 "+step.limit+" 组";
      default: {
        const field=step.op==="having"?step.metric:step.field;
        const threshold=field==="principalCents" || field==="cents" ? number.format(Number(step.value)/100)+" 元" : step.value;
        return (step.op==="having"?"保留分组中":"保留明细中")+(field==="measure" ? measureLabel(measure) : fieldLabel(field))+operators[step.operator]+threshold+"的记录";
      }
    }
  });
}
function rankedTable(data, groups, complete) {
  const {rank,metric} = data.plan;
  const group = data.dimensions?.[1] ?? data.plan.group;
  const primary = fieldLabel(data.dimensions?.[0] ?? rank.by), secondary = fieldLabel(group);
  const buckets = [...new Set([...(group === "account" ? ["AFS","Receivable","委外（公募）","委外（专户）","Trading"] : []),
    ...groups.map(g=>g.bucketName)])];
  const wide = node("div",null,"rank-table");
  const unit = {principal:"亿元",securities:"只",count:"条"}[metric];
  if (!complete || buckets.length > 8 || group === "none") {
    wide.append(table([primary,secondary,"本金（亿元）","不同券数","持仓行数"],groups.map(g=>[
      g.rankName,button(g.securityName || g.bucketName,()=>openDetail(data,g.name),"row-link"),
      billions(g.cents),count(g.securityCount),count(g.count)
    ]),[2,3,4]));
    return wide;
  }
  const ranks = new Map();
  for (const cell of groups) {
    if (!ranks.has(cell.rankName)) ranks.set(cell.rankName,new Map());
    ranks.get(cell.rankName).set(cell.bucketName,cell);
  }
  const headers = [primary,...buckets];
  // Counting distinct securities across multiple buckets is not additive.
  if (metric !== "securities") headers.push("合计");
  const columnTotals = new Map();
  const format = value => metric==="principal" ? billions(value) : count(value);
  const rows = [...ranks].map(([name,cells])=>{
    let total = 0;
    const row = [name];
    for (const bucket of buckets) {
      const cell = cells.get(bucket);
      if (!cell) { row.push("—"); continue; }
      const amount = amountValue(metric,cell,true);
      total += amount.value;
      columnTotals.set(bucket,(columnTotals.get(bucket) || 0) + amount.value);
      row.push(button(amount.display,()=>openDetail(data,cell.name),"row-link"));
    }
    if (metric !== "securities") row.push(format(total));
    return row;
  });
  const grid = table(headers,rows,headers.slice(1).map((_,i)=>i+1));
  grid.createCaption().textContent = (metric==="principal" ? "名义本金" : metric==="securities" ? "不同券数" : "持仓行数") + "（"+unit+"），— 表示无匹配持仓";
  if (metric!=="securities") {
    const footer=grid.createTFoot().insertRow();
    footer.insertCell().textContent="合计";
    for(const value of [...buckets.map(b=>columnTotals.get(b)||0),amountValue(metric,data).value]) {
      const td=footer.insertCell();td.className="num";td.textContent=format(value);
    }
  }
  wide.append(grid);
  return wide;
}
function appendTrace(article, trace) {
  if (!Array.isArray(trace)) return;
  const steps = trace.filter(step => typeof step === "string" && step.trim());
  if (!steps.length) return;
  const details = node("details", null, "source query-trace");
  const list = node("ol");
  for (const step of steps) list.append(node("li", step));
  details.append(node("summary", "查证过程"), list);
  article.append(details);
}
function withParentTrace(result, parentTrace) {
  if (!Array.isArray(parentTrace) || !parentTrace.length) return result;
  const trace = Array.isArray(result.trace) ? result.trace : [];
  if (parentTrace.every((step, index) => trace[index] === step)) return result;
  return { ...result, trace: [...parentTrace, ...trace] };
}
function showChart(groups, data) {
  const chart = node("div", null, "viz");
  chart.setAttribute("aria-label", "当前结果的分组条形图");
  const values = groups.map((g) => displayMetric(data,g).value || 0);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1;
  const zero = -min / range;
  for (const g of groups) {
    const n = displayMetric(data,g);
    const row = node("div", null, "bar-row");
    const mark = node("div", null, "bars");
    const fill = node("div", null, "bar-fill" + (n.value < 0 ? " negative" : ""));
    fill.style.left = 100 * (zero + Math.min(n.value || 0, 0) / range) + "%";
    fill.style.width = 100 * Math.abs(n.value || 0) / range + "%";
    mark.append(fill); mark.setAttribute("aria-hidden", "true");
    row.append(button(groupLabel(g), () => openDetail(data, g.name), "row-link"), mark, node("span", n.display + " " + n.unit, "num"));
    chart.append(row);
  }
  return chart;
}
function renderAnswer(current = state.current, target = $("current-answer"), view = state) {
  if (!current) return;
  const {data, label} = current;
  const panel = presentAnswer(current, () => {
    const download = button("下载完整 Excel", () => view.download ? view.download(download) : exportResult(data,download));
    return [button("查看匹配明细", () => openDetail(data,null)),download];
  }, () => {
    const detail = node("div");
    renderInventoryLedger(current,detail,view);
    return detail;
  });
  if (panel) {
    const article = node("article",null,"answer");
    if (label) article.append(node("p",label,"user-question"));
    article.append(panel);
    target.replaceChildren(article);
  } else renderInventoryLedger(current,target,view);
}
function renderInventoryLedger(current, target, view) {
  const { data, label, manual } = current;
  const groupCount = data.groupCount ?? data.groups.length;
  const rerender = () => renderInventoryLedger(current,target,view);
  const article = node("article", null, "answer");
  const m = displayMetric(data);
  const metric = node("div", m.display, "metric"); metric.append(node("small", m.unit));
  const filters = filterText(data.plan.filters, data.roleEvidence?.kind);
  article.append(node("p", label, "question"), node("p", [manual ? "手动查询" : "库存问数", data.snapshot.date, filters].filter(Boolean).join(" · "), "meta"));
  const evidence = data.roleEvidence;
  if (evidence) article.append(node("p", evidenceLabels[evidence.kind] || "库存统计口径", "evidence-label"));
  if (data.measure) article.append(node("p",measureLabel(data.measure),"meta"));
  if (evidence?.kind !== "unknown") article.append(metric);
  if (["enhancement", "attribution"].includes(evidence?.kind) && data.plan.metric === "principal")
    article.append(node("p", "库存名义本金 " + yuan(data.totalCents) + " 元", "meta"));
  if (data.summary && (!data.measure || evidence) && ![("名义本金 " + m.display + " 亿元"), (String(data.rowCount) + " 条持仓记录"), (String(data.securityCount) + " 只不同券码")].includes(data.summary)) {
    article.append(node("p", data.summary, "summary"));
  }
  if (evidence?.kind !== "unknown") article.append(node("p", count(data.securityCount) + " 只券 · " + count(data.rowCount) + " 条持仓 · " + count(groupCount) + " 个分组", "tagline"));
  for (const warning of data.warnings || []) {
    const text = typeof warning === "string" ? warning : warning?.message;
    if (text) article.append(node("p", text, "warning"));
  }
  appendTrace(article, [...(data.trace || []), ...(data.plan.analysis ? analysisTrace(data.plan.analysis) : [])]);
  if (evidence?.kind === "unknown") {
    target.replaceChildren(article);
    return;
  }
  const analytical = Array.isArray(data.dimensions);
  const group = analytical ? data.dimensions.map(fieldLabel).join(" · ") || "合计" : groupNames[data.plan.group] || "分组";
  const rank = data.plan.rank;
  const previewSize = rank ? 100 : analytical ? 16 : 5;
  const chunk = data.groups.slice(0, view.expanded ? data.groups.length : previewSize);
  const heading = node("div", null, "result-head");
  heading.append(node("h3",rank ? "本金前" + rank.limit + "名" + groupNames[rank.by] + " · " + group :
    group + (groupCount > previewSize && !view.expanded ? analytical ? " · 显示前 "+previewSize+" 组" : " · 前五" : "")));
  const switches = node("div", null, "mode-switch");
  for (const [key, title] of [["table", "表格"], ["chart", "图表"]]) {
    const b = button(title, () => { view.view = key; rerender(); });
    b.setAttribute("aria-pressed", String(view.view === key)); switches.append(b);
  }
  heading.append(switches); article.append(heading);
  if (!chunk.length) article.append(node("p", "当前条件没有匹配持仓。", "meta"));
  else if (view.view === "chart") article.append(showChart(chunk, data));
  else if (analytical && data.dimensions.length===2 && !data.measure && chunk.length===groupCount &&
           new Set(chunk.map(g=>g.labels[1])).size<=8) {
    const cells=chunk.map(g=>({...g,rankName:g.labels[0],bucketName:g.labels[1]}));
    article.append(rankedTable(data,cells,true));
  } else if (analytical) article.append(analysisTable(data,chunk));
  else if (rank) article.append(rankedTable(data,chunk,chunk.length===groupCount));
  else article.append(table([group, "本金（亿元）", "不同券数", "持仓行数"], chunk.map((g) => [
    button(groupLabel(g), () => openDetail(data, g.name), "row-link"), billions(g.cents), count(g.securityCount), count(g.count),
  ]), [1, 2, 3]));
  const actions = node("div", null, "view-actions");
  if (groupCount > previewSize || data.groupsTruncated) actions.append(button(view.expanded ? "收起排名" : "查看全部 " + groupCount + " 组", async event => {
    if (!view.expanded && data.groupsTruncated) {
      const trigger = event.currentTarget;
      trigger.disabled = true;
      try {
        const whole = await json("answer?" + new URLSearchParams({id:data.resultId,chatId:view.chatId || state.chat.id}));
        if (!article.isConnected) return;
        if (whole.resultId !== data.resultId || !Array.isArray(whole.groups) || whole.groups.length !== groupCount)
          throw new Error("历史分组读取不完整，请重试。");
        data.groups = whole.groups;
        data.groupsTruncated = false;
      } catch (error) {
        if (article.isConnected) { notice("query-notice",error.message,true); trigger.disabled=false; }
        return;
      }
    }
    view.expanded = !view.expanded;
    const last = state.conversation.at(-1);
    if (current === state.current && !rank && !analytical && last?.choices && last.dimension === data.plan.group)
      last.choices = data.groups.slice(0,view.expanded ? 16 : 5).map(item => item.name);
    rerender();
  }));
  actions.append(button("查看匹配明细", () => openDetail(data, null)));
  const download = button("下载完整 Excel", () => view.download ? view.download(download) : exportResult(data, download)); actions.append(download); article.append(actions);
  const source = node("details", null, "source");
  source.append(node("summary", "口径与来源"), node("p", [data.snapshot.filename, data.snapshot.sheet, "快照业务日 " + data.snapshot.date].filter(Boolean).join(" · ")),
    node("p", (filters || "全部匹配范围") + "；人民币元汇总后换算为亿元。"));
  article.append(source);
  target.replaceChildren(article);
}
function archiveTurn(turn) {
  if (!turn) return;
  const {label,data,action,identityValue} = turn;
  const record = node("details", null, "record");
  record.append(node("summary",identityValue ? "选择" + identityValue : label));
  record.addEventListener("toggle",function populate() {
    if (!record.open) return;
    record.removeEventListener("toggle",populate);
    if (data.resultId) {
      const body = node("div");
      record.append(body);
      renderAnswer({label,data,manual:action==="manual"&&!identityValue},body,{view:"table",expanded:false});
      return;
    }
    if (data.overview?.length && !data.identity) {
      record.append(overviewArticle(data,"",false));
      return;
    }
    record.append(node("p",data.clarification));
    appendTrace(record,data.trace);
    if (data.identity) {
      const hints=data.identity.hints || [];
      if (hints.length) record.append(table(["发行人","券数","本金（亿元）"],hints.map(h=>[h.name,count(h.securityCount),billions(h.totalCents)]),[1,2]));
      const other=data.identity.candidates.filter(name=>!hints.some(h=>h.name===name));
      if (other.length) record.append(node("p",other.join("、")));
      if (data.overview?.length) record.append(overviewEvidence(data,false));
    }
  });
  $("history").append(record);
}
function rememberTurn(question, data) {
  const turn = { question };
  const applied = data.plan || data.resume;
  if (applied) {
    turn.filters = Object.fromEntries(Object.entries(applied.filters || {}).filter(([key,value]) =>
      key !== "portfolio" && typeof value === "string" && value));
    turn.metric = applied.metric;
  }
  if (data.identity) {
    const hints = (data.identity.hints || []).map(hint => hint.name);
    turn.dimension = hints.length ? "issuer" : data.identity.field;
    turn.choices = [...new Set([...hints, ...data.identity.candidates])];
  } else if (data.overview) {
    turn.dimension = "role";
    turn.choices = data.overview.map(item => item.title);
  } else if (Array.isArray(data.dimensions)) {
    turn.dimension=data.dimensions[0];
    if (["issuer","code","marketType","branch","scope","account"].includes(turn.dimension))
      turn.choices=[...new Set(data.groups.slice(0,16).map(g=>g.labels[0]))];
  } else if (data.plan?.rank) {
    turn.dimension=data.plan.rank.by;
    if (turn.dimension!=="portfolio") turn.choices=[...new Set(data.groups.map(g=>g.rankName))].slice(0,16);
  } else if (data.plan) {
    turn.dimension = data.plan.group;
    if (["issuer","code","marketType","branch","scope","account"].includes(turn.dimension))
      turn.choices = data.groups.slice(0,5).map(item => item.name);
  }
  if (data.clarification) turn.reply = data.clarification;
  state.conversation.push(turn);
  if (state.conversation.length > 8) state.conversation.shift();
}
function overviewArticle(data,label,mayContinue) {
  const article = node("article", null, "answer");
  if(label) article.append(node("p",label,"user-question"));
  const evidence=()=>overviewEvidence(data,mayContinue);
  article.append(presentAnswer(data,()=>[],evidence)||evidence());
  return article;
}
function overviewEvidence(data,mayContinue) {
  const article=node("div");
  article.append(node("p", data.clarification));
  appendTrace(article, data.trace);
  for (const {title,result} of data.overview) {
    const section = node("section", null, "source");
    section.append(node("h3",title));
    if (!result.resultId || result.roleEvidence?.kind === "unknown") {
      section.append(node("p", result.clarification || result.summary));
    } else if (!mayContinue) {
      const body=node("div");
      renderInventoryLedger({label:title,data:result},body,{view:"table",expanded:false});
      section.append(body);
    } else {
      section.append(node("p", result.snapshot.date + " · " + count(result.securityCount) + " 只 · " + billions(result.totalCents) + " 亿元"));
      if(result.groups.length) section.append(node("p",result.groups.slice(0,8).map(groupLabel).join("、") + (result.groups.length>8?" 等":"")));
      const actions = node("div",null,"view-actions");
      actions.append(button("查看并追问这组",()=>query("select",{
        previousResultId:result.resultId,snapshotId:result.snapshot.id,
      },title,data.trace)));
      const download=button("下载这组 Excel",()=>exportResult(result,download));actions.append(download);
      section.append(actions);
    }
    article.append(section);
  }
  return article;
}
function showIdentityChoice(data, label, options) {
  if (!options) state.current = null;
  const article = node("article", null, "answer identity-choice");
  const snapshot = options ? options.snapshot : currentSnapshot();
  const hints = Array.isArray(data.identity.hints) ? data.identity.hints : [];
  article.append(node("p", label, "question"), node("h3", data.identity.fullNameMiss ? "本期未查到该全称的持仓" : hints.length ? "按发行人查看" : "确认主体"));
  const primary = hints.filter(hint => hint.primary);
  const lead = primary.length === 1 ? primary[0] : null;
  if (lead) {
    const basis = lead.source?.startsWith("券码 ") ? "券码" : lead.source?.includes("全称完全匹配") ? "发行人全称" : "券简称";
    article.append(node("p", "按" + basis + "，“" + data.identity.query + "”最吻合" + lead.name +
      "。本期持有 " + count(lead.securityCount) + " 只，名义本金 " + billions(lead.totalCents) + " 亿元。"));
  } else article.append(node("p",data.clarification));
  if (snapshot) article.append(node("p", "库存日期 " + snapshot.date, "meta"));
  appendTrace(article, data.trace);
  const resolve = options?.resolve || ((value, scope = {}) => query("manual", { ...data.resume, ...scope, identityValue: value }, label, data.trace));
  if (hints.length) {
    const preview = table(["发行人", "券数", "本金（亿元）", "持仓举例", ""], hints.map(hint => {
      const issuer = node("span", hint.name);
      if (hint.source) issuer.append(node("small", hint.source));
      const examples = (hint.securities || []).map(bond => [bond.name, bond.code].filter(Boolean).join(" · ")).join("、");
      const inspect = button("查看这家", () => resolve(hint.name, { field:"issuer", group:"code" }));
      inspect.setAttribute("aria-label", "查看" + hint.name);
      return [issuer, count(hint.securityCount), billions(hint.totalCents), examples || "—", inspect];
    }), [1, 2]);
    const scroll = node("div", null, "identity-preview");
    scroll.append(preview);
    article.append(scroll);
  }
  const choices = node("div", null, "view-actions");
  const previews = new Set(hints.map(hint => hint.name));
  for (const name of data.identity.candidates) {
    if (!previews.has(name)) choices.append(button(name, () => resolve(name)));
  }
  if (choices.childElementCount) article.append(choices);
  const form = node("form", null, "identity-form");
  const field = node("label", "主体全称或完整券码", "field");
  const input = node("input");
  input.required = true;
  input.maxLength = 160;
  input.placeholder = "例如：102481748.IB";
  field.append(input);
  const submit = node("button", "核对", "secondary");
  submit.type = "submit";
  form.append(field, submit);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (input.value.trim()) resolve(input.value.trim());
  });
  article.append(form);
  (options?.target || $("current-answer")).replaceChildren(article);
}
function syncAnswerSnapshot(id) {
  if (id && state.snapshots.some(snapshot => snapshot.id === id)) {
    state.selected = id;
    $("snapshot-picker").value = id;
  }
}
function applyTurn(turn, live) {
  const {action,identityValue,previousResultId,data,label} = turn;
  if (!data.clarification && (!data.resultId || !Array.isArray(data.groups) || !data.snapshot || !data.plan))
    throw new Error("问数服务返回的数据不完整。");
  archiveTurn(state.currentTurn);
  state.currentTurn = turn;
  const turnLabel = identityValue ? "选择" + identityValue : label;
  const manual = action === "manual" && (!identityValue || state.pending?.manual);
  rememberTurn(action === "manual" && !identityValue ? "手动查询库存" : turnLabel,data);
  if (data.clarification) {
    state.current = null;
    state.pending = {label:turnLabel, reply:data.clarification,previousResultId};
    if (data.identity && data.resume) {
      Object.assign(state.pending,{kind:"identity",manual});
      syncAnswerSnapshot(data.resume.snapshotId);
      showIdentityChoice(data,turnLabel);
    } else if (Array.isArray(data.overview)) {
      $("current-answer").replaceChildren(overviewArticle(data,turnLabel,true));
    } else {
      const article = node("article",null,"answer");
      article.append(node("p",turnLabel,"question"),node("p",data.clarification));
      appendTrace(article,data.trace);
      $("current-answer").replaceChildren(article);
    }
  } else {
    state.current = {label:turnLabel,manual,data};
    state.pending = null;
    if (data.snapshot.id === state.chat?.snapshotId) state.chatSnapshot = data.snapshot;
    syncAnswerSnapshot(data.snapshot.id);
    state.expanded = false; state.view = "table";
    renderAnswer();
    if (action === "manual") $("manual").open=false;
  }
  if (live) {
    $("question").value = "";
    notice("query-notice");
    $("current-answer").scrollIntoView({block:"start"});
  }
}
function displayChat(chat) {
  if (!chat.snapshot?.id || !Array.isArray(chat.turns) || !chat.turns.length)
    throw new Error("保存的对话读取不完整。");
  resetConversation();
  state.chat = {id:chat.id,version:chat.version,snapshotId:chat.snapshotId};
  state.chatSnapshot = chat.snapshot;
  state.selected = chat.snapshot.id;
  // Every saved turn remains readable, while only recent turns go into a follow-up.
  for (const turn of chat.turns.slice(0,-1)) {
    archiveTurn(turn);
    const question = turn.identityValue ? "选择" + turn.identityValue : turn.action === "manual" ? "手动查询库存" : turn.label;
    rememberTurn(question,turn.data);
  }
  applyTurn(chat.turns.at(-1),false);
  state.selected = chat.snapshot.id;
  showSnapshots();
  markChat(chat.id);
}
async function openChat(id) {
  const nav = ++state.navigation;
  state.loadingChat = true;
  renderControls();
  notice("query-notice","正在读取已保存的对话…");
  try {
    const chat = await json("chat?" + new URLSearchParams({id}));
    if (nav !== state.navigation) return false;
    displayChat(chat);
    if ($("chat-dialog").open) $("chat-dialog").close();
    notice("query-notice");
    return true;
  } catch (error) {
    if (nav === state.navigation) {
      notice("query-notice",error.message,true);
      if ($("chat-dialog").open) $("chat-list-status").textContent=error.message;
    }
    throw error;
  } finally {
    if (nav===state.navigation) {state.loadingChat=false;renderControls();}
  }
}
async function loadChatList(append=false) {
  const seq=++state.chatListVersion;
  $("chat-list-status").textContent="正在加载…";
  $("more-chats").hidden=true;
  if (!append) $("chat-list").replaceChildren();
  try {
    const page=await json("chats"+(append?"?"+new URLSearchParams({cursor:state.nextCursor}):""));
    if(seq!==state.chatListVersion)return;
    for(const item of page.chats) {
      const row=button("",()=>{if (!state.loadingChat) openChat(item.id).catch(()=>{});});
      row.append(node("strong",item.title),node("small",new Date(item.updatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}),"meta"));
      row.setAttribute("aria-current",String(item.id===state.chat?.id));
      $("chat-list").append(row);
    }
    state.nextCursor=page.nextCursor;
    $("more-chats").hidden=!page.nextCursor;
    $("chat-list-status").textContent=$("chat-list").childElementCount ? "" : "还没有已保存的对话。";
  } catch(error) {
    if(seq!==state.chatListVersion)return;
    $("chat-list-status").textContent=error.message;
    if (append) $("more-chats").hidden=false;
  }
}
async function initialize() {
  let nav=state.navigation;
  await refresh();
  if (nav!==state.navigation) return;
  try {
    const requested=new URL(location.href).searchParams.get("chat");
    if (requested==="new") return;
    let last;
    try {last=localStorage.getItem(lastChatKey);} catch {}
    if (requested || (last && last!=="new")) {
      nav=state.navigation+1;
      try {await openChat(requested || last);return;}
      catch(error) {
        if (nav!==state.navigation || requested || error.status!==404) return;
        state.loadingChat=true;
        renderControls();
        try {localStorage.removeItem(lastChatKey);} catch {}
      }
    }
    const {chats}=await json("chats");
    if (nav!==state.navigation) return;
    if (chats.length) await openChat(chats[0].id);
    else notice("query-notice");
  } catch (error) {if (nav===state.navigation) notice("query-notice",error.message,true);}
  finally {if (nav===state.navigation) {state.loadingChat=false;renderControls();}}
}
async function query(path, payload, label, parentTrace) {
  if (state.askController || state.loadingChat || !state.selected) return;
  const controller = new AbortController();
  state.askController = controller;
  renderControls();
  notice("query-notice",path==="ask" ? "正在解析问题并核对库存…" : "正在读取库存结果…");
  const signature=JSON.stringify([path,payload,label,state.chat?.id,state.chat?.version]);
  const retry=state.retry?.signature===signature ? state.retry : {
    signature,chatId:state.chat?.id || crypto.randomUUID(),requestId:crypto.randomUUID()
  };
  state.retry=retry;
  try {
    const input={...payload,label,chatId:retry.chatId,requestId:retry.requestId,version:state.chat?.version || 0};
    const response=await json(path,{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
    if (state.askController!==controller)return;
    const {chat,...answer}=response;
    if (chat?.id!==retry.chatId || !Number.isInteger(chat.version)) throw new Error("服务未确认对话已保存，请重试。");
    state.chat=chat;
    state.retry=null;
    markChat(chat.id);
    const data=withParentTrace(answer,parentTrace);
    const snap=data.snapshot || data.overview?.find(i=>i.result?.snapshot)?.result.snapshot;
    state.chatSnapshot = snap || state.snapshots.find(s=>s.id===chat.snapshotId) || state.chatSnapshot;
    if (state.selected !== chat.snapshotId) {
      state.selected=chat.snapshotId;
      showSnapshots();
    }
    const previousResultId=payload.previousResultId || state.pending?.previousResultId;
    applyTurn({label,data,action:path,identityValue:payload.identityValue,previousResultId},true);
  } catch(error) {
    if (state.askController!==controller || error.name==="AbortError")return;
    if (error.status===409 && error.data?.code==="chat_conflict") {
      const draft=$("question").value;
      try {
        await openChat(retry.chatId);
        $("question").value=draft;
        notice("query-notice","这段对话在另一页面有更新，已载入最新对话。可以继续提问。");
      } catch {}
    } else notice("query-notice",error.message,true);
  } finally {
    if (state.askController===controller) {state.askController=null;renderControls();}
  }
}
async function exportResult(data, trigger) {
  trigger.disabled = true;
  const previous = trigger.textContent;
  trigger.textContent = "正在生成 Excel…";
  try {
    const response = await request("export?" + new URLSearchParams({ id: data.resultId }));
    const type = response.headers.get("Content-Type") || "";
    if (!/spreadsheetml|octet-stream|application\/zip/i.test(type)) throw new Error("导出未返回 Excel 文件。");
    const file = await response.blob();
    const url = URL.createObjectURL(file);
    const a = node("a"); a.href = url; a.download = "库存问数_" + data.snapshot.date + "_" + data.resultId.slice(0, 8) + ".xlsx";
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { notice("query-notice", error.message, true); }
  finally { trigger.disabled = false; trigger.textContent = previous; }
}
function openDetail(data, group) {
  state.detailGroup = { id: data.resultId, group,role:data.roleEvidence }; state.offsets = [0];
  const cell = (data.plan.rank || data.dimensions) && data.groups.find(item=>item.name===group);
  $("detail-title").textContent = group === null ? "全部匹配持仓" : cell ? groupLabel(cell) : groupName(group);
  $("detail-meta").textContent = data.snapshot.date + " · " + data.snapshot.filename;
  if (!$("detail").open) $("detail").showModal();
  fetchDetail();
}
async function fetchDetail() {
  state.detailController?.abort();
  const controller = new AbortController(); state.detailController = controller;
  const offset = state.offsets.at(-1), { id, group } = state.detailGroup;
  const params = new URLSearchParams({ id, offset: String(offset) }); if (group !== null) params.set("group", group);
  $("detail-prev").disabled = true; $("detail-next").disabled = true; $("detail-range").textContent = "";
  $("detail-body").replaceChildren(node("p","正在读取明细…","meta"));
  try {
    const data = await json("detail?" + params, { signal: controller.signal });
    if (state.detailController !== controller) return;
    const rows = data.rows;
    state.detailRows = rows.length;
    if (!rows.length) $("detail-body").replaceChildren(node("p", "当前条件没有匹配持仓。", "meta"));
    else {
      const role = state.detailGroup.role;
      const columns = ["发行人 / 券名", "券码", "联动分行 / 组合", "本金（元）", "原表行号","会计科目"];
      columns.push("债券类型");
      if (role) columns.push(role.kind === "enhancement" ? "增信占用方" : role.kind === "attribution" ? "损益还原客户" : "台账担保人 / 损益还原客户");
      const t = table(columns, rows.map(r => {
        const name = node("span", r.issuer || "未填写"), ledger = node("span", r.branch || "未填写");
        name.append(node("small", r.name || "—")); ledger.append(node("small", [r.scope, r.portfolio].filter(Boolean).join(" · ")));
        const cells = [name, r.code, ledger, yuan(r.cents), r.sourceRow,r.queryAccount || r.account || "未填写"];
        const type = node("span", r.queryMarketType || r.marketType || "未填写");
        if (r.queryMarketType && r.marketType && r.queryMarketType !== r.marketType) type.append(node("small", "原表：" + r.marketType));
        cells.push(type);
        if (role) {
          const byCustomer = ["enhancement", "attribution"].includes(role.kind);
          const evidence = node("span", (byCustomer ? r.attribution : r.guarantor) || "未列明");
          if (!byCustomer) evidence.append(node("small", r.attribution || "未填写"));
          cells.push(evidence);
        }
        return cells;
      }), [3, 4]);
      t.className = "detail-table"; $("detail-body").replaceChildren(t);
    }
    $("detail-range").textContent = rows.length ? (offset + 1) + "–" + (offset + rows.length) + " / " + count(data.total) : "0 条";
    $("detail-prev").disabled = state.offsets.length < 2;
    $("detail-next").disabled = !rows.length || offset + rows.length >= data.total;
  } catch (error) {
    if (state.detailController === controller && error.name !== "AbortError") {
      $("detail-body").replaceChildren(node("p",error.message,"warning"),button("重试",fetchDetail));
    }
  }
}
const uploadLabels={pending:"待上传",sending:"正在上传",published:"已发布",reused:"已有相同文件",conflict:"待确认替换",failed:"失败",skipped:"已跳过"};
const uploadToday=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const currentUploadYear=Number(uploadToday.slice(0,4));

function folderDate(name,year) {
  const match=/^余额台账[ _-]?(\d{4}|\d{2})(\d{2})(\d{2})\.xlsx$/i.exec(name);
  if (!match) return "";
  const yyyy=match[1].length===2 ? "20"+match[1] : match[1];
  if (Number(yyyy)!==year) return "";
  const day=[yyyy,match[2],match[3]].join("-");
  const time=Date.parse(day+"T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(day) && day<=uploadToday ? day : "";
}
function queueFiles(input,year) {
  if (state.uploading) return;
  const files=Array.from(input.files);
  input.value="";
  if (!files.length) return;
  let selected=files;
  if (year!==undefined) {
    if (!Number.isInteger(year) || year<2000 || year>currentUploadYear) {
      notice("folder-notice","请输入 2000 至 "+currentUploadYear+" 的年份，再选择文件夹。",true);
      return;
    }
    selected=files.filter(file=>folderDate(file.name,year)).sort((a,b)=>folderDate(a.name,year).localeCompare(folderDate(b.name,year)) || a.webkitRelativePath.localeCompare(b.webkitRelativePath));
    notice("folder-notice",year+" 年找到 "+selected.length+" 份余额台账，略过 "+(files.length-selected.length)+" 个文件。按“余额台账＋日期.xlsx”选取，其他命名可用“选择 Excel 文件”添加。");
  } else notice("folder-notice");
  if (!selected.length) return;
  if (state.uploads.every(item=>["published","reused","skipped"].includes(item.status))) state.uploads=[];
  for (const file of selected) state.uploads.push({file,year,status:"pending",detail:""});
  renderUploads();
}
function renderUploads() {
  const items=state.uploads, totals={};
  const list=$("upload-list");
  list.replaceChildren();
  for (const item of items) {
    totals[item.status]=(totals[item.status] || 0)+1;
    const row=node("li",null,"upload-item"), info=node("div"), actions=node("div",null,"inline-actions");
    row.dataset.state=item.status;
    info.append(node("strong",item.file.webkitRelativePath || item.file.name),
      node("p",[uploadLabels[item.status],item.detail].filter(Boolean).join(" · "),"meta"));
    if (item.status==="conflict") actions.append(button("确认替换",()=>uploadFiles([item],item.conflict.previousId),"primary"));
    if (item.status==="failed") actions.append(button("重试",()=>uploadFiles([item])));
    if (["pending","failed","conflict"].includes(item.status)) {
      actions.append(button(item.status==="pending"?"移除":"跳过",()=>{
        if (item.status==="pending") state.uploads=state.uploads.filter(other=>other!==item);
        else {item.status="skipped";item.detail="";}
        renderUploads();
      }));
    }
    for (const action of actions.children) action.disabled=state.uploading;
    row.append(info,actions);list.append(row);
  }
  list.hidden=!items.length;
  $("file-name").textContent=items.length ? "本批 "+count(items.length)+" 份" : "尚未选择文件";
  $("upload").textContent=state.uploading ? "上传中…" : totals.pending>1 ? "上传并发布 "+count(totals.pending)+" 份" : "上传并发布";
  $("upload").disabled=state.uploading || !totals.pending;
  $("clear-upload").hidden=!items.length;
  for (const id of ["file","folder","upload-year","clear-upload","open-upload"]) $(id).disabled=state.uploading;
  const summary=Object.entries(uploadLabels).filter(([key])=>totals[key]).map(([key,label])=>label+" "+count(totals[key])+" 份");
  notice("upload-notice",summary.length && (state.uploading || items.some(item=>item.status!=="pending"))
    ? summary.join(" · ")+(state.uploading?"。上传期间请保持此页打开。":"") : "");
}
async function uploadFiles(items,replaceId) {
  if (state.uploading || !items.length) return;
  state.uploading=true;
  let published;
  try {
    for (const item of items) {
      item.status="sending";item.detail="";renderUploads();
      try {
        const file=item.file;
        if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("请选择 .xlsx 格式的库存工作簿。");
        const headers={"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","X-File-Name":encodeURIComponent(file.name)};
        if (item.year!==undefined) headers["X-Inventory-Year"]=String(item.year);
        if (replaceId) headers["X-Replace-Id"]=replaceId;
        const result=await json("upload",{method:"POST",headers,body:file});
        const snapshot=result.snapshot || result;
        if (!snapshot.id || !snapshot.date || !Number.isSafeInteger(snapshot.rowCount) || !Number.isSafeInteger(snapshot.totalCents))
          throw new Error("无法核对服务器返回的快照，请重试。");
        item.status=snapshot.reused?"reused":"published";
        item.detail=snapshot.date+" · "+count(snapshot.rowCount)+" 条 · "+billions(snapshot.totalCents)+" 亿元";
        item.snapshot=snapshot;
        published=snapshot;
      } catch (error) {
        const d=error.data;
        if (error.status===409 && d?.code==="revision_required" && d.previousId) {
          item.status="conflict";item.conflict=d;
          const date=d.date || state.snapshots.find(s=>s.id===d.previousId)?.date || state.uploads.find(i=>i.snapshot?.id===d.previousId)?.snapshot.date;
          item.detail=[date,"现有 "+count(d.previousCount)+" 条 / "+billions(d.previousCents)+" 亿元，新表 "+count(d.nextCount)+" 条 / "+billions(d.nextCents)+" 亿元。"].filter(Boolean).join(" · ");
        } else {item.status="failed";item.detail=error.message;}
      }
    }
    if (published) await refreshAfterUpload(state.uploads.length===1 ? published.id : undefined);
  } finally {
    state.uploading=false;renderUploads();
  }
}
let refreshAfterUpload = refresh;
function showTradeShortcut() {
  $("trade-shortcut").hidden = !/(?:增持|减持|买入|卖出|交易流水|交易量)/.test($("question").value);
}
function bindInventoryPage() {
$("question").addEventListener("input",showTradeShortcut);
$("trade-draft").addEventListener("click",() => {
  try {sessionStorage.setItem("bond-centre.trade.draft",$("question").value.trim());} catch {}
});
$("ask-form").addEventListener("submit", event => {
  event.preventDefault();
  const label = $("question").value.trim();
  if (!label || !state.configured) return;
  query("ask", { question:label, conversation:state.conversation, snapshotId: state.selected, previousResultId: state.current?.data.resultId || state.pending?.previousResultId, effort: $("effort").value }, label);
});
$("question").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); if (!$("submit").disabled) $("ask-form").requestSubmit();
  }
});
$("manual-form").addEventListener("submit", event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const { group, metric, ...fields } = values;
  const filters = Object.fromEntries(Object.entries(fields).map(([k,v]) => [k, v.trim()]).filter(([,v]) => v));
  query("manual", { group, metric, filters, snapshotId: state.selected }, "手动查询 · " + (filterText(filters) || "全部库存") + " · " + groupNames[group]);
});
$("snapshot-picker").addEventListener("change", () => chooseSnapshot($("snapshot-picker").value));
$("reset").addEventListener("click", () => location.assign("./?chat=new"));
$("open-chats").addEventListener("click",()=>{ $("chat-dialog").showModal(); loadChatList(); });
$("more-chats").addEventListener("click",()=>loadChatList(true));
$("close-chats").addEventListener("click",()=>$("chat-dialog").close());
$("refresh").addEventListener("click", () => refresh());
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
$("open-upload").addEventListener("click", () => {
  switchTab("data");
  $("upload-form").scrollIntoView({ block: "start" });
  $("file").focus({ preventScroll: true });
  $("file").click();
});
switchTab(location.hash === "#upload-form" ? "data" : "ask");
}
function bindInventoryTools() {
$("upload-year").value=String(currentUploadYear);
$("upload-year").max=String(currentUploadYear);
$("folder-controls").hidden=!("webkitdirectory" in $("folder"));
$("file").addEventListener("change",e=>queueFiles(e.currentTarget));
$("folder").addEventListener("change",e=>queueFiles(e.currentTarget,$("upload-year").valueAsNumber));
$("clear-upload").addEventListener("click",()=>{state.uploads=[];notice("folder-notice");renderUploads();});
$("upload-form").addEventListener("submit",e=>{e.preventDefault();uploadFiles(state.uploads.filter(item=>item.status==="pending"));});
$("close-detail").addEventListener("click", () => $("detail").close());
$("detail").addEventListener("close", () => { state.detailController?.abort(); state.detailController = null; });
$("detail-prev").addEventListener("click", () => { if (state.offsets.length > 1) { state.offsets.pop(); fetchDetail(); } });
$("detail-next").addEventListener("click", () => { state.offsets.push(state.offsets.at(-1) + state.detailRows); fetchDetail(); });
}

export function setupJointInventory(onUpload) {
  refreshAfterUpload = onUpload;
  bindInventoryTools();
}
export function showJointSnapshots(snapshots, selected, onSelect) {
  state.snapshots = snapshots;
  state.selected = selected;
  showSnapshots(onSelect);
}
export {renderAnswer as renderInventoryAnswer,renderInventoryLedger,showIdentityChoice as renderInventoryIdentity,openDetail as openInventoryDetail};
if (document.body.dataset.workspace !== "joint") {
  bindInventoryPage();
  bindInventoryTools();
  initialize().then(()=>{if(location.hash==="#manual") $("manual").open=true;});
}
