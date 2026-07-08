import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const VERSION = "20260708-reminder-center";

test("versions all first-party browser modules together", async () => {
  const [html, app, historyParser, reminders] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../history-parser.js", import.meta.url), "utf8"),
    readFile(new URL("../reminders.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, new RegExp(`app\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`history-parser\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`reminders\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`secondary-inventory\\.js\\?v=${VERSION}`));
  assert.match(historyParser, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
});

test("revalidates non-fingerprinted application assets", async () => {
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");

  assert.match(headers, /\/\*\.js\s+Cache-Control: no-cache/);
  assert.match(headers, /\/\*\.css\s+Cache-Control: no-cache/);
});

test("ships the protocol transfer ledger xlsx template", async () => {
  const workbook = await readFile(new URL("../templates/protocol-transfer-ledger-template.xlsx", import.meta.url));

  assert.equal(workbook[0], 0x50);
  assert.equal(workbook[1], 0x4b);
});
