import test from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, __test__ } from "../functions/api/dm/lookup.js";
import { onRequestGet as onValuationRequestGet } from "../functions/api/dm/valuation.js";

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
      data = [{ com_full_name: "测试集团有限公司", is_city_annex: 1 }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify({ data: encrypted }), { status: 200 });
  };

  try {
    const response = await onRequestGet({
      env: { APP_PASSWORD: "pw", INNO_APP_KEY: "app", INNO_APP_SECRET: secret },
      request: new Request("https://example.com/api/dm/lookup?shortName=26%E6%B5%8B%E8%AF%95SCP001", {
        headers: { Authorization: "Bearer pw" },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.normalized.shortName, "26测试SCP001");
    assert.equal(payload.normalized.issuerName, "测试集团有限公司");
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26%E5%90%AB%E6%9D%83MTN001", {
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
            security_id: "2520002.SH",
            sec_short_name: "25青岛城投私募01",
            sec_full_name: "青岛城市建设投资集团有限公司2025年非公开发行公司债券(第一期)",
            issuer_name: "青岛城市建设投资集团有限公司",
            remaining_tenor: "5Y",
            bond_issue_tenor: "5Y",
            bond_type_desc: "公司债券",
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
      data = request.securityIdList.map((securityId) => ({
        security_id: securityId,
        sec_short_name: securityId === "2520001.SH" ? "25青岛城投KJ01" : "25青岛城投MTN001",
        issue_date: "2026-06-26",
        cb_ytm: securityId === "2520001.SH" ? 2.46 : 2.5,
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
      request: new Request("https://example.com/api/dm/valuation?issuerName=%E9%9D%92%E5%B2%9B%E5%9F%8E%E5%B8%82%E5%BB%BA%E8%AE%BE%E6%8A%95%E8%B5%84%E9%9B%86%E5%9B%A2%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8&durationText=5%2B5%2B5Y&offeringType=%E5%85%AC%E5%8B%9F&venue=%E9%93%B6%E8%A1%8C%E9%97%B4&shortName=26%E9%9D%92%E5%B2%9B%E5%9F%8E%E6%8A%95MTN001&valuationDate=2026-06-26", {
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
    assert.ok(techComparable.marketAdjustment > 0.03);
    assert.ok(payload.trancheSuggestions[0].center > 2.48 && payload.trancheSuggestions[0].center < 2.52);
    assert.ok(calls.some((url) => url.includes("/bond/market-data/date")));
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26DMFIND001", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26%E6%B5%A6%E5%8F%91%E9%9B%86%E5%9B%A2MTN001", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26%E9%99%95%E8%A5%BF%E5%BB%BA%E5%B7%A5CP005", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26ACME01", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26ACME01", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26%E9%87%91%E5%B7%9DMTN001A", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26ALIAS07&startDate=2026-06-12&endDate=2026-07-11", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26MISSING&startDate=2026-06-12&endDate=2026-07-11", {
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
      request: new Request("https://example.com/api/dm/lookup?shortName=26MISSING&startDate=2026-06-12&endDate=2026-07-11", {
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
    assert.ok(payload.suggestions[0].score >= 80);
    assert.equal(payload.diagnostic.noResult.suggestionCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
