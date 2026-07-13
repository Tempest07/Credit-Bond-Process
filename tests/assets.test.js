import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const VERSION = "20260713-ledger-command-deck";

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
