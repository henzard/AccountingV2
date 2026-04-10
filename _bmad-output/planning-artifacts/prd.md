---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish]
inputDocuments: ['_bmad-output/brainstorming/brainstorming-session-2026-04-09-1800.md']
workflowType: 'prd'
brainstormingCount: 1
briefCount: 0
researchCount: 0
projectDocsCount: 0
classification:
  projectType: mobile_app
  domain: fintech-personal-finance
  complexity: medium-high
  projectContext: greenfield
---

# Product Requirements Document - AccountingV2

**Author:** Henza
**Date:** 2026-04-09

## Executive Summary

AccountingV2 is an offline-first React Native mobile application for personal financial stewardship, built on Dave Ramsey's zero-based budgeting and envelope methodology. It serves South African households at every level of financial literacy — from complete beginners who have never managed a budget independently, to practitioners managing their own households without external support.

The app was born from a real-world need: existing budgeting tools are too complex for people who need them most. The target user is not a finance enthusiast — it is someone who currently depends on a family member or spreadsheet to manage their money, and who needs to be taught to think differently about money, not just given another tool they will abandon. AccountingV2 meets users where they are and grows with them through a progressive learner-level system, moving them from guided dependence to genuine financial autonomy.

The core mission is not feature delivery — it is financial freedom rooted in the biblical principle of stewardship: ruling over money, not being ruled by it. Every design decision serves this mission. The app does not connect to banks, does not auto-import transactions, and does not make spending easy to ignore. It demands intentionality, and rewards it.

**Target Users:**
- **Level 1 — Learner:** Low financial literacy, first-time budgeter, requires full onboarding wizard, guided decision-making, mentor visibility, and heavy gamification to build habit
- **Level 2 — Practitioner:** Intermediate financial literacy, self-managing household, uses full feature set without hand-holding, benefits from AI coaching and analytics
- **Level 3 — Mentor:** Advisor to a linked learner household, read-access visibility, able to support and guide without controlling

**Platform:** React Native (iOS + Android), SQLite local storage (source of truth), Supabase cloud sync (periodic, conflict-resolved), offline-first architecture — 100% functional without connectivity.

### What Makes This Special

**The Wizard + The Guide:** Every other budgeting app drops users into a dashboard and expects them to figure it out. AccountingV2 opens with a structured onboarding wizard that walks the user through their first budget, first envelopes, and first meter readings — then stays present through proactive coaching messages, meter reading reminders, and contextual nudges. The app comes to the user. The user does not have to remember to open it.

**The Levelling System:** Users do not choose their complexity level — they earn it. Starting at Level 1, consistent logging, budget adherence, and Baby Step milestones unlock increased autonomy and reduced guidance. The Ramsey Score (a private monthly discipline score) is the character level. Financial literacy is treated as a skill that develops over time, not a prerequisite for using the app.

**Utility + Financial Integration:** No personal finance app tracks physical utility consumption. AccountingV2 treats electricity (kWh), water (litres), and vehicle distance (km) as first-class budget dimensions — recording readings, calculating unit rates, tracking tariff changes over time, and detecting anomalies. The app separates "you used more" from "it got more expensive" — a distinction that has real household financial impact in South Africa.

**AI-Powered Capture at Scale:** A photograph of a till slip, municipal statement, or invoice is transformed into structured financial data via OpenAI Vision — capturing items at line level, not just category totals. What you spent on meat vs. vegetables is known. Your personal inflation index, built from your actual shopping basket over time, is tracked. A WhatsApp/Telegram bot extends capture to any moment, any device, with or without the app open.

**Strict by Design:** The conversational budget advisor does not optimise for user satisfaction — it optimises for user freedom. "Can I go out with the girls tonight?" triggers clarifying questions, an honest assessment against actual budget position, and a required trade-off decision. Comfortable answers are not offered when the budget does not support them.

**South African by Design:** Prepaid electricity token scanning, municipal statement OCR, SA school-fee calendar intelligence, rand-denominated household benchmarks, and a WhatsApp-first capture channel are built for the country where this app will be used — not adapted from an American template.

## Project Classification

| Attribute | Value |
|-----------|-------|
| **Project Type** | Mobile App — React Native, cross-platform (iOS + Android) |
| **Domain** | Fintech — Personal Finance & Household Stewardship |
| **Complexity** | Medium-High (AI integration, offline-first sync, multi-user households, OCR pipeline, WhatsApp bot infrastructure) |
| **Project Context** | Greenfield — no existing codebase |
| **Architecture** | Offline-first: SQLite (local truth) + Supabase (sync + backup) |
| **Primary Integrations** | OpenAI Vision API, Supabase, WhatsApp/Telegram Bot Webhook |

## Success Criteria

### User Success

**The definitive success signal for a Learner (Level 1) user:**
A user who previously called family for every financial decision checks their own budget independently, makes a spending decision without assistance, and completes their first Dave Ramsey Baby Step. This is the human outcome the product exists to create.

**Measurable user success milestones:**

| Milestone | Target | What It Proves |
|-----------|--------|----------------|
| Onboarding completion | First budget and envelopes set up within 15 minutes of first launch | Wizard works — complexity barrier eliminated |
| First independent decision | User checks budget and makes a spend/no-spend call without assistance within 30 days | Core habit forming |
| 21-day logging streak | Transactions or meter readings logged for 21 consecutive days | Habit formation threshold crossed |
| First Baby Step completed | Emergency fund or debt payoff milestone reached | Real financial progress, not just tracking |
| Zero-assistance month | Learner user manages full month without calling mentor | The product has done its job |
| Meter reading habit | Monthly readings logged without reminder prompt by month 3 | Utility tracking embedded in routine |

**The "aha" moment:** The first time a user opens the app to check if they can afford something — and trusts the answer — instead of guessing or calling someone.

### Business / Mission Success

AccountingV2 is mission-driven, not revenue-driven. Business success is measured in household impact, not commercial metrics.

- **3-month target:** Both pilot households (Henza + sister) fully operational — budgets active, envelopes in use, meter readings logging
- **6-month target:** Sister's household self-managing — one full month completed without external financial guidance
- **12-month target:** At least one Baby Step completed per household; net worth tracking showing positive trajectory; app opened at minimum 3x per week consistently
- **Retention signal:** App still in daily use at 90 days (the graveyard zone where every budgeting app dies)

### Technical Success

| Requirement | Standard | Rationale |
|-------------|----------|-----------|
| **Data integrity** | Zero data loss, ever | SQLite is source of truth — Supabase is backup, never primary |
| **Offline functionality** | 100% of core features available without connectivity | Offline-first is a promise, not a fallback |
| **Sync conflict resolution** | GUIDs on all entities, last-write-wins | Simple, predictable, auditable — no merge complexity in MVP |
| **Sync speed** | Supabase sync completes within 30 seconds of connectivity detection | User never waits for sync to proceed |
| **Slip processing** | OpenAI Vision response within 10 seconds per slip | Fast enough to process at point of purchase |
| **Queue processing** | All queued slips processed within 60 seconds of connectivity | Offline capture feels seamless on reconnect |
| **App launch** | Cold start under 3 seconds on mid-range Android device | Accessibility for non-flagship hardware |

### Measurable Outcomes

- Learner completes first Baby Step within 12 months of consistent use
- Logging streak of 21+ days achieved within first 60 days
- Monthly Ramsey Score trend is positive by month 3
- Zero sync-related data loss incidents
- Slip scanning accuracy ≥ 90% on clear till slip photographs

## Product Scope

### MVP — Phase 1: The Foundation

*Must work before the app is useful to anyone.*

- **Core envelope budgeting** — envelope creation, fund allocation, spending against envelopes, savings-first flow
- **Manual transaction entry** — 3-tap quick entry, categories, notes
- **Meter readings** — water, electricity, vehicle odometer; unit + amount entry; rate calculation; monthly tracking
- **Baby Steps tracker** — visual progress bar, current step display, milestone logging
- **Debt snowball tracker** — debt entry, payment logging, animated payoff visualisation
- **Offline-first sync** — SQLite local storage, Supabase periodic sync, GUID-based last-write-wins conflict resolution
- **AI slip scanning** — OpenAI Vision integration, item-level extraction, async offline queue, auto-categorisation
- **Onboarding wizard** — guided first-budget setup, envelope creation walkthrough, meter reading setup
- **Basic notifications** — meter reading reminders, envelope balance warnings, month-start pre-flight checklist prompt

### Phase 2 — Growth: Intelligence Layer

*What makes it differentiated and sticky.*

- **Coaching nudges** — pattern-aware text messages referencing actual user history and behaviour
- **WhatsApp/Telegram bot** — text and image capture via webhook server; slip image processing via bot
- **Utility rate intelligence** — historical tariff tracking, rate inflation surfacing, tariff alert notifications, anomaly detection
- **Business expense tracking** — personal-to-business tagging, claim lifecycle, split transactions, VAT extraction, SARS-ready year-end report
- **Sinking fund manager** — targets, due dates, auto-contribution calculation
- **Seasonal budget templates** — named configurations, one-tap activation
- **90-day cash flow forecast** — projection from recurring expense patterns
- **Commitment contracts** — self-bet mechanics with auto-routing of penalties to snowball
- **Crisis Budget Mode** — one-tap discretionary lockdown

### Phase 3 — Vision: The Full Ecosystem

*The dream version — built once the foundation is proven.*

- **Learner levelling system** — earned progression from Level 1 to Level 2; Ramsey Score as character level; unlocked autonomy
- **Family network / household hierarchy** — linked households, mentor read access, spin-off households for grown children
- **Full AI advisor** — conversational "Ask Dave" against personal data; strict budget advisor; "What Would Dave Say?" pre-purchase check
- **SA household benchmarks** — opt-in anonymised comparison against real South African household data
- **Quarterly + Annual Financial Review** — Wrapped-style reports with full year summary
- **Net Worth milestone celebrations** — permanent dated milestones at round-number thresholds
- **Financial Memory Palace** — full-text search across entire financial history
- **The Family Financial Blueprint** — one-page master plan anchoring all coaching and decisions
- **Personal Best Tracker** — all-time records per metric, compete against yourself only


## User Journeys

### Journey 1: Thandi — The Learner's First 30 Days

**Thandi, 28. Primary school teacher. Johannesburg.**
She earns a salary, has a clothing account she should not, and genuinely does not know where her money goes each month. Every financial decision she calls her sister. She is not stupid. She is untaught. She has tried two budgeting apps. Both lasted four days.

**Opening Scene — Day 1:**
Her sister installs AccountingV2 and sits with her for 20 minutes. The onboarding wizard opens — not a dashboard, not a spreadsheet. A conversation. "Hi Thandi. Let us set up your money. How much do you earn each month?" One question at a time. She enters her salary. The wizard asks what she needs to pay first — rent, groceries, transport. It builds her envelopes as she talks. At the end of the wizard, she has a budget. It took 12 minutes. She has never had a budget before.

**Rising Action — Days 2–14:**
A notification arrives at 7pm: "Thandi, did you spend anything today? Takes 10 seconds." She opens the app, taps the grocery envelope, enters R89. Done. Day 7, she realises she has R1,200 left in groceries and two weeks to go. She has never known this before. Week 2 — she opens the app in the car before going into the shops. She does not buy the fancy yoghurt. She drives home feeling like she won something small.

**Climax — Day 21:**
Her sister calls — not about money. Thandi mentions she checked her budget before agreeing to a weekend trip. Her sister did not need to be consulted. Thandi made the decision.

**Resolution — Day 30:**
Month end. Ramsey Score: 61. The app shows: "You logged 24 out of 30 days. Your grocery spend was R200 under budget. You saved R400 this month. That is your first step toward a R5,000 emergency fund." She screenshots it and sends it to her sister.

**Capabilities Revealed:** Onboarding wizard, 3-tap daily entry with evening prompt, envelope balance visibility, 21-day streak tracking, month-end Ramsey Score, Baby Steps progress tracking.

---

### Journey 2: Henza — The Practitioner's Monthly Cycle

**Henza, household head. Two-income home. Pretoria.**
Understands Ramsey principles. Currently manages household budget in a spreadsheet. Does not need to be taught — needs a tool that does not slow her down.

**Opening Scene — 25th of the Month (Payday):**
Notification: "Payday! Time to fill your envelopes. Pre-flight checklist ready." Five questions, 4 minutes. Budget month is live.

**Rising Action — Month in Progress:**
Day 3 — petrol station. Scans the till slip. OpenAI extracts: 52.4L at R24.80/L = R1,300.52. Hits transport envelope automatically. Odometer entered: 87,420km. Cost-per-km: R1.84/km. Running average: R1.79/km. Slight upward trend flagged over 3 months.

Day 8 — electricity meter reading: 4,892 kWh. Previous: 4,710 kWh. Usage: 182 kWh at R2.89/kWh = R525.98. Budget: R600. On track.

Day 14 — grocery scan. Checkers slip: R1,847. OpenAI extracts 34 line items. App flags: "Meat spend is 39% of your grocery budget so far this month, with 16 days remaining. Your typical mid-month meat spend is 28%."

**Climax — Day 16:**
Henza adjusts — mince instead of rump for two weeks. R180 saved. Redirected to debt snowball. Small decision. Deliberate.

**Resolution — Month End:**
Ramsey Score: 84. Snowball payment: R2,400. Running total paid off this year: R18,700. Debt-free date projection: 14 months. Net worth up R3,200.

**Capabilities Revealed:** Pre-flight monthly checklist, AI slip scanning with line-item extraction, odometer + fuel integration, meter reading entry with cost calculation, mid-month spending pattern alerts, debt snowball tracker with debt-free date projection, month-end summary.

---

### Journey 3: Thandi — The Empty Envelope Crisis

**Same Thandi. Month 3. Friday afternoon.**

**Opening Scene:**
Friends plan a birthday dinner. Estimated cost: R350. Entertainment envelope: R80. Three weeks until month end.

**Rising Action:**
She types into the app: "Can I go to a birthday dinner that will cost R350?" Advisor: "Your entertainment envelope has R80. You need R270 from somewhere. Which envelope would you borrow from — and what would you cut?" She looks at clothing: R420 remaining. Advisor: "If you borrow R270 from clothing, your clothing budget drops to R150. Can you commit to no clothing purchases? If yes, I will make the adjustment."

**Climax:**
She commits. App moves R270 from clothing to entertainment. Records reallocation with note. She goes. Spends R320. Logs it herself when she gets home, unprompted.

**Resolution:**
Month end. Clothing: R180 remaining. Entertainment: R0. Ramsey Score: 74. The discipline held. She borrowed correctly, not recklessly.

**Capabilities Revealed:** Conversational strict budget advisor, mid-month envelope reallocation with recorded rationale, real-time balance visibility during decision-making, post-event transaction logging.

---

### Journey 4: The Bot Capture — Slip on the Go (Phase 2)

**Henza. Hardware store. No time to open the app.**

**Opening Scene:**
Buys R840 of plumbing supplies — personal card, rental property expense. Queue behind her at the till.

**Rising Action:**
Photographs the till slip. Sends to AccountingV2 WhatsApp bot. 8 seconds: "Got it. Extracting." 20 seconds: "Found: Plumbing supplies — R840. Business expense? Claimable?" She replies: "Yes, business, claimable from rental property."

**Resolution:**
Slip logged. Business claim created. Slip image attached. She drives home. Zero friction.

**Capabilities Revealed:** WhatsApp/Telegram bot webhook, image extraction via bot, business expense tagging via conversation, claim record creation with slip image.

---

### Journey Requirements Summary

| Capability Area | Revealed By |
|----------------|-------------|
| Onboarding wizard | Journey 1 |
| Daily transaction entry + evening nudges | Journey 1, 2 |
| Envelope balance home screen | Journey 1, 3 |
| AI slip scanning + line-item extraction | Journey 2 |
| Meter readings + rate calculation | Journey 2 |
| Cost-per-km engine | Journey 2 |
| Spending pattern alerts | Journey 2 |
| Debt snowball + debt-free projection | Journey 2 |
| Monthly Ramsey Score + summary | Journey 1, 2 |
| Conversational strict budget advisor | Journey 3 |
| Mid-month envelope reallocation | Journey 3 |
| WhatsApp/Telegram bot capture | Journey 4 |
| Business expense tagging + claim creation | Journey 4 |
| Baby Steps tracker | Journey 1 |
| Pre-flight monthly checklist | Journey 2 |

## Domain-Specific Requirements

### Compliance & Regulatory

**POPIA (Protection of Personal Information Act - South Africa)**
- AccountingV2 operates as a personal-use application with a single data controller (the household owner). No third-party access to user financial data.
- Financial data stored in Supabase is isolated per household via Row Level Security (RLS). No data is shared across households or accessible to any party other than the authenticated household owner.
- App must include a clear disclosure at onboarding: financial data is stored locally (SQLite) and synced to Supabase under the user's account. Till slip images are processed by OpenAI Vision for data extraction.

**SARS Business Expense Documentation**
- Business expense claims generated by the app must meet SARS audit requirements: supplier name, date of transaction, total amount, VAT amount (where applicable), VAT registration number of supplier (extracted from slip), and a documented business purpose.
- Slip images must be stored and retrievable as primary evidence. The generated claim report (PDF/CSV) is a summary only - the image is the legal record.
- Year-end reports must be groupable by tax year (1 March to 28/29 February) in addition to calendar year.

### Technical Constraints

**Data Security**
- All Supabase communication over TLS 1.2+ - no plaintext financial data in transit.
- Supabase Row Level Security enforced at database level - no application-layer-only access control.
- Local SQLite database encrypted at rest using SQLCipher (AES-256). Device PIN/biometric lock provides the additional authentication layer on app resume.
- OpenAI API calls over HTTPS. Only the slip image is transmitted - no household identity, user name, or account data accompanies the image.

**OpenAI Data Handling**
- User disclosure required at first slip scan: "Your till slip image will be sent to OpenAI for data extraction. No personal account information is included. OpenAI's data usage policy applies."
- Slip images are not stored by the app on Supabase - only the extracted structured JSON is persisted. Raw images are processed and discarded after extraction.
- Exception: Business expense slip images are retained as SARS documentation and stored in Supabase attached to the claim record.

**Privacy by Design**
- No analytics, tracking, or telemetry - the app collects no usage data beyond what the user explicitly enters.
- No advertising identifiers, no crash reporting services that transmit personal data.

### Integration Requirements

| Integration | Purpose | Data Transmitted | Security |
|-------------|---------|-----------------|----------|
| Supabase | Cloud sync + backup | All financial records (encrypted in transit, RLS at rest) | TLS + RLS |
| OpenAI Vision API | Slip + document extraction | Slip/document images only | HTTPS |
| WhatsApp/Telegram Webhook | Capture channel | Text messages + images | HTTPS webhook |

### Risk Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Device lost/stolen - local data exposed | Medium | Device PIN/biometric lock is the control layer; advise users in onboarding |
| Supabase outage - sync unavailable | Low | SQLite is source of truth; app fully functional offline; sync retries on reconnect |
| OpenAI API unavailable - slip scanning fails | Medium | Slips queue locally; user notified; manual entry always available as fallback |
| OpenAI extraction inaccuracy | Medium | User reviews extracted items before confirming; manual correction always available |
| SARS audit - claim documentation insufficient | Low | Slip image retained as primary evidence; structured report is supporting summary only |

## Innovation & Novel Patterns

### Detected Innovation Areas

**Innovation 1: Physical Utility Consumption as a First-Class Financial Dimension**
Every personal finance app treats electricity, water, and fuel as spending categories - a rand amount in a bucket. AccountingV2 treats them as physical measurements (kWh, litres, kilometres) and derives financial cost from those measurements. This inversion separates two distinct causes of cost increases: behavioural (you used more) and systemic (the tariff went up). No personal finance app makes this distinction.

*Assumption challenged:* That budgeting is about money. For utilities, budgeting is about consumption - rand amounts are the output, not the input.
*Validation:* Meter readings logged for 3 months reveal whether users can identify tariff increases vs usage spikes from their own data.

**Innovation 2: Financial Literacy as an Earned Levelling System**
Every budgeting app has one mode. AccountingV2 introduces a progression model - users earn increased complexity and autonomy through consistent behaviour measured by the Ramsey Score. Financial literacy is treated as a skill that develops, not a prerequisite.

*Assumption challenged:* That app complexity is a setting users choose. Complexity should be unlocked through demonstrated behaviour.
*Validation:* Learner users complete full months without assistance within 90 days.

**Innovation 3: A Conversational Advisor That Refuses to Be Pleasing**
Every AI financial tool optimises for user satisfaction. AccountingV2's advisor optimises for user freedom. "Can I go out tonight?" is not answered with comfort if the budget does not support it. The strictness is the product.

*Assumption challenged:* That financial AI should make users feel good. Honest discomfort is the mechanism of behaviour change.
*Validation:* Users who receive strict responses make measurably different envelope reallocation decisions.

**Innovation 4: Personal Inflation Index from Till Slip Data**
AccountingV2 builds a personal inflation index from the user's actual shopping basket - items, stores, prices - tracked over time at line-item level through AI slip extraction. "Your personal inflation rate this year is 14.3%" is a statement no app can currently make for any individual.

*Assumption challenged:* That inflation is a macro-economic figure. For household decisions, only personal inflation matters.
*Validation:* After 6 months, the app surfaces meaningful price trends for at least 10 commonly purchased items.

**Innovation 5: WhatsApp as a Financial Data Capture Channel**
In South Africa, WhatsApp penetration exceeds dedicated app usage for many demographics. Making WhatsApp a first-class capture channel - text entry, slip scanning, bot confirmation - meets users where they are.

*Assumption challenged:* That a dedicated app is the right capture interface.
*Validation:* If WhatsApp captures exceed 20% of total transactions post Phase 2, the hypothesis is confirmed.

**Innovation 6: Mission-Pure Design**
Every competitor has a revenue motive that shapes feature decisions. AccountingV2 has none. "Mission Over Monetisation" is an architectural principle - features that exist to retain users rather than serve their freedom are excluded by design.

*Assumption challenged:* That an app needs a monetisation layer to be worth building.

### Market Context & Competitive Landscape

| Differentiator | EveryDollar | YNAB | 22seven | AccountingV2 |
|---------------|-------------|------|---------|--------------|
| Offline-first | No | No | No | Yes |
| Utility meter tracking | No | No | No | Yes |
| Item-level slip scanning | No | No | No | Yes |
| Learner levelling system | No | No | No | Yes |
| Strict conversational advisor | No | No | No | Yes |
| WhatsApp capture | No | No | No | Yes |
| SA-specific (school fees, tariffs, prepaid) | No | No | Partial | Yes |
| Mission-pure (no monetisation) | No | No | No | Yes |
| Bank integration required | Optional | Yes | Yes | Never |

### Validation Approach

| Innovation | Validation Signal | Timeframe |
|-----------|-----------------|-----------|
| Utility measurement model | User correctly identifies tariff hike vs usage spike from app data | Month 3 |
| Levelling system | Level 1 user completes full month without external help | Month 3 |
| Strict advisor | Different decisions made after advisor interaction vs without | Month 2 |
| Personal inflation index | 10+ items with meaningful price trend data | Month 6 |
| WhatsApp channel | >20% of transactions captured via bot | Post Phase 2 |

### Risk Mitigation

| Innovation Risk | Mitigation |
|----------------|-----------|
| Strict advisor causes user abandonment | Tone configurable (Tough Love / Encouraging / Neutral) - strictness is default, not forced |
| Levelling system feels patronising | Users can self-select starting level at onboarding; progression acceleratable |
| WhatsApp delays frustrate users | In-app capture always available; bot is additive, never the only path |
| OpenAI extraction errors undermine trust | User reviews and confirms every extracted slip before it is committed |
| Utility model too complex for learners | Simplified to "enter the number on your meter" - rate calculation hidden until Level 2 |

## Mobile App Specific Requirements

### Project-Type Overview

AccountingV2 MVP ships as an Android-only React Native application, distributed via Google Play, free with no in-app purchases. iOS support is planned for a future phase. The offline-first architecture is central to all technical decisions — no feature may be gated behind connectivity.

### Platform Requirements

| Requirement | Decision | Rationale |
|-------------|----------|-----------|
| **Framework** | React Native | Cross-platform codebase ready for iOS without rewrite |
| **Platform (MVP)** | Android only | Faster to ship; validates core product before iOS investment |
| **Minimum Android version** | Android 10 (API Level 29) | ~85% SA Android device coverage |
| **Target Android version** | Android 14 (API Level 34) | Current Play Store requirement |
| **iOS support** | Phase 2+ | Codebase ready; no additional development beyond platform config |
| **Distribution** | Google Play Store | No APK sideloading for MVP |
| **Pricing** | Free, no in-app purchases | Mission-pure — no monetisation layer |

### Device Permissions

| Permission | Purpose | Required |
|-----------|---------|----------|
| `CAMERA` | Till slip and document scanning | Required |
| `READ_MEDIA_IMAGES` | Access saved images for slip upload | Required |
| `POST_NOTIFICATIONS` | Reminders, coaching messages, alerts | Required |
| `RECEIVE_BOOT_COMPLETED` | Reschedule local notifications after restart | Required |
| `INTERNET` | Supabase sync, OpenAI API calls | Required (gracefully degraded) |

**Permission Philosophy:** Request at moment of first use, not app launch. Notification permission requested at end of onboarding wizard, framed as "Stay on track — let the app remind you."

### Offline Mode Architecture

| Layer | Technology | Role |
|-------|-----------|------|
| **Local database** | SQLite via `expo-sqlite` | Source of truth — all writes go here first |
| **Sync layer** | Supabase JS client | Periodic push/pull on connectivity |
| **Conflict resolution** | GUID-based, last-write-wins | Simple, predictable, no merge complexity |
| **Offline queue** | SQLite pending_sync table | Tracks unsynced records; cleared on successful sync |
| **Connectivity detection** | `@react-native-community/netinfo` | Triggers sync and queued OpenAI processing on reconnect |

**Offline Rules:** All core features work with zero connectivity. Slip scanning queues locally when offline. Supabase sync failure is silent — SQLite data is never lost. Last-sync timestamp visible in settings with manual sync option.

### Push Notification Strategy

**Local Scheduled (device-side, no connectivity required):**

| Notification | Trigger | Configurable |
|-------------|---------|--------------|
| Evening log prompt | Daily at user-set time (default 7pm) | Yes — time |
| Meter reading reminder | 1st of month or billing cycle date | Yes — date |
| Month-start pre-flight | Payday date | Yes — date |
| Envelope warning | Envelope drops below 20% remaining | Yes — threshold |
| Baby Step milestone | On milestone completion | No |

**Supabase-Triggered via FCM (requires connectivity):**

| Notification | Trigger |
|-------------|---------|
| Pattern-aware coaching message | Supabase function analyses sync data, pushes via FCM |
| Anomaly detection alert | Utility spike detected on sync |

FCM Integration: Firebase Cloud Messaging via `@react-native-firebase/messaging`. FCM token registered at launch and stored in Supabase user profile.

### Google Play Store Compliance

| Requirement | Approach |
|-------------|---------|
| Target API level | API 34 (Android 14) |
| Privacy policy | Required — must document OpenAI data handling and Supabase storage |
| Data safety form | Declare: financial data collected, stored on-device and cloud, shared with OpenAI for slip processing |
| Content rating | Finance category — standard rating |
| App signing | Google Play App Signing — Play-managed key |

### Implementation Considerations

**Recommended React Native Libraries (MVP):**

| Concern | Library | Notes |
|---------|---------|-------|
| Navigation | `react-navigation` v6 | Stack + Tab navigators |
| SQLite | `expo-sqlite` | Expo managed workflow |
| Camera / Image picker | `expo-camera` + `expo-image-picker` | Slip capture + gallery |
| Notifications | `expo-notifications` | Local scheduling + FCM |
| Network state | `@react-native-community/netinfo` | Sync trigger on reconnect |
| Supabase | `@supabase/supabase-js` | Official JS client |
| State management | Zustand | Lightweight; avoid Redux overhead |
| UI components | React Native Paper | Material Design baseline |

**Expo Managed Workflow** recommended for MVP — faster development, simpler native modules. Eject to bare workflow only if a required module is unavailable in Expo SDK.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience MVP — build the minimum that creates a genuine, sustainable daily habit for real users. Not a prototype, not a feature demo. A complete tool that Henza and Thandi actually use every day from day one.

**Why this approach:** The product's biggest risk is not technical — it is behavioural. The history of budgeting apps is a graveyard of technically functional tools that nobody used past week 2. Every Phase 1 feature exists to support the daily loop: log → see → decide → repeat.

**Development Model:** Claude Code as primary developer under solo developer (Henza) supervision. Code generation capacity is not the constraint. The constraint is Henza's review, testing, and validation cycles.

**Resource Requirements:**

| Role | Resource |
|------|---------|
| Developer | Claude Code (AI-assisted development) |
| Product Owner / Supervisor | Henza |
| Testers (pilot users) | Henza's household + sister's household |
| Infrastructure | Supabase (hosted), Expo (managed build), OpenAI API, Google Play Console |

### MVP Feature Set — Phase 1

**Core User Journeys Supported:**
- Journey 1: Thandi — The Learner's First 30 Days (full support)
- Journey 2: Henza — The Practitioner's Monthly Cycle (full support)
- Journey 3: Thandi — The Empty Envelope Crisis (full support)

**Must-Have Capabilities:**

| Feature | Why It Cannot Be Deferred |
|---------|--------------------------|
| Onboarding wizard | Without it, Learner users cannot set up independently |
| Core envelope budgeting | The product has no function without this |
| Manual transaction entry (3-tap) | Primary daily interaction — must be frictionless |
| Envelope balance home screen | The single number that changes daily behaviour |
| Meter readings (water, electricity, odometer) | AccountingV2's unique differentiator — absent = just another budget app |
| Baby Steps tracker | Ramsey philosophy made visible |
| Debt snowball tracker | The motivational engine of the Ramsey plan |
| AI slip scanning (async queue) | Item-level capture is core to personal inflation index and grocery intelligence |
| Offline-first sync (SQLite + Supabase) | Non-negotiable architectural requirement |
| Local scheduled notifications | Habit formation requires the app to come to the user |
| Pre-flight monthly checklist | Intentionality at month-start made structural |

### Post-MVP Features

**Phase 2 — Intelligence Layer:**
Pattern-aware coaching messages, WhatsApp/Telegram bot, utility rate intelligence, business expense tracking, sinking fund manager, seasonal budget templates, 90-day cash flow forecast, commitment contracts, Crisis Budget Mode, SA Calendar Intelligence.

**Phase 3 — Full Ecosystem:**
Learner levelling system, family network/household hierarchy, full AI advisor, SA household benchmarks, Quarterly + Annual Financial Review, Net Worth milestone celebrations, Financial Memory Palace, Family Financial Blueprint, Personal Best Tracker, iOS support.

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| OpenAI Vision accuracy on SA till slips | Medium | User reviews every extraction before commit; manual correction always available |
| Expo managed workflow hitting native module ceiling | Low | Stay within Expo SDK; eject path documented if required |
| SQLite + Supabase sync edge cases | Medium | Pending_sync table handles partial syncs; idempotent operations; GUID deduplication |
| FCM complexity for coaching notifications | Low | Deferred to Phase 2; local notifications cover MVP |

**Supervision Risks:**

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Review cycle bottleneck | Medium | Work in small increments per Theme; test before proceeding to next Theme |
| Scope creep into Phase 2 during Phase 1 build | High | Strict Phase 1 feature list; Phase 2 requests logged and deferred |
| Testing coverage gaps | Medium | Both pilot households test each Theme before proceeding |

**Adoption Risks:**

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Thandi abandons after first week | Medium | Evening notification non-negotiable; 3-tap entry must genuinely be 3 taps; wizard under 15 minutes |
| Onboarding too complex for Learner | Medium | Wizard tested with Thandi first; redesigned if she cannot complete it alone |
| Slip scanning accuracy undermines trust | Medium | Explicit review-before-save UX; manual entry always the faster fallback |

## Functional Requirements

### FR-1: Budget & Envelope Management

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-01 | The system shall support zero-based budget creation where every rand of income is allocated to an envelope or savings category before the month begins | Must Have | 1 |
| FR-02 | The system shall allow users to create, name, edit, and archive budget envelopes with assigned monthly amounts | Must Have | 1 |
| FR-03 | The system shall display real-time envelope balance (allocated minus spent) and visual fill indicator per envelope | Must Have | 1 |
| FR-04 | The system shall provide a month-start budget setup wizard that guides Level 1 users through income entry, fixed expenses, and envelope allocation step-by-step | Must Have | 1 |
| FR-05 | The system shall enforce that total envelope allocations equal total declared income (zero-based constraint), alerting the user if a surplus or deficit exists | Must Have | 1 |
| FR-06 | The system shall support envelope-to-envelope fund transfers with a reason field, logged as an audit event | Must Have | 1 |
| FR-07 | The system shall support recurring envelope templates that pre-populate the next month's budget from the current month's structure | Should Have | 1 |
| FR-08 | The system shall provide a dedicated envelope for each active Dave Ramsey Baby Step with progress tracking and milestone celebration | Must Have | 1 |
| FR-09 | The system shall display a household budget overview dashboard showing all envelopes, total spent, total remaining, and percentage completion for the current month | Must Have | 1 |
| FR-10 | The system shall support utility envelopes (electricity, water, vehicle fuel) linked to meter/odometer reading data, so budget consumption is reflected against actual usage | Must Have | 1 |
| FR-11 | The system shall allow a Mentor user to view (read-only) the linked Learner household's budget and envelope state | Should Have | 1 |

### FR-2: Transaction Capture & Processing

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-12 | The system shall allow manual transaction entry with: amount, date, envelope assignment, payee, description, and optional receipt image | Must Have | 1 |
| FR-13 | The system shall allow a single transaction to be split across multiple envelopes with per-split amounts | Should Have | 1 |
| FR-14 | The system shall support image capture of till slips and receipts via device camera or gallery, sent to OpenAI Vision API for structured data extraction | Must Have | 1 |
| FR-15 | The system shall extract line-item detail from till slip images including: item name, quantity, unit price, and total per line — presented for user confirmation before saving | Must Have | 1 |
| FR-16 | The system shall allow the user to confirm, correct, or discard AI-extracted transaction data before it is committed to the local database | Must Have | 1 |
| FR-17 | The system shall queue till slip images for processing when offline and submit them to the AI pipeline automatically when connectivity is restored | Must Have | 1 |
| FR-18 | The system shall support flagging a transaction as a business expense with: business name, expense category (SARS-aligned), and optional invoice attachment | Should Have | 2 |
| FR-19 | The system shall maintain a full transaction history with search, date-range filter, envelope filter, and amount-range filter | Must Have | 1 |
| FR-20 | The system shall support transaction editing and deletion with an audit log entry recording the original values | Should Have | 1 |
| FR-21 | The system shall display a running monthly spend total per envelope and alert the user visually and via notification when an envelope reaches 80% and 100% of its budget | Must Have | 1 |

### FR-3: Utility & Home Metrics

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-22 | The system shall support entry of monthly electricity meter readings (kWh), calculating consumption since the previous reading | Must Have | 1 |
| FR-23 | The system shall support entry of monthly water meter readings (kilolitres), calculating consumption since the previous reading | Must Have | 1 |
| FR-24 | The system shall support entry of vehicle odometer readings (km), calculating distance travelled since the previous reading | Must Have | 1 |
| FR-25 | The system shall calculate the effective unit rate (cost per kWh, cost per kL, cost per km) from entered readings and corresponding expense transactions | Must Have | 1 |
| FR-26 | The system shall maintain a rate history for each utility type, allowing the user to see how their unit rate has changed over time (tariff changes, prepaid vs municipal) | Must Have | 1 |
| FR-27 | The system shall support prepaid electricity token entry as an alternative capture method, recording the rand amount and estimated kWh credited | Should Have | 1 |
| FR-28 | The system shall flag anomalous readings where consumption deviates more than 20% from the 3-month rolling average, prompting the user to verify or explain the variance | Should Have | 1 |
| FR-29 | The system shall display a utility dashboard showing: current month consumption, prior month comparison, unit rate trend, and budget vs actual spend | Must Have | 1 |
| FR-30 | The system shall send a monthly reminder notification (configurable day) prompting the user to enter their meter readings before they submit or estimate their utility bill | Must Have | 1 |
| FR-31 | The system shall support multiple vehicles, each with independent odometer history and fuel expense tracking | Should Have | 2 |

### FR-4: Financial Journey & Coaching

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-32 | The system shall implement the 7 Dave Ramsey Baby Steps as a structured progress framework, with each step having a defined completion condition and celebration event | Must Have | 1 |
| FR-33 | The system shall calculate and display a monthly Ramsey Score (0–100) based on: budget adherence, logging consistency, envelope discipline, Baby Step progress, and meter reading regularity | Must Have | 1 |
| FR-34 | The system shall implement a three-tier user level system: Level 1 Learner, Level 2 Practitioner, Level 3 Mentor — with Level 1 → Level 2 advancement requiring a Ramsey Score ≥ 70 for 3 consecutive budget periods. A score falling below 60 for 2 consecutive periods triggers a coaching warning notification; no automatic demotion occurs without user acknowledgement. | Must Have | 1 |
| FR-35 | The system shall adapt UI complexity, guidance density, and feature exposure based on the user's current level: Level 1 receives full wizard guidance, Level 2 receives streamlined flows, Level 3 receives advanced analytics | Must Have | 1 |
| FR-36 | The system shall display a 90-day cash flow forecast based on recurring transactions, scheduled bill patterns, and current envelope balances | Should Have | 1 |
| FR-37 | The system shall generate a monthly financial health summary at month-end, highlighting: budget performance, largest variances, utility trends, Baby Step progress, and Ramsey Score change | Must Have | 1 |
| FR-38 | The system shall deliver contextual coaching nudges via local push notification: envelope nearing limit, missing logging streak, meter reading due, month-start budget reminder, Baby Step milestone approaching | Must Have | 1 |
| FR-39 | The system shall provide an AI conversational advisor (on-demand, requires connectivity) that answers budget questions in the context of the user's actual data — trained to ask clarifying questions and present honest trade-offs, not comfortable answers | Should Have | 1 |
| FR-40 | The system shall maintain a 21-day logging streak counter, displaying streak progress and awarding a streak badge on completion | Must Have | 1 |
| FR-41 | The system shall detect and surface spending pattern insights in the monthly period summary when: (a) a spending category trend increases or decreases by more than 10% over 3 consecutive budget periods, (b) a merchant visit frequency changes by more than 50% month-over-month, or (c) an OCR-tracked item price increases more than 15% over 3 months for a regularly purchased item. Each insight includes the metric, the change, and the comparison baseline. | Should Have | 2 |
| FR-42 | The system shall support a Commitment Contract feature: the user sets a financial goal (e.g., "No restaurant spend in October"), the app tracks compliance, and reports outcome at month-end | Could Have | 2 |
| FR-43 | The system shall provide SA-specific calendar intelligence: school fee months, December bonus consideration, load shedding impact on prepaid electricity usage patterns | Could Have | 2 |
| FR-44 | The system shall allow a Mentor user to send encouragement messages to a linked Learner household, delivered as in-app notifications | Could Have | 2 |

### FR-10: Debt Snowball Tracker

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-73 | The system shall support debt record management with: creditor name, outstanding balance, interest rate (%), minimum monthly payment, and debt type (credit card, personal loan, store account, vehicle finance, bond). Multiple debts may be entered per household. By default, debts are ordered by smallest balance first (Dave Ramsey method); the user may reorder manually. | Must Have | 1 |
| FR-74 | The system shall calculate and display a debt snowball payoff plan showing: debts in payoff order, estimated payoff date per debt based on minimum payments plus any snowball allocation, total debt-free date projection, and running total paid off to date. All projections update dynamically when additional snowball payments are logged. A visual payoff indicator (animated reducing bar per debt) celebrates each debt cleared with a distinct milestone event. | Must Have | 1 |

### FR-5: Business Expense Management

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-45 | The system shall support flagging any personal transaction as a business expense reimbursement claim, capturing: business name, expense type (SARS-aligned category), description, and invoice/receipt image | Must Have | 2 |
| FR-46 | The system shall generate a monthly business expense report in PDF format, listing all flagged transactions grouped by expense category, suitable for employer reimbursement submission | Must Have | 2 |
| FR-47 | The system shall track the reimbursement status of each business expense claim (Pending / Submitted / Reimbursed), with a date field for each status change | Should Have | 2 |
| FR-48 | The system shall maintain a running total of outstanding (unreimbursed) business expenses visible on the dashboard, as this impacts personal cash flow | Should Have | 2 |

### FR-6: Household & User Management

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-49 | The system shall support a single household with multiple named members for shared budget awareness (e.g., income from multiple earners, named spending members) | Must Have | 1 |
| FR-50 | The system shall allow a household to invite a Mentor user (by Supabase-linked account), granting read-only visibility of the household's financial data | Should Have | 1 |
| FR-51 | The system shall support a household onboarding wizard covering: member setup, income declaration, fixed expense identification, envelope creation, meter baseline readings, and Baby Step starting point | Must Have | 1 |
| FR-52 | The system shall store all user data locally in SQLite and sync to Supabase when connectivity is available, with the local database as the authoritative source of truth | Must Have | 1 |
| FR-53 | The system shall apply Row-Level Security (RLS) in Supabase ensuring each user can only read and write their own household's data | Must Have | 1 |
| FR-54 | The system shall support offline-first operation: all budget, transaction, meter, and coaching features must be fully functional without internet connectivity | Must Have | 1 |
| FR-55 | The system shall provide user-configurable notification preferences: which notification types to receive, at what time of day, and on which days of the week | Should Have | 1 |

### FR-7: Insight & Reporting

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-56 | The system shall provide a monthly budget vs actual report per envelope, showing: budgeted amount, amount spent, variance (rand and percentage), and trend vs prior month | Must Have | 1 |
| FR-57 | The system shall provide a category spend analysis showing the breakdown of spending across envelope categories in chart form (pie and bar) for any selected month or date range | Should Have | 1 |
| FR-58 | The system shall track item-level grocery spend over time (from OCR-extracted till slip data), enabling a personal inflation index — the change in cost of your actual shopping basket over rolling 3-month and 12-month periods | Should Have | 2 |
| FR-59 | The system shall provide a utility trend report covering: monthly consumption history, unit rate history, spend history, and year-on-year comparison for electricity, water, and vehicle | Should Have | 1 |
| FR-60 | The system shall provide a Baby Steps progress timeline showing: current step, completion date of each past step, and estimated time to next milestone based on current savings rate | Should Have | 1 |
| FR-61 | The system shall produce a year-to-date financial health summary available at any time, covering: total income, total spend, largest expense categories, utility cost total, Ramsey Score average, and Baby Step progress | Could Have | 2 |
| FR-62 | The system shall export any report to PDF for record-keeping or sharing with a Mentor | Could Have | 2 |

### FR-8: Data & Synchronisation

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-63 | The system shall sync all local SQLite changes to Supabase when a network connection is detected, using GUID-based record identification and last-write-wins conflict resolution | Must Have | 1 |
| FR-64 | The system shall display a sync status indicator showing: last successful sync timestamp, pending changes count, and any sync error state | Should Have | 1 |
| FR-65 | The system shall support full data restore from Supabase to a new device — restoring all household data, transactions, meter readings, and envelope history from cloud backup | Must Have | 1 |
| FR-66 | The system shall encrypt all data at rest on the device using SQLite encryption, and transmit all data to Supabase over TLS 1.2 or higher | Must Have | 1 |
| FR-67 | The system shall comply with POPIA as a personal-use application with a single data controller (the household owner), storing only data voluntarily entered by the user, with no third-party data sharing | Must Have | 1 |

### FR-9: Budget Mechanics & Behaviour Design

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-68 | The system shall support configurable budget periods aligned to payday rather than calendar month. The household configures a payday date (e.g., the 20th), and each budget period runs from that date to the day before the following payday (e.g., 20th to 19th). All envelope balances, reports, and Ramsey Score calculations operate within this period boundary. | Must Have | 1 |
| FR-69 | The system shall enforce a savings-first allocation order: when creating or filling envelopes at period start, the savings and emergency fund envelopes are allocated first and locked. The remaining income is then distributed across spending envelopes. The zero-based constraint applies to the remainder after savings — savings is non-negotiable, not what survives the period. | Must Have | 1 |
| FR-70 | The system shall prevent automatic rollover of unspent envelope balances at period end. When a budget period closes with a surplus in any envelope, the user is presented with a mandatory routing decision: redirect to savings, add to debt snowball, or carry forward intentionally. The decision is logged as an audit event. No rand moves without the user's deliberate assignment. | Must Have | 1 |
| FR-71 | The system shall trigger a celebration moment when any spending envelope closes the period with a surplus — displaying the amount saved, an affirming message, and the routing prompt (savings / snowball / carry forward). This event is distinct from Baby Step celebrations and occurs every period a surplus is achieved. | Must Have | 1 |
| FR-72 | The system shall present a single-question Spending Trigger prompt when a transaction causes an envelope to exceed its budget: "What was happening when you decided to spend this?" The response is free-text, private, stored locally, and surfaced in the monthly period coaching summary when 3 or more Spending Trigger entries match a detected pattern (same envelope, same day of week, or same time-of-day bracket). The pattern and match count are shown; specific journal entries are never surfaced verbatim. | Should Have | 1 |

## Non-Functional Requirements

### Performance

| NFR | Requirement | Threshold |
|-----|-------------|-----------|
| NFR-P01 | App launch to dashboard (cold start) | ≤ 3 seconds on Android 10 (API 29) mid-range device |
| NFR-P02 | Transaction save (manual entry → confirmation) | ≤ 500ms |
| NFR-P03 | Envelope balance recalculation after transaction | ≤ 200ms (local SQLite query) |
| NFR-P04 | Till slip OCR round-trip (image upload → structured data returned) | ≤ 15 seconds on LTE; graceful loading state shown throughout |
| NFR-P05 | Monthly report generation (all envelopes, full month) | ≤ 2 seconds |
| NFR-P06 | Sync to Supabase (full delta push, ≤ 500 records) | ≤ 10 seconds; non-blocking (background process, does not block UI) |
| NFR-P07 | Offline operation has zero performance degradation vs online — all local-data features must perform identically with or without network | 100% parity |

### Security & Privacy

| NFR | Requirement |
|-----|-------------|
| NFR-S01 | All SQLite data at rest on the device encrypted using SQLCipher (AES-256) |
| NFR-S02 | All data in transit to Supabase transmitted over TLS 1.2 minimum |
| NFR-S03 | Supabase Row-Level Security (RLS) enforced server-side — every table policy scoped to `auth.uid()` |
| NFR-S04 | OpenAI Vision API calls made server-side or with the API key stored in environment configuration only — never embedded in the app bundle |
| NFR-S05 | No financial data logged to device console, crash reporters, or analytics services |
| NFR-S06 | App requires device authentication (PIN, biometric) on resume from background after 5 minutes of inactivity — configurable |
| NFR-S07 | POPIA compliance: single data controller (household owner), no third-party data sharing, all data user-generated and user-controlled |
| NFR-S08 | Users may export all their data to JSON and delete all cloud data (right to erasure) — full Supabase delete on request |

### Reliability & Offline-First

| NFR | Requirement |
|-----|-------------|
| NFR-R01 | The app must be 100% functional for all budget, transaction, utility, and coaching features without internet connectivity |
| NFR-R02 | No data loss on app crash — every user action committed to SQLite before any network operation |
| NFR-R03 | Sync conflicts resolved by last-write-wins using GUID + `updated_at` timestamp; no silent data loss |
| NFR-R04 | Failed sync retried automatically on next connectivity event with exponential backoff |
| NFR-R05 | Till slip images queued locally when offline, processed automatically on connectivity restoration |
| NFR-R06 | App handles Supabase service unavailability gracefully — surfaces a clear status indicator, continues in offline mode without error crashes |

### Accessibility

| NFR | Requirement |
|-----|-------------|
| NFR-A01 | Minimum WCAG AA compliance across all screens |
| NFR-A02 | All interactive elements have accessible labels (for TalkBack on Android) |
| NFR-A03 | Minimum touch target size of 48×48dp on all interactive elements |
| NFR-A04 | Colour is never the sole means of conveying information (critical for envelope status indicators) |
| NFR-A05 | Text minimum size 14sp; user can increase text size via Android system settings without layout breakage |
| NFR-A06 | Sufficient colour contrast — all text meets WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text) |

### Code Quality & Architecture

| NFR | Requirement |
|-----|-------------|
| NFR-Q01 | **Clean Architecture** — strict separation of Presentation, Domain, and Data layers; no business logic in UI components; no direct database access from screens |
| NFR-Q02 | **Repository Pattern** — all data access (SQLite reads/writes, Supabase sync) abstracted behind repository interfaces; screens and use cases depend on interfaces, not implementations |
| NFR-Q03 | **SOLID Principles** — Single Responsibility (one purpose per module/class), Open/Closed (extend behaviour via new modules, not modification), Liskov (substitutable implementations), Interface Segregation (no fat interfaces), Dependency Inversion (depend on abstractions) |
| NFR-Q04 | **Command Pattern** — all user actions that mutate state (create transaction, transfer envelope funds, log meter reading) implemented as discrete command objects, enabling undo support and audit logging |
| NFR-Q05 | **Observer/Reactive Pattern** — UI state changes driven by Zustand stores reacting to data layer events; no imperative state mutation from UI handlers |
| NFR-Q06 | **Strategy Pattern** — sync conflict resolution, notification scheduling, and coaching message selection implemented as interchangeable strategies |
| NFR-Q07 | ESLint + Prettier enforced — zero lint errors on CI; consistent formatting across all files |
| NFR-Q08 | No code smells: no magic numbers (use named constants), no deeply nested conditionals (max 3 levels), no functions exceeding 40 lines, no duplicate logic across modules |
| NFR-Q09 | TypeScript strict mode enabled — no `any` types, no implicit returns, full type coverage |

### Testing Standards

| NFR | Requirement |
|-----|-------------|
| NFR-T01 | **Unit Tests (Jest + React Native Testing Library)** — minimum 80% code coverage for Domain layer (use cases, business rules); all Repository implementations tested with in-memory SQLite |
| NFR-T02 | **Component Tests (React Native Testing Library)** — all screens and reusable components have render tests covering: empty state, loaded state, error state, and key user interaction |
| NFR-T03 | **E2E Tests (Maestro)** — critical user flows covered by Maestro YAML test scripts: onboarding wizard, transaction entry, envelope transfer, meter reading entry, till slip capture (mocked API), sync status display |
| NFR-T04 | **Functional Testing** — each Functional Requirement must have at least one associated test case (unit, component, or E2E) documented in a test plan before implementation begins |
| NFR-T05 | **UAT Protocol** — pilot household testing (Henza's household + linked Learner household) to validate: onboarding completion within 15 minutes, first independent budget decision within 30 days, and meter reading habit by month 3 |
| NFR-T06 | No feature is considered complete without: unit test passing, component render test passing, and manual functional walkthrough by the developer |

### UI/UX Standards & Design System

| NFR | Requirement |
|-----|-------------|
| NFR-U01 | **Material Design 3** as the foundational design system — component library: React Native Paper |
| NFR-U02 | **Deliberate Brand Palette** (no dynamic colour / Material You theming): Deep Teal primary (`#00695C`), Warm Amber secondary (`#FFB300`), Emerald success (`#2E7D32`), Warm Red danger/alert (`#C62828`), Warm White surface (`#FAFAFA`) |
| NFR-U03 | **Progressive Disclosure** — Level 1 users see only the controls needed for their current task; advanced features and analytics are unlocked progressively as the user's level increases |
| NFR-U04 | **Minimal Cognitive Load** — every screen has a single primary action; no screen presents more than 5 options at once to a Level 1 user; copy is plain language (no finance jargon without explanation) |
| NFR-U05 | **Emotional Design** — milestone events (Baby Step completion, first 21-day streak, level advancement) receive a distinct celebration moment (animation + affirming copy) that acknowledges the human achievement, not just the data point |
| NFR-U06 | **Honest Feedback** — the AI advisor and coaching messages do not soften difficult truths; if the budget cannot support a spend, the UI communicates this directly and offers a trade-off path, not a comfortable non-answer |
| NFR-U07 | **Forgiveness** — all destructive actions (delete transaction, archive envelope, reset budget) require a confirmation step and support undo within the session |
| NFR-U08 | **Feedback Immediacy** — every user action produces immediate visual feedback within 100ms (button press state, loading indicator, success/error result) |
| NFR-U09 | **Stewardship Aesthetic** — the visual language reinforces intentionality and care: clean layouts with deliberate whitespace, no gratuitous animations, typography hierarchy that makes amounts and balances immediately legible |
| NFR-U10 | **Consistency** — identical interactions behave identically across all screens; the same data (e.g., envelope balance) is formatted identically everywhere it appears |

### Platform & Distribution

| NFR | Requirement |
|-----|-------------|
| NFR-PL01 | Minimum Android SDK: API 29 (Android 10); Target SDK: API 34 (Android 14) |
| NFR-PL02 | Phase 1: Android only. Phase 2+: iOS support added |
| NFR-PL03 | Distribution: Google Play Store — free, no in-app purchases, no subscription |
| NFR-PL04 | Built with Expo Managed Workflow; no bare native modules in Phase 1 |
| NFR-PL05 | App bundle size ≤ 50MB (initial install); assets lazy-loaded where possible |

