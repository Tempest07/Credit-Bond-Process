import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizeLookupPayload } from "../bond-identity.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function loadFunctions(context, names) {
  for (const name of names) {
    const expression = new RegExp(`(?:async )?function ${name}\\(`);
    const start = source.search(expression);
    assert.ok(start >= 0, name);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
  }
}

function harness() {
  const elements = new Map();
  const $ = key => {
    if (!elements.has(key)) elements.set(key, { value: "", textContent: "", disabled: false });
    return elements.get(key);
  };
  const requests = [];
  const applied = [];
  const rendered = [];
  const context = vm.createContext({
    $, AbortController, URLSearchParams, performance, normalizeLookupPayload,
    projectDmRequest: null, dmLookupRequest: null, project: {},
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    authHeaders: () => ({}), briefTemplatePlaceholders: () => [],
    looksLikeSecurityId: query => /^\d{6}/.test(query),
    showToast: () => {}, dmPayloadSourceLabel: () => "DM",
    pushProjectDmHistoryFromCurrent: () => {},
    renderProjectDmAssist: payload => rendered.push(payload),
    applyDmLookupToCurrentProject: payload => applied.push(payload),
  });
  loadFunctions(context, ["runProjectDmLookup", "cancelProjectDmLookup", "setProjectDmLookupBusy", "checkedDmLookupPayload"]);
  const answer = (index, name) => requests[index].resolve({
    ok: true, status: 200,
    json: async () => ({ ok: true, normalized: { shortName: name } }),
  });
  return { context, $, requests, applied, rendered, answer };
}

test("a slower previous DM response cannot overwrite the newest project lookup", async () => {
  const h = harness();
  const first = h.context.runProjectDmLookup("26鄂交03");
  const second = h.context.runProjectDmLookup("26鄂交05");
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.answer(1, "26鄂交05");
  await second;
  h.answer(0, "26鄂交03");
  await first;
  assert.deepEqual(h.applied.map(row => row.normalized.shortName), ["26鄂交05"]);
  assert.deepEqual(h.rendered.map(row => row.normalized.shortName), ["26鄂交05"]);
  assert.equal(h.$("#projectDmLookupButton").disabled, false);
});

test("editing the input while DM is pending discards the previous response", async () => {
  const h = harness();
  const pending = h.context.runProjectDmLookup("26鄂交03");
  h.$("#projectDmSeedInput").value = "26鄂交05";
  h.answer(0, "26鄂交03");
  await pending;
  assert.equal(h.applied.length, 0);
  assert.equal(h.rendered.length, 0);
});

test("cancelled workspace requests cannot apply even if transport ignores abort", async () => {
  const h = harness();
  const pending = h.context.runProjectDmLookup("26鄂交05");
  h.context.cancelProjectDmLookup();
  h.answer(0, "26鄂交05");
  await pending;
  assert.equal(h.applied.length, 0);
  assert.equal(h.rendered.length, 0);
  assert.equal(h.$("#projectDmLookupButton").disabled, false);
  for (const fn of ["resetProjectDmWorkspace", "restoreProjectDmHistoryItem", "parseAndRender", "loadBlankBriefTemplate"]) {
    const start = source.indexOf(`function ${fn}(`);
    const body = source.slice(start, source.indexOf("\nfunction ", start + 1));
    assert.match(body, /cancelProjectDmLookup\(\)/, fn);
  }
});

test("a mismatched DM target is shown as an error without filling the project", async () => {
  const h = harness();
  const pending = h.context.runProjectDmLookup("26鄂交05");
  h.answer(0, "26鄂交03");
  await pending;
  assert.equal(h.applied.length, 0);
  assert.equal(h.rendered[0].ok, false);
  assert.ok(h.rendered[0].identityError);
});

test("DM details cannot repopulate after clearing during asynchronous issuer enrichment", async () => {
  const h = harness();
  let finishEnrichment;
  let renders = 0;
  Object.assign(h.context, {
    enrichDmLookupWithLocalIssuer: payload => new Promise(resolve => { finishEnrichment = () => resolve(payload); }),
    renderDmNormalized: () => renders++, renderDmIssueGroup: () => renders++,
    renderDmDiagnostic: () => renders++, renderDmCandidates: () => renders++,
    dmLastPayload: null,
  });
  loadFunctions(h.context, ["runDmLookup", "cancelDmLookup", "clearDmLookup", "setDmLookupBusy", "renderDmLookupResult"]);
  h.$("#dmLookupInput").value = "26鄂交05";
  const pending = h.context.runDmLookup();
  h.answer(0, "26鄂交05");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishEnrichment, "function");
  h.context.clearDmLookup();
  finishEnrichment();
  await pending;
  assert.equal(renders, 0);
  assert.equal(h.context.dmLastPayload, null);
  assert.equal(h.$("#dmLookupStatus").textContent, "等待查询");
});

test("DM details and copied payload both discard an unrelated historical group", async () => {
  const h = harness();
  let displayedGroup;
  Object.assign(h.context, {
    enrichDmLookupWithLocalIssuer: async payload => payload,
    renderDmNormalized: () => {}, renderDmIssueGroup: group => { displayedGroup = group; },
    renderDmDiagnostic: () => {}, renderDmCandidates: () => {}, dmLastPayload: null,
  });
  loadFunctions(h.context, ["renderDmLookupResult"]);
  await h.context.renderDmLookupResult({
    ok: true, query: { shortName: "26鄂交05" },
    normalized: { shortName: "26鄂交05", securityId: "525044.SZ" },
    issueGroup: { tranches: [{ shortName: "26鄂交03" }, { shortName: "26鄂交04" }] },
  });
  assert.equal(displayedGroup, null);
  assert.equal(h.context.dmLastPayload.issueGroup, null);
  assert.equal(h.context.dmLastPayload.normalized.shortName, "26鄂交05");
  assert.doesNotMatch(h.$("#dmRawOutput").textContent, /26鄂交03|26鄂交04/);
});
