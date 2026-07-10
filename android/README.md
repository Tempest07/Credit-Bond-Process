# Tempest07 Bond Centre Android

First Android shell for the Tempest07 Bond Centre workbench.

## What this first version does

- Opens `https://tempest07.com/bond-centre/` inside an Android WebView.
- Keeps the Gateway login flow inside the app for `tempest07.com`.
- Provides native quick tabs for Reminders, Ledger, New Project, Protocol Transfer, and Inventory.
- Supports file upload from WebView forms.
- Receives the web app's unified reminders through `Tempest07Android.syncReminders(...)`.
- Posts local Android notifications for immediate reminders and schedules simple local alarms for dated reminders.

## Build

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

Notifications are local and are refreshed when the app opens the Bond Centre page and receives reminder data from the web app. A later version should add a backend reminder endpoint and FCM push for reminders that must arrive when the app has not been opened recently.
