import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnifiedReminders,
  markDailyMailSent,
  normalizeReminderState,
} from "../reminders.js";

test("builds daily flow mail reminder and suppresses it after mail is sent", () => {
  const state = {
    projects: [
      { id: "p1", shortName: "26测试SCP001", status: "未投标", cutoffAt: "2026-07-08T18:00" },
      { id: "p2", shortName: "26明日SCP001", status: "未投标", cutoffAt: "2026-07-09T18:00" },
    ],
    reminderState: normalizeReminderState(),
  };

  const reminders = buildUnifiedReminders(state, new Date("2026-07-08T09:00:00+08:00"));
  const flowMail = reminders.find((item) => item.kind === "flow-mail");
  assert.equal(Boolean(flowMail), true);
  assert.equal(Boolean(flowMail.subject), true);

  const sentState = {
    ...state,
    reminderState: markDailyMailSent(state.reminderState, "2026-07-08"),
  };
  const afterSent = buildUnifiedReminders(sentState, new Date("2026-07-08T09:00:00+08:00"));
  assert.equal(afterSent.some((item) => item.kind === "flow-mail"), false);
});

test("keeps tomorrow and morning payment reminders in daily policy", () => {
  const state = {
    projects: [
      {
        id: "today",
        shortName: "26今日SCP001",
        status: "待缴款",
        resultConfirmed: true,
        tranches: [{ id: "t1", shortName: "26今日SCP001", resultStatus: "中标", paymentDate: "2026-07-08", prepaymentNumber: "W2026070800003" }],
      },
      {
        id: "tomorrow",
        shortName: "26明日SCP001",
        status: "待缴款",
        resultConfirmed: true,
        tranches: [{ id: "t2", shortName: "26明日SCP001", resultStatus: "中标", paymentDate: "2026-07-09" }],
      },
    ],
  };

  const reminders = buildUnifiedReminders(state, new Date("2026-07-08T09:00:00+08:00"));
  const todayPayment = reminders.find((item) => item.id === "project:today:payment:t1");
  const tomorrowPayment = reminders.find((item) => item.id === "project:tomorrow:payment:t2");
  assert.equal(todayPayment.subject, state.projects[0].tranches[0].shortName);
  assert.equal(todayPayment.title, "今日缴款");
  assert.equal(todayPayment.pushPolicy, "daily");
  assert.equal(todayPayment.severity, "info");
  assert.equal(tomorrowPayment.title, "明日缴款");
  assert.equal(tomorrowPayment.pushPolicy, "daily");
  assert.equal(tomorrowPayment.severity, "info");
});

test("escalates unpaid same-day payment after 15:30", () => {
  const state = {
    projects: [{
      id: "p1",
      shortName: "26测试SCP001",
      status: "待缴款",
      resultConfirmed: true,
      tranches: [{ id: "t1", shortName: "26测试SCP001", resultStatus: "中标", paymentDate: "2026-07-08" }],
    }],
  };

  const reminders = buildUnifiedReminders(state, new Date("2026-07-08T15:30:00+08:00"));
  const payment = reminders.find((item) => item.kind === "project-payment");
  assert.equal(payment.title, "15:30 后仍未缴款");
  assert.equal(payment.pushPolicy, "immediate");
  assert.equal(payment.severity, "critical");
});

test("combines project cutoff, result and protocol transfer reminders", () => {
  const state = {
    projects: [
      { id: "bid", shortName: "26截标SCP001", status: "未投标", cutoffAt: "2026-07-08T15:20", cutoffTimeConfirmed: true },
      { id: "result", shortName: "26结果SCP001", status: "已投标待结果", cutoffAt: "2026-07-08T12:00" },
    ],
    protocolTransfers: [{
      id: "protocol",
      code: "245599.SH",
      shortName: "26工投K4",
      tradeDate: "2026-07-08",
      counterpartySealDate: "2026-07-08",
      ownSealDate: "2026-07-08",
    }],
  };

  const reminders = buildUnifiedReminders(state, new Date("2026-07-08T15:00:00+08:00"));
  assert.equal(reminders.some((item) => item.id === "project:bid:bid" && item.severity === "critical"), true);
  assert.equal(reminders.some((item) => item.id === "project:result:result"), true);
  assert.equal(reminders.some((item) => item.id === "protocol:protocol:counterparty"), true);
});
