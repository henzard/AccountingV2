# Privacy Policy — AccountingV2

_Last updated: 2026-09-20_

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

## Deleting your account

You can delete your account from inside the app: **Settings → Delete account**. You will be asked to type `DELETE` to confirm. The deletion runs immediately — there is no waiting period and no email required. It needs an internet connection, because the data is erased on our servers, not just on your phone.

### What is deleted

- Your sign-in account (email and password) with Supabase Auth.
- Your push-notification (FCM) device tokens, so no further notifications can reach you.
- Your slip-scanning consent record and your theme preference.
- Internal rate-limiting records tied to you (failed invite-code attempts, slip-scan attempts).
- The till-slip photos you uploaded for scanning.
- Your membership of every household you belong to.
- Everything stored on the device itself: the local SQLite database is wiped and you are signed out.

### What happens to a shared household

Budget data belongs to the household, not to one person, so when you leave a household that still has other members, **the household's envelopes, transactions, debts and history stay with the remaining members**. Only your link to it is removed. Specifically:

- If you were the household's last owner, **ownership passes automatically to the longest-standing remaining member**, so the household is never left without an owner.
- Your name is removed from anything you created that the remaining members still see — invitations you sent and slips you scanned are re-attributed to an anonymous placeholder.

If you were the **only** member of a household, nobody can reach that household's data again once your membership is removed: every access rule in our database is scoped through an active membership. The rows themselves are then purged on our retention schedule.

## Data retention

- Your account and household data remain in the Supabase database until you delete your account.
- Household data left with no members after an account deletion is unreachable immediately and purged on our retention schedule.
- Firebase Crashlytics retains crash reports for 90 days. Crash reports are not linked to your account and are not removed by an account deletion; they expire on their own 90-day schedule.

## Sharing

We do not sell or share your personal data with third parties except:

- **Supabase** — database and authentication host (data processor).
- **OpenAI** — slip image processing (only when you use the scan feature).
- **Firebase / Google** — crash reporting and push notification delivery (FCM).

## Your rights

You can delete your account and all associated data yourself, at any time, from **Settings → Delete account** in the app — see [Deleting your account](#deleting-your-account) for exactly what that removes and what stays with a shared household. If you cannot reach that screen, or you want a copy of your data first, email henzardkruger@gmail.com and we will process the request within 30 days.

## Children

This app is not directed at children under 13. We do not knowingly collect data from children.

## Changes

We will update this policy when we change data practices. the _Last updated_ date at the top will reflect changes.

## Contact

Henza Kruger — henzardkruger@gmail.com
