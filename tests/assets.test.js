import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const VERSION = "20260611-payment-reminders";

test("versions all first-party browser modules together", async () => {
  const [html, app, historyParser] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../history-parser.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, new RegExp(`app\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`history-parser\\.js\\?v=${VERSION}`));
  assert.match(historyParser, new RegExp(`core\\.js\\?v=${VERSION}`));
});

test("revalidates non-fingerprinted application assets", async () => {
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");

  assert.match(headers, /\/\*\.js\s+Cache-Control: no-cache/);
  assert.match(headers, /\/\*\.css\s+Cache-Control: no-cache/);
});
