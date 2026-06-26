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
      assert.equal(request.secShortName, "26测试SCP001");
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
          subscribe_rate: "1.30-1.50",
          tender_market_desc: "银行间",
          public_offering_status: "公募",
          unde_name: "兴业银行",
          subscribe_date: "2026-06-26",
          subscribe_time: "18:00",
        }],
      };
    } else {
      data = [{ com_full_name: "测试集团有限公司", is_city_annex: 1 }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return new Response(JSON.stringify(encrypted), { status: 200 });
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
    assert.equal(payload.normalized.leadUnderwriter, "兴业银行");
    assert.equal(payload.normalized.sponsorStatus, "牵头");
    assert.equal(payload.normalized.subjectRating, "AAA");
    assert.equal(payload.normalized.ratingAgency, "中诚信国际");
    assert.equal(payload.normalized.impliedRating, "AA+");
    assert.ok(payload.fieldCandidates.some((item) => item.key === "implied_rating"));
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((part) => parseInt(part, 16)));
}
