import assert from "node:assert/strict";
import test from "node:test";

await import("../vendor/pinyin-pro.min.js");

import {
  buildIssuerSearchIndex,
  normalizeIssuerSearchTerm,
  searchIssuerIndex,
} from "../issuer-search.js";

const issuers = [
  {
    id: "yuexiu",
    legalName: "广州越秀产业投资有限公司",
    aliases: ["广州产投", "越秀产投"],
    linkedBranch: "广州分行",
  },
  {
    id: "wuhan",
    legalName: "武汉城市建设集团有限公司",
    aliases: ["武汉城建"],
    linkedBranch: "武汉分行",
  },
  {
    id: "qingdao",
    legalName: "青岛城市建设投资（集团）有限责任公司",
    aliases: ["青岛城投"],
    linkedBranch: "青岛分行",
  },
];

test("normalizes issuer search text without depending on spaces or punctuation", () => {
  assert.equal(normalizeIssuerSearchTerm(" Guang Zhou-产投 "), "guangzhou产投");
  assert.equal(normalizeIssuerSearchTerm("青岛城市建设投资（集团）"), "青岛城市建设投资集团");
});

test("finds issuers by Chinese, full pinyin and pinyin initials", () => {
  const index = buildIssuerSearchIndex(issuers, globalThis.pinyinPro.pinyin);

  assert.equal(searchIssuerIndex(index, "越秀产业")[0].issuer.id, "yuexiu");
  assert.equal(searchIssuerIndex(index, "guangzhouyuexiuchanyetouzi")[0].issuer.id, "yuexiu");
  assert.equal(searchIssuerIndex(index, "gzyxcytz")[0].issuer.id, "yuexiu");
  assert.equal(searchIssuerIndex(index, "wuhan chengjian")[0].issuer.id, "wuhan");
  assert.equal(searchIssuerIndex(index, "whcj")[0].issuer.id, "wuhan");
  assert.equal(searchIssuerIndex(index, "qdct")[0].issuer.id, "qingdao");
});

test("also searches stored aliases and linked branches", () => {
  const index = buildIssuerSearchIndex(issuers, globalThis.pinyinPro.pinyin);

  assert.equal(searchIssuerIndex(index, "gzct")[0].issuer.id, "yuexiu");
  assert.equal(searchIssuerIndex(index, "qingdaofenhang")[0].issuer.id, "qingdao");
  assert.deepEqual(searchIssuerIndex(index, "not-a-real-issuer"), []);
});
