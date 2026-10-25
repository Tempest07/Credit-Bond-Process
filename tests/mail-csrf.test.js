import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { onRequestGet, onRequestPost } from "../functions/api/mail/today.js";
import { onRequestPost as sendLedger } from "../functions/api/mail/secondary-ledger.js";

const secret = "synthetic-mail-csrf-only";
function context(method, path, headers = {}, authenticated = true) {
  const body = Buffer.from(JSON.stringify({ sub: "admin", username: "admin", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return {
    env: { GATEWAY_AUTH_SECRET: secret, MAILER_APP_PASSWORD: "synthetic-mailer-password" },
    request: new Request(`https://tempest07.com/bond-centre/api/mail/${path}`, {
      method, headers: { ...(authenticated ? { Cookie: `tempest07_session=${body}.${signature}` } : {}), ...headers },
    }),
  };
}

test("a cross-site authenticated GET cannot select a sending action", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, method: init.method }); return Response.json({ ok: true });
  });
  for (const action of ["send", "SEND", "unknown"]) {
    const response = await onRequestGet(context("GET", `today?action=${action}`, { "Sec-Fetch-Site": "cross-site" }));
    assert.equal(response.status, 200);
  }
  assert.ok(calls.every(call => call.method === "GET" && new URL(call.url).pathname === "/preview-today"));
});

test("mail sending rejects cross-site, null and unverifiable origins with a real signed session", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ ok: true }); });
  for (const [send, path] of [[onRequestPost, "today?action=send"], [sendLedger, "secondary-ledger"]]) {
    for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, {},
      { Origin: "https://tempest07.com", "Sec-Fetch-Site": "cross-site" }]) {
      assert.equal((await send(context("POST", path, headers))).status, 403);
    }
    assert.equal((await send(context("POST", path, { Origin: "https://tempest07.com" }, false))).status, 401);
  }
  assert.equal(calls, 0);
});

test("same-origin POST alone can send while conflicting action names are rejected", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }); });
  for (const headers of [{ Origin: "https://tempest07.com" }, { "Sec-Fetch-Site": "same-origin" }]) {
    assert.equal((await onRequestPost(context("POST", "today?action=send&date=2026-10-25", headers))).status, 200);
    assert.equal((await sendLedger(context("POST", "secondary-ledger", headers))).status, 200);
  }
  assert.ok(calls.every(call => call.init.method === "POST"));
  assert.equal(new URL(calls[0].url).pathname, "/send-today");
  assert.equal(new URL(calls[0].url).searchParams.get("date"), "2026-10-25");
  assert.equal((await onRequestPost(context("POST", "today?action=preview", { Origin: "https://tempest07.com" }))).status, 400);
  assert.equal(calls.length, 4);
});
