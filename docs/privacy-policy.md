# Privacy Policy — AccountingV2

_Last updated: 2026-04-18_

## Who we are

AccountingV2 is a personal budgeting app developed by Henza Kruger (henzardkruger@gmail.com). This policy applies to the Android app published on Google Play under the package name `com.henza.accountingv2`.

## What data we collect

### Data you enter

- Email address and password (used for authentication via Supabase Auth).
- Household budget data: envelope names, allocated amounts, transaction amounts, payees, and descriptions.
- Income figures and payday configuration.

### Data collected automatically

- Crash reports via Firebase Crashlytics. These include device model, OS version, app version, and a stack trace. They do not include personally identifiable information unless it appears in a log message (we do not log PII).
- **FCM push token:** If you grant notification permission, your device's Firebase Cloud Messaging (FCM) token is stored in our Supabase database. It is used solely to deliver budget coaching notifications to your device. You can revoke this at any time by disabling notifications in Settings.
- Anonymous usage events are not currently collected.

## Slip scanning (AI feature)

If you use the slip-scanning feature, a photo of your till slip is sent to OpenAI's API for text extraction. The image is transmitted over TLS and is subject to OpenAI's data usage policies. Images are not stored on our servers after the extraction response is returned. We recommend cropping or obscuring your name, card number, and loyalty details before scanning.

## How we store data

- **On-device:** Budget data is stored in a SQLite database on your device. The database is not included in Android backups (`android:allowBackup="false"`). The database is not currently encrypted (see our [security decisions](./security-decisions.md) for rationale and roadmap).
- **In the cloud:** Data is synced to a Supabase PostgreSQL database hosted in the EU (Frankfurt). All connections use TLS 1.2+. Row-level security policies restrict each household to its own data.
- **Credentials:** Authentication tokens are stored in Android Keystore-backed secure storage (`expo-secure-store`), not in plain SQLite.

## Data retention

- Your account and household data remain in the Supabase database until you delete your account.
- Firebase Crashlytics retains crash reports for 90 days.

## Sharing

We do not sell or share your personal data with third parties except:

- **Supabase** — database and authentication host (data processor).
- **OpenAI** — slip image processing (only when you use the scan feature).
- **Firebase / Google** — crash reporting and push notification delivery (FCM).

## Your rights

You may request deletion of your account and all associated data by emailing henzardkruger@gmail.com. We will process the request within 30 days.

## Children

This app is not directed at children under 13. We do not knowingly collect data from children.

## Changes

We will update this policy when we change data practices. the _Last updated_ date at the top will reflect changes.

## Contact

Henza Kruger — henzardkruger@gmail.com
