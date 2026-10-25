import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { gatewayUserFromRequest } from "../functions/api/_auth.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const androidSources = join(repo, "android/app/src/main/java/com/tempest07/bondcentre");

test("the actual Java reminder HTTP policy accepts only successful JSON and distinguishes expired login from retryable failures", async t => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, "bond-reminder-policy-"));
  t.after(() => {
    assert.equal(dirname(directory), temporaryRoot);
    assert.match(basename(directory), /^bond-reminder-policy-/);
    return rm(directory, { recursive: true, force: true });
  });
  const harness = join(directory, "ReminderHttpPolicyTestMain.java");
  await writeFile(harness, `package com.tempest07.bondcentre;
public final class ReminderHttpPolicyTestMain {
    private static int checks = 0;
    private static void check(boolean condition, String detail) {
        checks++;
        if (!condition) throw new AssertionError(detail);
    }
    public static void main(String[] args) {
        for (int status : new int[] {401, 403}) {
            check(ReminderHttpPolicy.isLoggedOut(status), "expired login: " + status);
            check(!ReminderHttpPolicy.acceptsPayload(status, "application/json"), "login response is not reminders");
        }
        for (int status : new int[] {200, 204, 302, 304, 307, 400, 404, 429, 500, 503}) {
            check(!ReminderHttpPolicy.isLoggedOut(status), "HTTP status must not masquerade as logout: " + status);
            if (status != 200) check(!ReminderHttpPolicy.acceptsPayload(status, "application/json"), "retry HTTP " + status);
        }
        for (String type : new String[] {"application/json", "application/json; charset=utf-8", " APPLICATION/JSON ; charset=UTF-8"}) {
            check(ReminderHttpPolicy.acceptsPayload(200, type), "accept valid JSON: " + type);
        }
        for (String type : new String[] {null, "", "text/html", "text/html; charset=utf-8", "application/jsonp", "application/problem+json"}) {
            check(!ReminderHttpPolicy.acceptsPayload(200, type), "reject non-reminder content: " + type);
        }
        System.out.println("Reminder HTTP policy checks passed: " + checks);
    }
}
`);
  const compiled = spawnSync("javac", ["-encoding", "UTF-8", "-d", directory,
    join(androidSources, "ReminderHttpPolicy.java"), harness], { encoding: "utf8" });
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  const executed = spawnSync("java", ["-cp", directory, "com.tempest07.bondcentre.ReminderHttpPolicyTestMain"], { encoding: "utf8" });
  assert.ifError(executed.error);
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.match(executed.stdout, /Reminder HTTP policy checks passed: 32/);
});

test("the Java-configured reminder URL reaches the product API through the actual sibling gateway", async t => {
  let gatewaySource;
  for (const path of [resolve(repo, "../tempest07-home/gateway-worker.js"), resolve(repo, "../../tempest07-home/gateway-worker.js")]) {
    try { gatewaySource = await readFile(path, "utf8"); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!gatewaySource) {
    t.skip("跨仓库路由验证需要同工作区 tempest07-home/gateway-worker.js；Java策略测试独立运行");
    return;
  }
  const activity = await readFile(join(androidSources, "MainActivity.java"), "utf8");
  const worker = await readFile(join(androidSources, "ReminderSyncWorker.java"), "utf8");
  const baseUrl = activity.match(/BASE_URL\s*=\s*"([^"]+)"/)?.[1];
  const apiSuffix = worker.match(/REMINDER_API_URL\s*=\s*MainActivity\.BASE_URL\s*\+\s*"([^"]+)"/)?.[1];
  assert.ok(baseUrl);
  assert.ok(apiSuffix, "the Worker derives its API from the same product base as the WebView");
  const configuredUrl = new URL(`${baseUrl}${apiSuffix}`);
  const { default: gateway } = await import(`data:text/javascript;base64,${Buffer.from(gatewaySource).toString("base64")}`);
  const secret = "synthetic-reminder-routing-test-only";
  const body = Buffer.from(JSON.stringify({ username: "admin", sub: "admin", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const cookie = `${body}.${createHmac("sha256", secret).update(body).digest("hex")}`;
  const env = { GATEWAY_AUTH_SECRET: secret };
  const incoming = url => new Request(url, { headers: { Cookie: `tempest07_session=${cookie}`, Accept: "application/json" } });
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async request => {
    forwarded.push(request);
    return Response.json({ ok: true, reminders: [] });
  };
  const response = await gateway.fetch(incoming(configuredUrl), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].url, "https://credit-bond-process.pages.dev/api/reminders");
  assert.equal(forwarded[0].method, "GET");
  assert.equal((await gatewayUserFromRequest(forwarded[0], env)).username, "admin");
  assert.deepEqual((await response.json()).reminders, []);

  await gateway.fetch(incoming(new URL("/api/reminders", baseUrl)), env);
  assert.equal(forwarded[1].url, "https://tempest07-home.pages.dev/api/reminders", "the former root URL routes to the home product");
});
