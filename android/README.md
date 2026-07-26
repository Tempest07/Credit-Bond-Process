# Tempest07 Bond Centre Android

Android shell for the Tempest07 Bond Centre workbench.

## What this version does

- Opens `https://tempest07.com/bond-centre/` inside an Android WebView.
- Keeps the Gateway login flow inside the app for `tempest07.com`.
- Uses a full-screen WebView shell without browser-style title, refresh, or duplicate native navigation bars.
- Hides the Android status bar while keeping the system navigation gesture available; a top-edge swipe can reveal the status bar temporarily.
- Activates the web workbench's Android layout: compact page title, one icon navigation dock, and a More sheet for screenshot import, database, DM, rules, and data actions.
- Supports file upload from WebView forms.
- Receives the web app's unified reminders through `Tempest07Android.syncReminders(...)`.
- Posts local Android notifications for immediate reminders and schedules simple local alarms for dated reminders.
- Periodically fetches `https://tempest07.com/api/reminders` through WorkManager with the saved Gateway session cookie, so reminder sync survives app exits and device restarts.
- Opens reminder notifications back into the relevant workbench module, such as the project ledger or secondary trading centre.
- Rejects external intent URLs before they reach the WebView and its JavaScript bridge.

## Build

### GitHub Actions debug APK

Pushes to `main` or `codex/android-*` that touch the Android app or reminder bridge run the `Android Debug APK` workflow. After it finishes, open the workflow run in GitHub Actions and download the `tempest07-bond-centre-debug-apk` artifact. The artifact contains:

```text
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/apk/debug/app-debug.apk.sha256
```

You can also start the workflow manually from GitHub Actions with `Run workflow`.

### Local development build

Install Android Studio with Android SDK 35 and JDK 17, then run from this folder:

```powershell
gradle :app:assembleDebug
```

Or open this `android` folder in Android Studio and run the `app` configuration.

This repository does not currently include a Gradle wrapper. Generate one from Android Studio if you want reproducible CLI builds:

```powershell
gradle wrapper --gradle-version 8.7
```

## Current limitation

Notifications are still local to the device. WorkManager makes periodic refresh resilient, but Android may defer background work to protect battery life. A later version should add FCM push for reminders that must arrive immediately.
