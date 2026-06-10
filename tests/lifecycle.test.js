import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBidResultSummary,
  createProjectRecord,
  dashboardCounts,
  deriveProjectStatus,
  normalizeProjectRecord,
  upsertProject,
} from "../lifecycle.js";

test("creates a project ledger record with one tranche per bond variety", () => {
  const record = createProjectRecord({
    shortName: "26广越05/06",
    shortNames: ["26广越05", "26广越06"],
    durationText: "3/5年期",
    durationParts: ["3年", "5年"],
    inquiryRanges: [{ low: 1.3, high: 2.3 }, { low: 1.5, high: 2.5 }],
    branch: "广州分行",
    venue: "上交所",
    leadUnderwriter: "中信证券",
    sourceText: "source",
  }, { id: "issuer-1", legalName: "广州越秀集团股份有限公司" }, { opinion: "流程意见" });

  assert.equal(record.status, "待投标");
  assert.equal(record.tranches.length, 2);
  assert.deepEqual(record.tranches.map((item) => item.shortName), ["26广越05", "26广越06"]);
  assert.deepEqual(record.tranches.map((item) => item.durationText), ["3年", "5年"]);
});

test("derives bidding and award statuses from tranche records", () => {
  const base = normalizeProjectRecord({
    shortName: "26测试MTN001A/B",
    tranches: [{ shortName: "A", bidRate: 1.8, bidAmount: 1 }, { shortName: "B", bidRate: 2, bidAmount: 1 }],
  });
  assert.equal(deriveProjectStatus(base), "已投标待结果");
  assert.equal(deriveProjectStatus({
    ...base,
    tranches: [{ ...base.tranches[0], resultStatus: "中标" }, { ...base.tranches[1], resultStatus: "未中标" }],
  }), "部分中标");
  assert.equal(deriveProjectStatus({
    ...base,
    tranches: base.tranches.map((item) => ({ ...item, resultStatus: "未中标" })),
  }), "未中标");
});

test("calculates dashboard counts and comprehensive pricing result summary", () => {
  const today = new Date("2026-06-10T09:00:00");
  const projects = [
    normalizeProjectRecord({ shortName: "A", status: "待投标", cutoffAt: "2026-06-10T15:00" }),
    normalizeProjectRecord({ shortName: "B", status: "已投标待结果" }),
    normalizeProjectRecord({ shortName: "C", status: "已中标" }),
  ];
  assert.deepEqual(dashboardCounts(projects, today), {
    all: 3,
    dueToday: 1,
    toBid: 1,
    awaitingResult: 1,
    won: 1,
    notWon: 0,
  });

  const project = normalizeProjectRecord({
    shortName: "26测试01",
    comprehensivePricing: true,
    afterTaxRevenue: 1.2,
    ftpCost: 0.7,
    tranches: [{
      shortName: "26测试01",
      bidRate: 1.8,
      bidAmount: 2,
      resultStatus: "中标",
      winningRate: 1.85,
      winningAmount: 1,
    }],
  });
  assert.equal(project.netIncome, 0.5);
  assert.match(buildBidResultSummary(project), /中标1亿元，中标利率1.85%/);
  assert.match(buildBidResultSummary(project), /扣除FTP后收益0.5/);
});

test("upserts project records without affecting issuers", () => {
  const state = upsertProject({ version: 2, issuers: [{ id: "issuer" }], projects: [] }, { shortName: "项目A" });
  assert.equal(state.issuers.length, 1);
  assert.equal(state.projects.length, 1);
});
