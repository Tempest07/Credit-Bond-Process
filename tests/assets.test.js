import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const VERSION = "20260905-ui-beta-50120";

test("exposes a readable product version consistent with package metadata", async () => {
  const [html, packageText, lockText] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ]);
  const { version: packageVersion, buildVersion } = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const visibleVersion = buildVersion;

  assert.equal(lock.version, packageVersion);
  assert.equal(lock.packages[""].version, packageVersion);
  assert.match(html, new RegExp(`<meta name="application-version" content="${buildVersion.replaceAll(".", "\\.")}">`));
  assert.match(html, /<meta name="application-build-version" content="5\.0\.1\.20">/);
  assert.match(html, /class="brand-version" title="内部构建 5\.0\.1\.20 · 2026-09-05 更新"/);
  assert.match(html, new RegExp(`styles\\.css\\?v=${VERSION}`));
  assert.match(html, new RegExp(`class="brand-version"[^>]*>v${visibleVersion.replaceAll(".", "\\.")}<`));
});

test("versions all first-party browser modules together", async () => {
  const [html, app, historyParser, lifecycle, reminders] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../history-parser.js", import.meta.url), "utf8"),
    readFile(new URL("../lifecycle.js", import.meta.url), "utf8"),
    readFile(new URL("../reminders.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, new RegExp(`app\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`issuance-recognition\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`issuance-queue\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`history-parser\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`protocol-transfer-templates\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`protocol-transfer-docx\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`reminders\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`secondary-inventory\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`trade-record-converter\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`trade-record-grid\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`trade-record-ledger\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`date-picker\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`realtime-quotes\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`project-screenshot-ocr\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`project-screenshot-layout\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`project-screenshot-image\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`state-history\\.js\\?v=${VERSION}`));
  assert.match(historyParser, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(lifecycle, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
});

test("queues compact issuance-result entry without blocking the project workspace", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="resultEntryPanel" role="dialog" aria-labelledby="resultEntryTitle" hidden/);
  assert.doesNotMatch(html, /result-entry-backdrop|id="resultEntryPanel"[^>]*aria-modal="true"/);
  assert.match(html, /id="parseAdvertisementButton"[^>]*>确认并排队</);
  assert.match(html, /id="issuanceQueueNotifications"[^>]*aria-live="polite"/);
  assert.match(app, /createSequentialIssuanceQueue\(requestQueuedIssuanceRecognition, handleIssuanceQueueChange\)/);
  assert.match(app, /function queueIssuanceResultRecognition/);
  assert.match(app, /function renderIssuanceQueueNotifications/);
  assert.match(app, /function positionResultEntryPanel/);
  assert.doesNotMatch(app, /addEventListener\("scroll", positionResultEntryPanel/);
  assert.doesNotMatch(app, /modal-open",\s*!\$\("#resultEntryPanel"\)\.hidden/);
  assert.match(html, /class="result-entry-anchor"[\s\S]*id="openResultButton"[\s\S]*id="resultEntryPanel"/);
  assert.match(styles, /\.result-entry-anchor\s*\{[^}]*position:\s*relative;/s);
  assert.match(styles, /\.result-entry-anchor\.is-open\s*\{[^}]*z-index:\s*130;/s);
  assert.match(app, /panel\.hidden = false;\s*anchor\?\.classList\.add\("is-open"\)/);
  assert.match(app, /closest\("\.result-entry-anchor"\)\?\.classList\.remove\("is-open"\)/);
  assert.match(app, /anchor\?\.setAttribute\("data-queue-status", queueStatus\)/);
  assert.match(app, /button\.setAttribute\("aria-busy", processing \? "true" : "false"\)/);
  assert.doesNotMatch(styles, /\.result-action\[data-queue-status=/);
  assert.match(styles, /\.result-entry-anchor\[data-queue-status="processing"\]::before,[\s\S]*animation:\s*resultQueueWave/);
  assert.match(styles, /@keyframes resultQueueWave/);
  assert.match(styles, /\.result-entry-anchor\[data-queue-status="ready"\]::before\s*\{[^}]*content:\s*"✓";[^}]*animation:\s*resultQueueCheckIn/s);
  assert.match(styles, /\.result-entry-anchor\[data-queue-status="error"\]::before\s*\{[^}]*content:\s*"!";/s);
  assert.match(styles, /@keyframes resultQueueCheckIn/);
  assert.match(app, /const queueStatus = ready \? "ready" : failed \? "error" : processing \? "processing" : "";/);
  assert.match(styles, /\.result-entry-panel\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ 9px\);[^}]*width:\s*min\(460px/s);
  assert.match(styles, /\.issuance-queue-notifications\s*\{[^}]*position:\s*fixed;[^}]*right:\s*22px;/s);
});

test("ships a configurable dark DM realtime quote tab without a large text-entry surface", async () => {
  const [html, app, realtime, endpoint, valuationEndpoint, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../realtime-quotes.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/dm/realtime-quotes.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/dm/realtime-valuations.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-view-target="realtime-quotes"[^>]*>(?:<svg\b[^>]*>[\s\S]*?<\/svg>)?实时行情<\/button>/);
  assert.match(html, /id="realtimeQuoteImportButton"[^>]*>\s*<span[^>]*>＋<\/span> 导入券池/);
  assert.match(html, /id="realtimeQuoteImportInput" type="text"/);
  assert.doesNotMatch(html, /<textarea[^>]*realtimeQuote/i);
  assert.match(html, /id="realtimeQuoteInterval"[\s\S]*15 秒[\s\S]*20 秒[\s\S]*30 秒/);
  assert.match(html, /id="realtimeQuoteColumnButton"/);
  assert.match(html, /拖动表头右边缘调整列宽/);
  assert.match(html, /id="realtimeQuoteNotificationButton"/);
  assert.match(html, /id="realtimeQuoteUnreadCount"/);
  assert.match(html, /id="realtimeQuoteTableHead"/);
  const realtimeSection = html.match(/<section class="view realtime-quotes-view"[\s\S]*?<section class="view" data-view="dm-test">/)?.[0] || "";
  assert.match(realtimeSection, /realtime-kicker[^>]*>[\s\S]*MARKET DATA/);
  assert.equal((realtimeSection.match(/\bDM\b/g) || []).length, 1);
  assert.match(realtimeSection, /来源：DM · \/bond\/market-data\/realtime-quote/);
  assert.doesNotMatch(realtimeSection, /DM MARKET DATA|读取 DM|DM估值|DM 当前接口/);
  assert.match(app, /realtimeQuoteController\?\.setActive\(viewName === "realtime-quotes"\)/);
  assert.match(realtime, /document\.addEventListener\("visibilitychange"/);
  assert.match(realtime, /credit-bond-process-realtime-watchlist-v1/);
  assert.match(realtime, /credit-bond-process-realtime-watchlist-v2/);
  assert.match(realtime, /data-copy-quote-side/);
  assert.match(realtime, /data-resize-realtime-column/);
  assert.match(realtime, /setPointerCapture/);
  assert.match(realtime, /widths:\s*normalizeColumnWidths\(saved\?\.widths\)/);
  assert.match(realtime, /side === "ofr" \? "TKN" : "GVN"/);
  assert.doesNotMatch(realtime, /side === "ofr" \? "taken" : "given"/);
  assert.match(realtime, /continue|继续轮询/);
  assert.doesNotMatch(realtime, /读取 DM|DM估值|<span>DM<\/span>|非债券或 DM 未匹配/);
  assert.match(realtime, /每 \$\{this\.intervalMs \/ 1_000\} 秒自动刷新/);
  assert.match(realtime, /title="数据来源：DM"><span>聚合<\/span>/);
  assert.match(realtime, /\{ id: "identity", label: "债券", width: 240,/);
  assert.match(endpoint, /bond\/market-data\/realtime-quote/);
  assert.match(endpoint, /brokerBreakdownAvailable: false/);
  assert.match(valuationEndpoint, /bond\/market-data\/date/);
  assert.match(valuationEndpoint, /cbYtm/);
  assert.match(valuationEndpoint, /csYte/);
  assert.match(styles, /\.view\[data-view="realtime-quotes"\][^{]*\{[^}]*background:[^}]*#070a10/s);
  assert.match(styles, /\.quote-identity-cell strong\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.realtime-column-resizer\s*\{[^}]*cursor:\s*col-resize;[^}]*touch-action:\s*none;/s);
  assert.match(styles, /\.quote-identity-cell span\s*\{[^}]*white-space:\s*nowrap;/s);
});

test("starts the application only after module constants are initialized", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const secondaryColumnClasses = app.indexOf("const SECONDARY_PENDING_COLUMN_CLASSES");
  const initializeCall = app.lastIndexOf("void initialize().catch");

  assert.ok(secondaryColumnClasses >= 0);
  assert.ok(initializeCall > secondaryColumnClasses);
  assert.equal(app.slice(0, secondaryColumnClasses).includes("initialize();"), false);
});

test("keeps repeated bid rounds visible and submit-ready in project details", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="projectBidRoundSummary"/);
  assert.match(html, /id="bidSubmissionHistory"/);
  assert.match(html, /id="markBidButton"[^>]*>提交第 1 次标</);
  assert.match(app, /markBidButton"\)\.addEventListener\("click", submitProjectBidRound\)/);
  assert.match(app, /appendBidSubmission\(readProjectForm\(\)\)/);
  assert.match(app, /\["未投标", "已投标"\]\.includes\(status\)/);
  assert.match(html, /id="finalizeBidButton"[^>]*>确认最终标位</);
  assert.match(html, /id="reopenBidButton"[^>]*>继续改标</);
  assert.match(app, /finalizeBidButton"\)\.addEventListener\("click", \(\) => changeProjectBidFinalization\(false\)/);
  assert.match(app, /reopenBidButton"\)\.addEventListener\("click", \(\) => changeProjectBidFinalization\(true\)/);
  assert.match(app, /finalBidSubmissionId: existing\.finalBidSubmissionId/);
  assert.match(app, /bidSubmissions: existing\.bidSubmissions/);
  assert.match(styles, /\.bid-submission-row\s*\{/);
  assert.match(styles, /\.bid-submission-current\s*\{/);
});

test("ships tranche prepayment entry with a mobile-safe three-digit input", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="prepaymentEntryPanel"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="prepaymentSuffixInput"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\{3\}"[^>]*maxlength="3"/);
  assert.match(app, /data-prepayment-payment/);
  assert.match(app, /data-tranche-field="prepaymentNumber"[^>]*readonly/);
  assert.match(app, /data-tranche-field="prepaymentRecordedAt"[^>]*type="hidden"/);
  assert.match(app, /buildPrepaymentNumber\(suffix, activePrepaymentTarget\.numberDate\)/);
  assert.match(app, /prepaymentNumber:\s*new Date|prepaymentRecordedAt:\s*new Date/);
  assert.match(styles, /\.prepayment-number-input input\s*\{[^}]*font-size:\s*18px;/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.prepayment-entry-panel\s*\{[^}]*place-items:\s*end stretch;/s);
});

test("lets mobile scrolling start on date inputs without opening the picker", async () => {
  const [datePicker, styles] = await Promise.all([
    readFile(new URL("../date-picker.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  const pointerDownStart = datePicker.indexOf('input.addEventListener("pointerdown"');
  const clickStart = datePicker.indexOf('input.addEventListener("click"', pointerDownStart);

  assert.ok(pointerDownStart >= 0);
  assert.ok(clickStart > pointerDownStart);
  assert.doesNotMatch(datePicker.slice(pointerDownStart, clickStart), /openPicker\(input\)/);
  assert.match(datePicker, /input\.addEventListener\("pointermove"/);
  assert.match(datePicker, /input\.addEventListener\("pointercancel"/);
  assert.match(datePicker, /if \(suppressNextClick\)/);
  assert.match(styles, /\.custom-date-input\s*\{[^}]*touch-action:\s*pan-y;/s);
});

test("revalidates non-fingerprinted application assets", async () => {
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");

  assert.match(headers, /\/\*\.js\s+Cache-Control: no-cache/);
  assert.match(headers, /\/\*\.css\s+Cache-Control: no-cache/);
});

test("hides the project empty state once a project is selected", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.project-empty\[hidden\]\s*\{\s*display:\s*none;/);
});

test("ships separate 50206 and 50217 credit modules with project and shelf approval scopes", async () => {
  const [html, app, core, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../core.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /普通信用债授信（50206）/);
  assert.match(html, /data-issuer-credit-module="50206"/);
  assert.match(html, /data-issuer-credit-module="50217"/);
  assert.match(html, /id="selectedIssuerAbsCreditCount">0 张批单/);
  assert.match(html, /id="absCreditApprovalForm"/);
  assert.match(html, /单项目批复（总行批）/);
  assert.match(html, /储架批复（总行储架批）/);
  assert.match(html, /data-abs-field="creditApprovalId"/);
  assert.match(html, /id="openAbsCreditLibraryButton">即时新增 50217/);
  assert.match(html, /id="quickAbsCreditPanel"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /保存并关联当前项目/);
  assert.match(html, /增信方尚未入库，同时新增主体/);
  assert.match(app, /upsertAbsCreditApproval\(state, approval\)/);
  assert.match(app, /absCreditApprovalAppliesToProject/);
  assert.match(app, /filter\(\(approval\) => approval\.enhancerIssuerId === enhancerIssuerId\)/);
  assert.match(app, /project = applyAbsCreditApproval\(project, saved\)/);
  assert.match(app, /function syncIssuerCreditWorkspace\(\)/);
  assert.match(app, /增信方未入库，就地新增主体/);
  assert.match(core, /ABS 项目尚未关联 50217 批单/);
  assert.doesNotMatch(core, /abs\.approvalRatio\)\s*\?\?\s*numberOrNull\(issuer\?\.credit/);
  assert.match(styles, /\.issuer-credit-chooser\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(styles, /\.abs-credit-library-panel\s*\{[^}]*padding:\s*18px;/s);
  assert.match(styles, /\.quick-abs-credit-dialog\s*\{[^}]*padding:\s*24px;/s);
});

test("keeps the legacy project brief textarea available to code but hidden from the new-project UI", async () => {
  const [html, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<textarea id="briefInput" hidden><\/textarea>/);
  assert.match(styles, /#briefInput\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});

test("renders protocol transfer progress as sequential action buttons", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="protocolTransferStepActions"/);
  assert.match(html, /data-protocol-form-step="counterparty"/);
  assert.match(html, /data-protocol-form-step="own"/);
  assert.match(html, /data-protocol-form-step="submit"/);
  assert.doesNotMatch(html, /class="checkbox-label"[^>]*><input id="protocolTransfer(?:Counterparty|Own|Exchange)/);
  assert.match(app, /function handleProtocolTransferFormStep\(/);
  assert.match(app, /setProtocolTransferStep\(readProtocolTransferForm\(\), step\.key, completing\)/);
  assert.match(styles, /\.protocol-step-action\.is-current\s*\{/);
  assert.match(styles, /\.protocol-step-action\.is-complete\s*\{/);
  assert.match(styles, /\.protocol-step-grid > input\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
});

test("ships project guarantor entry, DM mapping and ledger detail display", async () => {
  const [html, app, styles, dmLookup] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/dm/lookup.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="projectGuaranteePanel"/);
  assert.match(html, /id="addProjectGuarantorButton"/);
  assert.match(html, /id="projectSummaryGuarantee"/);
  assert.match(app, /function renderProjectGuarantorFields\(/);
  assert.match(app, /patch\.guaranteeInfo/);
  assert.match(dmLookup, /"gura_name", "guraName"/);
  assert.match(dmLookup, /"guarantor"/);
  assert.match(dmLookup, /lookupDmGuarantorRatings/);
  assert.match(styles, /\.guarantor-row\s*\{/);
});

test("shows selectable same-issuer DM candidates when the requested issue has no bond record", async () => {
  const [html, app, styles, dmLookup] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/dm/lookup.js", import.meta.url), "utf8"),
  ]);

  assert.match(dmLookup, /lookupDmNearMatchSuggestions\(dm,/);
  assert.match(dmLookup, /OUTSTANDING_BONDS_PATH, \{ issuerFullName: issuerName \}/);
  assert.match(dmLookup, /suggestions: noDmBondResult \? nearMatches\.suggestions : \[\]/);
  assert.match(app, /<strong>同主体债券候选<\/strong>/);
  assert.match(app, /suggestions\.map\(renderProjectDmSuggestion\)/);
  assert.match(app, /data-project-dm-query=/);
  assert.ok(html.indexOf('id="valuationAssist"') < html.indexOf('id="projectDmAssist"'));
  assert.ok(html.indexOf('id="projectDmAssist"') < html.indexOf('id="warningBox"'));
  assert.ok(html.indexOf('id="projectDmAssist"') < html.indexOf('class="panel fields-panel"'));
  assert.match(styles, /\.input-panel \.project-dm-assist \.dm-suggestion-list\s*\{\s*grid-template-columns:\s*1fr;/);
});

test("keeps the desktop sidebar rail continuous and the empty detail state compact", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.app-shell\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*#10172d 0 252px,\s*transparent 252px\)/s);
  assert.match(styles, /\.sidebar\s*\{[^}]*position:\s*relative;[^}]*align-self:\s*stretch;[^}]*min-height:\s*100vh;[^}]*overflow:\s*visible;[^}]*border-right:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /@media \(min-width: 761px\)[\s\S]+\.project-detail-panel:has\(> \.project-empty:not\(\[hidden\]\)\)\s*\{\s*min-height:\s*0;/);
  assert.match(styles, /\.project-detail-panel > \.project-empty:not\(\[hidden\]\)\s*\{\s*min-height:\s*140px;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.app-shell\s*\{[^}]*background:\s*transparent;/);
});

test("spreads cutoff todo details across desktop rows only", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.cutoff-todo-item \.payment-todo-main\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /@media \(min-width: 761px\)[\s\S]+\.cutoff-todo-item \.payment-todo-main\s*\{[^}]*grid-template-columns:\s*minmax\(120px, 1fr\) minmax\(0, \.9fr\);[^}]*column-gap:\s*clamp\(12px, 2vw, 36px\);/s);
  assert.match(styles, /@media \(min-width: 761px\)[\s\S]+\.cutoff-todo-item \.payment-todo-main span\s*\{[^}]*justify-self:\s*stretch;[^}]*border-left:\s*1px solid/s);
  assert.match(styles, /@media \(max-width: 1050px\)[\s\S]+\.ledger-todo-zone\s*\{\s*grid-template-columns:\s*1fr;/s);
});

test("maps DM V2.5 ratings into the new-project fields", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "subjectRating", normalized\.subjectRating, normalizedProjectFieldSource\(normalized, "subjectRating"\)\)/);
  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "ratingAgency", normalized\.ratingAgency, normalizedProjectFieldSource\(normalized, "ratingAgency"\)\)/);
  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "hiddenRating", normalized\.impliedRating, normalizedProjectFieldSource\(normalized, "impliedRating"\)\)/);
  assert.match(app, /patch\.hiddenRatingSource = normalized\.ratingSource\?\.impliedRating \|\| "dm"/);
  assert.match(app, /patch\.hiddenRatingAsOf = normalized\.impliedRatingAsOf/);
});

test("excludes cancelled DM records without shifting inquiry ranges between varieties", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /const unusableStatuses = new Set\(\["reallocated", "cancelled", "failed"\]\)/);
  assert.match(app, /patch\.inquiryRanges = ranges;/);
  assert.doesNotMatch(app, /const completeRanges = ranges\.filter/);
});

test("lets every project list set the page height without internal scrolling", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(app, /SHORT_PROJECT_LIST_LIMIT|is-short-list|has-short-list|keepSelectedProjectCardClear/);
  assert.match(styles, /\.project-list-panel\s*\{[^}]*position:\s*static;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s);
  assert.match(styles, /\.project-list\s*\{[^}]*max-height:\s*none;[^}]*padding:\s*0 0 14px;[^}]*overflow:\s*visible;/s);
  assert.doesNotMatch(styles, /\.project-list\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(styles, /\.project-item\s*\{[^}]*scroll-margin-block:\s*12px;/s);
  assert.match(styles, /\.project-list\.liquid-track::before\s*\{[^}]*box-sizing:\s*border-box;/s);
});

test("keeps project bidding cards inside a zoom-constrained desktop workspace", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.ledger-grid\s*\{[^}]*grid-template-columns:\s*clamp\(320px, 27vw, 430px\) minmax\(0, 1fr\);[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.project-list-panel, \.project-detail-panel\s*\{[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.project-detail-panel \.tranche-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/s);
  assert.match(styles, /\.bid-level-card \.tranche-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/s);
  assert.match(styles, /\.outsourced-card \.tranche-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/s);
});

test("places the optional valuation badge between inquiry and offering facts", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  const inquiry = app.indexOf("formatInquirySummary(item.tranches)", app.indexOf("function renderProjectList"));
  const valuation = app.indexOf('class="project-valuation-badge"', inquiry);
  const offering = app.indexOf('class="project-offering-badge', valuation);

  assert.ok(inquiry >= 0 && inquiry < valuation && valuation < offering);
  assert.match(styles, /\.project-item-facts span\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*23px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*font-size:\s*10px;[^}]*line-height:\s*1;/s);
  assert.match(styles, /\.project-item-facts \.project-valuation-badge\s*\{[^}]*color:\s*#087f8d;[^}]*background:\s*linear-gradient/s);
});

test("wraps complete venue and lead-underwriter details on project cards", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /class="project-party-badge">\$\{escapeHtml\(formatProjectVenueLead\(item\)\)\}<\/span>/);
  assert.match(app, /function formatProjectVenueLead\(projectValue\)/);
  assert.doesNotMatch(app, /formatProjectLeadSummary|等\$\{names\.length\}家/);
  assert.doesNotMatch(app, /project-venue-badge|project-lead-badge/);
  assert.match(styles, /\.project-item-facts \.project-party-badge\s*\{[^}]*flex:\s*1 1 100%;[^}]*width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*line-height:\s*1\.45;/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.project-item-facts span\s*\{[^}]*min-height:\s*26px;[^}]*font-size:\s*11px;/s);
});

test("renders compact submitted bid positions below card facts with wrapping and escaped labels", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /\$\{renderProjectCardBidSummary\(item\)\}/);
  assert.match(app, /const summary = projectCardBidSummary\(project\)/);
  assert.match(app, /escapeHtml\(tranche.shortName\)/);
  assert.match(app, /escapeHtml\(position.label\)/);
  assert.match(app, /escapeHtml\(position.rate\)/);
  assert.match(app, /有修改未提交/);
  assert.match(styles, /\.project-bid-positions\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.project-bid-position\s*\{[^}]*max-width:\s*100%;[^}]*flex-wrap:\s*wrap;[^}]*overflow-wrap:\s*anywhere;/s);
});

test("lets new projects choose a smart, same-day or next-business-day cutoff", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="newProjectCutoffPreview"/);
  assert.match(html, /data-new-project-cutoff-mode="auto"/);
  assert.match(html, /data-new-project-cutoff-mode="today"/);
  assert.match(html, /data-new-project-cutoff-mode="next-business-day"/);
  assert.match(app, /dayMode:\s*newProjectCutoffMode/);
  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "subscribeDate", normalized\.subscribeDate \|\| issueGroup\?\.subscribeDate\)/);
  assert.match(app, /resolveNewProjectCutoff\(project, issuer, referenceDate, \{/);
  assert.match(app, /existingProject: existing/);
  assert.match(app, /newProjectCutoffPreview = suggestion/);
  assert.match(app, /upsertParsedProjectToLedger\(project, issuer, generated, newProjectCutoffPreview\)/);
  assert.match(app, /const cutoff = cutoffPreview \|\| resolveNewProjectCutoff/);
  assert.doesNotMatch(app, /cutoffAt: existing.cutoffAt \|\| created.cutoffAt/);
  assert.match(html, /id="newProjectCutoffHint"/);
  assert.match(app, /dayMode: existing \? "auto" : newProjectCutoffMode/);
  assert.match(app, /editProjectOpinionButton"\)\.addEventListener\("click", \(\) => \{\s*const record = readProjectForm\(\);\s*\/\/[^\n]+\n\s*newProjectCutoffMode = "auto"/);
  assert.match(styles, /\.new-project-cutoff-modes button\.active\s*\{/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.new-project-cutoff-modes\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
});

test("keeps protocol transfer hover borders clear of the scroll viewport", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const liftedCardHover = styles.indexOf(".project-item:hover,");
  const protocolHoverOverride = styles.lastIndexOf(".protocol-transfer-item:hover {");

  assert.match(styles, /\.protocol-transfer-list\s*\{[^}]*padding:\s*10px 8px 10px 5px;[^}]*overflow:\s*auto;[^}]*scroll-padding-block:\s*10px;[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(styles, /\.protocol-transfer-item\s*\{[^}]*position:\s*relative;/s);
  assert.match(styles, /\.protocol-transfer-item::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*1px;[^}]*border:\s*1px solid transparent;[^}]*pointer-events:\s*none;/s);
  assert.match(styles, /\.protocol-transfer-item:hover\s*\{[^}]*z-index:\s*1;[^}]*outline:\s*none;[^}]*box-shadow:\s*inset 0 0 0 1px var\(--accent\),[^}]*transform:\s*none;/s);
  assert.match(styles, /\.protocol-transfer-item:hover::after\s*\{\s*border-color:\s*transparent;\s*\}/s);
  assert.ok(protocolHoverOverride > liftedCardHover, "protocol hover override must follow the generic lifted-card hover rule");
});

test("uses a reusable, layout-aware OCR worker for project screenshots", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /tesseract\.js@5\.1\.1/);
  assert.match(app, /Tesseract\.createWorker\("chi_sim\+eng"/);
  assert.match(app, /tessedit_pageseg_mode/);
  assert.match(app, /pageSegMode: band\.height \/ Math\.max\(1, columns\.name\.width\)/);
  assert.match(app, /\? "SINGLE_BLOCK"\s*:\s*"SINGLE_LINE"/s);
  assert.match(app, /projectScreenshotOtsuThreshold/);
  assert.match(app, /eraseProjectScreenshotTableLines/);
  assert.match(app, /canvas\.width = 1;\s*canvas\.height = 1;/s);
  assert.match(app, /\? 24 : 32/);
  assert.match(app, /\? 10 : 14/);
  assert.match(app, /maxPixels:\s*4_500_000/);
  assert.match(app, /maxPixels:\s*9_000_000/);
  assert.match(app, /maxPixels:\s*1_600_000/);
  assert.match(app, /maxPixels:\s*2_800_000/);
  assert.match(app, /analyzeProjectScreenshotLayout/);
  assert.match(app, /detectProjectScreenshotContentBounds/);
  assert.match(app, /splitProjectScreenshotRegionVertically/);
  assert.match(app, /buildProjectScreenshotAnalysisTiles/);
  assert.match(app, /projectScreenshotUniformScale/);
  assert.match(app, /inspectProjectScreenshotImageHeader/);
  assert.match(app, /projectScreenshotResizeDimensions/);
  assert.match(app, /PROJECT_SCREENSHOT_MAX_FILE_BYTES/);
  assert.match(app, /for \(const degrees of \[90, 270, 180\]\)/);
  assert.match(app, /createProjectScreenshotRotatedCanvas/);
  assert.match(app, /selectProjectScreenshotOrientationProbe/);
  assert.match(app, /limitProjectScreenshotOcrTargets/);
  assert.match(app, /projectScreenshotWorkerGeneration/);
  assert.match(app, /projectScreenshotOcrPassBudget = compact \? 72 : 120/);
  assert.match(app, /const cropSize = Math\.max\(1, Math\.min\(image\.width, image\.height\)\)/);
  assert.match(app, /source-y:/);
  assert.match(app, /sourceKey:\s*`source-y:\$\{Math\.round\(band\.y \+ band\.height \/ 2\)\}/);
  assert.doesNotMatch(app, /targetHeight:\s*Math\.max\((?:96|108),/);
  assert.doesNotMatch(app, /fitProjectScreenshot(?:Rows|Height|Columns)ToCanvas/);
  assert.match(app, /if \(rowBands\.length >= 2 && columns\)/);
  assert.match(app, /passErrors\.push/);
  assert.match(app, /controller\.abort\(\);\s*}, 12_000/);
  assert.match(app, /canvasPixels <= maxPixels/);
  assert.doesNotMatch(app, /rowPassMatches|rowCoverageReached|minimumRowMatches|structuredPassMatches/);
  assert.match(html, /id="projectScreenshotStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="projectScreenshotOutput" hidden/);
  assert.doesNotMatch(html, /id="projectScreenshotOutput" aria-live=/);
  assert.match(app, /data-project-screenshot-row-status/);
  assert.match(app, /handleProjectScreenshotCorrectionSubmit/);
  assert.match(app, /createManualProjectScreenshotRow/);
  assert.match(app, /data-project-screenshot-branch-select/);
  assert.match(app, /current\.revision !== revision/);
  assert.match(app, /row\.dmVerified = false/);
  assert.match(app, /row\.status === "ok" && row\.dmVerified && row\.verifiedFullName && row\.verifiedShortName/);
  assert.match(styles, /\.project-screenshot-item\.is-pending/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.project-screenshot-correction input, \.project-screenshot-correction select\s*\{[^}]*min-height:\s*44px;[^}]*font-size:\s*16px;/);
});

test("ships the daily trade ledger as an editable DM-backed spreadsheet", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="secondaryLedgerDmButton"[^>]*>读取 DM</);
  assert.match(html, /id="secondaryLedgerSaveButton"[^>]*>保存修改</);
  assert.match(app, /class="secondary-ledger-table"/);
  assert.match(app, /data-ledger-row-index=/);
  assert.match(app, /pasteTradeRecordDraftCells/);
  assert.match(app, /DM_TRADE_RECORDS_URL = "\.\/api\/dm\/trade-records"/);
  assert.match(app, /buildTradeRecordTableText\(rows, \{ includeHeader: false \}\)/);
  assert.doesNotMatch(app, /buildTradeRecordClipboardText/);
  assert.match(styles, /\.secondary-ledger-sheet\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(styles, /\.secondary-workspace\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(styles, /\.secondary-workspace-panel\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(styles, /\.secondary-ledger-panel\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.secondary-ledger-sheet\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s);
  assert.match(styles, /\.secondary-ledger-cell:focus\s*\{[^}]*outline:\s*2px solid #3f9e95;/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.secondary-ledger-cell\s*\{[^}]*font-size:\s*16px;/s);
});

test("renders pending secondary trades as an editable DM-backed spreadsheet", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /一笔一行|一行一笔；可一次粘贴多笔交易|当前仅接收公募债及 PPN/);
  assert.match(html, /id="secondaryPendingDmButton"[^>]*>重新读取 DM</);
  assert.match(html, /id="secondaryIntakeToggleButton"[^>]*>收起录入区</);
  assert.match(html, /id="secondaryPendingSaveButton"[^>]*>保存修改</);
  assert.match(html, /id="secondaryPendingCopyButton"[^>]*>复制到 Excel</);
  assert.match(html, /id="secondaryPendingQuickDeleteButton"[^>]*aria-pressed="false"[^>]*>免确认删除：关</);
  assert.match(app, /class="secondary-pending-table \$\{secondaryPendingShowAllColumns/);
  assert.match(app, /class="secondary-pending-cell/);
  assert.match(app, /pasteTradeRecordDraftCells\(secondaryPendingDraftRows/);
  assert.match(app, /applySecondaryPendingDraftRows/);
  assert.match(app, /enrichSecondaryPendingFromDm/);
  assert.match(app, /for \(let index = 0; index < requestRows\.length; index \+= 80\)/);
  assert.match(app, /"清算速度\(0\/1\)": "settlementSpeed"/);
  assert.match(app, /清算速度: "settlementSpeedText"/);
  assert.match(app, /data-secondary-trade-action="front-office">成交</);
  assert.match(app, /data-secondary-delete-confirm-popover=/);
  assert.match(app, /secondaryPendingQuickDelete/);
  assert.match(app, /if \(secondaryPendingQuickDelete\) \{\s*removePendingSecondaryTrade\(id\);\s*return;/s);
  assert.doesNotMatch(app, /confirm\(`确认删除 \$\{trade\.shortName \|\| trade\.code \|\| "这笔"\} 待成交记录/);
  assert.doesNotMatch(app, /secondary-card secondary-pending-trade/);
  assert.match(styles, /\.secondary-pending-sheet\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(styles, /\.secondary-input-panel\.collapsed > :not\(\.panel-head\)\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.secondary-pending-table:not\(\.show-all-columns\) \.secondary-pending-optional\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.secondary-pending-cell:focus\s*\{[^}]*outline:\s*2px solid #3f9e95;/s);
  assert.match(styles, /\.secondary-pending-actions, \.secondary-pending-action-heading\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0;/s);
  assert.match(styles, /\.secondary-pending-action-buttons\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*118px;/s);
  assert.match(styles, /\.secondary-pending-delete-popover\s*\{[^}]*position:\s*absolute;[^}]*right:\s*calc\(100% \+ 9px\);/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.secondary-pending-cell\s*\{[^}]*font-size:\s*16px;/s);
});

test("uses single-pane project navigation on compact screens", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-view="ledger" data-mobile-pane="list"/);
  assert.match(html, /id="ledgerMobileNav"[\s\S]+data-ledger-mobile-pane="list"[\s\S]+data-ledger-mobile-pane="overview"/);
  assert.match(html, /id="mobileProjectBackButton"/);
  assert.match(html, /id="resultEntryDialog" tabindex="-1"/);
  assert.match(app, /LEDGER_MOBILE_PANES = new Set\(\["list", "detail", "overview"\]\)/);
  assert.match(app, /pane: params\.get\("pane"\)/);
  assert.match(app, /history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(app, /function openLedgerProject/);
  assert.match(app, /function restoreLedgerMobileViewport/);
  assert.match(app, /querySelector\("\.project-list-panel"\)\?\.scrollIntoView/);
  assert.match(app, /element\.inert = !visible/);
  assert.match(app, /positionResultEntryPanel\(\)/);
  assert.match(app, /\$\("#resultEntryDialog"\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /route\.target === selected\.id[\s\S]+route\.kind === "project-result"/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.view\[data-view="ledger"\] > \.ledger-mobile-nav\s*\{[^}]*position:\s*fixed;[^}]*right:\s*14px;[^}]*left:\s*14px;[^}]*width:\s*auto;[^}]*max-width:\s*430px;/s);
  assert.match(styles, /data-mobile-pane="list"[\s\S]+\.project-detail-panel/);
  assert.match(styles, /data-mobile-pane="detail"[\s\S]+\.project-list-panel/);
  assert.match(styles, /data-mobile-pane="overview"[^\n]+\.ledger-grid\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.ledger-mobile-back\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.result-entry-panel\s*\{[^}]*z-index:\s*120;[^}]*top:\s*calc\(100% \+ 9px\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.result-entry-panel\s*\{[^}]*max-height:\s*min\(68dvh/s);
  assert.match(styles, /\.view\.active\s*\{[^}]*animation:\s*workspaceSurfaceIn \.28s ease backwards;/);
});

test("uses a single crash-safe immersive Android app shell without the mobile sidebar gap", async () => {
  const [html, shellMode, app, styles, mainActivity, androidTheme] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app-shell-mode.js", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/MainActivity.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/res/values/styles.xml", import.meta.url), "utf8"),
  ]);

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, new RegExp(`app-shell-mode\\.js\\?v=${VERSION}`));
  assert.match(shellMode, /navigator\.userAgent\.includes\("Tempest07Android\/"\)/);
  assert.match(shellMode, /get\("app-shell"\) === "android"/);
  assert.match(shellMode, /classList\.add\("android-app-preview"\)/);
  assert.match(html, /id="androidMoreButton"/);
  assert.match(html, /id="androidMorePanel"/);
  assert.match(html, /class="android-app-nav"/);
  assert.match(app, /function initializeAndroidAppShell/);
  assert.match(app, /screenshotMount\.append\(screenshotTool\)/);
  assert.match(app, /dataActionsMount\.append\(dataActions\)/);
  assert.match(app, /item\.dataset\.viewTarget === viewName/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.sidebar\s*\{[^}]*min-height:\s*0;/s);
  assert.match(styles, /html\.android-app \.sidebar\s*\{\s*display:\s*none;/);
  assert.match(styles, /html\.android-app \.android-app-nav\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /html\.android-app \.view\[data-view="ledger"\] > \.ledger-mobile-nav\s*\{[^}]*position:\s*sticky;/s);
  assert.match(mainActivity, /setContentView\(webView\)/);
  assert.ok(mainActivity.indexOf("setContentView(webView)") < mainActivity.indexOf("scheduleStatusBarHide()"));
  assert.match(mainActivity, /webView\.post\(this::hideStatusBarSafely\)/);
  assert.match(mainActivity, /webView\.getWindowInsetsController\(\)/);
  assert.match(mainActivity, /WindowInsets\.Type\.statusBars\(\)/);
  assert.match(mainActivity, /catch \(RuntimeException ignored\)/);
  assert.doesNotMatch(mainActivity, /getWindow\(\)\.getInsetsController\(\)/);
  assert.doesNotMatch(mainActivity, /onWindowFocusChanged|protected void onResume/);
  assert.match(androidTheme, /name="android:windowFullscreen">true</);
  assert.doesNotMatch(mainActivity, /LinearLayout|android\.widget\.Button|webView\.reload/);
});

test("ships liquid selection motion with accessible fallback", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-ledger-filter="all"[^>]+aria-pressed="true"/);
  assert.match(html, /data-ledger-filter="bidding"/);
  assert.match(html, /data-ledger-filter="bidFinal"/);
  assert.match(html, /data-ledger-filter="resulted"/);
  for (const filter of ["toBid", "bidding", "bidFinal", "resulted"]) {
    assert.match(html, new RegExp(`<option value="${filter}">`));
  }
  assert.match(app, /projectStatusFilter"\)\.addEventListener\("change", \(event\) => setLedgerFilter\(event\.target\.value/);
  assert.match(app, /projectMatchesStatusFilter\(item, ledgerFilter\)/);
  assert.doesNotMatch(app, /statusFilter && item\.status !== statusFilter/);
  assert.doesNotMatch(html, /ledgerFilterSelect|ledgerFilterLabel/);
  assert.doesNotMatch(app, /LEDGER_FILTER_SELECT_VALUES|ledgerFilterSelect|ledgerFilterLabel/);
  assert.match(app, /dashboardBidding/);
  assert.match(app, /dashboardBidFinal/);
  assert.match(app, /dashboardResulted/);
  assert.match(app, /function initializeLiquidMotion/);
  assert.match(app, /function syncLiquidTrack/);
  assert.match(app, /item\.setAttribute\("aria-pressed", String\(active\)\)/);
  assert.match(styles, /\.liquid-track::before/);
  assert.match(styles, /\.ledger-filter-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(styles, /@keyframes liquidSelectorMorph/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("ships a custom pinyin-searchable issuer picker", async () => {
  const [html, app, styles, search, vendor, license] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../issuer-search.js", import.meta.url), "utf8"),
    readFile(new URL("../vendor/pinyin-pro.min.js", import.meta.url), "utf8"),
    readFile(new URL("../vendor/pinyin-pro.LICENSE.md", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="issuerSearchInput"[^>]+role="combobox"[^>]+aria-controls="issuerSearchResults"/);
  assert.match(html, /id="issuerSearchResults"[^>]+role="listbox"/);
  assert.match(html, /id="issuerSelect" type="hidden"/);
  assert.doesNotMatch(html, /<select id="issuerSelect"/);
  assert.ok(html.indexOf("vendor/pinyin-pro.min.js") < html.indexOf("app.js?v="));
  assert.match(app, /function bindIssuerPicker\(\)/);
  assert.match(app, /buildIssuerSearchIndex\(state\.issuers \|\| \[\]\)/);
  assert.match(app, /searchIssuerIndex\(issuerSearchEntries, input\.value\)/);
  assert.match(app, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(app, /event\.key === "Enter"/);
  assert.match(search, /fullPinyinKeys/);
  assert.match(search, /initialPinyinKeys/);
  assert.match(styles, /\.issuer-picker-control input\s*\{[^}]*appearance:\s*none;/s);
  assert.match(styles, /\.issuer-picker-results\s*\{[^}]*position:\s*absolute;/s);
  assert.match(styles, /\.issuer-picker-option:hover, \.issuer-picker-option\.is-active/);
  assert.match(vendor, /pinyinPro/);
  assert.match(license, /MIT License/);
});

test("shows the compact DM policy-bank curve in the project command corner", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /class="ledger-command-bottom"[\s\S]+id="policyCurveCard"/);
  assert.match(html, /id="policyCurvePoints"/);
  assert.match(html, /id="policyCurveUpdatedAt"/);
  assert.match(html, /id="policyCurveTitle">国开债曲线</);
  assert.match(app, /DM_POLICY_CURVE_URL/);
  assert.match(app, /\["0\.1Y", "0\.2Y", "0\.25Y", "0\.3Y"[^\]]+"1Y", "3Y", "5Y"\]/);
  assert.match(app, /POLICY_CURVE_KEY_TERMS = new Set\(\["0\.1Y", "0\.25Y", "0\.3Y", "0\.5Y", "0\.75Y", "1Y", "3Y", "5Y"\]\)/);
  assert.match(styles, /\.policy-curve-points\s*\{[^}]*grid-template-columns:\s*repeat\(7,/s);
  assert.match(app, /node\?\.method === "derived-linear"/);
  assert.match(app, /loadPolicyCurve\(\{ refresh: true \}\)/);
  assert.match(styles, /\.ledger-command-bottom\s*\{[^}]*grid-template-columns:[^}]*align-items:\s*stretch;/s);
  assert.match(styles, /\.ledger-filter-bar\s*\{[^}]*display:\s*grid;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.policy-curve-card\s*\{[^}]*grid-template-columns:\s*minmax\(142px, auto\)\s+minmax\(0, 1fr\)/s);
  assert.match(styles, /\.policy-curve-points\s*\{[^}]*grid-template-columns:\s*repeat\(7,/s);
  assert.match(styles, /\.policy-curve-point\.is-key\s*\{/);
  assert.match(styles, /@media \(max-width: 1380px\)[\s\S]+\.ledger-command-bottom\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media \(max-width: 1050px\)[\s\S]+\.ledger-command-bottom\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.policy-curve-points\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
});

test("ships the protocol transfer ledger xlsx template", async () => {
  const workbook = await readFile(new URL("../templates/protocol-transfer-ledger-template.xlsx", import.meta.url));

  assert.equal(workbook[0], 0x50);
  assert.equal(workbook[1], 0x4b);
});

test("opens protocol transfer todos in place and highlights the selected record", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /data-protocol-transfer-open/);
  assert.match(app, /record\.id === selectedProtocolTransferId \? "active" : ""/);
  assert.match(app, /function openProtocolTransferRecord\(id\)/);
  assert.match(app, /protocolTransferEditMode = true;\s*renderProtocolTransferWorkspace\(\);/s);
  assert.doesNotMatch(app, /detail\.scrollIntoView\(/);
  assert.match(app, /window\.scrollTo\(\{ \.\.\.scrollPosition, behavior: "auto" \}\)/);
  assert.match(app, /persistState\(\);\s*openProtocolTransferRecord\(next\.id\);/s);
  assert.match(styles, /\.protocol-todo-record\s*\{[^}]*cursor:\s*pointer;/s);
  assert.match(styles, /\.protocol-todo-item\.active\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*box-shadow:\s*inset 4px 0 0 var\(--accent\)/s);
});

test("ships maker-specific protocol transfer Word templates and generation controls", async () => {
  const [html, app, styles, jiantou, huachuang, yintai, pizzip] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../templates/protocol-transfer/citic-jiantou.docx", import.meta.url)),
    readFile(new URL("../templates/protocol-transfer/huachuang.docx", import.meta.url)),
    readFile(new URL("../templates/protocol-transfer/yintai.docx", import.meta.url)),
    readFile(new URL("../vendor/pizzip.min.js", import.meta.url), "utf8"),
  ]);

  for (const template of [jiantou, huachuang, yintai]) {
    assert.equal(template[0], 0x50);
    assert.equal(template[1], 0x4b);
  }
  assert.match(html, /id="protocolTransferMarketMaker"/);
  assert.match(html, /id="protocolTransferTemplateSelect"/);
  assert.match(html, /id="protocolTransferGenerateDocxButton"/);
  assert.match(html, /id="protocolTransferTemplateInput"/);
  assert.match(html, /最终买方不写入申请单/);
  assert.match(html, /vendor\/pizzip\.min\.js/);
  assert.match(pizzip, /window\.PizZip=/);
  assert.match(app, /generateProtocolTransferApplicationDocx/);
  assert.match(app, /indexedDB\.open\(PROTOCOL_TRANSFER_TEMPLATE_DB/);
  assert.match(styles, /\.protocol-template-controls\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.protocol-transfer-detail \.field-grid \.span-2\s*\{\s*grid-column:\s*span 1;/s);
});

test("exposes unified reminders to the Android bridge", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /function syncAndroidReminders/);
  assert.match(app, /window\.Tempest07Android/);
  assert.match(app, /bridge\.syncReminders/);
  assert.match(app, /syncAndroidReminders\(reminders\)/);
  assert.match(app, /function parseRouteFromHash/);
  assert.match(app, /params\.get\("target"\)/);
  assert.match(app, /route\.kind === "project-result"/);
  assert.match(app, /\["protocol-transfer", "secondary-inventory"\]\.includes\(route\.view\)/);
});

test("ships Android shell and debug APK workflow", async () => {
  const [html, manifest, rootBuildGradle, buildGradle, gradleProperties, mainActivity, receiver, reminderSync, syncWorker, reminderApi, workflow, readme] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
    readFile(new URL("../android/build.gradle", import.meta.url), "utf8"),
    readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
    readFile(new URL("../android/gradle.properties", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/MainActivity.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/ReminderReceiver.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/ReminderSync.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/ReminderSyncWorker.java", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/reminders.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/android-debug.yml", import.meta.url), "utf8"),
    readFile(new URL("../android/README.md", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(rootBuildGradle, /com\.android\.application" version "8\.6\.1"/);
  assert.match(buildGradle, /namespace "com\.tempest07\.bondcentre"/);
  assert.match(buildGradle, /applicationId "com\.tempest07\.bondcentre"/);
  assert.match(buildGradle, /versionCode 4/);
  assert.match(buildGradle, /versionName "0\.3\.1"/);
  assert.match(buildGradle, /androidx\.work:work-runtime:2\.11\.2/);
  assert.match(gradleProperties, /android\.useAndroidX=true/);
  assert.match(mainActivity, /https:\/\/tempest07\.com\/bond-centre\//);
  assert.match(mainActivity, /addJavascriptInterface\(new AndroidBridge\(\), "Tempest07Android"\)/);
  assert.match(mainActivity, /ReminderSyncWorker\.schedulePeriodicSync\(this\)/);
  assert.match(mainActivity, /safeInternalUrl\(url, fallbackUrl\)/);
  assert.match(mainActivity, /if \(!isAllowedExternalScheme\(scheme\)\) return true/);
  assert.match(mainActivity, /catch \(ActivityNotFoundException error\) \{\s*return true;/);
  assert.match(mainActivity, /Tempest07Android\/" \+ BuildConfig\.VERSION_NAME/);
  assert.match(receiver, /CHANNEL_ID = "bond-centre-reminders"/);
  assert.match(reminderSync, /routeUrl\(item\)/);
  assert.match(reminderSync, /appendQueryParam\(builder, "kind"/);
  assert.match(syncWorker, /https:\/\/tempest07\.com\/api\/reminders/);
  assert.match(syncWorker, /CookieManager\.getInstance\(\)\.getCookie/);
  assert.match(syncWorker, /enqueueUniquePeriodicWork/);
  assert.match(syncWorker, /ExistingPeriodicWorkPolicy\.UPDATE/);
  assert.match(syncWorker, /NetworkType\.CONNECTED/);
  assert.match(reminderApi, /buildUnifiedReminders/);
  assert.match(mainActivity, /controller\.hide\(WindowInsets\.Type\.statusBars\(\)\)/);
  assert.match(mainActivity, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
  assert.doesNotMatch(mainActivity, /navButton|webView\.reload|Tempest07 Bond/);
  ["reminders", "ledger", "payment-receipts", "secondary-trading", "generator"]
    .forEach((route) => assert.match(html, new RegExp(`android-app-nav-item[^>]+data-view-target="${route}"`)));
  assert.match(html, new RegExp(`app-shell-mode\\.js\\?v=${VERSION}`));
  assert.match(html, /id="androidMorePanel"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(readme, /WorkManager/);
  assert.match(workflow, /Android Debug APK/);
  assert.match(workflow, /codex\/android-\*/);
  assert.match(workflow, /gradle -p android :app:assembleDebug --no-daemon/);
  assert.match(workflow, /sha256sum .*app-debug\.apk/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(readme, /tempest07-bond-centre-debug-apk/);
});
