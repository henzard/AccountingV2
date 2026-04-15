# AccountingV2 — User Guide

A zero-based envelope-budgeting app built on Dave Ramsey's Baby Steps.
Version 1.1.x, Android (internal testing track).

---

## What this app is

AccountingV2 helps you do three things:

1. **Budget every Rand before payday** into named "envelopes" (Groceries, Rent, Transport, …) so every Rand has a job before the month starts.
2. **Work through Ramsey's 7 Baby Steps** in order — starter R1 000 emergency fund first, then debt snowball, then the bigger moves.
3. **Log daily spend in under 10 seconds** — either by typing an amount or by photographing a till slip.

The app is offline-first: you can capture transactions, adjust envelopes, and mark steps complete with no signal. Everything syncs to the cloud when you're back online.

---

## Getting started

### 1. Sign up

Open the app → tap **Sign up** → enter email + password. A magic-link confirmation is emailed; tap it once and return to the app.

### 2. Create or join a household

- **Starting fresh**: tap **Create household**, give it a name ("The Smiths"), and you're the owner.
- **Joining someone else's**: they send you an 8-character invite code (from their Settings → Household → Share invite). Tap **Join household**, paste the code, done.

Everyone in a household shares the same envelopes, transactions, and Baby-Step progress.

### 3. Complete onboarding (~12 minutes)

You'll answer these questions once:

1. **Monthly income** (after tax).
2. **Payday day of month** (1–31). The app uses this to reset envelopes each cycle.
3. **Expense categories** you care about — pick from a list (Groceries, Rent, Transport, …) or add your own.
4. **Utility meters** (optional) — water, electricity, gas. Useful if you track usage + cost.
5. **How the Ramsey Score works** — a quick explainer of the 0–100 habit score.

When you tap **Go to Dashboard**, the app is live.

> **Heads-up:** right now each envelope starts with a placeholder allocation of R0.01. Tap any envelope on the Dashboard to set its real allocation. _(A proper split-your-income wizard is on the roadmap.)_

---

## Daily use

### Logging a transaction

1. Dashboard → tap the envelope you spent against → **Log payment** or **Add transaction**.
2. Enter the amount in Rand (the app does cents internally — type `125.50`).
3. Add a short description ("Pick 'n Pay, milk + eggs").
4. Save.

Your envelope's **Remaining** drops, and the Ramsey Score nudges up for logging-today.

### Scanning a till slip (optional, consent-gated)

1. Dashboard → camera FAB (top right).
2. First time only: read the consent screen and tap **I agree** (image is sent to OpenAI for extraction, kept for 30 days, then auto-deleted).
3. Point at the slip, capture. Multi-shot is supported for long slips.
4. The app extracts merchant, date, total, and line items. Review on the confirm screen, pick the envelope(s), save.

Offline? The slip queues and processes next time you have signal.

### Adjusting envelopes

- **Add one**: Budget tab → + FAB → name, allocation, type (expense / emergency fund / baby-step).
- **Edit**: tap the envelope → edit allocation.
- **Delete**: edit screen → delete button. Deletes sync across household members.

### Meter readings

Settings → Meters → your meter → **Add reading**.
Log the current reading (e.g. 12 345 kWh). The app computes usage since last reading and, with your tariff, the cost. Weekly reminders are on by default.

### Baby Steps

Bottom nav → **Steps** tab.

- The card at the top shows your **current step**. Tap it to see sub-tasks.
- Steps 1, 2, 3 advance automatically: Step 1 completes when your EF envelope hits R1 000; Step 2 when all non-mortgage debts are cleared; Step 3 when EF hits 3–6 months of expenses.
- Steps 4, 5, 7 are manual toggles — tap "Mark complete" when you've done them (retirement invested 15 %, college fund started, giving generously).
- Each completion triggers a celebration modal. First one's on the house.

### Debt snowball

Settings → Debts → **Add debt** (name, balance, minimum payment).
The app sorts smallest-balance-first and projects your payoff month-by-month. When a debt clears, its minimum rolls into the next smallest — the snowball.

Log a payment: tap the debt → **Log payment**.

---

## Ramsey Score

Out of 100, refreshed when you open the app.

| Component           | Weight | How to earn it                                             |
| ------------------- | ------ | ---------------------------------------------------------- |
| Logging consistency | 30     | Log at least one transaction per day, several days a week. |
| Envelope discipline | 30     | Keep spend ≤ allocation; overspending drops this fast.     |
| Meter readings      | 20     | A reading per meter per month.                             |
| Baby Step active    | 20     | Having a current step in progress (nearly automatic).      |

**Reality check:** this is a _habit_ score, not a pure Ramsey-adherence score. High score ≠ debt-free — it means you're using the app regularly and staying within budget.

---

## Settings tour

- **Profile** — name, email, sign out.
- **Household** — members, share invite, leave.
- **Notifications** — evening log reminder time, meter reading day, month-start preflight.
- **Meters** — add/edit meters and rates.
- **Debts** — add/edit debts, reorder snowball priority.
- **Privacy** — slip-scan consent, data export.
- **Crash log** _(dev builds)_ — read the last startup crash if the app restarted unexpectedly.

---

## Troubleshooting

**"Your budget is ready" button doesn't open the dashboard.**
Force-quit and reopen. Fixed in versions ≥ `1.1.24+46d5fdc` — update via Play Store.

**App crashes on launch.**
Reopen once: the boot-recovery screen will show you the crash with a **Share** button — send it to support. Then tap **Clear & continue** to try again.

**Envelopes all show R0.01 allocated.**
That's the current seed default (known gap). Tap each envelope → edit → set your real allocation. A proper wizard is coming.

**Slip scan hangs on "Processing".**
Needs network; if you captured offline, it'll auto-resume next time you have signal. If it stays stuck >5 min with signal, it's been flipped to _failed_ and you can retry from Settings → Slip queue.

**Invited a member but they don't see our transactions.**
Known issue — there are two household-membership tables being reconciled. Track the fix in `docs/superpowers/plans/2026-04-13-codebase-hardening.md` Phase A.

**"Household is locked" when I try to edit.**
Sign out and back in. Session state got stuck.

---

## What's next (roadmap visible to users)

Near-term (shipping now):

- Dashboard "Add transaction" FAB
- Real allocation wizard during onboarding
- Household-sync reliability fixes (Phase A hardening)

Later:

- Encrypted local database
- iOS build
- CSV / JSON data export
- Family-chat-style notes on transactions

---

## Support

- Bug reports: GitHub issues at the project repository.
- Privacy questions: data handling details are in [privacy policy link].
- Crash details: Settings → Crash log (dev builds) or Firebase Crashlytics (auto-submitted).

---

_Last updated: 2026-04-15. This guide is intentionally short; if you want the how-it-works internals, see `README.md` + `docs/superpowers/specs/`._
