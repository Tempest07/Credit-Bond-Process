import test from "node:test";
import assert from "node:assert/strict";

import {
  applyGuidancePricing,
  applyIssuanceAdvertisement,
  buildAwardResultText,
  buildBidPositionText,
  calculateFtpForDuration,
  createProjectRecord,
  dashboardCounts,
  deriveProjectStatus,
  normalizeProjectRecord,
  parseIssuanceAdvertisement,
  suggestProjectCutoff,
  trancheNeedsPayment,
  updateProjectCutoff,
  upsertProject,
} from "../lifecycle.js";

test("creates a project ledger record with one tranche per bond variety", () => {
  const record = createProjectRecord({
    shortName: "26广越05/06",
    shortNames: ["26广越05", "26广越06"],
    durationText: "3/5年期",
    durationParts: ["3年", "5年"],
    inquiryRanges: [{ low: 1.3, high: 2.3 }, { low: 1.5, high: 2.5 }],
    issueScale: 20,
    guidancePrices: [1.7, 1.91],
    suggestedRatios: [20, 15],
    branch: "广州分行",
    venue: "上交所",
    leadUnderwriter: "中信证券",
    sourceText: "source",
  }, { id: "issuer-1", legalName: "广州越秀集团股份有限公司" }, { opinion: "流程意见" });

  assert.equal(record.status, "未投标");
  assert.equal(record.issueScale, 20);
  assert.equal(record.tranches.length, 2);
  assert.deepEqual(record.tranches.map((item) => item.shortName), ["26广越05", "26广越06"]);
  assert.deepEqual(record.tranches.map((item) => item.durationText), ["3年", "5年"]);
  assert.deepEqual(record.tranches.map((item) => item.suggestedRatio), [20, 15]);
  assert.deepEqual(record.tranches.map((item) => item.pricingMode), ["综合定价", "综合定价"]);
  assert.deepEqual(record.tranches.map((item) => item.pricingRate), [1.7, 1.91]);
});

test("fills missing comprehensive pricing from project brief guidance prices", () => {
  const project = normalizeProjectRecord({
    shortName: "26测试MTN001A/B",
    tranches: [
      { shortName: "26测试MTN001A", pricingMode: "未综", pricingRate: null },
      { shortName: "26测试MTN001B", pricingMode: "未综", pricingRate: 1.99 },
    ],
  });
  const updated = applyGuidancePricing(project, [1.68, 1.85]);

  assert.equal(updated.tranches[0].pricingMode, "综合定价");
  assert.equal(updated.tranches[0].pricingRate, 1.68);
  assert.equal(updated.tranches[1].pricingMode, "未综");
  assert.equal(updated.tranches[1].pricingRate, 1.99);
});

test("matches and interpolates FTP curve by bond duration", () => {
  const curve = {
    m3: 0.8,
    m4: 0.9,
    m6: 1,
    m9: 1.3,
    y1: 1.5,
    y2: 1.8,
    y3: 2.1,
    y4: 2.4,
    y5: 2.6,
    y7: 3,
    y10: 3.6,
  };

  assert.equal(calculateFtpForDuration("2M", curve), 0.8);
  assert.equal(calculateFtpForDuration("8M", curve), 1.2);
  assert.equal(calculateFtpForDuration("3+2年", curve), 2.1);
  assert.equal(calculateFtpForDuration("11年", curve), 3.6);
  assert.equal(calculateFtpForDuration("3年", { y3: 210 }), 2.1);
});

test("derives bidding, award and payment statuses from tranche records", () => {
  const base = normalizeProjectRecord({
    shortName: "26测试MTN001A/B",
    tranches: [{ shortName: "A", bidRate: 1.8, bidAmount: 1 }, { shortName: "B", bidRate: 2, bidAmount: 1 }],
  });
  assert.equal(deriveProjectStatus(base), "未投标");
  assert.equal(deriveProjectStatus({ ...base, status: "已投标待结果" }), "已投标待结果");
  assert.equal(deriveProjectStatus({
    ...base,
    resultConfirmed: true,
    tranches: [{ ...base.tranches[0], resultStatus: "中标" }, { ...base.tranches[1], resultStatus: "未中标" }],
  }), "部分中标");
  assert.equal(deriveProjectStatus({
    ...base,
    resultConfirmed: true,
    tranches: base.tranches.map((item) => ({ ...item, resultStatus: "未中标" })),
  }), "未中标");
  assert.equal(deriveProjectStatus({
    ...base,
    resultConfirmed: true,
    tranches: [{ ...base.tranches[0], resultStatus: "中标", paymentDate: "2026-06-12" }],
  }, new Date("2026-06-11T09:00:00")), "待缴款");
  assert.equal(deriveProjectStatus({
    ...base,
    resultConfirmed: true,
    tranches: [{ ...base.tranches[0], resultStatus: "中标", paymentDate: "2026-06-12" }],
  }, new Date("2026-06-12T09:00:00")), "待缴款");
  assert.equal(trancheNeedsPayment({
    resultStatus: "中标",
    paymentDate: "2026-06-12",
  }, new Date("2026-06-11T09:00:00")), true);
  assert.equal(trancheNeedsPayment({
    resultStatus: "中标",
    paymentDate: "2026-06-12",
  }, new Date("2026-06-12T09:00:00")), true);
  assert.equal(trancheNeedsPayment({
    resultStatus: "待出结果",
    winningAmountWan: 3000,
    paymentDate: "2026-06-12",
  }, new Date("2026-06-11T09:00:00")), true);
  const migratedWinning = normalizeProjectRecord({
    shortName: "26测试MTN001",
    venue: "银行间",
    cutoffAt: "2026-06-11T18:00",
    resultConfirmed: true,
    tranches: [{ shortName: "26测试MTN001", resultStatus: "中标", winningAmountWan: 3000 }],
  });
  assert.equal(migratedWinning.tranches[0].paymentDate, "2026-06-12");
  assert.equal(deriveProjectStatus(migratedWinning, new Date("2026-06-11T09:00:00")), "待缴款");
  assert.equal(deriveProjectStatus({
    ...base,
    resultConfirmed: true,
    tranches: [{ ...base.tranches[0], resultStatus: "中标", paymentDate: "2026-06-12", paymentCompleted: true }],
  }), "已缴款");
  assert.equal(deriveProjectStatus(normalizeProjectRecord({
    shortName: "委外中标项目",
    resultConfirmed: true,
    tranches: [{
      shortName: "委外中标项目",
      resultStatus: "未中标",
      paymentDate: "2026-06-12",
      outsourcedBids: [{ managerName: "委外一号", winningAmountWan: 5000 }],
    }],
  }), new Date("2026-06-12T09:00:00")), "待缴款");
});

test("calculates dashboard counts including payment reminders", () => {
  const today = new Date("2026-06-10T09:00:00");
  const projects = [
    normalizeProjectRecord({ shortName: "A", status: "未投标", cutoffAt: "2026-06-10T15:00" }),
    normalizeProjectRecord({ shortName: "B", status: "已投标待结果" }),
    normalizeProjectRecord({ shortName: "C", status: "待缴款", resultConfirmed: true, tranches: [{ shortName: "C", resultStatus: "中标", paymentDate: "2026-06-10" }] }),
    normalizeProjectRecord({ shortName: "D", status: "已缴款" }),
    normalizeProjectRecord({ shortName: "E", status: "已中标", resultConfirmed: true, tranches: [{ shortName: "E", resultStatus: "中标", paymentDate: "2026-06-11" }] }),
  ];
  assert.deepEqual(dashboardCounts(projects, today), {
    all: 5,
    dueToday: 1,
    toBid: 1,
    awaitingResult: 1,
    won: 3,
    notWon: 0,
    duePayment: 2,
    paymentToday: 1,
  });
});

test("suggests cutoff times by venue and flags private interbank issuers", () => {
  const reference = new Date("2026-06-11T09:00:00");
  assert.deepEqual(suggestProjectCutoff({ venue: "银行间", sourceText: "" }, { enterpriseType: "地方国企" }, reference), {
    cutoffAt: "2026-06-12T18:00",
    cutoffTimeConfirmed: true,
    cutoffSource: "银行间默认18:00",
  });
  assert.deepEqual(suggestProjectCutoff({ venue: "上交所", sourceText: "" }, null, reference), {
    cutoffAt: "2026-06-12T19:00",
    cutoffTimeConfirmed: true,
    cutoffSource: "交易所默认19:00",
  });
  assert.equal(
    suggestProjectCutoff({ venue: "银行间", sourceText: "" }, { enterpriseType: "民营企业" }, reference).cutoffTimeConfirmed,
    false,
  );
  assert.equal(
    suggestProjectCutoff({ venue: "银行间", sourceText: "6月15日18:30截标" }, null, reference).cutoffAt,
    "2026-06-15T18:30",
  );
  assert.equal(
    suggestProjectCutoff({ venue: "银行间", sourceText: "" }, null, new Date("2026-06-12T09:00:00")).cutoffAt,
    "2026-06-15T18:00",
  );
});

test("records cutoff changes and confirmation state", () => {
  const project = normalizeProjectRecord({
    shortName: "26测试01",
    cutoffAt: "2026-06-12T18:00",
    cutoffTimeConfirmed: false,
  });
  const updated = updateProjectCutoff(project, "2026-06-12T19:00", "延期60分钟", true);
  assert.equal(updated.cutoffTimeConfirmed, true);
  assert.equal(updated.cutoffSource, "延期60分钟");
  assert.deepEqual(updated.cutoffHistory[0], {
    from: "2026-06-12T18:00",
    to: "2026-06-12T19:00",
    reason: "延期60分钟",
    changedAt: updated.cutoffHistory[0].changedAt,
  });
});

test("builds own and outsourced bid positions for interbank, exchange and dual projects", () => {
  const nonLead = normalizeProjectRecord({
    shortName: "26测试MTN001",
    venue: "银行间",
    sponsorStatus: "非我行主承",
    leadUnderwriter: "中信银行",
    tranches: [{
      shortName: "26测试MTN001",
      suggestedRatio: 30,
      bidRate: 1.6,
      bidAmount: 3,
      outsourcedBids: [{ managerName: "委外一号", bidRate: 1.62, bidAmount: 1 }],
    }],
  });
  assert.equal(
    buildBidPositionText(nonLead),
    "【参团+投标】26测试MTN001，1.60%投3亿，不超30%，主承中信银行\n【委外投标：委外一号】26测试MTN001，1.62%投1亿，不超30%",
  );

  const revised = normalizeProjectRecord({
    shortName: "26越秀交通MTN003",
    venue: "银行间",
    sponsorStatus: "非我行主承",
    leadUnderwriter: "中信银行",
    tranches: [{
      shortName: "26越秀交通MTN003",
      suggestedRatio: 30,
      bidAction: "改标",
      bidLevels: [
        { bidRate: 1.76, bidAmount: 1.2 },
        { bidRate: 1.8, bidAmount: 0.4 },
      ],
    }],
  });
  assert.equal(
    buildBidPositionText(revised),
    "【改标】26越秀交通MTN003，1.76%投1.2亿，1.80%投0.4亿，合计不超30%，主承中信银行",
  );

  const lead = normalizeProjectRecord({
    shortName: "26测试SCP001",
    venue: "银行间",
    sponsorStatus: "牵头",
    tranches: [{ shortName: "26测试SCP001", suggestedRatio: 20, bidRate: 1.5, bidAmount: 2 }],
  });
  assert.equal(buildBidPositionText(lead), "【投标】26测试SCP001，1.50%投2亿，不超20%");

  const exchange = normalizeProjectRecord({
    shortName: "26测试01",
    venue: "上交所",
    sponsorStatus: "非我行主承",
    tranches: [{ shortName: "26测试01", suggestedRatio: 30, bidRate: 1.7, bidAmount: 2 }],
  });
  assert.equal(buildBidPositionText(exchange), "【投标】26测试01，1.70%投2亿，不超30%");

  const dual = normalizeProjectRecord({
    shortName: "26测试MTN002A/B",
    venue: "银行间",
    sponsorStatus: "联席",
    tranches: [
      { shortName: "26测试MTN002A", durationText: "2年", suggestedRatio: 20, bidRate: 1.6, bidAmount: 2 },
      { shortName: "26测试MTN002B", durationText: "5年", suggestedRatio: 15, bidRate: 1.8, bidAmount: 1 },
    ],
  });
  assert.equal(
    buildBidPositionText(dual),
    "【投标】26测试MTN002A，2年期，1.60%投2亿，不超2年期的20%\n【投标】26测试MTN002B，5年期，1.80%投1亿，不超5年期的15%",
  );
});

test("parses issuance advertisements and infers payment month", () => {
  const exchangeAd = `【26常通01  245383.SH】簿记结果
发行规模：7亿元
债券期限：5年
全场倍数：4.7倍
票面利率：1.84%
缴款日期：6月12日
---------------------
【26常通02  245384.SH】全部回拨至品种一`;
  const parsedExchange = parseIssuanceAdvertisement(exchangeAd, new Date("2026-06-11T09:00:00"));
  assert.equal(parsedExchange.items[0].shortName, "26常通01");
  assert.equal(parsedExchange.items[0].securityCode, "245383.SH");
  assert.equal(parsedExchange.items[0].durationText, "5年");
  assert.equal(parsedExchange.items[0].issueScale, 7);
  assert.equal(parsedExchange.items[0].fullMarketMultiple, 4.7);
  assert.equal(parsedExchange.items[0].couponRate, 1.84);
  assert.equal(parsedExchange.items[0].paymentDate, "2026-06-12");
  assert.equal(parsedExchange.items[1].allocationNote, "全部回拨至品种一");

  const interbankAd = "【发行结果】26远东租赁SCP005，代码：012681422，期限179天，规模10亿，票面1.45%，11日缴款，感谢各位金主支持！";
  const currentMonth = parseIssuanceAdvertisement(interbankAd, new Date("2026-06-11T09:00:00")).items[0];
  const nextMonth = parseIssuanceAdvertisement(interbankAd, new Date("2026-06-12T09:00:00")).items[0];
  assert.equal(currentMonth.shortName, "26远东租赁SCP005");
  assert.equal(currentMonth.securityCode, "012681422");
  assert.equal(currentMonth.durationText, "179天");
  assert.equal(currentMonth.paymentDate, "2026-06-11");
  assert.equal(nextMonth.paymentDate, "2026-07-11");

  const detailedAd = `珠海正方集团有限公司2026年度第一期中期票据
......................................
简称代码：26珠海正方MTN001（102682132.IB）
主体/债项评级：AA+/-
债券期限：3年
发行规模：6.2亿元
票面利率：2.27%
全场倍数：1.50倍
......................................
起息日期：2026-06-11
缴款日期：2026-06-11
......................................
感谢大家的支持！`;
  const detailed = parseIssuanceAdvertisement(detailedAd, new Date("2026-06-11T09:00:00"));
  assert.equal(detailed.issuerName, "珠海正方集团有限公司");
  assert.equal(detailed.items[0].shortName, "26珠海正方MTN001");
  assert.equal(detailed.items[0].securityCode, "102682132.IB");
  assert.equal(detailed.items[0].durationText, "3年");
  assert.equal(detailed.items[0].issueScale, 6.2);
  assert.equal(detailed.items[0].couponRate, 2.27);
  assert.equal(detailed.items[0].fullMarketMultiple, 1.5);
  assert.equal(detailed.items[0].startDate, "2026-06-11");
  assert.equal(detailed.items[0].paymentDate, "2026-06-11");

  const notice = parseIssuanceAdvertisement(`【截标通知】
26广州产投SCP004：AAA国企，9.5亿，270天，区间1.30%-1.47%，票面利率1.43%，明日缴款，感谢支持！`, new Date("2026-06-11T09:00:00"));
  assert.equal(notice.items[0].shortName, "26广州产投SCP004");
  assert.equal(notice.items[0].issueScale, 9.5);
  assert.equal(notice.items[0].durationText, "270天");
  assert.equal(notice.items[0].couponRate, 1.43);
  assert.equal(notice.items[0].paymentDate, "2026-06-12");

  const terse = parseIssuanceAdvertisement("【发行结果】26越秀交通MTN003，12亿，5年，边际1.76%，边际1.05倍，全场1.75倍，感谢支持！", new Date("2026-06-11T09:00:00"));
  assert.equal(terse.items[0].shortName, "26越秀交通MTN003");
  assert.equal(terse.items[0].issueScale, 12);
  assert.equal(terse.items[0].durationText, "5年");
  assert.equal(terse.items[0].couponRate, 1.76);
  assert.equal(terse.items[0].marginalMultiple, 1.05);
  assert.equal(terse.items[0].fullMarketMultiple, 1.75);
});

test("applies advertisements and builds own and outsourced award report", () => {
  const ad = "【发行结果】26测试SCP001，代码：012681422，期限179天，规模10亿，票面1.45%，11日缴款";
  const project = applyIssuanceAdvertisement(normalizeProjectRecord({
    shortName: "26测试SCP001",
    tranches: [{
      shortName: "26测试SCP001",
      resultStatus: "中标",
      winningAmountWan: 12000,
      pricingMode: "综合定价",
      pricingRate: 1.48,
      revenueBp: 3.5,
      outsourcedBids: [{ managerName: "委外一号", winningAmountWan: 5000, pricingMode: "未综", revenueBp: 99 }],
    }],
  }), ad, new Date("2026-06-11T09:00:00"));

  assert.equal(project.tranches[0].winningRate, 1.45);
  assert.equal(project.tranches[0].paymentDate, "2026-06-11");
  assert.equal(
    buildAwardResultText(project),
    `${ad}\n\n表内中标1.2亿，综合定价至1.48%，营收3.5BP\n委外一号委外中标5000万，未综`,
  );
});

test("auto-calculates winning amounts from bid positions and marginal multiple", () => {
  const ad = `珠海正方集团有限公司2026年度第一期中期票据
......................................
简称代码：26珠海正方MTN001（102682132.IB）
债券期限：3年
发行规模：6.2亿元
票面利率：2.27%
全场倍数：1.50倍
边际倍数：2倍
起息日期：2026-06-11
缴款日期：2026-06-11
感谢大家的支持！`;
  const project = applyIssuanceAdvertisement(normalizeProjectRecord({
    shortName: "26珠海正方MTN001",
    ftpCost: 122.25,
    tranches: [{
      shortName: "26珠海正方MTN001",
      bidRate: 2.27,
      bidAmount: 2.4,
      pricingMode: "未综",
      outsourcedBids: [
        { managerName: "委外一号", bidRate: 2.26, bidAmount: 1 },
        { managerName: "委外二号", bidRate: 2.3, bidAmount: 1 },
      ],
    }],
  }), ad, new Date("2026-06-11T09:00:00"));

  assert.equal(project.tranches[0].marginalMultiple, 2);
  assert.equal(project.tranches[0].resultStatus, "中标");
  assert.equal(project.tranches[0].winningAmountWan, 12000);
  assert.equal(project.tranches[0].revenueBp, 90.36);
  assert.equal(project.tranches[0].outsourcedBids[0].winningAmountWan, 10000);
  assert.equal(project.tranches[0].outsourcedBids[1].winningAmountWan, 0);
  assert.equal(
    buildAwardResultText(project),
    `${ad}\n\n表内中标1.2亿，未综，营收90.36BP\n委外一号委外中标1亿，未综`,
  );
});

test("sums multiple own bid levels when auto-calculating winning amounts", () => {
  const ad = "【发行结果】26越秀交通MTN003，代码：102681111，期限3年，规模10亿，票面1.80%，边际倍数2倍，11日缴款";
  const project = applyIssuanceAdvertisement(normalizeProjectRecord({
    shortName: "26越秀交通MTN003",
    ftpCost: 87,
    tranches: [{
      shortName: "26越秀交通MTN003",
      bidAction: "改标",
      bidLevels: [
        { bidRate: 1.76, bidAmount: 1.2 },
        { bidRate: 1.8, bidAmount: 0.4 },
        { bidRate: 1.82, bidAmount: 0.3 },
      ],
    }],
  }), ad, new Date("2026-06-11T09:00:00"));

  assert.equal(project.tranches[0].winningRate, 1.8);
  assert.equal(project.tranches[0].winningAmountWan, 14000);
  assert.equal(project.tranches[0].resultStatus, "中标");
  assert.equal(project.tranches[0].revenueBp, 81.59);
});

test("maps single base-name result to dual-tranche duration and infers payment date", () => {
  const ad = "【发行结果】26越秀交通MTN003，12亿，5年，边际1.76%，边际1.05倍，全场1.75倍，感谢支持！";
  const project = applyIssuanceAdvertisement(normalizeProjectRecord({
    shortName: "26越秀交通MTN003A/B",
    venue: "银行间",
    cutoffAt: "2026-06-11T18:00",
    ftpCost: 172,
    tranches: [
      { shortName: "26越秀交通MTN003A", durationText: "2年", bidRate: 1.6, bidAmount: 1 },
      {
        shortName: "26越秀交通MTN003B",
        durationText: "5年",
        bidRate: 1.76,
        bidAmount: 1.6,
        pricingMode: "综合定价",
        pricingRate: 1.85,
      },
    ],
  }), ad, new Date("2026-06-11T09:00:00"));

  assert.equal(project.tranches[0].winningAmountWan, null);
  assert.equal(project.tranches[0].paymentDate, "");
  assert.equal(project.tranches[1].winningRate, 1.76);
  assert.equal(project.tranches[1].marginalMultiple, 1.05);
  assert.equal(project.tranches[1].winningAmountWan, 15000);
  assert.equal(project.tranches[1].paymentDate, "2026-06-12");
  assert.equal(project.tranches[1].revenueBp, -7.16);
  assert.equal(deriveProjectStatus({ ...project, resultConfirmed: true }, new Date("2026-06-11T09:00:00")), "待缴款");
  assert.equal(
    buildAwardResultText(project),
    `${ad}\n\n表内中标1.5亿，综合定价至1.85%，营收-7.16BP`,
  );
});

test("uses FTP curve to calculate revenue from tranche duration", () => {
  const ad = "【发行结果】26测试MTN001，代码：102681111，期限3年，规模10亿，票面2.00%，11日缴款";
  const project = applyIssuanceAdvertisement({
    ...normalizeProjectRecord({
    shortName: "26测试MTN001",
    tranches: [{
      shortName: "26测试MTN001",
      durationText: "3年",
      bidRate: 2,
      bidAmount: 1,
    }],
    }),
    ftpCurve: { y3: 1.2 },
  }, ad, new Date("2026-06-11T09:00:00"));

  assert.equal(project.tranches[0].winningAmountWan, 10000);
  assert.equal(project.tranches[0].revenueBp, 67.32);
});

test("keeps manually edited winning amounts during normal saves", () => {
  const project = normalizeProjectRecord({
    shortName: "26测试MTN001",
    tranches: [{
      shortName: "26测试MTN001",
      bidRate: 2.27,
      bidAmount: 1.2,
      winningRate: 2.27,
      winningAmountWan: 8000,
      resultStatus: "中标",
      revenueBp: 45,
    }],
  });

  assert.equal(project.tranches[0].winningAmountWan, 8000);
  assert.equal(project.tranches[0].revenueBp, 45);
});

test("upserts project records without affecting issuers", () => {
  const state = upsertProject({ version: 2, issuers: [{ id: "issuer" }], projects: [] }, { shortName: "项目A" });
  assert.equal(state.issuers.length, 1);
  assert.equal(state.projects.length, 1);
});
