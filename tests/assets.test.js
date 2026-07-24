import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const VERSION = "20260722-payment-receipt-explorer";

test("exposes a readable product version consistent with package metadata", async () => {
  const [html, packageText] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageVersion = JSON.parse(packageText).version;
  const visibleVersion = packageVersion.split(".").slice(0, 3).join(".");

  assert.match(html, new RegExp(`<meta name="application-version" content="${packageVersion.replaceAll(".", "\\.")}">`));
  assert.match(html, /<meta name="application-build-version" content="3\.2\.0\.2">/);
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
  assert.match(app, new RegExp(`history-parser\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`reminders\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`secondary-inventory\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`date-picker\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`project-screenshot-ocr\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`project-screenshot-layout\\.js\\?v=${VERSION}`));
  assert.match(app, new RegExp(`project-screenshot-image\\.js\\?v=${VERSION}`));
  assert.match(historyParser, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(lifecycle, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
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

test("revalidates non-fingerprinted application assets", async () => {
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");

  assert.match(headers, /\/\*\.js\s+Cache-Control: no-cache/);
  assert.match(headers, /\/\*\.css\s+Cache-Control: no-cache/);
});

test("hides the project empty state once a project is selected", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.project-empty\[hidden\]\s*\{\s*display:\s*none;/);
});

test("keeps the desktop sidebar rail continuous and the empty detail state compact", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.app-shell\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*#10172d 0 252px,\s*transparent 252px\)/s);
  assert.match(styles, /@media \(min-width: 761px\)[\s\S]+\.project-detail-panel:has\(> \.project-empty:not\(\[hidden\]\)\)\s*\{\s*min-height:\s*0;/);
  assert.match(styles, /\.project-detail-panel > \.project-empty:not\(\[hidden\]\)\s*\{\s*min-height:\s*140px;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.app-shell\s*\{[^}]*background:\s*transparent;/);
});

test("spreads cutoff todo details across desktop rows only", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /@media \(min-width: 761px\)[\s\S]+\.cutoff-todo-item \.payment-todo-main\s*\{[^}]*grid-template-columns:\s*minmax\(150px, 1fr\) minmax\(200px, \.9fr\);[^}]*column-gap:\s*clamp\(24px, 5vw, 72px\);/s);
  assert.match(styles, /@media \(min-width: 761px\)[\s\S]+\.cutoff-todo-item \.payment-todo-main span\s*\{[^}]*border-left:\s*1px solid/s);
});

test("maps DM V2.5 ratings into the new-project fields", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "subjectRating", normalized\.subjectRating, normalizedProjectFieldSource\(normalized, "subjectRating"\)\)/);
  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "ratingAgency", normalized\.ratingAgency, normalizedProjectFieldSource\(normalized, "ratingAgency"\)\)/);
  assert.match(app, /assignProjectDmValueWithSource\(patch, sourceMap, "hiddenRating", normalized\.impliedRating, normalizedProjectFieldSource\(normalized, "impliedRating"\)\)/);
  assert.match(app, /patch\.hiddenRatingSource = normalized\.ratingSource\?\.impliedRating \|\| "dm"/);
  assert.match(app, /patch\.hiddenRatingAsOf = normalized\.impliedRatingAsOf/);
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

test("places the optional valuation badge between inquiry and offering facts", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  const inquiry = app.indexOf("formatInquirySummary(item.tranches)", app.indexOf("function renderProjectList"));
  const valuation = app.indexOf('class="project-valuation-badge"', inquiry);
  const offering = app.indexOf('class="project-offering-badge', valuation);

  assert.ok(inquiry >= 0 && inquiry < valuation && valuation < offering);
  assert.match(styles, /\.project-item-facts \.project-valuation-badge\s*\{[^}]*color:\s*#087f8d;[^}]*background:\s*linear-gradient/s);
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
  assert.match(app, /if \(isCompactLedger\(\)\) requestAnimationFrame\(\(\) => \$\("#resultEntryDialog"\)\?\.focus/);
  assert.match(app, /route\.target === selected\.id[\s\S]+route\.kind === "project-result"/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.ledger-mobile-nav\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /data-mobile-pane="list"[\s\S]+\.project-detail-panel/);
  assert.match(styles, /data-mobile-pane="detail"[\s\S]+\.project-list-panel/);
  assert.match(styles, /data-mobile-pane="overview"[^\n]+\.ledger-grid\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.ledger-mobile-back\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.result-entry-panel\s*\{[^}]*z-index:\s*120;[^}]*place-items:\s*end stretch;/s);
  assert.match(styles, /\.result-entry-dialog\s*\{[^}]*max-height:\s*calc\(100dvh/);
  assert.match(styles, /\.view\.active\s*\{[^}]*animation:\s*workspaceSurfaceIn \.28s ease backwards;/);
});

test("ships liquid selection motion with accessible fallback", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-ledger-filter="all"[^>]+aria-pressed="true"/);
  assert.match(html, /data-ledger-filter="awaitingResult"/);
  assert.match(html, /data-ledger-filter="won"/);
  assert.match(html, /data-ledger-filter="notWon"/);
  assert.doesNotMatch(html, /ledgerFilterSelect|ledgerFilterLabel/);
  assert.doesNotMatch(app, /LEDGER_FILTER_SELECT_VALUES|ledgerFilterSelect|ledgerFilterLabel/);
  assert.match(app, /dashboardAwaitingResult/);
  assert.match(app, /dashboardWon/);
  assert.match(app, /dashboardNotWon/);
  assert.match(app, /function initializeLiquidMotion/);
  assert.match(app, /function syncLiquidTrack/);
  assert.match(app, /item\.setAttribute\("aria-pressed", String\(active\)\)/);
  assert.match(styles, /\.liquid-track::before/);
  assert.match(styles, /\.ledger-filter-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(styles, /@keyframes liquidSelectorMorph/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
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
  assert.match(html, /0\.1–1年国开债曲线/);
  assert.match(app, /DM_POLICY_CURVE_URL/);
  assert.match(app, /\["0\.1Y", "0\.2Y", "0\.25Y", "0\.3Y"[^\]]+"1Y"\]/);
  assert.match(app, /POLICY_CURVE_KEY_TERMS = new Set\(\["0\.1Y", "0\.25Y", "0\.3Y", "0\.5Y", "0\.75Y", "1Y"\]\)/);
  assert.match(app, /node\?\.method === "derived-linear"/);
  assert.match(app, /loadPolicyCurve\(\{ refresh: true \}\)/);
  assert.match(styles, /\.ledger-command-bottom\s*\{[^}]*grid-template-columns:[^}]*align-items:\s*stretch;/s);
  assert.match(styles, /\.ledger-filter-bar\s*\{[^}]*display:\s*grid;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.policy-curve-card\s*\{[^}]*grid-template-columns:\s*minmax\(142px, auto\)\s+minmax\(0, 1fr\)/s);
  assert.match(styles, /\.policy-curve-points\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
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

test("exposes unified reminders to the Android bridge", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /function syncAndroidReminders/);
  assert.match(app, /window\.Tempest07Android/);
  assert.match(app, /bridge\.syncReminders/);
  assert.match(app, /syncAndroidReminders\(reminders\)/);
  assert.match(app, /function parseRouteFromHash/);
  assert.match(app, /params\.get\("target"\)/);
  assert.match(app, /route\.kind === "project-result"/);
});

test("ships Android shell and debug APK workflow", async () => {
  const [manifest, buildGradle, mainActivity, receiver, reminderSync, syncReceiver, reminderApi, workflow, readme] = await Promise.all([
    readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
    readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/MainActivity.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/ReminderReceiver.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/ReminderSync.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/com/tempest07/bondcentre/ReminderSyncReceiver.java", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/reminders.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/android-debug.yml", import.meta.url), "utf8"),
    readFile(new URL("../android/README.md", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(buildGradle, /namespace "com\.tempest07\.bondcentre"/);
  assert.match(buildGradle, /applicationId "com\.tempest07\.bondcentre"/);
  assert.match(mainActivity, /https:\/\/tempest07\.com\/bond-centre\//);
  assert.match(mainActivity, /addJavascriptInterface\(new AndroidBridge\(\), "Tempest07Android"\)/);
  assert.match(mainActivity, /ReminderSyncReceiver\.schedulePeriodicSync\(this\)/);
  assert.match(receiver, /CHANNEL_ID = "bond-centre-reminders"/);
  assert.match(reminderSync, /routeUrl\(item\)/);
  assert.match(reminderSync, /appendQueryParam\(builder, "kind"/);
  assert.match(syncReceiver, /https:\/\/tempest07\.com\/api\/reminders/);
  assert.match(syncReceiver, /CookieManager\.getInstance\(\)\.getCookie/);
  assert.match(reminderApi, /buildUnifiedReminders/);
  assert.match(readme, /background sync/);
  assert.match(workflow, /Android Debug APK/);
  assert.match(workflow, /gradle -p android :app:assembleDebug --no-daemon/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(readme, /tempest07-bond-centre-debug-apk/);
});
