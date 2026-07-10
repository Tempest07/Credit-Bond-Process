# Tempest07 Bond Centre Android

First Android shell for the Tempest07 Bond Centre workbench.

## What this first version does

- Opens `https://tempest07.com/bond-centre/` inside an Android WebView.
- Keeps the Gateway login flow inside the app for `tempest07.com`.
- Provides native quick tabs for Reminders, Ledger, New Project, Protocol Transfer, and Inventory.
- Supports file upload from WebView forms.
- Receives the web app's unified reminders through `Tempest07Android.syncReminders(...)`.
- Posts local Android notifications for immediate reminders and schedules simple local alarms for dated reminders.
- Periodically fetches `https://tempest07.com/api/reminders` with the saved Gateway session cookie so reminders can refresh after login even when the workbench page is not currently open.

## Build

### GitHub Actions debug APK

Pushes that touch the Android app or the reminder bridge run the `Android Debug APK` workflow. After it finishes, open the workflow run in GitHub Actions and download the `tempest07-bond-centre-debug-apk` artifact. The artifact contains:

```text
android/app/build/outputs/apk/debug/app-debug.apk
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

Notifications are still local to the device. The first version refreshes reminders when the app opens the Bond Centre page and through a best-effort background sync. A later version should add FCM push for reminders that must arrive even if Android has stopped background work for the app.
