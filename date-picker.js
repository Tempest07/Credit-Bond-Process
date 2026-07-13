const DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"]';
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const PANEL_ID = "bondCentreDatePicker";

let pickerPanel = null;
let pickerBackdrop = null;
let activeInput = null;
let activeType = "date";
let pendingDate = null;
let focusedDate = null;
let viewYear = 0;
let viewMonth = 0;
let pendingHour = 0;
let pendingMinute = 0;
let dateInputObserver = null;
let repositionFrame = null;

export function initializeDatePickers(root = document) {
  if (!root?.querySelectorAll || typeof document === "undefined") return;
  ensurePickerPanel();
  enhanceDateInputs(root);
  if (!dateInputObserver && document.body && "MutationObserver" in window) {
    dateInputObserver = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => enhanceDateInputs(node)));
    });
    dateInputObserver.observe(document.body, { childList: true, subtree: true });
  }
}

export function parseDatePickerValue(value, type = "date") {
  const match = String(value || "").trim().match(
    type === "datetime-local"
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
      : /^(\d{4})-(\d{2})-(\d{2})/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const date = new Date(year, month, day);
  if (
    !Number.isInteger(year)
    || date.getFullYear() !== year
    || date.getMonth() !== month
    || date.getDate() !== day
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
  ) return null;
  return { date, hour, minute };
}

export function formatDatePickerValue(date, type = "date", hour = 0, minute = 0) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const isoDate = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  if (type !== "datetime-local") return isoDate;
  return `${isoDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function buildDatePickerMonth(year, month) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      date,
      value: formatDatePickerValue(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      weekend: date.getDay() === 0 || date.getDay() === 6,
    };
  });
}

function ensurePickerPanel() {
  if (pickerPanel) return;
  pickerBackdrop = document.createElement("div");
  pickerBackdrop.className = "date-picker-backdrop";
  pickerBackdrop.setAttribute("aria-hidden", "true");
  pickerBackdrop.hidden = true;

  pickerPanel = document.createElement("section");
  pickerPanel.id = PANEL_ID;
  pickerPanel.className = "date-picker-popover";
  pickerPanel.setAttribute("role", "dialog");
  pickerPanel.setAttribute("aria-modal", "false");
  pickerPanel.setAttribute("aria-labelledby", `${PANEL_ID}Title`);
  pickerPanel.hidden = true;
  pickerPanel.innerHTML = `
    <div class="date-picker-heading">
      <div>
        <strong id="${PANEL_ID}Title">选择日期</strong>
      </div>
      <button class="date-picker-icon-button" type="button" data-date-picker-action="close" aria-label="关闭">×</button>
    </div>
    <div class="date-picker-month-nav">
      <button class="date-picker-icon-button" type="button" data-date-picker-action="previous-month" aria-label="上个月">‹</button>
      <div class="date-picker-period">
        <select data-date-picker-role="year" aria-label="年份"></select>
        <select data-date-picker-role="month" aria-label="月份"></select>
      </div>
      <button class="date-picker-icon-button" type="button" data-date-picker-action="next-month" aria-label="下个月">›</button>
    </div>
    <div class="date-picker-weekdays" aria-hidden="true">
      ${WEEKDAY_LABELS.map((label, index) => `<span class="${index > 4 ? "is-weekend" : ""}">${label}</span>`).join("")}
    </div>
    <div class="date-picker-days" data-date-picker-role="days" role="grid" aria-label="日期"></div>
    <div class="date-picker-time" data-date-picker-role="time" hidden>
      <span>时间</span>
      <label><select data-date-picker-role="hour" aria-label="小时"></select><small>时</small></label>
      <label><select data-date-picker-role="minute" aria-label="分钟"></select><small>分</small></label>
    </div>
    <div class="date-picker-footer">
      <button class="date-picker-action is-muted" type="button" data-date-picker-action="clear">清除</button>
      <div>
        <button class="date-picker-action" type="button" data-date-picker-action="today">今天</button>
        <button class="date-picker-action is-primary" type="button" data-date-picker-action="apply" hidden>完成</button>
      </div>
    </div>
  `;
  document.body.append(pickerBackdrop, pickerPanel);

  pickerBackdrop.addEventListener("click", closePicker);
  pickerPanel.addEventListener("click", handlePickerClick);
  pickerPanel.addEventListener("change", handlePickerChange);
  pickerPanel.addEventListener("keydown", handlePickerKeydown);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  window.addEventListener("resize", schedulePickerPosition);
  window.addEventListener("scroll", schedulePickerPosition, true);
}

function enhanceDateInputs(root) {
  if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
  const inputs = root.matches?.(DATE_INPUT_SELECTOR)
    ? [root]
    : [...root.querySelectorAll?.(DATE_INPUT_SELECTOR) || []];
  inputs.forEach((input) => {
    if (input.dataset.datePickerEnhanced === "true") return;
    input.dataset.datePickerEnhanced = "true";
    input.dataset.datePickerType = input.type;
    input.readOnly = true;
    input.autocomplete = "off";
    input.classList.add("custom-date-input");
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-controls", PANEL_ID);
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("pointerdown", (event) => {
      if (input.disabled) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      openPicker(input);
    });
    input.addEventListener("click", (event) => {
      if (input.disabled) return;
      event.preventDefault();
      openPicker(input);
    });
    input.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        openPicker(input);
      }
      if (["Backspace", "Delete"].includes(event.key) && input.value) {
        event.preventDefault();
        writePickerInputValue(input, "");
      }
    });
  });
}

function openPicker(input) {
  if (!pickerPanel || input.disabled) return;
  if (activeInput && activeInput !== input) activeInput.setAttribute("aria-expanded", "false");
  activeInput = input;
  activeType = input.dataset.datePickerType || input.type || "date";
  const parsed = parseDatePickerValue(input.value, activeType);
  const now = new Date();
  pendingDate = parsed?.date || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  focusedDate = new Date(pendingDate);
  viewYear = pendingDate.getFullYear();
  viewMonth = pendingDate.getMonth();
  pendingHour = parsed?.hour ?? now.getHours();
  pendingMinute = parsed?.minute ?? now.getMinutes();

  input.setAttribute("aria-expanded", "true");
  pickerPanel.hidden = false;
  pickerPanel.style.visibility = "hidden";
  pickerPanel.dataset.type = activeType;
  pickerPanel.querySelector(`#${PANEL_ID}Title`).textContent = pickerTitle(input, activeType);
  renderPicker();
  positionPicker();
  pickerPanel.style.visibility = "visible";
  requestAnimationFrame(focusCurrentDay);
}

function closePicker({ restoreFocus = true } = {}) {
  if (!pickerPanel || pickerPanel.hidden) return;
  const trigger = activeInput;
  trigger?.setAttribute("aria-expanded", "false");
  pickerPanel.hidden = true;
  pickerBackdrop.hidden = true;
  pickerPanel.style.removeProperty("left");
  pickerPanel.style.removeProperty("top");
  pickerPanel.style.removeProperty("width");
  activeInput = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function renderPicker() {
  if (!activeInput) return;
  renderPeriodControls();
  const todayValue = formatDatePickerValue(new Date());
  const selectedValue = formatDatePickerValue(pendingDate);
  const focusedValue = formatDatePickerValue(focusedDate);
  const days = buildDatePickerMonth(viewYear, viewMonth);
  pickerPanel.querySelector('[data-date-picker-role="days"]').innerHTML = days.map((item) => {
    const classes = ["date-picker-day"];
    const disabled = !dateAllowedForInput(item.date);
    if (!item.inMonth) classes.push("is-adjacent");
    if (item.weekend) classes.push("is-weekend");
    if (item.value === todayValue) classes.push("is-today");
    if (item.value === selectedValue) classes.push("is-selected");
    if (disabled) classes.push("is-disabled");
    return `<button
      class="${classes.join(" ")}"
      type="button"
      role="gridcell"
      data-date-picker-value="${item.value}"
      aria-label="${item.date.getFullYear()}年${item.date.getMonth() + 1}月${item.day}日"
      aria-selected="${item.value === selectedValue}"
      aria-disabled="${disabled}"
      ${item.value === todayValue ? 'aria-current="date"' : ""}
      tabindex="${item.value === focusedValue ? "0" : "-1"}"
      ${disabled ? "disabled" : ""}
    >${item.day}</button>`;
  }).join("");

  const timePanel = pickerPanel.querySelector('[data-date-picker-role="time"]');
  const applyButton = pickerPanel.querySelector('[data-date-picker-action="apply"]');
  const isDateTime = activeType === "datetime-local";
  timePanel.hidden = !isDateTime;
  applyButton.hidden = !isDateTime;
  pickerPanel.querySelector('[data-date-picker-action="today"]').disabled = !dateAllowedForInput(new Date());
  if (isDateTime) renderTimeControls();
}

function renderPeriodControls() {
  const yearSelect = pickerPanel.querySelector('[data-date-picker-role="year"]');
  const monthSelect = pickerPanel.querySelector('[data-date-picker-role="month"]');
  const currentYear = new Date().getFullYear();
  const minYear = inputBoundaryYear(activeInput?.min) ?? currentYear - 50;
  const maxYear = inputBoundaryYear(activeInput?.max) ?? currentYear + 50;
  const firstYear = Math.min(minYear, viewYear);
  const lastYear = Math.max(maxYear, viewYear);
  yearSelect.innerHTML = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
    const year = firstYear + index;
    return `<option value="${year}" ${year === viewYear ? "selected" : ""}>${year}年</option>`;
  }).join("");
  monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) =>
    `<option value="${index}" ${index === viewMonth ? "selected" : ""}>${index + 1}月</option>`,
  ).join("");
}

function renderTimeControls() {
  const hourSelect = pickerPanel.querySelector('[data-date-picker-role="hour"]');
  const minuteSelect = pickerPanel.querySelector('[data-date-picker-role="minute"]');
  hourSelect.innerHTML = Array.from({ length: 24 }, (_, hour) =>
    `<option value="${hour}" ${hour === pendingHour ? "selected" : ""}>${String(hour).padStart(2, "0")}</option>`,
  ).join("");
  minuteSelect.innerHTML = Array.from({ length: 60 }, (_, minute) =>
    `<option value="${minute}" ${minute === pendingMinute ? "selected" : ""}>${String(minute).padStart(2, "0")}</option>`,
  ).join("");
}

function handlePickerClick(event) {
  const dayButton = event.target.closest("[data-date-picker-value]");
  if (dayButton) {
    const parsed = parseDatePickerValue(dayButton.dataset.datePickerValue);
    if (!parsed) return;
    pendingDate = parsed.date;
    focusedDate = new Date(parsed.date);
    viewYear = pendingDate.getFullYear();
    viewMonth = pendingDate.getMonth();
    if (activeType === "datetime-local") {
      renderPicker();
      requestAnimationFrame(focusCurrentDay);
    } else {
      commitPickerValue(formatDatePickerValue(pendingDate));
    }
    return;
  }

  const action = event.target.closest("[data-date-picker-action]")?.dataset.datePickerAction;
  if (!action) return;
  if (action === "close") closePicker();
  if (action === "previous-month") shiftPickerMonth(-1);
  if (action === "next-month") shiftPickerMonth(1);
  if (action === "clear") commitPickerValue("");
  if (action === "today") {
    const today = new Date();
    pendingDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    focusedDate = new Date(pendingDate);
    viewYear = pendingDate.getFullYear();
    viewMonth = pendingDate.getMonth();
    if (activeType === "datetime-local") {
      renderPicker();
      requestAnimationFrame(focusCurrentDay);
    } else {
      commitPickerValue(formatDatePickerValue(pendingDate));
    }
  }
  if (action === "apply") {
    commitPickerValue(formatDatePickerValue(pendingDate, activeType, pendingHour, pendingMinute));
  }
}

function handlePickerChange(event) {
  const role = event.target.dataset.datePickerRole;
  if (role === "year") {
    viewYear = Number(event.target.value);
    focusedDate = clampDayToMonth(focusedDate, viewYear, viewMonth);
    renderPicker();
    requestAnimationFrame(focusCurrentDay);
  }
  if (role === "month") {
    viewMonth = Number(event.target.value);
    focusedDate = clampDayToMonth(focusedDate, viewYear, viewMonth);
    renderPicker();
    requestAnimationFrame(focusCurrentDay);
  }
  if (role === "hour") pendingHour = Number(event.target.value);
  if (role === "minute") pendingMinute = Number(event.target.value);
}

function handlePickerKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closePicker();
    return;
  }
  if (event.key === "Tab" && pickerPanel.classList.contains("is-mobile")) {
    const focusable = [...pickerPanel.querySelectorAll("button:not([disabled]), select:not([disabled])")]
      .filter((element) => !element.hidden && element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if (!event.target.closest(".date-picker-day")) return;
  const dayDelta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (dayDelta) {
    event.preventDefault();
    moveFocusedDate(dayDelta);
    return;
  }
  if (["PageUp", "PageDown"].includes(event.key)) {
    event.preventDefault();
    shiftPickerMonth(event.key === "PageUp" ? -1 : 1);
    return;
  }
  if (["Home", "End"].includes(event.key)) {
    event.preventDefault();
    const mondayIndex = (focusedDate.getDay() + 6) % 7;
    moveFocusedDate(event.key === "Home" ? -mondayIndex : 6 - mondayIndex);
  }
}

function moveFocusedDate(days) {
  const candidate = new Date(focusedDate.getFullYear(), focusedDate.getMonth(), focusedDate.getDate() + days);
  if (!dateAllowedForInput(candidate)) return;
  focusedDate = candidate;
  viewYear = focusedDate.getFullYear();
  viewMonth = focusedDate.getMonth();
  renderPicker();
  requestAnimationFrame(focusCurrentDay);
}

function shiftPickerMonth(delta) {
  const target = new Date(viewYear, viewMonth + delta, 1);
  viewYear = target.getFullYear();
  viewMonth = target.getMonth();
  focusedDate = clampDayToMonth(focusedDate, viewYear, viewMonth);
  renderPicker();
  requestAnimationFrame(focusCurrentDay);
}

function clampDayToMonth(date, year, month) {
  const day = Math.min(date?.getDate?.() || 1, new Date(year, month + 1, 0).getDate());
  return new Date(year, month, day);
}

function commitPickerValue(value) {
  if (!activeInput) return;
  const input = activeInput;
  writePickerInputValue(input, value);
  closePicker();
}

function writePickerInputValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function focusCurrentDay() {
  pickerPanel?.querySelector('.date-picker-day[tabindex="0"]')?.focus({ preventScroll: true });
}

function pickerTitle(input, type) {
  const explicit = input.getAttribute("aria-label");
  if (explicit) return explicit;
  const label = input.closest("label");
  if (label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll("input, select, textarea, button, small").forEach((element) => element.remove());
    const text = copy.textContent.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return type === "datetime-local" ? "选择日期和时间" : "选择日期";
}

function inputBoundaryYear(value) {
  return parseDatePickerValue(value, activeType)?.date.getFullYear() || null;
}

function dateAllowedForInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !activeInput) return false;
  const candidate = formatDatePickerValue(date);
  const min = parseDatePickerValue(activeInput.min, activeType)?.date;
  const max = parseDatePickerValue(activeInput.max, activeType)?.date;
  if (min && candidate < formatDatePickerValue(min)) return false;
  if (max && candidate > formatDatePickerValue(max)) return false;
  return true;
}

function handleDocumentPointerDown(event) {
  if (!activeInput || pickerPanel.hidden) return;
  if (pickerPanel.contains(event.target) || event.target === activeInput || activeInput.contains?.(event.target)) return;
  closePicker({ restoreFocus: false });
}

function schedulePickerPosition() {
  if (!activeInput || pickerPanel?.hidden) return;
  if (repositionFrame) cancelAnimationFrame(repositionFrame);
  repositionFrame = requestAnimationFrame(() => {
    repositionFrame = null;
    positionPicker();
  });
}

function positionPicker() {
  if (!activeInput || !pickerPanel) return;
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  pickerPanel.classList.toggle("is-mobile", mobile);
  pickerPanel.setAttribute("aria-modal", String(mobile));
  pickerBackdrop.hidden = !mobile;
  if (mobile) {
    pickerPanel.style.removeProperty("left");
    pickerPanel.style.removeProperty("top");
    pickerPanel.style.removeProperty("width");
    return;
  }
  const margin = 12;
  const gap = 8;
  const trigger = activeInput.getBoundingClientRect();
  const width = Math.min(368, window.innerWidth - margin * 2);
  pickerPanel.style.width = `${width}px`;
  const height = pickerPanel.offsetHeight;
  const left = Math.min(Math.max(trigger.left, margin), window.innerWidth - width - margin);
  const below = trigger.bottom + gap;
  const above = trigger.top - height - gap;
  const top = below + height <= window.innerHeight - margin || above < margin ? below : above;
  pickerPanel.style.left = `${Math.round(left)}px`;
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  pickerPanel.style.top = `${Math.min(maxTop, Math.max(margin, Math.round(top)))}px`;
}
