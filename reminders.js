import { normalizeProjectRecord, trancheNeedsPayment } from "./lifecycle.js?v=20260708-reminder-workbench";
import { protocolTransferTodos } from "./protocol-transfer.js?v=20260708-reminder-workbench";

const BID_PENDING_STATUSES = new Set(["未投标", "待投标"]);
const RESULT_PENDING_STATUS = "已投标待结果";
const PAYMENT_ESCALATE_HOUR = 15;
const PAYMENT_ESCALATE_MINUTE = 30;

export function normalizeReminderState(input = {}) {
  return {
    dailyMailSentDates: uniqueDates(input.dailyMailSentDates),
  };
}

export function markDailyMailSent(input = {}, date = localDate(new Date())) {
  return normalizeReminderState({
    ...input,
    dailyMailSentDates: [...(input.dailyMailSentDates || []), date],
  });
}

export function buildUnifiedReminders(state = {}, referenceDate = new Date()) {
  const today = localDate(referenceDate);
  const tomorrow = addDays(today, 1);
  const reminderState = normalizeReminderState(state.reminderState);
  const projects = (state.projects || []).map((item) => normalizeProjectRecord(item));
  const reminders = [];

  const mailProjects = projects.filter((project) =>
    BID_PENDING_STATUSES.has(project.status)
    && String(project.cutoffAt || "").slice(0, 10) === today,
  );
  if (mailProjects.length && !reminderState.dailyMailSentDates.includes(today)) {
    reminders.push({
      id: `mail:today:${today}`,
      sourceType: "mail",
      sourceId: today,
      kind: "flow-mail",
      moduleLabel: "流程邮件",
      subject: "今日流程邮件",
      severity: "info",
      timing: "today",
      pushPolicy: "daily",
      title: "待发送",
      detail: `${mailProjects.length} 笔今日待投标项目`,
      dueAt: `${today}T09:00`,
      actionLabel: "预览邮件",
      route: { view: "ledger", target: "mail" },
      priority: 45,
    });
  }

  for (const project of projects) {
    if (project.status === "已结束") continue;
    collectProjectBidReminders(reminders, project, referenceDate);
    collectProjectResultReminders(reminders, project, referenceDate);
    collectProjectPaymentReminders(reminders, project, referenceDate, today, tomorrow);
  }

  for (const item of protocolTransferTodos(state.protocolTransfers || [], referenceDate)) {
    if (item.step.dueDate > tomorrow) continue;
    const severity = item.timing === "overdue" ? "critical" : item.timing === "today" ? "warning" : "info";
    reminders.push({
      id: `protocol:${item.record.id}:${item.step.key}`,
      sourceType: "protocol",
      sourceId: item.record.id,
      kind: `protocol-${item.step.key}`,
      moduleLabel: "协议转让",
      subject: item.record.shortName || item.record.code || "协议转让",
      severity,
      timing: item.timing,
      pushPolicy: item.timing === "upcoming" ? "daily" : "immediate",
      title: `${item.step.label}待处理`,
      detail: formatDueDate(item.step.dueDate, today, tomorrow),
      dueAt: `${item.step.dueDate}T10:00`,
      actionLabel: item.step.label,
      route: { view: "protocol-transfer", target: item.record.id, step: item.step.key },
      priority: severityPriority(severity) + timingPriority(item.timing),
    });
  }

  return reminders
    .sort((left, right) =>
      right.priority - left.priority
      || String(left.dueAt || "").localeCompare(String(right.dueAt || ""))
      || left.title.localeCompare(right.title, "zh-CN"),
    );
}

function collectProjectBidReminders(reminders, project, referenceDate) {
  if (!BID_PENDING_STATUSES.has(project.status) || !project.cutoffAt) return;
  const cutoff = new Date(project.cutoffAt);
  if (Number.isNaN(cutoff.getTime())) return;
  const minutes = (cutoff.getTime() - referenceDate.getTime()) / 60000;
  const today = localDate(referenceDate);
  const cutoffDate = String(project.cutoffAt).slice(0, 10);
  let severity = "";
  let timing = "";
  let title = "";
  let priority = 0;

  if (!project.cutoffTimeConfirmed) {
    severity = "warning";
    timing = "unconfirmed";
    title = "截标时间待确认";
    priority = 72;
  } else if (minutes < 0) {
    severity = "critical";
    timing = "overdue";
    title = "已过截标仍未投标";
    priority = 95;
  } else if (minutes <= 30) {
    severity = "critical";
    timing = "soon";
    title = "距截标不足30分钟";
    priority = 92;
  } else if (minutes <= 60) {
    severity = "warning";
    timing = "soon";
    title = "距截标不足1小时";
    priority = 82;
  } else if (minutes <= 180) {
    severity = "warning";
    timing = "soon";
    title = "距截标不足3小时";
    priority = 70;
  } else if (cutoffDate === today) {
    severity = "info";
    timing = "today";
    title = "今日待投标";
    priority = 55;
  }
  if (!title) return;

  reminders.push({
    id: `project:${project.id}:bid`,
    sourceType: "project",
    sourceId: project.id,
    kind: "project-bid",
    moduleLabel: "投标",
    subject: project.shortName || "未命名项目",
    severity,
    timing,
    pushPolicy: severity === "info" ? "daily" : "immediate",
    title,
    detail: formatDateTime(project.cutoffAt),
    dueAt: project.cutoffAt,
    actionLabel: "打开项目",
    route: { view: "ledger", target: project.id },
    priority,
  });
}

function collectProjectResultReminders(reminders, project, referenceDate) {
  if (project.status !== RESULT_PENDING_STATUS || !project.cutoffAt) return;
  const cutoff = new Date(project.cutoffAt);
  if (Number.isNaN(cutoff.getTime()) || cutoff.getTime() > referenceDate.getTime()) return;
  const minutes = (referenceDate.getTime() - cutoff.getTime()) / 60000;
  reminders.push({
    id: `project:${project.id}:result`,
    sourceType: "project",
    sourceId: project.id,
    kind: "project-result",
    moduleLabel: "发行结果",
    subject: project.shortName || "未命名项目",
    severity: minutes >= 120 ? "warning" : "info",
    timing: "after-cutoff",
    pushPolicy: minutes >= 120 ? "immediate" : "daily",
    title: minutes >= 120 ? "发行结果待录入" : "截标后等待结果",
    detail: `截标 ${formatDateTime(project.cutoffAt)}`,
    dueAt: project.cutoffAt,
    actionLabel: "录入结果",
    route: { view: "ledger", target: project.id },
    priority: minutes >= 120 ? 68 : 44,
  });
}

function collectProjectPaymentReminders(reminders, project, referenceDate, today, tomorrow) {
  for (const tranche of project.tranches || []) {
    if (!tranche.paymentDate || !trancheNeedsPayment(tranche, referenceDate)) continue;
    if (tranche.paymentDate > tomorrow) continue;
    const paymentTiming = paymentReminderTiming(tranche.paymentDate, referenceDate, today, tomorrow);
    reminders.push({
      id: `project:${project.id}:payment:${tranche.id || tranche.shortName || tranche.paymentDate}`,
      sourceType: "project",
      sourceId: project.id,
      kind: "project-payment",
      moduleLabel: "缴款",
      subject: tranche.shortName || project.shortName || "未命名品种",
      severity: paymentTiming.severity,
      timing: paymentTiming.timing,
      pushPolicy: paymentTiming.pushPolicy,
      title: paymentTiming.title,
      detail: paymentTiming.detail,
      dueAt: `${tranche.paymentDate}T16:00`,
      actionLabel: "标记缴款",
      route: { view: "ledger", target: project.id, trancheId: tranche.id },
      priority: paymentTiming.priority,
    });
  }
}

function paymentReminderTiming(paymentDate, referenceDate, today, tomorrow) {
  const escalation = new Date(`${today}T${String(PAYMENT_ESCALATE_HOUR).padStart(2, "0")}:${String(PAYMENT_ESCALATE_MINUTE).padStart(2, "0")}:00`);
  if (paymentDate < today) {
    return {
      severity: "critical",
      timing: "overdue",
      pushPolicy: "immediate",
      title: "缴款已逾期",
      detail: `${paymentDate} 应缴款`,
      priority: 98,
    };
  }
  if (paymentDate === today && referenceDate >= escalation) {
    return {
      severity: "critical",
      timing: "today",
      pushPolicy: "immediate",
      title: "15:30 后仍未缴款",
      detail: "今日16:00前处理",
      priority: 94,
    };
  }
  if (paymentDate === today) {
    return {
      severity: "info",
      timing: "today",
      pushPolicy: "daily",
      title: "今日缴款",
      detail: "今日16:00前处理",
      priority: 52,
    };
  }
  return {
    severity: "info",
    timing: "upcoming",
    pushPolicy: "daily",
    title: paymentDate === tomorrow ? "明日缴款" : "待缴款",
    detail: paymentDate === tomorrow ? "明日缴款" : `${paymentDate} 缴款`,
    priority: 35,
  };
}

function severityPriority(severity) {
  if (severity === "critical") return 80;
  if (severity === "warning") return 55;
  return 30;
}

function timingPriority(timing) {
  if (timing === "overdue") return 18;
  if (timing === "today") return 9;
  return 0;
}

function formatDueDate(date, today, tomorrow) {
  if (date < today) return `${date} 已逾期`;
  if (date === today) return "今日到期";
  if (date === tomorrow) return "明日到期";
  return date;
}

function formatDateTime(value) {
  return String(value || "").replace("T", " ");
}

function uniqueDates(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((item) => String(item || "").trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)))].sort();
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
