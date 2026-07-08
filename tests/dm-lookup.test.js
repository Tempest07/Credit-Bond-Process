import test from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, __test__ } from "../functions/api/dm/lookup.js";
import { onRequestGet as onValuationRequestGet, __test__ as valuationTest } from "../functions/api/dm/valuation.js";

test("SM4 block encryption matches the official test vector", () => {
  const key = hexToBytes("0123456789abcdeffedcba9876543210");
  const plaintext = hexToBytes("0123456789abcdeffedcba9876543210");
  const ciphertext = __test__.sm4CryptBlock(plaintext, __test__.sm4RoundKeys(key));
  assert.equal(__test__.bytesToHex(ciphertext), "681edf34d206965e86b3e94f536e4246");
});

test("DM lookup normalizes mocked bond, primary and rating fields", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init.body });
    const body = __test__.sm4DecryptFromBase64Url(init.body, secret);
    const request = JSON.parse(body);
    let data;
    if (url.includes("/bond/basic-info/info")) {
      assert.deepEqual(request.secShortNameList, ["26测试SCP001"]);
      data = [{
        security_id: "012681111.IB",
        sec_short_name: "26测试SCP001",
        sec_full_name: "测试集团有限公司2026年度第一期超短期融资券",
        issuer_name: "测试集团有限公司",
        society_code: "91320000123456789X",
        bond_matu: "270D",
        subject_rating: "AAA",
        rating_agency: "中诚信国际",
        implied_rating: "AA+",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "012681111.IB",
          sec_short_name: "26测试SCP001",
          issuer_full_name: "测试集团有限公司",
          bond_issue_tenor: "270D",
          plan_issue_amount: 70000,
          subscribe_rate: "1.300000 ~ 1.500000",
          tender_market_desc: null,
          public_offering_status: "公募",
          unde_name: "平安银行股份有限公司,兴业银行股份有限公司",
          subscribe_date: 1782662400000,
          subscribe_time: "18:00",
          pay_date: 1782748800000,
        }],
      };
    } else {
      assert.deepEqual(request.comFullNameList, ["测试集团有限公司"]);
      data = [{ com_full_name: "测试集团有限公司", society_code: "91320000123456789X", is_city_annex: 1 }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26%E6%B5%8B%E8%AF%95SCP001", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.normalized.shortName, "26测试SCP001");
    assert.equal(payload.normalized.issuerName, "测试集团有限公司");
    assert.equal(payload.normalized.societyCode, "91320000123456789X");
    assert.equal(payload.normalized.issueScaleYi, 7);
    assert.equal(payload.normalized.inquiryRange, "1.3-1.5");
    assert.equal(payload.normalized.venue, "银行间");
    assert.equal(payload.normalized.leadUnderwriter, "平安银行股份有限公司,兴业银行股份有限公司");
    assert.equal(payload.normalized.sponsorStatus, "联席");
    assert.equal(payload.normalized.subscribeDate, "2026-06-29");
    assert.equal(payload.normalized.paymentDate, "2026-06-30");
    assert.equal(payload.normalized.subjectRating, "AAA");
    assert.equal(payload.normalized.ratingAgency, "中诚信国际");
    assert.equal(payload.normalized.impliedRating, "AA+");
    assert.ok(payload.fieldCandidates.some((item) => item.key === "implied_rating"));
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup resolves a primary record by full bond name", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const fullName = "广州地铁集团有限公司2026年度第六期超短期融资券";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (String(url).includes("/bond/basic-info/info")) {
      throw new Error("fullName-only lookup should not call basic-info");
    } else if (String(url).includes("/bond/primary/data")) {
      assert.equal(request.bond_category, "1");
      assert.equal(request.issuerFullName, undefined);
      data = {
        list: [
          {
            security_id: "012681234.IB",
            sec_short_name: "26广州地铁SCP006",
            sec_full_name: fullName,
            issuer_full_name: "广州地铁集团有限公司",
            bond_issue_tenor: "270D",
            plan_issue_amount: 210000,
            subscribe_rate: "1.300000 ~ 1.600000",
            subscribe_date: "2026-06-29",
            subject_rating: "AAA",
            rating_agency: "中诚信国际",
            implied_rating: "AAA",
          },
          {
            security_id: "012689999.IB",
            sec_short_name: "26其他SCP001",
            sec_full_name: "其他发行人2026年度第一期超短期融资券",
            issuer_full_name: "其他发行人",
          },
        ],
      };
    } else {
      assert.deepEqual(request.comFullNameList, ["广州地铁集团有限公司"]);
      data = [{ com_full_name: "广州地铁集团有限公司" }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request(`http://127.0.0.1:8788/api/dm/lookup?fullName=${encodeURIComponent(fullName)}`, {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.query.fullName, fullName);
    assert.equal(payload.normalized.shortName, "26广州地铁SCP006");
    assert.equal(payload.normalized.fullName, fullName);
    assert.equal(payload.normalized.issuerName, "广州地铁集团有限公司");
    assert.equal(payload.normalized.issueScaleYi, 21);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup discovers ABS tranches and ABS-specific fields", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const primaryRequests = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (String(url).includes("/bond/basic-info/info")) {
      data = [{
        security_id: "260001.SZ",
        sec_short_name: "26创格2A",
        sec_full_name: "创格租赁悦升2025年第2期资产支持专项计划(普惠金融)优先A1级资产支持证券",
        issuer_name: "创格融资租赁有限公司",
        bond_type_desc: "资产支持证券",
      }];
    } else if (String(url).includes("/bond/primary/data")) {
      primaryRequests.push(request);
      data = request.bond_category === "2" ? {
        list: [
          {
            security_id: "260001.SZ",
            sec_short_name: "26创格2A",
            sec_full_name: "创格租赁悦升2025年第2期资产支持专项计划(普惠金融)",
            issuer_full_name: "创格融资租赁有限公司",
            bond_type_desc: "资产支持证券",
            total_issue_amount: 50000,
            plan_issue_amount: 34535,
            issue_ratio: 69.07,
            pre_maturity_date: "2027/04/16",
            bond_rating: "AAA",
            rating_agency: "联合资信",
            subscribe_rate: "1.5-2.0",
            underlying_asset: "租金请求权、附属担保权益及租赁车辆的尾付款",
            difference_payment_committer: "创格融资租赁有限公司",
          },
          {
            security_id: "260002.SZ",
            sec_short_name: "26创格2B",
            sec_full_name: "创格租赁悦升2025年第2期资产支持专项计划(普惠金融)",
            issuer_full_name: "创格融资租赁有限公司",
            bond_type_desc: "资产支持证券",
            total_issue_amount: 50000,
            plan_issue_amount: 5920,
            issue_ratio: 11.84,
            plan_maturity_date: "2027-10-25",
            bond_rating: "AAA",
            rating_agency: "联合资信",
            subscribe_rate: "1.8-2.3",
            underlying_asset: "租金请求权、附属担保权益及租赁车辆的尾付款",
            difference_payment_committer: "创格融资租赁有限公司",
          },
          {
            security_id: "260003.SZ",
            sec_short_name: "26创格2C",
            sec_full_name: "创格租赁悦升2025年第2期资产支持专项计划(普惠金融)次级资产支持证券",
            issuer_full_name: "创格融资租赁有限公司",
            bond_type_desc: "资产支持证券",
            total_issue_amount: 50000,
            plan_issue_amount: 9545,
            issue_ratio: 19.09,
          },
        ],
      } : { list: [] };
    } else {
      data = [{ com_full_name: "创格融资租赁有限公司" }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26%E5%88%9B%E6%A0%BC2A", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.normalized.instrumentType, "ABS");
    assert.equal(payload.normalized.isAbs, true);
    assert.equal(payload.normalized.absInfo.totalScale, 5);
    assert.equal(payload.normalized.absInfo.underlyingAsset, "租金请求权、附属担保权益及租赁车辆的尾付款");
    assert.equal(payload.normalized.absInfo.creditEnhancementType, "差额支付承诺人");
    assert.equal(payload.issueGroup.instrumentType, "ABS");
    assert.equal(payload.issueGroup.tranches.length, 3);
    assert.deepEqual(payload.issueGroup.tranches.map((item) => item.trancheLevel), ["优先A1级", "优先A2级", "次级"]);
    assert.equal(payload.issueGroup.tranches[0].sharePct, 69.07);
    assert.equal(payload.issueGroup.tranches[0].expectedMaturityDate, "2027-04-16");
    assert.equal(payload.issueGroup.tranches[0].debtRating, "AAA");
    assert.equal(payload.issueGroup.tranches[0].debtRatingAgency, "联合资信");
    assert.ok(primaryRequests.some((request) => request.bond_category === "2"));
    assert.ok(primaryRequests.some((request) => !request.bond_category));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup prefers callable tenor from basic bond fields over final issue tenor", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (url.includes("/bond/basic-info/info")) {
      assert.deepEqual(request.secShortNameList, ["26含权MTN001"]);
      data = [{
        security_id: "102681234.IB",
        sec_short_name: "26含权MTN001",
        sec_full_name: "含权测试集团有限公司2026年度第一期中期票据",
        issuer_name: "含权测试集团有限公司",
        bond_matu: "3+2Y",
        special_item: "调整票面利率选择权、投资者回售选择权",
        next_option_date: "2029-06-27",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "102681234.IB",
          sec_short_name: "26含权MTN001",
          issuer_full_name: "含权测试集团有限公司",
          bond_issue_tenor: "5Y",
          plan_issue_amount: 50000,
          subscribe_rate: "1.500000 ~ 2.000000",
          subscribe_date: "2026-06-27",
        }],
      };
    } else {
      data = [{ com_full_name: "含权测试集团有限公司" }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26%E5%90%AB%E6%9D%83MTN001", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.normalized.durationText, "3+2Y");
    assert.equal(payload.normalized.durationSource, "bond_matu");
    assert.equal(payload.normalized.specialItem, "调整票面利率选择权、投资者回售选择权");
    assert.equal(payload.normalized.nextOptionDate, "2029-06-27");
    assert.ok(payload.fieldCandidates.some((item) => item.key === "special_item"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM valuation assistant uses current DM valuations and cross-market tech adjustments", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (url.includes("/bond/basic-info/outstanding-bonds")) {
      assert.equal(request.issuerFullName, "青岛城市建设投资集团有限公司");
      assert.deepEqual(request.bondStatusList, [2]);
      data = {
        list: [
          {
            security_id: "102600001.IB",
            sec_short_name: "25青岛城投MTN001",
            sec_full_name: "青岛城市建设投资集团有限公司2025年度第一期中期票据",
            issuer_name: "青岛城市建设投资集团有限公司",
            remaining_tenor: "4.9Y",
            bond_issue_tenor: "5Y",
            bond_type_desc: "中期票据",
          },
          {
            security_id: "2520001.SH",
            sec_short_name: "25青岛城投KJ01",
            sec_full_name: "青岛城市建设投资集团有限公司2025年面向专业投资者公开发行科技创新公司债券(第一期)",
            issuer_name: "青岛城市建设投资集团有限公司",
            remaining_tenor: "5.1Y",
            bond_issue_tenor: "5Y",
            bond_type_desc: "公司债券",
          },
          {
            security_id: "102600010.IB",
            sec_short_name: "25青岛城投MTN010",
            sec_full_name: "青岛城市建设投资集团有限公司2025年度第十期中期票据",
            issuer_name: "青岛城市建设投资集团有限公司",
            remaining_tenor: "4.61Y+10.00Y",
            bond_issue_tenor: "5+10Y",
            bond_type_desc: "中期票据",
          },
          {
            security_id: "2520002.SH",
            sec_short_name: "25青岛城投私募01",
            sec_full_name: "青岛城市建设投资集团有限公司2025年非公开发行公司债券(第一期)",
            issuer_name: "青岛城市建设投资集团有限公司",
            remaining_tenor: "5Y",
            bond_issue_tenor: "5Y",
            bond_type_desc: "公司债券",
          },
          {
            security_id: "102600999.IB",
            sec_short_name: "25青岛城投MTN002",
            sec_full_name: "青岛城市建设投资集团有限公司2025年度第二期永续中期票据",
            issuer_name: "青岛城市建设投资集团有限公司",
            remaining_tenor: "4.61Y+10.00Y",
            bond_issue_tenor: "5+NY",
            bond_type_desc: "中期票据",
          },
        ],
        maxOffset: null,
      };
    } else if (url.includes("/bond/basic-info/info")) {
      assert.ok(request.securityIdList.includes("102600001.IB"));
      data = request.securityIdList.map((securityId) => {
        if (securityId === "2520001.SH") {
          return {
            security_id: securityId,
            sec_short_name: "25青岛城投KJ01",
            sec_full_name: "青岛城市建设投资集团有限公司2025年面向专业投资者公开发行科技创新公司债券(第一期)",
            remaining_tenor: "5.1Y",
            bond_type_desc: "公司债券",
            payment_order: "普通债权",
            special_item: "",
          };
        }
        if (securityId === "102600010.IB") {
          return {
            security_id: securityId,
            sec_short_name: "25青岛城投MTN010",
            sec_full_name: "青岛城市建设投资集团有限公司2025年度第十期中期票据",
            remaining_tenor: "4.61Y+10.00Y",
            bond_issue_tenor: "5+10Y",
            bond_type_desc: "中期票据",
            payment_order: "普通债权",
            special_item: "调整票面利率选择权、投资者回售选择权",
          };
        }
        if (securityId === "102600999.IB") {
          return {
            security_id: securityId,
            sec_short_name: "25青岛城投MTN002",
            sec_full_name: "青岛城市建设投资集团有限公司2025年度第二期中期票据",
            remaining_tenor: "4.61Y+10.00Y",
            bond_type_desc: "中期票据",
            payment_order: "普通债权",
            special_item: "发行人续期选择权、递延支付利息选择权",
          };
        }
        return {
          security_id: securityId,
          sec_short_name: securityId === "102600001.IB" ? "25青岛城投MTN001" : "25青岛城投私募01",
          sec_full_name: securityId === "102600001.IB"
            ? "青岛城市建设投资集团有限公司2025年度第一期中期票据"
            : "青岛城市建设投资集团有限公司2025年非公开发行公司债券(第一期)",
          remaining_tenor: securityId === "102600001.IB" ? "4.9Y" : "5Y",
          bond_type_desc: securityId === "102600001.IB" ? "中期票据" : "公司债券",
          payment_order: "普通债权",
          special_item: "",
        };
      });
    } else if (url.includes("/bond/market-data/date")) {
      assert.deepEqual(request.startDate, "2026-06-26");
      assert.ok(request.securityIdList.length <= 5);
      assert.ok(request.securityIdList.includes("102600010.IB"));
      assert.ok(!request.securityIdList.includes("102600999.IB"));
      data = request.securityIdList.map((securityId) => ({
        security_id: securityId,
        sec_short_name: securityId === "2520001.SH"
          ? "25青岛城投KJ01"
          : securityId === "102600010.IB"
            ? "25青岛城投MTN010"
            : "25青岛城投MTN001",
        issue_date: "2026-06-26",
        cb_ytm: securityId === "2520001.SH" ? 2.46 : securityId === "102600010.IB" ? 2.51 : 2.5,
        cb_yte: null,
        cb_reliability: "推荐",
      }));
    } else {
      throw new Error(`unexpected DM path: ${url}`);
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onValuationRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/valuation?issuerName=%E9%9D%92%E5%B2%9B%E5%9F%8E%E5%B8%82%E5%BB%BA%E8%AE%BE%E6%8A%95%E8%B5%84%E9%9B%86%E5%9B%A2%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8&durationText=5%2B5%2B5Y&offeringType=%E5%85%AC%E5%8B%9F&venue=%E9%93%B6%E8%A1%8C%E9%97%B4&shortName=26%E9%9D%92%E5%B2%9B%E5%9F%8E%E6%8A%95MTN001&valuationDate=2026-06-26", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "DM market-data/date");
    assert.equal(payload.trancheSuggestions[0].years, 5);
    assert.ok(payload.trancheSuggestions[0].method.includes("交易所科创债约4bp"));
    const techComparable = payload.trancheSuggestions[0].comparableItems.find((item) => item.shortName === "25青岛城投KJ01");
    assert.ok(techComparable);
    assert.ok(payload.trancheSuggestions[0].comparableItems.some((item) => item.shortName === "25青岛城投MTN010"));
    assert.ok(!payload.trancheSuggestions[0].comparableItems.some((item) => item.shortName === "25青岛城投MTN002"));
    assert.ok(techComparable.marketAdjustment > 0.03);
    assert.ok(payload.trancheSuggestions[0].center > 2.48 && payload.trancheSuggestions[0].center < 2.52);
    assert.ok(calls.some((url) => url.includes("/bond/market-data/date")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM valuation assistant prefers society code when loading issuer comparables", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const outstandingRequests = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (url.includes("/bond/basic-info/outstanding-bonds")) {
      outstandingRequests.push(request);
      assert.equal(request.societyCode, "91320200123456789X");
      assert.equal(request.issuerFullName, undefined);
      data = {
        list: [{
          security_id: "256800002.SH",
          sec_short_name: "26锡城02",
          sec_full_name: "无锡城建发展集团有限公司2026年面向专业投资者非公开发行公司债券(第二期)",
          issuer_name: "无锡城建发展集团有限公司",
          remaining_tenor: "9.92Y",
          bond_issue_tenor: "10Y",
          bond_type_desc: "公司债券",
          public_offering_status: "私募",
        }],
        maxOffset: null,
      };
    } else if (url.includes("/bond/basic-info/info")) {
      data = request.securityIdList.map((securityId) => ({
        security_id: securityId,
        sec_short_name: "26锡城02",
        sec_full_name: "无锡城建发展集团有限公司2026年面向专业投资者非公开发行公司债券(第二期)",
        issuer_name: "无锡城建发展集团有限公司",
        remaining_tenor: "9.92Y",
        bond_issue_tenor: "10Y",
        bond_type_desc: "公司债券",
        payment_order: "普通债权",
        special_item: "",
      }));
    } else if (url.includes("/bond/market-data/date")) {
      assert.deepEqual(request.securityIdList, ["256800002.SH"]);
      data = [{
        security_id: "256800002.SH",
        sec_short_name: "26锡城02",
        valuation_date: "2026-06-30",
        cb_ytm: 2.4575,
        cb_reliability: "推荐",
      }];
    } else {
      throw new Error(`unexpected DM path: ${url}`);
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onValuationRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/valuation?issuerName=%E5%90%8D%E7%A7%B0%E5%8F%AF%E8%83%BD%E6%9C%89%E5%B7%AE%E5%BC%82&societyCode=91320200123456789X&durationText=10Y&offeringType=%E7%A7%81%E5%8B%9F&venue=%E4%B8%8A%E4%BA%A4%E6%89%80&shortName=26%E9%94%A1%E5%9F%8E03&valuationDate=2026-06-30", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.query.societyCode, "91320200123456789X");
    assert.equal(payload.trancheSuggestions[0].comparableItems[0].shortName, "26锡城02");
    assert.equal(outstandingRequests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM valuation assistant centers on the nearest duration cluster", () => {
  const profile = {
    bondClass: "MTN",
    market: "interbank",
    exchangeTech: false,
    perpetual: false,
    subordinated: false,
    structured: false,
  };
  const candidates = [
    valuationCandidate("near-1", 4.61, 1.9546, profile),
    valuationCandidate("near-2", 4.59, 1.9525, profile),
    valuationCandidate("short-1", 3.78, 1.8381, profile),
    valuationCandidate("short-2", 3.72, 1.8361, profile),
    valuationCandidate("short-3", 3.69, 1.8351, profile),
  ];
  const suggestion = valuationTest.buildTrancheSuggestion(
    { durationText: "5+10Y", years: 5 },
    0,
    candidates,
    profile,
    true,
  );

  assert.equal(suggestion.center, 1.97);
  assert.equal(suggestion.clusterMode, "nearestCluster");
  assert.equal(suggestion.confidence, "中等");
  assert.deepEqual(suggestion.comparableItems.map((item) => item.shortName), ["near-1", "near-2"]);
  assert.ok(!suggestion.comparableItems.some((item) => item.shortName.startsWith("short-")));
});

test("DM valuation assistant falls back cautiously when target duration lacks nearby bonds", () => {
  const profile = {
    bondClass: "MTN",
    market: "interbank",
    exchangeTech: false,
    perpetual: false,
    subordinated: false,
    structured: false,
  };
  const candidates = [
    valuationCandidate("short-1", 3.78, 1.8381, profile),
    valuationCandidate("short-2", 3.72, 1.8361, profile),
    valuationCandidate("short-3", 3.69, 1.8351, profile),
  ];
  const suggestion = valuationTest.buildTrancheSuggestion(
    { durationText: "5+10Y", years: 5 },
    0,
    candidates,
    profile,
    true,
  );

  assert.equal(suggestion.clusterMode, "oneSidedExtrapolation");
  assert.equal(suggestion.confidence, "较低");
  assert.ok(suggestion.clusterNote.includes("单侧最近期限外推"));
  assert.deepEqual(suggestion.comparableItems.map((item) => item.shortName), ["short-1", "short-2", "short-3"]);
  assert.ok(suggestion.low < suggestion.center);
  assert.ok(suggestion.high > suggestion.center);
});

test("DM valuation assistant calibrates sparse tenors with implied-rating ChinaBond MTN curve", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  const issuerName = "Curve Issuer";
  const securities = [
    { security_id: "102600101.IB", sec_short_name: "short-1", remaining_tenor: "3.78Y", bond_issue_tenor: "5Y", bond_type_desc: "MTN" },
    { security_id: "102600102.IB", sec_short_name: "short-2", remaining_tenor: "3.72Y", bond_issue_tenor: "5Y", bond_type_desc: "MTN" },
    { security_id: "102600103.IB", sec_short_name: "short-3", remaining_tenor: "3.69Y", bond_issue_tenor: "5Y", bond_type_desc: "MTN" },
  ];
  const rates = new Map([
    ["102600101.IB", 1.8381],
    ["102600102.IB", 1.8361],
    ["102600103.IB", 1.8351],
  ]);
  const curveYields = new Map([
    ["5", 1.88],
    ["3.78", 1.75],
    ["3.72", 1.745],
    ["3.69", 1.742],
  ]);

  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    calls.push({ url: String(url), request });
    let data;
    if (url.includes("/bond/basic-info/outstanding-bonds")) {
      assert.equal(request.issuerFullName, issuerName);
      data = { list: securities.map((item) => ({ ...item, issuer_name: issuerName })), maxOffset: null };
    } else if (url.includes("/bond/basic-info/info")) {
      data = request.securityIdList.map((securityId) => ({
        ...securities.find((item) => item.security_id === securityId),
        issuer_name: issuerName,
        payment_order: "普通债权",
        special_item: "",
      }));
    } else if (url.includes("/bond/market-data/date")) {
      data = request.securityIdList.map((securityId) => ({
        security_id: securityId,
        sec_short_name: securities.find((item) => item.security_id === securityId)?.sec_short_name,
        valuation_date: "2026-06-26",
        cb_yte: rates.get(securityId),
        cb_reliability: "推荐",
      }));
    } else if (url.includes("/bond/yield-curve/data")) {
      assert.equal(request.curveName, "中债中短期票据收益率曲线(AA+)");
      assert.equal(request.dataSource, "18");
      assert.equal(request.curveType, "1");
      assert.ok(!request.curveName.includes("AAA"));
      data = request.curveTermList.map((term) => ({
        curve_ch_name: request.curveName,
        curve_term: Number(term),
        curve_type: 1,
        valuation_date: "2026-06-26",
        yield: curveYields.get(term),
      }));
    } else {
      throw new Error(`unexpected DM path: ${url}`);
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onValuationRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/valuation?issuerName=Curve%20Issuer&durationText=5%2B10Y&offeringType=%E5%85%AC%E5%8B%9F&venue=%E9%93%B6%E8%A1%8C%E9%97%B4&shortName=26CURVE001&hiddenRating=AA%2B&subjectRating=AAA&valuationDate=2026-06-26", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.trancheSuggestions[0].clusterMode, "curveResidualCalibration");
    assert.equal(payload.trancheSuggestions[0].curveCalibration.impliedRating, "AA+");
    assert.equal(payload.trancheSuggestions[0].curveCalibration.targetCurveYield, 1.88);
    assert.ok(payload.trancheSuggestions[0].curveCalibration.averageResidualBp > 8);
    assert.ok(payload.trancheSuggestions[0].center > 1.95 && payload.trancheSuggestions[0].center < 1.98);
    assert.ok(payload.trancheSuggestions[0].method.includes("不使用主体评级"));
    assert.ok(payload.trancheSuggestions[0].comparableItems.every((item) => Number.isFinite(item.curveResidualBp)));
    assert.ok(calls.some((call) => call.url.includes("/bond/yield-curve/data")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup searches additional DM issuer data before falling back to D1", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "012681333.IB",
        sec_short_name: "26DMFIND001",
        sec_full_name: "DM Rating Issuer 2026 SCP001",
        issuer_name: "DM Rating Issuer",
        society_code: "91330000123456789X",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "012681333.IB",
          sec_short_name: "26DMFIND001",
          issuer_full_name: "DM Rating Issuer",
          bond_issue_tenor: "180D",
          plan_issue_amount: 50000,
        }],
      };
    } else if (url.includes("/company/basic-info/info")) {
      data = [{ com_full_name: "DM Rating Issuer", society_code: "91330000123456789X" }];
    } else if (url.includes("/bond/basic-info/outstanding-bonds")) {
      data = {
        list: [{
          security_id: "012681000.IB",
          sec_short_name: "26DMOTHER001",
          issuer_name: "DM Rating Issuer",
          subject_rating: "AA+",
          rating_agency: "DM Agency",
          implied_rating: "AA",
        }],
      };
    } else {
      throw new Error(`unexpected DM path: ${url}`);
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  const DB = {
    prepare() {
      throw new Error("D1 should not be queried when DM discovery finds ratings");
    },
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret, DB },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26DMFIND001", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.normalized.subjectRating, "AA+");
    assert.equal(payload.normalized.ratingAgency, "DM Agency");
    assert.equal(payload.normalized.impliedRating, "AA");
    assert.deepEqual(payload.normalized.ratingSource, {
      subjectRating: "dm-discovery",
      ratingAgency: "dm-discovery",
      impliedRating: "dm-discovery",
    });
    assert.ok(payload.diagnostic.rating.dmDiscoverySources.includes("outstandingBondsByIssuer"));
    assert.deepEqual(payload.diagnostic.rating.filledFromIssuerDb, []);
    assert.ok(calls.some((url) => url.includes("/bond/basic-info/outstanding-bonds")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup fills missing ratings from the issuer database", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url, init) => {
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "012681222.IB",
        sec_short_name: "26浦发集团MTN001",
        sec_full_name: "上海浦东发展集团股份有限公司2026年度第一期中期票据",
        issuer_name: "上海浦东发展集团股份有限公司",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "012681222.IB",
          sec_short_name: "26浦发集团MTN001",
          issuer_full_name: "上海浦东发展集团股份有限公司",
          bond_issue_tenor: "5Y",
          plan_issue_amount: 50000,
        }],
      };
    } else {
      data = [{ com_full_name: "上海浦东发展集团股份有限公司" }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  const DB = {
    prepare(sql) {
      assert.match(sql, /SELECT data FROM app_state/);
      return {
        async first() {
          return {
            data: JSON.stringify({
              issuers: [{
                legalName: "上海浦东发展（集团）有限公司",
                aliases: ["浦发集团"],
                subjectRating: "AAA",
                ratingAgency: "中诚信国际",
                hiddenRating: "AA+",
              }],
            }),
          };
        },
      };
    },
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret, DB },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26%E6%B5%A6%E5%8F%91%E9%9B%86%E5%9B%A2MTN001", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.normalized.subjectRating, "AAA");
    assert.equal(payload.normalized.ratingAgency, "中诚信国际");
    assert.equal(payload.normalized.impliedRating, "AA+");
    assert.deepEqual(payload.normalized.ratingSource, {
      subjectRating: "issuer-db",
      ratingAgency: "issuer-db",
      impliedRating: "issuer-db",
    });
    assert.equal(payload.diagnostic.rating.matchedIssuer, "上海浦东发展（集团）有限公司");
    assert.deepEqual(payload.diagnostic.rating.missing, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup fills missing ratings from historical D1 project text", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url) => {
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "042680222.IB",
        sec_short_name: "26陕西建工CP005",
        sec_full_name: "陕西建工控股集团有限公司2026年度第五期短期融资券",
        issuer_name: "陕西建工控股集团有限公司",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "042680222.IB",
          sec_short_name: "26陕西建工CP005",
          issuer_full_name: "陕西建工控股集团有限公司",
          bond_issue_tenor: "365D",
          plan_issue_amount: 50000,
        }],
      };
    } else if (url.includes("/company/basic-info/info")) {
      data = [{ com_full_name: "陕西建工控股集团有限公司" }];
    } else {
      data = { list: [] };
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  const DB = {
    prepare(sql) {
      assert.match(sql, /SELECT data FROM app_state/);
      return {
        async first() {
          return {
            data: JSON.stringify({
              issuers: [],
              projects: [{
                shortName: "26陕西建工CP005",
                issuerName: "陕西建工控股集团有限公司",
                sourceText: "26陕西建工CP005 牵头 西安分行\n365D 规模5亿 AAA(中诚信国际)/隐含AA+\n询价区间2.95-3.95 银行间 兴业银行",
              }],
            }),
          };
        },
      };
    },
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret, DB },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26%E9%99%95%E8%A5%BF%E5%BB%BA%E5%B7%A5CP005", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.normalized.subjectRating, "AAA");
    assert.equal(payload.normalized.ratingAgency, "中诚信国际");
    assert.equal(payload.normalized.impliedRating, "AA+");
    assert.deepEqual(payload.normalized.ratingSource, {
      subjectRating: "issuer-db",
      ratingAgency: "issuer-db",
      impliedRating: "issuer-db",
    });
    assert.equal(payload.diagnostic.rating.matchedBy, "26陕西建工CP005");
    assert.equal(payload.diagnostic.rating.matchedIssuer, "陕西建工控股集团有限公司");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup builds an issue group from same-issue DM primary rows", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url, init) => {
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "260001.SH",
        sec_short_name: "26ACME01",
        sec_full_name: "ACME 2026 corporate bond tranche 01",
        issuer_name: "ACME Group Co Ltd",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [
          {
            security_id: "260001.SH",
            sec_short_name: "26ACME01",
            issuer_full_name: "ACME Group Co Ltd",
            bond_issue_tenor: "3Y",
            plan_issue_amount: 30000,
            subscribe_rate: "2.000000 ~ 2.500000",
            subscribe_date: "2026-06-27",
          },
          {
            security_id: "260002.SH",
            sec_short_name: "26ACME02",
            issuer_full_name: "ACME Group Co Ltd",
            bond_issue_tenor: "5Y",
            plan_issue_amount: 50000,
            subscribe_rate: "2.300000 ~ 2.800000",
            subscribe_date: "2026-06-27",
          },
        ],
      };
    } else if (url.includes("/company/basic-info/info")) {
      data = [{ com_full_name: "ACME Group Co Ltd" }];
    } else {
      data = { list: [] };
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26ACME01", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.issueGroup.source, "dm");
    assert.equal(payload.issueGroup.tranches.length, 2);
    assert.deepEqual(payload.issueGroup.tranches.map((item) => item.shortName), ["26ACME01", "26ACME02"]);
    assert.equal(payload.issueGroup.tranches[0].isQueriedInput, true);
    assert.equal(payload.normalized.issueGroup.tranches[1].tenor, "5Y");
    assert.equal(payload.diagnostic.issueGroup.found, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup groups green MTN A/B tranches with issuer alias short-name variants", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url) => {
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "102682501.IB",
        sec_short_name: "26YUEXIUXINENGYUANMTN001A(GREEN)",
        sec_full_name: "Yuexiu new energy 2026 MTN tranche A",
        issuer_name: "Yuexiu New Energy Investment Co Ltd",
      }];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [
          {
            security_id: "102682502.IB",
            sec_short_name: "26YUEXIUXINENGMTN001B(GREEN)",
            sec_full_name: "Yuexiu new energy 2026 MTN tranche B",
            issuer_full_name: "Yuexiu New Energy Investment Co Ltd",
            bond_issue_tenor: "7Y",
            plan_issue_amount: 50000,
            subscribe_rate: "2.000000 ~ 2.600000",
            subscribe_date: "2026-07-08",
          },
          {
            security_id: "102682501.IB",
            sec_short_name: "26YUEXIUXINENGYUANMTN001A(GREEN)",
            sec_full_name: "Yuexiu new energy 2026 MTN tranche A",
            issuer_full_name: "Yuexiu New Energy Investment Co Ltd",
            bond_issue_tenor: "5Y",
            plan_issue_amount: 30000,
            subscribe_rate: "1.800000 ~ 2.110000",
            subscribe_date: "2026-07-08",
          },
        ],
      };
    } else if (url.includes("/company/basic-info/info")) {
      data = [{ com_full_name: "Yuexiu New Energy Investment Co Ltd" }];
    } else {
      data = { list: [] };
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26YUEXIUXINENGYUANMTN001A(GREEN)", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.issueGroup.source, "dm");
    assert.equal(payload.issueGroup.tranches.length, 2);
    assert.deepEqual(payload.issueGroup.tranches.map((item) => item.shortName), [
      "26YUEXIUXINENGYUANMTN001A(GREEN)",
      "26YUEXIUXINENGMTN001B(GREEN)",
    ]);
    assert.equal(payload.issueGroup.tranches[0].isQueriedInput, true);
    assert.equal(payload.issueGroup.tranches[1].tenor, "7Y");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup ignores unrelated same-serial primary rows when resolving issuer aliases", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const primaryRequests = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "102682599.IB",
        sec_short_name: "26LIYANGMTN001A(GREEN)",
        issuer_name: "Liyang City Investment Co Ltd",
      }];
    } else if (url.includes("/bond/primary/data")) {
      primaryRequests.push(request);
      data = {
        list: request.issuerFullName ? [] : [
          {
            security_id: "102682599.IB",
            sec_short_name: "26LIYANGMTN001",
            issuer_full_name: "Liyang City Investment Co Ltd",
            bond_issue_tenor: "3Y",
            plan_issue_amount: 80000,
            subscribe_rate: "1.400000 ~ 2.400000",
            subscribe_date: "2026-07-08",
          },
          {
            security_id: "102682598.IB",
            sec_short_name: "26XININGMTN001",
            issuer_full_name: "Xining Urban Development Co Ltd",
            bond_issue_tenor: "2Y",
            plan_issue_amount: 50000,
            subscribe_rate: "2.000000 ~ 3.500000",
            subscribe_date: "2026-07-08",
          },
          {
            security_id: "102682501.IB",
            sec_short_name: "26YUEXIUXINENGYUANMTN001A(GREEN)",
            sec_full_name: "Yuexiu new energy 2026 MTN tranche A",
            issuer_full_name: "Yuexiu New Energy Investment Co Ltd",
            bond_issue_tenor: "5Y",
            plan_issue_amount: 30000,
            subscribe_rate: "1.800000 ~ 2.110000",
            subscribe_date: "2026-07-08",
          },
          {
            security_id: "102682502.IB",
            sec_short_name: "26YUEXIUXINENGYUANMTN001B(GREEN)",
            sec_full_name: "Yuexiu new energy 2026 MTN tranche B",
            issuer_full_name: "Yuexiu New Energy Investment Co Ltd",
            bond_issue_tenor: "7Y",
            plan_issue_amount: 50000,
            subscribe_rate: "2.000000 ~ 2.600000",
            subscribe_date: "2026-07-08",
          },
        ],
      };
    } else if (url.includes("/company/basic-info/info")) {
      data = [{ com_full_name: "Yuexiu New Energy Investment Co Ltd" }];
    } else {
      data = { list: [] };
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26YUEXIUXINENGMTN001A", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(primaryRequests[0].issuerFullName, undefined);
    assert.equal(payload.normalized.shortName, "26YUEXIUXINENGYUANMTN001A(GREEN)");
    assert.equal(payload.normalized.issuerName, "Yuexiu New Energy Investment Co Ltd");
    assert.deepEqual(payload.issueGroup.tranches.map((item) => item.shortName), [
      "26YUEXIUXINENGYUANMTN001A(GREEN)",
      "26YUEXIUXINENGYUANMTN001B(GREEN)",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup does not build a cross-issuer group from a bare same serial match", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url) => {
    const data = url.includes("/bond/primary/data")
      ? {
          list: [
            {
              security_id: "102682599.IB",
              sec_short_name: "26LIYANGMTN001",
              issuer_full_name: "Liyang City Investment Co Ltd",
              bond_issue_tenor: "3Y",
              subscribe_rate: "1.400000 ~ 2.400000",
            },
            {
              security_id: "102682598.IB",
              sec_short_name: "26XININGMTN001",
              issuer_full_name: "Xining Urban Development Co Ltd",
              bond_issue_tenor: "2Y",
              subscribe_rate: "2.000000 ~ 3.500000",
            },
          ],
        }
      : [];
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26YUEXIUXINENGMTN001A", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.noResult, true);
    assert.equal(payload.issueGroup, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup marks a queried cancelled tranche from D1 issue group", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url) => {
    const data = url.includes("/bond/primary/data") ? { list: [] } : [];
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  const DB = {
    prepare(sql) {
      assert.match(sql, /SELECT data FROM app_state/);
      return {
        async first() {
          return {
            data: JSON.stringify({
              issuers: [],
              projects: [{
                id: "project-acme",
                shortName: "26ACME01/02",
                shortNames: ["26ACME01", "26ACME02"],
                issuerName: "ACME Group Co Ltd",
                venue: "Exchange",
                leadUnderwriter: "Lead Bank",
                resultConfirmed: true,
                tranches: [
                  { shortName: "26ACME01", durationText: "3Y" },
                  { shortName: "26ACME02", durationText: "5Y", securityCode: "260002.SH", issueScale: 5, winningRate: 2.6 },
                ],
              }],
            }),
          };
        },
      };
    },
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret, DB },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26ACME01", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.issueGroup.source, "cloud-db");
    assert.equal(payload.issueGroup.tranches.length, 2);
    assert.equal(payload.issueGroup.tranches[0].shortName, "26ACME01");
    assert.equal(payload.issueGroup.tranches[0].status, "reallocated");
    assert.equal(payload.issueGroup.tranches[0].isQueriedInput, true);
    assert.equal(payload.issueGroup.tranches[0].reallocationTargetShortName, "26ACME02");
    assert.equal(payload.issueGroup.tranches[0].reallocationTargetSecurityId, "260002.SH");
    assert.match(payload.issueGroup.tranches[0].statusReason, /已全部回拨至26ACME02/);
    assert.equal(payload.issueGroup.tranches[1].status, "issued");
    assert.equal(payload.issueGroup.tranches[1].actualScale, 5);
    assert.equal(payload.diagnostic.issueGroup.statuses[0].status, "reallocated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup points A/B reallocated tranches to the final issued MTN tranche", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url) => {
    const data = url.includes("/bond/primary/data") ? { list: [] } : [];
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  const DB = {
    prepare(sql) {
      assert.match(sql, /SELECT data FROM app_state/);
      return {
        async first() {
          return {
            data: JSON.stringify({
              issuers: [],
              projects: [{
                id: "project-jinchuan",
                shortName: "26金川MTN001A/B",
                shortNames: ["26金川MTN001", "26金川MTN001A", "26金川MTN001B"],
                issuerName: "金川集团股份有限公司",
                resultConfirmed: true,
                tranches: [
                  { shortName: "26金川MTN001", durationText: "5Y", securityCode: "102681001.IB", issueScale: 10, winningRate: 1.96 },
                  { shortName: "26金川MTN001A", durationText: "3Y" },
                  { shortName: "26金川MTN001B", durationText: "5Y" },
                ],
              }],
            }),
          };
        },
      };
    },
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret, DB },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26%E9%87%91%E5%B7%9DMTN001A", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.issueGroup.tranches.map((item) => item.shortName), ["26金川MTN001", "26金川MTN001A", "26金川MTN001B"]);
    assert.equal(payload.issueGroup.tranches[0].status, "issued");
    assert.equal(payload.issueGroup.tranches[1].status, "reallocated");
    assert.equal(payload.issueGroup.tranches[1].isQueriedInput, true);
    assert.equal(payload.issueGroup.tranches[1].reallocationTargetShortName, "26金川MTN001");
    assert.equal(payload.issueGroup.tranches[1].reallocationTargetSecurityId, "102681001.IB");
    assert.match(payload.issueGroup.tranches[1].statusReason, /已全部回拨至26金川MTN001/);
    assert.equal(payload.issueGroup.tranches[2].status, "reallocated");
    assert.equal(payload.issueGroup.tranches[2].reallocationTargetShortName, "26金川MTN001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup matches primary cross-market aliases before normalization", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (url.includes("/bond/basic-info/info")) {
      assert.deepEqual(request.secShortNameList, ["26ALIAS07"]);
      data = [];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [
          {
            security_id: "999999.IB",
            sec_short_name: "26WRONG01",
            issuer_full_name: "Wrong Issuer",
            subscribe_rate: "9.000000 ~ 9.100000",
          },
          {
            security_id: "2600007.IB",
            sec_short_name: "26MAIN07",
            cros_mar_bond: "26ALIAS07(123456.SH),MAIN2607(654321.SZ),26MAIN07(2600007.BJ)",
            issuer_full_name: "Target Issuer",
            bond_issue_tenor: "10Y",
            plan_issue_amount: 20000,
            subscribe_rate: "1.800000 ~ 2.100000",
            unde_name: "Target Bank",
          },
        ],
      };
    } else if (url.includes("/company/basic-info/info")) {
      assert.deepEqual(request.comFullNameList, ["Target Issuer"]);
      data = [{ com_full_name: "Target Issuer" }];
    } else if (url.includes("/bond/basic-info/outstanding-bonds")) {
      assert.equal(request.issuerFullName, "Target Issuer");
      data = { list: [] };
    } else {
      throw new Error(`unexpected DM path: ${url}`);
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26ALIAS07&startDate=2026-06-12&endDate=2026-07-11", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.normalized.securityId, "2600007.IB");
    assert.equal(payload.normalized.shortName, "26MAIN07");
    assert.equal(payload.normalized.issuerName, "Target Issuer");
    assert.equal(payload.normalized.issueScaleYi, 2);
    assert.equal(payload.normalized.inquiryRange, "1.8-2.1");
    assert.equal(payload.raw.primaryData.list.length, 2);
    assert.ok(payload.fieldCandidates.some((item) => item.key === "subscribe_rate" && item.value === "1.800000 ~ 2.100000"));
    assert.ok(!payload.fieldCandidates.some((item) => item.value === "9.000000 ~ 9.100000"));
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM lookup does not fall back to the first primary row when no row matches", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "999999.IB",
          sec_short_name: "26WRONG01",
          issuer_full_name: "Wrong Issuer",
          subscribe_rate: "9.000000 ~ 9.100000",
        }],
      };
    } else {
      throw new Error("company lookup should not run without a matched issuer");
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26MISSING&startDate=2026-06-12&endDate=2026-07-11", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.noResult, true);
    assert.equal(payload.error, "未查询到匹配债券");
    assert.equal(payload.normalized, null);
    assert.deepEqual(payload.fieldCandidates, []);
    assert.equal(payload.raw.primaryData.list[0].sec_short_name, "26WRONG01");
    assert.equal(payload.diagnostic.noResult.rawPrimaryRows, 1);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM no-result response includes close short-name suggestions", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  globalThis.fetch = async (url) => {
    let data;
    if (url.includes("/bond/basic-info/info")) {
      data = [];
    } else if (url.includes("/bond/primary/data")) {
      data = {
        list: [
          {
            security_id: "012689999.IB",
            sec_short_name: "26MISSNG",
            issuer_full_name: "Missing Letter Issuer",
            bond_issue_tenor: "270D",
            plan_issue_amount: 30000,
            subscribe_rate: "1.200000 ~ 1.800000",
            subscribe_date: 1782662400000,
          },
          {
            security_id: "012680000.IB",
            sec_short_name: "18UNRELATED",
            issuer_full_name: "Unrelated Issuer",
          },
        ],
      };
    } else {
      throw new Error("company lookup should not run without a matched issuer");
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?shortName=26MISSING&startDate=2026-06-12&endDate=2026-07-11", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.noResult, true);
    assert.equal(payload.suggestions.length, 1);
    assert.equal(payload.suggestions[0].shortName, "26MISSNG");
    assert.equal(payload.suggestions[0].issuerName, "Missing Letter Issuer");
    assert.equal(payload.suggestions[0].issueScaleYi, 3);
    assert.equal(payload.suggestions[0].inquiryRange, "1.2-1.8");
    assert.match(payload.suggestions[0].matchReason, /简称/);
    assert.ok(payload.suggestions[0].score >= 80);
    assert.equal(payload.diagnostic.noResult.suggestionCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM no-result suggestions prefer same issuer alias over unrelated same issue number", () => {
  const suggestions = __test__.closestDmLookupSuggestions({
    shortName: "26广越09",
    rows: [
      {
        security_id: "809370.IB",
        sec_short_name: "26黑龙江09",
        issuer_full_name: "黑龙江省人民政府",
        bond_issue_tenor: "5Y",
        plan_issue_amount: 882030,
      },
      {
        security_id: "260659.SH",
        sec_short_name: "26安徽债59",
        issuer_full_name: "安徽省人民政府",
        bond_issue_tenor: "10Y",
        plan_issue_amount: 46400,
      },
      {
        security_id: "260608.SH",
        sec_short_name: "26广越08",
        issuer_full_name: "广州越秀集团股份有限公司",
        bond_issue_tenor: "10Y",
        plan_issue_amount: 90000,
        subscribe_rate: "1.700000 ~ 2.700000",
      },
      {
        security_id: "260610.SH",
        sec_short_name: "26广越10",
        issuer_full_name: "广州越秀集团股份有限公司",
        bond_issue_tenor: "5Y",
        plan_issue_amount: 60000,
      },
    ],
  });

  assert.deepEqual(suggestions.map((item) => item.shortName), ["26广越08", "26广越10"]);
  assert.ok(suggestions.every((item) => /同主体简称/.test(item.matchReason)));
  assert.ok(!suggestions.some((item) => /黑龙江|安徽/.test(item.shortName)));
});

test("DM lookup still accepts direct encrypted string responses", () => {
  const secret = "1234567890abcdef";
  const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data: { ok: true } }), secret);
  assert.equal(__test__.extractDmEncryptedPayload(encrypted), encrypted);
});

test("DM lookup unwraps double-encoded encrypted response payloads", () => {
  const secret = "1234567890abcdef";
  const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data: { ok: true } }), secret);
  const content = { data: JSON.stringify(encrypted) };
  assert.equal(__test__.extractDmEncryptedPayload(content), encrypted);
  assert.equal(JSON.parse(__test__.decryptDmPayload(encrypted, secret)).data.ok, true);
});

test("DM lookup reports diagnostics for unencrypted upstream responses", () => {
  assert.throws(
    () => __test__.decryptDmPayload("这不是密文", "1234567890abcdef", { text: '{"data":"这不是密文"}', content: { data: "这不是密文" } }),
    (error) => {
      assert.match(error.message, /not encrypted/);
      assert.equal(error.diagnostic.responseShape, "object(data)");
      assert.match(error.diagnostic.extractedPayloadPreview, /不是密文/);
      return true;
    },
  );
});

test("DM primary default window stays within the 30 calendar day limit", () => {
  const window = __test__.resolvePrimaryWindow("", "");
  const start = Date.parse(`${window.startDate}T00:00:00Z`);
  const end = Date.parse(`${window.endDate}T00:00:00Z`);
  const inclusiveDays = Math.floor((end - start) / 86400000) + 1;
  assert.ok(inclusiveDays <= 30);
});

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((part) => parseInt(part, 16)));
}

function valuationCandidate(shortName, years, rate, profile) {
  return {
    shortName,
    securityId: `${shortName}.IB`,
    durationText: `${years.toFixed(2)}Y`,
    years,
    profile,
    valuation: {
      rate,
      source: "中债行权估值",
      reliability: "推荐度推荐",
      valuationDate: "2026-06-26",
    },
  };
}
