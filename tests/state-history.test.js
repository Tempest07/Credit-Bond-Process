import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStateChangeSummary,
  normalizeStateSaveMeta,
  statePayloadEquals,
  summarizeStateChange,
} from "../state-history.js";

test("summarizes stable-id collection additions, updates and removals", () => {
  const before = {
    issuers: [
      { id: "i1", legalName: "保留主体", hiddenRating: "AAA" },
      { id: "i2", legalName: "删除主体" },
    ],
    projects: [{ id: "p1", shortName: "26测试01" }],
    ftpCurve: { y1: 1.5 },
  };
  const after = {
    issuers: [
      { id: "i1", legalName: "保留主体", hiddenRating: "AA+" },
      { id: "i3", legalName: "新增主体" },
    ],
    projects: [{ id: "p1", shortName: "26测试01" }],
    ftpCurve: { y1: 1.6 },
  };
  const summary = summarizeStateChange(before, after);

  assert.equal(summary.collections.issuers.added, 1);
  assert.equal(summary.collections.issuers.updated, 1);
  assert.equal(summary.collections.issuers.removed, 1);
  assert.equal(summary.settings[0].key, "ftpCurve");
  assert.match(formatStateChangeSummary(summary), /主体.*新增 1.*修改 1.*删除 1/);
});

test("ignores server updatedAt when comparing state payloads", () => {
  assert.equal(statePayloadEquals(
    { issuers: [], updatedAt: "2026-08-30T00:00:00.000Z" },
    { issuers: [], updatedAt: "2026-08-30T00:01:00.000Z" },
  ), true);
});

test("sanitizes save metadata and rejects unknown reasons", () => {
  assert.deepEqual(normalizeStateSaveMeta({
    source: "unknown",
    clientId: "a".repeat(140),
    clientLabel: "设备 A",
  }), {
    source: "autosave",
    clientId: "a".repeat(100),
    clientLabel: "设备 A",
  });
});
