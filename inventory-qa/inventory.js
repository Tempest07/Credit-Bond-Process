"use strict";

const $ = (id) => document.getElementById(id);
const api = "../api/inventory/";
const groupNames = { issuer: "发行人", branch: "联动分行", portfolio: "交易组合", scope: "持仓范围", account: "会计分类", marketType: "债券类型", code: "逐券", none: "全部持仓" };
const filterNames = { ...groupNames, code: "券码", holdingStatus: "台账状态", guarantor: "查询担保人", attribution: "损益还原客户" };
const evidenceLabels = { enhancement: "增信占用 · 按损益还原客户统计", candidate: "待核实 · 损益还原客户匹配", unknown: "台账信息不足", ledger: "台账列明的担保人", attribution: "客户占用 · 按损益还原客户统计" };
const number = new Intl.NumberFormat("zh-CN");
const decimal = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yuan = (cents) => Number.isFinite(cents) ? decimal.format(cents / 100) : "—";
const billions = (cents) => Number.isFinite(cents) ? decimal.format(cents / 1e10) : "—";
const count = (n) => Number.isFinite(n) ? number.format(n) : "—";
const state = {
  snapshots: [], configured: false, selected: "", current: null, pending: null,
  statusVersion: 0, askController: null, uploading: false, revision: null, view: "table", expanded: false,
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
  state.expanded = false;
  state.view = "table";
  if ($("detail").open) $("detail").close();
  $("question").value = "";
  $("current-answer").replaceChildren();
  $("history").replaceChildren();
  notice("query-notice");
  renderControls();
}
function chooseSnapshot(id) {
  if (state.selected !== id) { state.selected = id; resetConversation(); }
  $("snapshot-picker").value = id;
  renderControls();
}
function renderControls() {
  const snap = state.snapshots.find((item) => item.id === state.selected);
  const busy = Boolean(state.askController);
  $("snapshot-context").textContent = snap
    ? snap.filename + " · " + count(snap.rowCount) + " 条持仓"
    : "当前没有可查询的有效快照。";
  $("query-workspace").hidden = !snap;
  $("empty").hidden = Boolean(snap);
  $("snapshot-picker").disabled = !snap;
  $("submit").disabled = busy || !snap || !state.configured;
  $("question").disabled = !snap || !state.configured;
  $("effort").disabled = busy || !state.configured;
  $("reset").hidden = !state.current && !state.pending && !busy;
  $("submit").textContent = busy ? "查询中…" : state.current || state.pending ? "追问 ↑" : "提问 ↑";
  $("compose-heading").textContent = state.current || state.pending ? "继续追问" : "向库存提问";
  $("ai-status").textContent = !state.configured ? "问数专用 API Key 待配置。你可以先使用手动查询。" : "";
  for (const el of $("manual-form").elements) el.disabled = busy || !snap;
  $("suggestions").replaceChildren();
  if (state.configured) {
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
function showSnapshots() {
  const select = $("snapshot-picker");
  select.replaceChildren();
  const list = $("snapshot-list");
  list.replaceChildren();
  $("snapshot-count").textContent = state.snapshots.length + " 个业务日";
  for (const snapshot of state.snapshots) {
    const opt = node("option", snapshot.date); opt.value = snapshot.id; select.append(opt);
    const item = node("div", null, "snap-row"), info = node("div");
    info.append(node("strong", snapshot.date), node("p", snapshot.filename), node("p", count(snapshot.rowCount) + " 条 · 名义本金 " + billions(snapshot.totalCents) + " 亿元", "meta"));
    item.append(info, button("用此快照问数", () => { chooseSnapshot(snapshot.id); switchTab("ask"); }));
    list.append(item);
  }
  if (!state.snapshots.length) { list.append(node("p", "尚无已发布快照。", "meta")); select.append(node("option", "暂无快照")); }
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
    const selected = state.snapshots.some((s) => s.id === wanted) ? wanted : state.snapshots[0]?.id || "";
    if (selected !== state.selected) { state.selected = selected; resetConversation(); }
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
function groupLabel(g) { return g.securityName ? g.securityName + " · " + g.name : groupName(g.name); }
function showChart(groups, metric, data) {
  const chart = node("div", null, "viz");
  chart.setAttribute("aria-label", "按当前指标排序的分组条形图");
  const values = groups.map((g) => amountValue(metric, g, true).value || 0);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1;
  const zero = -min / range;
  for (const g of groups) {
    const n = amountValue(metric, g, true);
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
function renderAnswer() {
  if (!state.current) return;
  const { data, label, manual } = state.current;
  const article = node("article", null, "answer");
  const m = amountValue(data.plan.metric, data);
  const metric = node("div", m.display, "metric"); metric.append(node("small", m.unit));
  const filters = filterText(data.plan.filters, data.roleEvidence?.kind);
  article.append(node("p", label, "question"), node("p", [manual ? "手动查询" : "库存问数", data.snapshot.date, filters].filter(Boolean).join(" · "), "meta"));
  const evidence = data.roleEvidence;
  if (evidence) article.append(node("p", evidenceLabels[evidence.kind] || "库存统计口径", "evidence-label"));
  if (evidence?.kind !== "unknown") article.append(metric);
  if (["enhancement", "attribution"].includes(evidence?.kind) && data.plan.metric === "principal")
    article.append(node("p", "库存名义本金 " + yuan(data.totalCents) + " 元", "meta"));
  if (data.summary && ![("名义本金 " + m.display + " 亿元"), (String(data.rowCount) + " 条持仓记录"), (String(data.securityCount) + " 只不同券码")].includes(data.summary)) {
    article.append(node("p", data.summary, "summary"));
  }
  if (evidence?.kind !== "unknown") article.append(node("p", count(data.securityCount) + " 只券 · " + count(data.rowCount) + " 条持仓 · " + count(data.groups.length) + " 个分组", "tagline"));
  for (const warning of data.warnings || []) {
    const text = typeof warning === "string" ? warning : warning?.message;
    if (text) article.append(node("p", text, "warning"));
  }
  if (evidence?.kind === "unknown") {
    $("current-answer").replaceChildren(article);
    return;
  }
  const group = groupNames[data.plan.group] || "分组";
  const chunk = data.groups.slice(0, state.expanded ? data.groups.length : 5);
  const heading = node("div", null, "result-head");
  heading.append(node("h3", group + (data.groups.length > 5 && !state.expanded ? " · 前五" : "")));
  const switches = node("div", null, "mode-switch");
  for (const [key, title] of [["table", "表格"], ["chart", "图表"]]) {
    const b = button(title, () => { state.view = key; renderAnswer(); });
    b.setAttribute("aria-pressed", String(state.view === key)); switches.append(b);
  }
  heading.append(switches); article.append(heading);
  if (!chunk.length) article.append(node("p", "当前条件没有匹配持仓。", "meta"));
  else if (state.view === "chart") article.append(showChart(chunk, data.plan.metric, data));
  else article.append(table([group, "本金（亿元）", "不同券数", "持仓行数"], chunk.map((g) => [
    button(groupLabel(g), () => openDetail(data, g.name), "row-link"), billions(g.cents), count(g.securityCount), count(g.count),
  ]), [1, 2, 3]));
  const actions = node("div", null, "view-actions");
  if (data.groups.length > 5) actions.append(button(state.expanded ? "收起排名" : "查看全部 " + data.groups.length + " 组", () => { state.expanded = !state.expanded; renderAnswer(); }));
  actions.append(button("查看匹配明细", () => openDetail(data, null)));
  const download = button("下载完整 Excel", () => exportResult(data, download)); actions.append(download); article.append(actions);
  const source = node("details", null, "source");
  source.append(node("summary", "口径与来源"), node("p", [data.snapshot.filename, data.snapshot.sheet, "快照业务日 " + data.snapshot.date].filter(Boolean).join(" · ")),
    node("p", (filters || "全部匹配范围") + "；人民币元汇总后换算为亿元。"));
  article.append(source);
  $("current-answer").replaceChildren(article);
}
function rememberAnswer() {
  if (!state.current) return;
  const { label, data } = state.current;
  const record = node("details", null, "record");
  record.append(node("summary", label), node("p", data.snapshot.date + " · " + data.summary));
  if (data.roleEvidence?.kind !== "unknown") {
    const b = button("下载本次完整结果", () => exportResult(data, b)); record.append(b);
  }
  $("history").append(record);
}
function showSubjectOverview(data, label) {
  rememberAnswer();
  state.current = null;
  const article = node("article", null, "answer");
  article.append(node("p", label, "question"),node("p", data.clarification));
  for (const {title,result} of data.overview) {
    const section = node("section", null, "source");
    section.append(node("h3",title));
    if (!result.resultId || result.roleEvidence?.kind === "unknown") {
      section.append(node("p", result.clarification || result.summary));
    } else {
      section.append(node("p", result.snapshot.date + " · " + count(result.securityCount) + " 只 · " + billions(result.totalCents) + " 亿元"));
      if(result.groups.length) section.append(node("p",result.groups.slice(0,8).map(groupLabel).join("、") + (result.groups.length>8?" 等":"")));
      const actions = node("div",null,"view-actions");
      actions.append(button("查看并追问这组",()=>{
        state.current={label:label+" · "+title,data:result}; state.pending=null;
        state.expanded=true;state.view="table";renderAnswer();renderControls();notice("query-notice");
      }));
      const download=button("下载这组 Excel",()=>exportResult(result,download));actions.append(download);
      section.append(actions);
    }
    article.append(section);
  }
  $("current-answer").replaceChildren(article);
  article.scrollIntoView({block:"start"});
}
async function query(path, payload, label) {
  if (state.askController || !state.selected) return;
  const controller = new AbortController();
  state.askController = controller;
  renderControls();
  notice("query-notice", path === "ask" ? "正在解析问题并核对库存…" : "正在汇总库存…");
  try {
    const data = await json(path, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (state.askController !== controller) return;
    if (data.clarification) {
      state.pending = { question: payload.question, clarification: String(data.clarification), previousResultId:payload.previousResultId };
      if(Array.isArray(data.overview)){showSubjectOverview(data,label);notice("query-notice");}
      else notice("query-notice", data.clarification);
      $("question").value = ""; $("question").focus();
      return;
    }
    if (!data.resultId || !Array.isArray(data.groups) || !data.snapshot || !data.plan) throw new Error("问数服务返回的数据不完整。");
    rememberAnswer();
    state.pending = null;
    state.current = { label, manual: path === "manual", data };
    state.expanded = false; state.view = "table";
    $("question").value = "";
    renderAnswer(); notice("query-notice");
    if (path === "manual") $("manual").open = false;
    $("current-answer").scrollIntoView({ block: "start" });
  } catch (error) {
    if (state.askController === controller && error.name !== "AbortError") notice("query-notice", error.message, true);
  } finally {
    if (state.askController === controller) { state.askController = null; renderControls(); }
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
  state.detailGroup = { id: data.resultId, group }; state.offsets = [0];
  $("detail-title").textContent = group === null ? "全部匹配持仓" : groupName(group);
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
      const role = state.current?.data.resultId === id ? state.current.data.roleEvidence : null;
      const columns = ["发行人 / 券名", "券码", "联动分行 / 组合", "本金（元）", "原表行号"];
      columns.push("债券类型");
      if (role) columns.push(role.kind === "enhancement" ? "增信占用方" : role.kind === "attribution" ? "损益还原客户" : "台账担保人 / 损益还原客户");
      const t = table(columns, rows.map(r => {
        const name = node("span", r.issuer || "未填写"), ledger = node("span", r.branch || "未填写");
        name.append(node("small", r.name || "—")); ledger.append(node("small", [r.scope, r.portfolio].filter(Boolean).join(" · ")));
        const cells = [name, r.code, ledger, yuan(r.cents), r.sourceRow];
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
function clearRevision() { state.revision = null; $("revision").hidden = true; }
async function upload(replaceId) {
  const file = $("file").files[0];
  if (!file || state.uploading) return;
  if (!file.name.toLowerCase().endsWith(".xlsx")) { notice("upload-notice","请使用 .xlsx 格式的库存工作簿。",true); return; }
  state.uploading = true; $("file").disabled = true; $("upload").disabled = true; $("replace").disabled = true; $("open-upload").disabled = true;
  notice("upload-notice", "正在校验文件并上传至云端知识库…");
  try {
    const headers = { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-File-Name": encodeURIComponent(file.name) };
    if (replaceId) headers["X-Replace-Id"] = replaceId;
    const result = await json("upload", { method: "POST", headers, body: file });
    const snapshot = result.snapshot || result;
    clearRevision(); $("file").value = ""; $("file-name").textContent = "尚未选择文件";
    const outcome = snapshot.reused ? " 已有相同文件，沿用原快照" : " 库存已就绪";
    notice("upload-notice", snapshot.date + outcome + "，" + count(snapshot.rowCount) + " 条，名义本金 " + billions(snapshot.totalCents) + " 亿元。");
    await refresh(snapshot.id);
  } catch (error) {
    const data = error.data;
    if (error.status === 409 && data?.code === "revision_required" && data.previousId) {
      state.revision = data.previousId;
      $("revision-message").textContent = "现有 " + count(data.previousCount) + " 条 / " + billions(data.previousCents) + " 亿元；新表 " + count(data.nextCount) + " 条 / " + billions(data.nextCents) + " 亿元。仅替换同一业务日的完整快照。";
      $("revision").hidden = false; notice("upload-notice");
    } else { clearRevision(); notice("upload-notice", error.message, true); }
  } finally {
    state.uploading = false; $("file").disabled = false; $("upload").disabled = !$("file").files.length || Boolean(state.revision); $("replace").disabled = false; $("open-upload").disabled = false;
  }
}
$("ask-form").addEventListener("submit", event => {
  event.preventDefault();
  const label = $("question").value.trim();
  if (!label || !state.configured) return;
  const question = state.pending ? "原问题：" + state.pending.question + "\n待澄清：" + state.pending.clarification + "\n用户补充：" + label : label;
  query("ask", { question, snapshotId: state.selected, previousResultId: state.current?.data.resultId || state.pending?.previousResultId, effort: $("effort").value }, label);
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
$("reset").addEventListener("click", () => { resetConversation(); $("question").focus(); });
$("refresh").addEventListener("click", () => refresh());
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
$("open-upload").addEventListener("click", () => {
  switchTab("data");
  $("upload-form").scrollIntoView({ block: "start" });
  $("file").focus({ preventScroll: true });
  $("file").click();
});
switchTab(location.hash === "#upload-form" ? "data" : "ask");
$("file").addEventListener("change", () => {
  clearRevision(); notice("upload-notice"); const f = $("file").files[0];
  $("file-name").textContent = f?.name || "尚未选择文件"; $("upload").disabled = !f;
});
$("upload-form").addEventListener("submit", e => { e.preventDefault(); if (!state.revision) upload(); });
$("replace").addEventListener("click", () => { if (state.revision) upload(state.revision); });
$("cancel-replace").addEventListener("click", () => { clearRevision(); $("upload").disabled = !$("file").files.length; notice("upload-notice", "已取消，当前快照继续生效。"); });
$("close-detail").addEventListener("click", () => $("detail").close());
$("detail").addEventListener("close", () => { state.detailController?.abort(); state.detailController = null; });
$("detail-prev").addEventListener("click", () => { if (state.offsets.length > 1) { state.offsets.pop(); fetchDetail(); } });
$("detail-next").addEventListener("click", () => { state.offsets.push(state.offsets.at(-1) + state.detailRows); fetchDetail(); });
refresh();
