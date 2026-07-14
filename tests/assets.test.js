import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const VERSION = "20260714-mobile-ledger";

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
  assert.match(app, new RegExp(`date-picker\\.js\\?v=${VERSION}`));
  assert.match(historyParser, new RegExp(`core\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`lifecycle\\.js\\?v=${VERSION}`));
  assert.match(reminders, new RegExp(`protocol-transfer\\.js\\?v=${VERSION}`));
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

test("lets short project lists expand without internal scrolling", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /SHORT_PROJECT_LIST_LIMIT = 3/);
  assert.match(app, /classList\.toggle\("is-short-list", isShortList\)/);
  assert.match(app, /function keepSelectedProjectCardClear[\s\S]+activeBottom \+ clearance > visibleBottom/);
  assert.match(styles, /\.project-list\s*\{[^}]*padding:\s*0 4px 14px 0;[^}]*scroll-padding-block:\s*12px;/s);
  assert.match(styles, /\.project-list\.is-short-list\s*\{[^}]*max-height:\s*none;[^}]*padding:\s*0;[^}]*overflow:\s*visible;/s);
  assert.match(styles, /\.project-item\s*\{[^}]*scroll-margin-block:\s*12px;/s);
  assert.match(styles, /\.project-list\.liquid-track::before\s*\{[^}]*box-sizing:\s*border-box;/s);
  assert.match(styles, /\.project-list-panel\.has-short-list\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s);
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
