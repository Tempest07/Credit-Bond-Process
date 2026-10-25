import assert from "node:assert/strict";
import test from "node:test";
import { prepareStoredState, StateStorageError } from "../state-storage.js";

import { onRequestGet as onMailProxyGet } from "../functions/api/mail/today.js";
import { onRequestPost as onSecondaryLedgerProxyPost } from "../functions/api/mail/secondary-ledger.js";
import mailerWorker, {
  buildReportFromDb,
  buildSecondaryLedgerMail,
  buildTodayMail,
  selectSecondaryLedgerRows,
  selectTodayBidProjects,
} from "../mailer-worker.js";

const today = "2026-06-11";

test("mailer reads the current per-user state before the legacy state", async () => {
  const queries = [];
  const report = await buildReportFromDb({ DB: reportStateDb({
    user: { data: JSON.stringify({ projects: [{ shortName: "当前项目", status: "未投标", cutoffAt: `${today}T18:00` }] }) },
    legacy: { data: JSON.stringify({ projects: [{ shortName: "旧项目", status: "未投标", cutoffAt: `${today}T18:00` }] }) },
  }, queries) }, { date: today });
  assert.deepEqual(report.projects.map((project) => project.shortName), ["当前项目"]);
  assert.equal(queries.some((sql) => /FROM app_state\b/i.test(sql)), false);
});

test("mailer only falls back to legacy state when the user row or table is absent", async () => {
  for (const user of [null, new Error("D1_ERROR: no such table: user_app_state: SQLITE_ERROR")]) {
    const report = await buildReportFromDb({ DB: reportStateDb({
      user,
      legacy: { data: JSON.stringify({ projects: [{ shortName: "旧项目", status: "未投标", cutoffAt: `${today}T18:00` }] }) },
    }) }, { date: today });
    assert.deepEqual(report.projects.map((project) => project.shortName), ["旧项目"]);
  }
});

test("mailer rejects malformed user state and database errors without using stale legacy data", async () => {
  for (const user of [{ data: "{broken" }, new Error("D1_ERROR: database unavailable")]) {
    const queries = [];
    await assert.rejects(buildReportFromDb({ DB: reportStateDb({
      user,
      legacy: { data: JSON.stringify({ projects: [] }) },
    }, queries) }, { date: today }));
    assert.equal(queries.some((sql) => /FROM app_state\b/i.test(sql)), false);
  }
});

test("mailer reads multi-chunk user and legacy states without losing project data", async () => {
  const storage = await prepareStoredState(JSON.stringify({
    issuers: [{ legalName: "保留发行人", sourceText: "原始资料".repeat(120_000) }],
    projects: [{ id: "project-original", shortName: "当前项目", opinion: "保留流程意见", status: "未投标", cutoffAt: `${today}T18:00` }],
  }));
  assert.ok(storage.chunks.length > 1);
  for (const kind of ["user", "legacy"]) {
    const report = await buildReportFromDb({ DB: reportStateDb({
      [kind]: { data: storage.serialized }, chunks: storage.chunks,
    }) }, { date: today });
    assert.equal(report.projects[0].id, "project-original");
    assert.match(report.text, /保留流程意见/);
  }
});

test("mailer rejects incomplete, corrupted, or unavailable chunks instead of mailing stale state", async () => {
  const storage = await prepareStoredState(JSON.stringify({ projects: [], sourceText: "原始资料".repeat(120_000) }));
  for (const options of [
    { chunks: storage.chunks.slice(1) },
    { chunks: storage.chunks.map((chunk, index) => index === 0 ? chunk.replace("原", "旧") : chunk) },
    { chunks: storage.chunks, chunkError: new Error("D1_ERROR: chunks unavailable") },
  ]) {
    const queries = [];
    await assert.rejects(buildReportFromDb({ DB: reportStateDb({
      user: { data: storage.serialized }, legacy: { data: JSON.stringify({ projects: [] }) }, ...options,
    }, queries) }, { date: today }), options.chunkError ? /chunks unavailable/ : StateStorageError);
    assert.equal(queries.some((sql) => /FROM app_state\b/i.test(sql)), false);
  }
});

function reportStateDb({ user = null, legacy = null, chunks = [], chunkError = null }, queries = []) {
  return {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async first() {
          const row = /FROM user_app_state\b/i.test(sql) ? user : legacy;
          if (row instanceof Error) throw row;
          return row;
        },
        async all() {
          assert.match(sql, /LEFT JOIN app_state_chunks/);
          if (chunkError) throw chunkError;
          const row = /FROM user_app_state\b/i.test(sql) ? user : legacy;
          return { results: chunks.map((chunk_data, chunk_index) => ({ ...row, chunk_index, chunk_data })) };
        },
      };
    },
  };
}

test("selects today's pending bid projects only", () => {
  const projects = [
    { shortName: "26B", status: "未投标", cutoffAt: "2026-06-11T19:00" },
    { shortName: "26A", status: "未投标", cutoffAt: "2026-06-11T18:00" },
    { shortName: "26C", status: "已投标待结果", cutoffAt: "2026-06-11T18:00" },
    { shortName: "26D", status: "未投标", cutoffAt: "2026-06-12T18:00" },
  ];

  assert.deepEqual(
    selectTodayBidProjects(projects, today).map((project) => project.shortName),
    ["26A", "26B"],
  );
});

test("builds Resend mail content with brief and opinion template", () => {
  const report = buildTodayMail({
    projects: [
      {
        id: "project-1",
        shortName: "26测试MTN001",
        status: "未投标",
        cutoffAt: "2026-06-11T18:00",
        sourceText: "26测试MTN001 非我行主承 上海分行\n3年期 规模5亿 AAA/隐含AAA\n询价区间1.5-1.8 银行间 中信银行",
        opinion: "上海分行申请与资金营运中心一二级联动投资测试债券。",
      },
    ],
  }, { date: today });

  assert.equal(report.subject, "流程意见260611");
  assert.match(report.text, /^1\. 26测试MTN001/m);
  assert.match(report.text, /项目简表：\n26测试MTN001 非我行主承 上海分行/);
  assert.match(report.text, /流程意见：\n上海分行申请与资金营运中心一二级联动投资测试债券。/);
  assert.match(report.html, /今日流程意见提示/);
});

test("uses a fallback project brief when source text is missing", () => {
  const report = buildTodayMail({
    projects: [
      {
        id: "project-2",
        shortName: "26测试01",
        issuerName: "测试集团有限公司",
        branch: "苏州分行",
        venue: "上交所",
        sponsorStatus: "非我行主承",
        leadUnderwriter: "中信证券",
        status: "待投标",
        cutoffAt: "2026-06-11T19:00",
        opinion: "",
        tranches: [
          {
            shortName: "26测试01",
            durationText: "3年",
            inquiryLow: 1.5,
            inquiryHigh: 2.5,
            suggestedRatio: 20,
            bidRate: 1.8,
            bidAmount: 1,
          },
        ],
      },
    ],
  }, { date: today });

  assert.match(report.text, /主体：测试集团有限公司/);
  assert.match(report.text, /询价区间：1.5%-2.5%/);
  assert.match(report.text, /流程意见：\n【暂无流程意见】/);
});

test("builds one secondary ledger mail from non-protocol and protocol trades", () => {
  const state = {
    secondaryTrades: [{
      id: "trade-1",
      side: "sell",
      account: "SDR",
      code: "280680.SH",
      shortName: "25联投17",
      quantityWan: 3000,
      price: "100.99",
      frontOfficeDone: true,
      frontOfficePrice: "100.98",
      tradeDate: today,
      ledgerDate: today,
      settlementDate: "2026-06-12",
      counterparty: "首创证券",
      tradeCategory: "non_protocol",
    }],
    protocolTransfers: [{
      id: "protocol-1",
      code: "281926.SH",
      shortName: "26光交01",
      tradeDate: today,
      buyer: "中信证券",
      seller: "兴业银行",
      finalBuyer: "测试资管",
      price: "101.033",
      amountTenThousand: 2000,
      counterpartySealed: true,
    }],
  };

  const rows = selectSecondaryLedgerRows(state, today);
  const report = buildSecondaryLedgerMail(state, { date: today });

  assert.equal(rows.length, 2);
  assert.equal(report.subject, "二级成交台账260611");
  assert.equal(report.rowCount, 2);
  assert.equal(report.tradeCount, 1);
  assert.equal(report.protocolCount, 1);
  assert.match(report.text, /谈判日\t交易日\t债券代码\t债券简称\t债券类型\t净价\t收益率\(%\)/);
  assert.match(report.text, /2026-06-11\t280680\.SH\t25联投17\t\t100\.98\t\t\t卖出\t3000\t首创证券\t\tSDR/);
  assert.match(report.text, /2026-06-11\t2026-06-11\t281926\.SH\t26光交01\t\t101\.033\t\t\t卖出\t2000\t中信证券\t\tSSE/);
  assert.match(report.html, /二级成交台账/);
  assert.match(report.html, /<th>估值收益率<\/th>/);
});

test("returns a readable JSON error when sending is misconfigured", async () => {
  const response = await mailerWorker.fetch(new Request("https://mailer.test/send-today", {
    method: "POST",
    headers: { Authorization: "Bearer secret" },
  }), {
    APP_PASSWORD: "secret",
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.status, "error");
  assert.match(body.error, /RESEND_API_KEY/);
  assert.match(body.hint, /RESEND_API_KEY/);
});

test("mail proxy authenticates the page session and forwards the mailer password", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedAuthorization = "";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://credit-bond-mailer.weiqian-yu.workers.dev/preview-today");
    forwardedAuthorization = init.headers.Authorization;
    return new Response(JSON.stringify({ ok: true, text: "preview" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await onMailProxyGet({
      env: { APP_PASSWORD: "mailer-password", DB: createSessionDb() },
      request: new Request("http://127.0.0.1:8788/api/mail/today?action=preview", {
        headers: { Authorization: "Bearer session-token" },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.text, "preview");
    assert.equal(forwardedAuthorization, "Bearer mailer-password");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("secondary ledger proxy authenticates the page session and forwards the mailer password", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedAuthorization = "";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://credit-bond-mailer.weiqian-yu.workers.dev/send-secondary-ledger?date=2026-07-20");
    forwardedAuthorization = init.headers.Authorization;
    return new Response(JSON.stringify({ status: "sent", date: "2026-07-20" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await onSecondaryLedgerProxyPost({
      env: { APP_PASSWORD: "mailer-password", DB: createSessionDb() },
      request: new Request("http://127.0.0.1:8788/api/mail/secondary-ledger?date=2026-07-20", {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:8788" },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "sent");
    assert.equal(forwardedAuthorization, "Bearer mailer-password");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createSessionDb() {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async run() {
          return {};
        },
        async first() {
          if (/SELECT id FROM users WHERE username/i.test(sql)) return { id: "admin" };
          if (/SELECT user_id FROM user_app_state/i.test(sql)) return { user_id: "admin" };
          if (/FROM sessions s/i.test(sql)) {
            return { id: "admin", username: "admin", nickname: "管理员", role: "admin" };
          }
          return null;
        },
      };
    },
  };
}
