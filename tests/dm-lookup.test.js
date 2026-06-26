import test from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, __test__ } from "../functions/api/dm/lookup.js";

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
