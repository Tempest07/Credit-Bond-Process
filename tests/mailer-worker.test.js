import assert from "node:assert/strict";
import test from "node:test";

import mailerWorker, { buildTodayMail, selectTodayBidProjects } from "../mailer-worker.js";

const today = "2026-06-11";

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

  assert.equal(report.subject, "流程意见26测试MTN001");
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
