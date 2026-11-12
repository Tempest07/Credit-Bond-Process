const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const small = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 3 });
const finite = Number.isFinite;
const svgNS = "http://www.w3.org/2000/svg";
const day = 86400000;
const pageSize = 15;
const barPageSize = 8;

function format(value, digits) {
  if (!finite(value)) return "缺数";
  if(Number.isInteger(digits))return value.toLocaleString("zh-CN",{minimumFractionDigits:digits,maximumFractionDigits:digits});
  return (value !== 0 && Math.abs(value) < 0.01 ? small : number).format(value);
}

function element(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, key, click, selected) {
  const node = element("button", "", text);
  node.type = "button";
  node.dataset.avControl = key;
  if (selected != null) node.setAttribute("aria-pressed", String(selected));
  node.addEventListener("click", click);
  return node;
}

function unitLabel(field) {
  return field.unit ? field.label + "（" + field.unit + "）" : field.label;
}

function dateValue(value) {
  if (typeof value !== "string" || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return NaN;
  const iso = value.length === 4 ? value + "-01-01" : value.length === 7 ? value + "-01" : value;
  const t = Date.parse(iso + "T00:00:00Z");
  return finite(t) && new Date(t).toISOString().slice(0, 10) === iso ? t : NaN;
}

function usableWhole(result, measure) {
  const w = result.whole;
  if (!w || !w.label || !finite(w.value) || w.value <= 0 || w.measureKey !== measure.key ||
      !measure.additive || result.dimensions.length !== 1 || result.dimensions[0].kind !== "category") return false;
  let total = 0;
  for (const row of result.rows) {
    const value = row[measure.key];
    if (!finite(value)) continue;
    if (value < 0 || value > w.value) return false;
    total += value;
  }
  return total <= w.value * (1 + 1e-10);
}

// Only typed result fields and observed values participate in chart selection.
export function chooseAnswerView(result, measureKey) {
  if(result?.columns && !result.measures.length && result.rows?.length)return 'table';
  const measure = result?.measures?.find(m => m.key === measureKey) ?? result?.measures?.[0];
  if (!measure || result.coverage === "missing" || !result.rows?.some(r => finite(r[measure.key]))) return "missing";
  const { rows, dimensions } = result;
  const share = !result.preferAmount && usableWhole(result,measure);
  if (rows.length === 1 && !share) return "scalar";
  if (dimensions.length !== 1) return "table";
  const dim = dimensions[0];
  const labels = rows.map(row => row[dim.key]);
  if (labels.some(v => v == null || v === "") || new Set(labels).size !== rows.length) return "table";
  if (dim.kind === "date") {
    if (!labels.every(v => finite(dateValue(v)))) return "table";
    return rows.length > 2 || (result.preferTrend && rows.length>=2) ? "trend" : "comparison";
  }
  if (share) return "share";
  if (measure.signed || rows.some(r => finite(r[measure.key]) && r[measure.key] < 0)) return "diverging";
  if (result.orderedBy?.key === measure.key) return "ranking";
  return rows.length === 2 ? "comparison" : "bars";
}

function scope(result, row) {
  return result.dimensions.map(d => row[d.key]).filter(v => v != null && v !== "").join(" / ");
}

function numericSort(a, b, ascending) {
  if (!finite(a) || !finite(b)) return Number(!finite(a)) - Number(!finite(b));
  return ascending ? a - b : b - a;
}

function chartRows(result, measure, kind) {
  const items = result.rows.map((row, index) => ({ row, index }));
  const dim = result.dimensions[0];
  if(result.netComposition?.key===measure.key){
    const named=items.filter(item=>item.index!==result.netComposition.blankIndex);
    if(!named.length)return items;
    const positive=named.filter(item=>item.row[measure.key]>0).sort((a,b)=>b.row[measure.key]-a.row[measure.key]);
    const negative=named.filter(item=>item.row[measure.key]<0).sort((a,b)=>a.row[measure.key]-b.row[measure.key]);
    const ordered=[];
    for(let i=0;i<Math.max(positive.length,negative.length);i++){
      if(positive[i])ordered.push(positive[i]);
      if(negative[i])ordered.push(negative[i]);
    }
    return ordered.concat(named.filter(item=>item.row[measure.key]===0));
  }
  if (dim?.kind === "date" && (kind === "trend" || kind === "comparison")) {
    items.sort((a, b) => dateValue(a.row[dim.key]) - dateValue(b.row[dim.key]));
  } else if (result.orderedBy?.key === measure.key) {
    const asc = result.orderedBy.direction === "asc";
    items.sort((a, b) => numericSort(a.row[measure.key], b.row[measure.key], asc));
  }
  return items;
}

function choice(title, labels, selected, key, change) {
  if (labels.length > 3) {
    const select = element("select", "av-select");
    select.setAttribute("aria-label", title);
    select.dataset.avControl = key;
    labels.forEach((label, i) => {
      const option = element("option", "", label);
      option.value = String(i);
      select.append(option);
    });
    select.selectedIndex = selected;
    select.addEventListener("change", () => change(select.selectedIndex, key));
    return select;
  }
  const group = element("div", "av-choice");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", title);
  labels.forEach((label, i) => group.append(button(label, key + i, () => change(i, key + i), i === selected)));
  return group;
}

function pager(length, size, current, key, update) {
  const pageCount = Math.ceil(length / size);
  if (pageCount < 2) return null;
  const bar = element("div", "av-pager");
  const prev = button("上一页", key + "prev", () => update(current - 1));
  const next = button("下一页", key + "next", () => update(current + 1));
  prev.disabled = current === 0;
  next.disabled = current >= pageCount - 1;
  bar.append(prev, element("span", "", (current * size + 1) + "–" + Math.min(length, (current + 1) * size) + " / " + length), next);
  return bar;
}

function matrix(result, state, redraw) {
  const box = element("div", "av-matrix");
  if (!result.rows.length && !result.columns?.length) return box;
  const dataFields = [...result.dimensions, ...result.measures];
  const fields = result.columns ? result.columns.map(c=>dataFields.find(f=>f.key===c.key)) : dataFields;
  const metrics = new Set(result.measures.map(m=>m.key));
  const rows = result.rows.map((row, index) => ({ row, index }));
  if (state.sort != null) {
    const field = fields[state.sort];
    rows.sort((a, b) => {
      const x = a.row[field.key], y = b.row[field.key];
      if (metrics.has(field.key)) return numericSort(x, y, state.ascending);
      if (x == null || y == null) return Number(x == null) - Number(y == null);
      return String(x).localeCompare(String(y), "zh-CN") * (state.ascending ? 1 : -1);
    });
  } else if(result.dimensions.length===1 && result.dimensions[0].kind==='date' && !result.orderedBy) {
    const key=result.dimensions[0].key;
    if(rows.every(({row})=>finite(dateValue(row[key]))))rows.sort((a,b)=>dateValue(a.row[key])-dateValue(b.row[key]));
  }
  const caps = new Map();
  // Gray cell bars share one zero-based scale. Distinct units, signed values and
  // lone observations are kept numeric so their lengths cannot imply comparability.
  if (result.measures[0]?.unit && new Set(result.measures.map(m => m.unit)).size === 1) {
    const comparable = result.measures.filter(m => {
      const values = rows.map(({ row }) => row[m.key]).filter(finite);
      return values.length > 1 && values.every(v => v >= 0) && !m.signed;
    });
    const cap = comparable.reduce((max, m) => rows.reduce((n, { row }) => Math.max(n, finite(row[m.key]) ? row[m.key] : 0), max), 0);
    if (cap > 0) for (const m of comparable) caps.set(m.key, cap);
  }
  const scroll = element("div", "av-scroll");
  if (rows.length > 6) scroll.classList.add("av-long-table");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "数据表");
  const table = element("table");
  if (fields.length >= 4) table.className = "av-wide";
  const head = table.createTHead().insertRow();
  fields.forEach((field, i) => {
    const th = element("th");
    if (metrics.has(field.key)) th.classList.add("av-numeric-heading");
    th.scope = "col";
    const sorted = state.sort === i;
    if (sorted) th.setAttribute("aria-sort", state.ascending ? "ascending" : "descending");
    const key = "sort" + i;
    const b = button(unitLabel(field), key, () => {
      state.ascending = sorted ? !state.ascending : !metrics.has(field.key);
      state.sort = i;
      state.page = 0;
      redraw(key);
    });
    const arrow = element("span", "av-sort", sorted ? state.ascending ? " ↑" : " ↓" : " ↕");
    arrow.setAttribute("aria-hidden", "true");
    b.append(arrow); th.append(b); head.append(th);
  });
  const body = table.createTBody();
  for (const { row, index } of rows.slice(state.page * pageSize, (state.page + 1) * pageSize)) {
    const tr = body.insertRow();
    fields.forEach((field, i) => {
      const cell = tr.insertCell(), v = row[field.key], metric = metrics.has(field.key);
      const label = metric ? format(v,field.digits) : String(v ?? "缺数");
      if (metric) cell.className = "av-number";
      else if (field.kind === "date") cell.className = "av-date";
      let value;
      if (i === 0) {
        const key = "row" + index;
        value = button(label, key, () => {
          state.expanded = state.expanded === index ? null : index;
          redraw(key);
        });
        value.className = "av-row-link";
        value.setAttribute("aria-expanded", String(index === state.expanded));
      } else if (field.key === "members" && !metric && label.length > 35 && label.includes("、")) {
        value = element("details", "av-members");
        value.append(element("summary", "", "查看名单"), element("p", "", label));
      } else value = element("span", "", label);
      if (caps.has(field.key) && finite(v)) {
        value.classList.add("av-cell");
        value.style.setProperty("--av-extent", (100 * v / caps.get(field.key)) + "%");
      }
      cell.append(value);
    });
    if (state.expanded === index) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = fields.length;
      const list = element("dl", "av-exact");
      fields.forEach(f => list.append(element("dt", "", unitLabel(f)), element("dd", "", row[f.key] ?? "缺数")));
      cell.append(list);
    }
  }
  if(result.footer){
    const tr=table.createTFoot().insertRow();
    fields.forEach((f,i)=>{
      const cell=tr.insertCell();
      if(!i)cell.append(element("strong","","全表合计"));
      if(f.key===result.footer.measureKey){
        cell.className="av-number";
        cell.append(element("strong","",format(result.footer.value,f.digits)));
      }
    });
  }
  scroll.append(table); box.append(scroll);
  const pages = pager(rows.length, pageSize, state.page, "matrix", n => { state.page = n; redraw("matrix" + (n === 0 ? "next" : "prev")); });
  if (pages) box.append(pages);
  return box;
}

function readout(result, item, measure, large = false) {
  const box = element("div", large ? "av-total" : "av-readout");
  const label = scope(result, item.row);
  if (label) box.append(element("span", "av-datum", label));
  box.append(element("strong", "", format(item.row[measure.key],measure.digits)));
  if (measure.unit) box.append(element("small", "", measure.unit));
  return box;
}

function answerLead(text, measure, scalarValue, headline) {
  const box = element("p", "av-answer");
  const raw = String(text);
  const matches = [];
  if (measure?.unit) {
    // Match the unit in the metric contract literally. Keep the original spelling
    // and precision of every number in the verified answer.
    for (const match of raw.matchAll(/[+\-−]?\d[\d,]*(?:\.\d+)?/g)) {
      const offset = match.index + match[0].length;
      const whitespace = raw.slice(offset).match(/^\s*/)[0];
      if (!raw.startsWith(measure.unit, offset + whitespace.length)) continue;
      // A valuation year in the narrative is a date, not a duration.
      if (measure.unit === "年" && /^\d{4}$/.test(match[0])) continue;
      const numeric = Number(match[0].replaceAll(",", "").replace("−", "-"));
      const digits = (match[0].split(".")[1] || "").length;
      const tolerance = 0.5 * 10 ** -digits + Number.EPSILON * Math.abs(numeric);
      const equalsScalar = finite(scalarValue) && Math.abs(numeric - scalarValue) <= tolerance;
      const equalsHeadline = headline?.measureKey === measure.key && finite(headline.value) && Math.abs(numeric - headline.value) <= tolerance;
      matches.push({start:match.index, end:offset + whitespace.length + measure.unit.length, original:match[0], whitespace, equalsScalar, equalsHeadline});
    }
  }
  const scalarMatch = matches.find(m => m.equalsScalar);
  const highlighted = scalarMatch || matches.find(m => m.equalsHeadline) || (matches.length === 1 ? matches[0] : null);
  let position = 0;
  for (const part of matches) {
    box.append(document.createTextNode(raw.slice(position, part.start)));
    const value = element("span", highlighted === part ? "av-key-value" : "av-inline-value");
    value.append(element("strong", "", part.original), document.createTextNode(part.whitespace), element("small", "", measure.unit));
    box.append(value);
    position = part.end;
  }
  box.append(document.createTextNode(raw.slice(position)));
  return {box, includesScalar:Boolean(scalarMatch)};
}

function barChart(result, measure, items, state, kind, redraw, showUnit = false) {
  const box = element("div", "av-bars");
  const shared = kind === "share";
  const split = !shared && (measure.signed || items.some(({ row }) => row[measure.key] < 0));
  const cap = shared ? result.whole.value : items.reduce((max, { row }) =>
    finite(row[measure.key]) ? Math.max(max, Math.abs(row[measure.key])) : max, 0);
  if (split) {
    const axis = element("div", "av-zero");
    axis.setAttribute("aria-hidden", "true");
    axis.append(element("span"), element("span", "", "0"), element("span")); box.append(axis);
  }
  for (const item of items.slice(state.barPage * barPageSize, (state.barPage + 1) * barPageSize)) {
    const { index, row } = item;
    const value = row[measure.key];
    const share = finite(value) && cap > 0 ? 100 * Math.abs(value / cap) : 0;
    const key = "bar" + index;
    const b = button("", key, () => { state.picked = index; redraw(key); }, state.picked === index);
    b.className = "av-bar";
    b.append(element("span", "av-bar-name", scope(result, row)));
    const track = element("span", split ? "av-track av-split" : "av-track");
    track.setAttribute("aria-hidden", "true");
    const fill = element("span", value < 0 ? "av-fill av-negative" : "av-fill");
    const width = Math.min(100, share) * (split ? 0.5 : 1);
    fill.style.width = width + "%";
    fill.style.left = (split ? value < 0 ? 50 - width : 50 : 0) + "%";
    track.append(fill);
    const sign=result.netComposition?.key===measure.key && value>0?"+":"";
    const text = !finite(value) ? "缺数" : shared ? format(share,measure.digits) + "%" : sign+format(value,measure.digits)+(measure.unit==="%"?"%":"");
    const end = element("span", "av-end", text);
    if (showUnit && finite(value) && measure.unit) end.append(element("small", "av-bar-unit", measure.unit));
    b.append(track, end);
    b.title = measure.label + "　" + (finite(value) ? value + " " + (measure.unit || "") : "缺数");
    box.append(b);
  }
  const pages = pager(items.length, barPageSize, state.barPage, "bars", n => {
    state.barPage = n; state.picked = null; redraw("bars" + (n === 0 ? "next" : "prev"));
  });
  if (pages) box.append(pages);
  if (shared) box.append(element("p", "av-caption", "分母为" + result.whole.label + " " + format(result.whole.value,measure.digits) + " " + (measure.unit || "")));
  if (state.picked != null) {
    const item = items.find(it => it.index === state.picked);
    if (item) box.append(readout(result, item, measure));
  }
  return box;
}

function balanceChangeView(model, measure, state, mode, redraw) {
  const {subject, metric, delta, note} = model.balanceChange;
  const section = element("div", "av-balance");
  const summary = element("div", "av-balance-stat");
  const direction = delta > 0 ? "增加" : delta < 0 ? "减少" : "持平";
  summary.append(element("span", "av-balance-label", metric + direction));
  const value = element("div", "av-balance-value");
  value.append(element("strong", "", format(Math.abs(delta), measure.digits)), element("small", "", measure.unit));
  summary.append(value);
  const result = {...model.result, measures:[{...measure, label:metric}]};
  const plot = mode === 1 ? matrix(result, state, redraw)
    : barChart(result, result.measures[0], chartRows(result, measure, "comparison"), state, "comparison", redraw, true);
  plot.classList.add(mode === 1 ? "av-balance-table" : "av-balance-plot");
  plot.setAttribute("aria-label", subject + " · " + unitLabel({label:metric, unit:measure.unit}));
  section.append(summary, plot);
  if (note) section.append(element("p", "av-balance-note", note));
  return section;
}

function adjacentDates(left, right, leftTime, rightTime, result) {
  const cadence = result.cadence;
  if (cadence === "yearly" || (left.length === 4 && right.length === 4)) {
    return Number(right.slice(0, 4)) - Number(left.slice(0, 4)) === 1;
  }
  if (cadence === "monthly" || (left.length === 7 && right.length === 7)) {
    return 12 * (Number(right.slice(0, 4)) - Number(left.slice(0, 4))) + Number(right.slice(5, 7)) - Number(left.slice(5, 7)) === 1;
  }
  if (cadence === "weekly") {
    // Unix epoch was Thursday. Shift by three days so buckets begin on Monday.
    return Math.floor((rightTime / day + 3) / 7) - Math.floor((leftTime / day + 3) / 7) === 1;
  }
  if (cadence === "daily") return rightTime - leftTime === day;
  if (finite(result.cadenceDays) && result.cadenceDays > 0) return rightTime - leftTime === result.cadenceDays * day;
  return true;
}

function timeChart(result, measure, items, state, redraw) {
  const box = element("div", "av-time");
  const plot = element("div", "av-plot");
  const d = result.dimensions[0].key;
  const stamps = items.map(({ row }) => dateValue(row[d]));
  const first = stamps[0], last = stamps.at(-1);
  const values = items.map(it => it.row[measure.key]);
  const series = result.measures.length <= 4 && result.measures.every(m=>m.unit===measure.unit) ? result.measures : [measure];
  let lo = Infinity, hi = -Infinity;
  for (const m of series) for(const {row} of items) if (finite(row[m.key])) {
    lo = Math.min(lo, row[m.key]); hi = Math.max(hi, row[m.key]);
  }
  if (hi === lo) {
    const pad = Math.max(1, Math.abs(hi) * 0.05);
    hi += pad; lo -= pad;
  }
  const x = i => 3 + 94 * ((stamps[i] - first) / (last - first));
  const y = v => 7 + 86 * ((hi - v) / (hi - lo));
  const grid = value => {
    const node = element("span", "av-grid");
    node.style.top = y(value) + "%";
    node.append(element("span", "", format(value,measure.digits)));
    plot.append(node);
  };
  [hi, (hi + lo) / 2, lo].forEach(grid);
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "av-lines");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",series.map(m=>m.label).join("、")+"随时间变化");
  const styles=["","6 4","2 3","7 3 2 3"], legend=element("div","av-legend");
  for(const [j,m] of series.entries()){
    const segments=[];
    for (let i=1;i<items.length;i++) {
      const before=items[i-1].row[m.key],after=items[i].row[m.key];
      if(finite(before)&&finite(after)&&adjacentDates(items[i-1].row[d],items[i].row[d],stamps[i-1],stamps[i],result))
        segments.push("M",x(i-1),y(before),"L",x(i),y(after));
    }
    const path=document.createElementNS(svgNS,"path");
    path.setAttribute("d",segments.join(" "));path.setAttribute("vector-effect","non-scaling-stroke");
    if(j)path.setAttribute("stroke-dasharray",styles[j]);
    const title=document.createElementNS(svgNS,"title");title.textContent=m.label;path.append(title);svg.append(path);
    path.dataset.series=String(j);
    if(series.length>1){
      const label=element("span","av-legend-item");
      const sample=document.createElementNS(svgNS,"svg");
      sample.setAttribute("viewBox","0 0 25 8");sample.setAttribute("aria-hidden","true");
      const line=document.createElementNS(svgNS,"path");line.setAttribute("d","M1 4 H24");
      line.dataset.series=String(j);if(j)line.setAttribute("stroke-dasharray",styles[j]);
      sample.append(line);label.append(sample,document.createTextNode(m.label));legend.append(label);
    }
  }
  plot.append(svg);
  const points = items.map((item, i) => ({ item, i })).filter(({ i }) => finite(values[i]));
  const pickedIndex = points.findIndex(({ item }) => item.index === state.picked);
  const current = points[pickedIndex < 0 ? points.length - 1 : pickedIndex].item;
  // One tab stop enters the plot. Arrow keys then move through the actual observations.
  points.forEach(({ item, i }, j) => {
    const key = "point" + item.index;
    const b = button("", key, () => { state.picked = item.index; redraw(key); }, item.index === current.index);
    b.className = "av-point";
    b.tabIndex = item.index === current.index ? 0 : -1;
    b.title = item.row[d] + "　" + measure.label + " " + format(values[i],measure.digits) + " " + (measure.unit || "");
    b.setAttribute("aria-label", b.title);
    b.style.left = x(i) + "%"; b.style.top = y(values[i]) + "%";
    b.addEventListener("keydown", e => {
      let next;
      if (e.key === "ArrowLeft") next = Math.max(0, j - 1);
      else if (e.key === "ArrowRight") next = Math.min(points.length - 1, j + 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = points.length - 1;
      else return;
      e.preventDefault();
      state.picked = points[next].item.index;
      redraw("point" + state.picked);
    });
    plot.append(b);
  });
  [0, Math.floor((items.length - 1) / 2), items.length - 1].forEach((i, j) => {
    if(j===1 && (i===0 || i===items.length-1))return;
    const tick = element("time", "av-time-" + j, items[i].row[d]);
    tick.style.left = x(i) + "%";
    if(j===1 && (x(i)-x(0)<23 || x(items.length-1)-x(i)<23)){
      tick.classList.add("av-stagger");
      tick.style.transform=x(i)>50?"translateX(-100%)":"none";
    }
    plot.append(tick);
  });
  box.append(plot);
  const content = element("div", "av-trend");
  if(legend.childElementCount)content.append(legend);
  content.append(box);
  if(series.length===1)content.append(readout(result,current,measure));
  else {
    const reading=element("div","av-series-reading");
    reading.append(element("time","",current.row[d]));
    for(const m of series)reading.append(element("span","",m.label+" "+format(current.row[m.key],m.digits)+(finite(current.row[m.key])&&m.unit?" "+m.unit:"")));
    content.append(reading);
  }
  return content;
}

function isModel(model) {
  const r = model?.result;
  return r && Array.isArray(r.dimensions) && Array.isArray(r.measures) && Array.isArray(r.rows) &&
    (r.measures.length || r.dimensions.length || r.coverage === "missing") &&
    [...r.dimensions, ...r.measures].every(f => f && typeof f.key === "string" && typeof f.label === "string") &&
    r.rows.every(row => row && typeof row === "object");
}

function resultLead(lead) {
  const box = element("div", "av-result-lead");
  if (lead.title) box.append(element("p", "av-result-title", lead.title));
  if (lead.metrics?.length) {
    const metrics = element("dl", "av-result-metrics");
    for (const item of lead.metrics) {
      const pair = element("div", "av-result-metric");
      const label = element("dt", "", item.label);
      const value = element("dd");
      const text = typeof item.value === "number" ? format(item.value, item.digits) : item.value ?? "待核";
      value.append(element("strong", "", text));
      if (item.unit && item.value != null) value.append(element("small", "", item.unit));
      pair.append(label, value); metrics.append(pair);
    }
    box.append(metrics);
  }
  for (const note of lead.notes || []) box.append(element("p", "av-result-note", note));
  return box;
}

// Model selection, the current metric, pagination and keyboard focus belong to this
// message only. No dependencies on the enclosing chat, stored answers or network.
export function createAnswerViews(models) {
  const root = element("section", "answer-views");
  const list = Array.isArray(models) ? models.filter(isModel) : [];
  if (!list.length) return root;
  let selected = 0;
  const states = list.map(model => ({
    metric: Math.max(0, model.result.measures.findIndex(m => model.result.rows.some(row => finite(row[m.key])))),
    mode: model.result.defaultTable ? 1 : 0, picked: null, expanded: null, sort: null, ascending: false, page: 0, barPage: 0,
  }));
  function draw(focusKey) {
    const model = list[selected], result = model.result, state = states[selected];
    const mode = state.mode;
    const priorScroll = focusKey?.startsWith("row") && root.querySelector(".av-scroll");
    const offset = priorScroll && [priorScroll.scrollLeft, priorScroll.scrollTop];
    const measure = result.measures[state.metric];
    const kind = chooseAnswerView(result, measure?.key);
    const balance = kind === "comparison" && model.balanceChange;
    const toolbar = element("div", "av-toolbar");
    if (list.length > 1) toolbar.append(choice("选择查询结果", list.map((m, i) => m.shortTitle || "结果 " + (i + 1)), selected, "model", (i, key) => {
      selected = i; draw(key);
    }));
    else if (model.shortTitle) toolbar.append(element("h3", "av-title", balance ? balance.subject : model.shortTitle));
    const hasData = result.coverage !== "missing" && result.rows.length > 0;
    if (hasData && kind !== "table") toolbar.append(choice("回答视图", ["图览", "分析台"], mode, "mode", (i, key) => { state.mode = i; draw(key); }));
    const content = element("div", "av-body");
    const scalarValue = kind === "scalar" ? result.rows[0][measure.key] : undefined;
    const display = !balance && model.displayLead;
    const shownScalar = kind === "scalar" && display?.metrics?.some(item => item.unit === measure.unit &&
      (item.value === scalarValue || model.directionalMagnitude && item.value === Math.abs(scalarValue)));
    const lead = !balance && !display && model.answer && answerLead(model.answer, measure, model.directionalMagnitude?Math.abs(scalarValue):scalarValue, result.headline);
    if (display) content.append(resultLead(display));
    else if (lead) content.append(lead.box);
    for(const line of model.ratingCoverage||[])content.append(element("p","av-caption",line));
    const hasMeasure = result.measures.some(m => result.rows.some(row => finite(row[m.key])));
    if (result.coverage === "missing" || !result.rows.length) {
      if (!model.answer) content.append(element("p", "av-empty", result.note || "当前数据不足以回答这个问题。"));
      if (result.columns?.length || result.coverage === "missing" && result.rows.length) content.append(matrix(result, state, draw));
    } else if (balance) {
      if (list.length > 1) content.append(element("h3", "av-balance-subject", balance.subject));
      content.append(balanceChangeView(model, measure, state, mode, draw));
    } else {
      if (result.coverage === "partial") content.append(element("p", "av-caption", result.note || "当前仅覆盖部分记录。"));
      if (mode === 1 || kind === "table" || !measure) {
        content.append(matrix(result, state, draw));
      } else {
        const tools = element("div", "av-tools");
        if (result.measures.length > 1) {
          tools.append(choice("选择指标", result.measures.map(unitLabel), state.metric, "metric", (i, key) => {
            state.metric = i; state.picked = null; state.barPage = 0; draw(key);
          }));
        } else if (kind !== "missing" && !(kind === "scalar" && (lead?.includesScalar || shownScalar))) {
          tools.append(element("span", "av-measure", kind==="share" ? measure.label+"占比（%）" : unitLabel(measure)));
        }
        if (tools.childElementCount) content.append(tools);
        if (kind === "missing") {
          if (hasMeasure || !model.answer) content.append(element("p", "av-empty", measure.label + "在这些记录中缺数。"));
        } else {
          const items = chartRows(result, measure, kind);
          if (kind === "scalar") {
            if (!shownScalar && !lead?.includesScalar) content.append(readout(result, items[0], measure, true));
            else if (lead?.includesScalar) {
              const label=scope(result,items[0].row);
              if(label&&!model.answer.includes(label))content.append(element("p","av-caption",label));
            }
          }
          else if (kind === "trend") content.append(timeChart(result, measure, items, state, draw));
          else content.append(barChart(result, measure, items, state, kind, draw, result.preferAmount && measure.key===result.whole?.measureKey));
        }
      }
    }
    if(result.columns && result.note && !display?.foldNote && result.coverage!=="partial") content.append(element("p","av-caption",result.note));
    const parts = toolbar.childElementCount ? [toolbar, content] : [content];
    const disclosures = element("div", "av-disclosures");
    if(model.calculations?.length){
      const details=element("details","av-source");
      details.open=state.calculationsOpen ?? (!display && model.calculations.reduce((n,c)=>n+c.inputs.length,0)<=6);
      details.append(element("summary","","计算取数"));
      for(const row of model.calculations){
        const inputs=row.inputs.map((input,i)=>{
          const label=input.label.split(" / ").at(-1);
          const role=row.op==="share" && row.inputs.length===2 ? (i===0?"分子 · ":"分母 · "):"";
          const value=finite(input.value)?input.value.toLocaleString("zh-CN",{maximumFractionDigits:8}):"待核";
          return role+label+" "+value+" "+(input.unit||"");
        });
        const line=element("p","",row.label+"："+inputs.join("，"));
        line.title=row.inputs.map(input=>input.label).join("；");details.append(line);
      }
      details.addEventListener("toggle",()=>{if(details.isConnected)state.calculationsOpen=details.open;});
      disclosures.append(details);
    }
    if (model.cautions?.length) {
      const cautions = element("details", "av-source");
      cautions.open = Boolean(state.cautionsOpen);
      const redemption = model.cautions.every(text => text.includes("实际兑付待核"));
      cautions.append(element("summary", "", redemption ? "部分 ABS 实际兑付待核" : "部分持仓的兑付或归属待核"));
      for (const text of model.cautions) cautions.append(element("p", "", text));
      cautions.addEventListener("toggle", () => { if (cautions.isConnected) state.cautionsOpen = cautions.open; });
      disclosures.append(cautions);
    }
    const sourceNote = result.note && !result.columns && result.coverage !== "partial" && result.note !== model.answer;
    if (model.source || sourceNote) {
      const details = element("details", "av-source");
      details.open = Boolean(state.sourceOpen);
      details.append(element("summary", "", "口径与来源"));
      if (model.source) details.append(element("p", "", model.source));
      if (sourceNote) details.append(element("p", "", result.note));
      details.addEventListener("toggle", () => { if (details.isConnected) state.sourceOpen = details.open; });
      disclosures.append(details);
    }
    if (display && ((model.answer && display.showOriginal !== false) || (result.note && display.foldNote))) {
      const original = element("details", "av-source av-original");
      original.open = Boolean(state.originalOpen);
      original.append(element("summary", "", "完整回答"));
      if (model.answer) original.append(element("p", "", model.answer));
      if (display.foldNote && result.note && result.note !== model.answer) original.append(element("p", "", result.note));
      original.addEventListener("toggle", () => { if (original.isConnected) state.originalOpen = original.open; });
      disclosures.append(original);
    }
    if (disclosures.childElementCount) parts.push(disclosures);
    root.replaceChildren(...parts);
    if (offset) root.querySelector(".av-scroll")?.scrollTo(...offset);
    if (focusKey) {
      const next = Array.from(root.querySelectorAll("[data-av-control]")).find(b => b.dataset.avControl === focusKey && !b.disabled);
      next?.focus({ preventScroll: true });
    }
  }
  draw();
  return root;
}
