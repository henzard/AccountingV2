# AI Slip Scanning + Operational Catch-up + Tech Debt — Design Spec

**Date:** 2026-04-13
**Status:** Approved
**PRD references:** Phase 1 MVP — "AI slip scanning: OpenAI Vision integration, item-level extraction, async offline queue, auto-categorisation"; Journey 2 (Henza scans petrol slip / Checkers slip); FR-related items in Phase 1 MVP scope.

## Goal

Ship the last unbuilt Phase 1 MVP feature — AI slip scanning with item-level extraction and auto-categorisation — alongside operational catch-up (sync hotfix deployment, store listing, backups, Crashlytics) and bundled tech-debt continuation (dark mode adoption, Detox, remaining repo ports, coverage raise) in a single PR.

## Product decisions (locked in during brainstorming)

| #   | Decision                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Extraction level: **header + items + auto-category** (most magical; merchant + total + per-item with suggested envelope)   |
| 2   | Provider: **OpenAI `gpt-4o-mini`** — single API call returns structured JSON (~$0.0015/scan)                               |
| 3   | Capture flow: **online-only blocking** — no offline queue (capture disabled when offline; user falls back to manual entry) |
| 4   | Multi-shot: **sticky session** — Add / Done buttons in capture; up to 5 frames sent in one OpenAI call                     |
| 5   | Transaction policy: **one transaction per line item**, with `slip_id` FK linking back to source slip                       |
| 6   | Image storage: **Supabase Storage** with **30-day auto-deletion** (both cloud and local copies)                            |
| 7   | Confirm UX: **single scrollable list** with tap-to-edit rows, bulk action, save disabled until every row has an envelope   |
| 8   | Architecture: **Mobile → Supabase Edge Function → OpenAI** (key stays server-side, rate-limit + cost tracking centralised) |

## Architecture

The mobile app captures images through `expo-camera`, compresses them locally, uploads to a private Supabase Storage bucket, then invokes a Deno Edge Function (`extract-slip`) that:

1. Authenticates the caller via JWT and verifies household membership.
2. Rate-limits per household per day.
3. Fetches the user's envelope list to seed categorisation.
4. Generates signed Storage URLs and calls OpenAI `gpt-4o-mini` with structured-output JSON schema.
5. Validates the response, persists raw + parsed data on `slip_queue`, returns parsed result.

The client renders a confirm screen, the user reviews and saves, and the app creates one transaction per line item (each linked back to the slip via `slip_id`). The original slip image is auto-deleted from Storage and from the device after 30 days.

The flow is online-only by design — capture is disabled when offline. This is a deliberate trade against the offline-first principle: blocking guarantees the user gets immediate feedback and never has to context-switch back to a "review queue" later.

## Data model

### Local Drizzle schema changes

**`src/data/local/schema/slipQueue.ts` — replaced (no real data exists; destructive replacement is safe):**

```ts
export const slipQueue = sqliteTable('slip_queue', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  createdBy: text('created_by').notNull(),
  imageUris: text('image_uris').notNull(), // JSON array of Storage paths
  status: text('status').notNull().default('processing'),
  // 'processing' | 'completed' | 'failed' | 'cancelled'
  errorMessage: text('error_message'),
  merchant: text('merchant'),
  slipDate: text('slip_date'),
  totalCents: integer('total_cents'),
  rawResponseJson: text('raw_response_json'),
  imagesDeletedAt: text('images_deleted_at'),
  openaiCostCents: integer('openai_cost_cents').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

**`src/data/local/schema/transactions.ts` — add column:**

```ts
slipId: text('slip_id'),  // nullable FK to slip_queue.id
```

Local migration `0008_slip_scanning.sql`:

- `DROP TABLE slip_queue;` then `CREATE TABLE slip_queue (...)` with new shape (no production rows exist yet)
- `ALTER TABLE transactions ADD COLUMN slip_id TEXT;`
- `CREATE INDEX idx_transactions_slip_id ON transactions(slip_id);`

### Supabase migration `006_slip_scanning.sql`

- `DROP TABLE public.slip_queue;` followed by full `CREATE TABLE` with the new column set, RLS, and unique-index-by-id.
- Replace `public.merge_slip_queue` RPC with one matching the new shape (LWW guard on `updated_at`; membership check via `user_households`).
- `ALTER TABLE public.transactions ADD COLUMN slip_id TEXT;` plus index.
- Replace `public.merge_transaction` RPC SET clause to include `slip_id = EXCLUDED.slip_id`.
- `INSERT INTO storage.buckets ('slip-images', false)` with bucket-create RLS policies (read + write scoped to household membership via the path's first segment).
- `pg_cron` job `cleanup-old-slip-images` daily 03:00 UTC that deletes Storage objects + flips `slip_queue.images_deleted_at` for slips older than 30 days.

### Storage bucket

`slip-images` — private, household-scoped path scheme `<household_id>/<slip_id>/<frame_index>.jpg`. RLS policies enforce that authenticated users can only read/write objects whose first path segment matches a household they belong to (via `user_households`).

## Edge Function — `extract-slip`

`supabase/functions/extract-slip/index.ts`. Deno runtime.

**Request:**

```json
{ "slip_id": "uuid", "household_id": "...", "image_paths": ["<storage path>", ...] }
```

**Response (success):**

```json
{
  "merchant": "Pick n Pay Sea Point",
  "slip_date": "2026-04-13",
  "total_cents": 84025,
  "items": [
    {
      "description": "FREE RANGE EGGS 6S",
      "amount_cents": 4999,
      "quantity": 1,
      "suggested_envelope_id": "env_groceries",
      "confidence": 0.94
    },
    {
      "description": "WIFI VOUCHER 50R",
      "amount_cents": 5000,
      "quantity": 1,
      "suggested_envelope_id": null,
      "confidence": 0.42
    }
  ]
}
```

**Function logic (sequential):**

1. Verify JWT; reject 401 if missing/invalid.
2. Verify caller in `user_households` for `household_id`; reject 403 otherwise.
3. Count `slip_queue` rows for `(household_id, created_at > now - 24h)`; reject 429 if `>= 50`.
4. `SELECT id, name FROM envelopes WHERE household_id = X AND envelope_type IN ('spending', 'utility') AND is_archived = false`.
5. Generate 1-hour signed Storage URLs for each `image_paths` entry.
6. Build OpenAI request: model `gpt-4o-mini`, `response_format: { type: 'json_schema', schema: SLIP_SCHEMA }`, content array with one text part (prompt) + N image parts (the signed URLs as `{ type: 'image_url', image_url: { url } }`).
7. Validate parsed response: `total_cents` must be within ±100 cents of `sum(items.amount_cents)`. Mismatch flags as low-confidence but does NOT reject.
8. Persist on `slip_queue`: `merchant`, `slip_date`, `total_cents`, `raw_response_json`, `openai_cost_cents` (computed from token counts), `status='completed'`. Function does NOT create transactions — that is the client's job after user confirms.
9. Return parsed JSON to client.

### Error mapping

| Failure                     | Status                | `slip_queue.status` | `error_message`                 |
| --------------------------- | --------------------- | ------------------- | ------------------------------- |
| Missing/invalid JWT         | 401                   | unchanged           | (function never persists)       |
| Not a household member      | 403                   | unchanged           |                                 |
| Rate limit (>= 50/24h)      | 429                   | unchanged           |                                 |
| OpenAI 5xx / timeout > 30s  | 503                   | `failed`            | `OpenAI unreachable`            |
| OpenAI returns invalid JSON | 503 (after one retry) | `failed`            | `OpenAI returned invalid JSON`  |
| OpenAI returns `items: []`  | 200                   | `completed`         | (client routes to manual-entry) |
| Image fetch fails           | 503                   | `failed`            | `Image fetch failed`            |

### Prompt sketch

```
You are a receipt parser for a South African budgeting app. You receive 1-5 images of a single till slip (potentially multi-page). Extract the merchant name, date, total in cents (ZAR), and every line item with description, quantity, and amount in cents.

For each item, suggest the best envelope_id from this list:
{{envelopes_json}}

If no envelope is clearly applicable, set suggested_envelope_id to null and confidence below 0.5. Do not invent line items — if the slip is unreadable, return items: [] and merchant: null.
```

### Tests

- `supabase/functions/extract-slip/__tests__/extract-slip.test.ts` (Deno test runner). Mocks Supabase + OpenAI fetch. Covers: auth reject, RLS reject, rate-limit, total-mismatch tolerance, envelope-list propagation, error mapping for each error class.

## Domain layer

`src/domain/slipScanning/`

| File                            | Responsibility                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                      | `SlipStatus`, `SlipExtraction`, `SlipExtractionItem`, `SlipFrame`                                                                                           |
| `ports/ISlipExtractor.ts`       | Interface: `extract(slipId, householdId, imagePaths) → Promise<SlipExtraction>`                                                                             |
| `SlipExtractionParser.ts`       | Pure parser for Edge Function response → typed `SlipExtraction`; gracefully handles missing fields                                                          |
| `CaptureSlipUseCase.ts`         | Creates `slip_queue` row with `status='processing'`. Returns `slipId`. No upload, no extraction.                                                            |
| `UploadSlipImagesUseCase.ts`    | Compresses + uploads each frame via injected `SlipImageCompressor` + `SlipImageUploader`. Updates `slip_queue.image_uris`. Throws on failure.               |
| `ExtractSlipUseCase.ts`         | Calls `ISlipExtractor`. Updates `slip_queue` with extraction. Throws typed errors mapped from extractor (`OpenAIUnreachable`, `RateLimited`, `Unreadable`). |
| `ConfirmSlipUseCase.ts`         | Drizzle transaction wrapper. For each confirmed item: insert `transactions` row with `slip_id`. Mark slip `completed`. All-or-nothing atomic.               |
| `CleanupExpiredSlipsUseCase.ts` | Device-local cleanup: deletes local images + flips `images_deleted_at` for slips > 30 days. Idempotent. Runs on app startup.                                |
| `__tests__/*.test.ts`           | One per use case; pure mock-based.                                                                                                                          |

All use cases follow project conventions: accept `enqueuer?: ISyncEnqueuer` as optional trailing constructor param (defaults to `new PendingSyncEnqueuerAdapter(db)`); return `Result<T>`; set `isSynced=false` on every write.

## Infrastructure layer

`src/infrastructure/slipScanning/`

| File                           | Responsibility                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `SlipImageCompressor.ts`       | `expo-image-manipulator` → JPEG q80, max-edge 1600px. Returns compressed file URI.                                          |
| `SlipImageUploader.ts`         | `supabase.storage.from('slip-images').upload(...)`. Path scheme `<household_id>/<slip_id>/<index>.jpg`.                     |
| `EdgeFunctionSlipExtractor.ts` | Implements `ISlipExtractor`. `supabase.functions.invoke('extract-slip', { body })`. Maps HTTP status → typed domain errors. |
| `SlipImageLocalStore.ts`       | `${FileSystem.documentDirectory}slips/<slip_id>/`. Methods: `save`, `delete`, `listExpired`.                                |
| `__tests__/*.test.ts`          | Per file; mocks `expo-image-manipulator`, Supabase Storage, `supabase.functions.invoke`, `expo-file-system`.                |

### New dependencies

```json
"expo-image-manipulator": "~14.x",
"expo-camera": "~17.x"   // verify; install if missing
```

## Presentation layer

`src/presentation/screens/slipScanning/`

| File                                 | Responsibility                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SlipCaptureScreen.tsx`              | `expo-camera` viewfinder. Shutter button + frame thumbnail strip + Add/Done buttons. Up to 5 frames hard cap. Camera permission denied → settings link. Online check disables shutter offline.                                                                                        |
| `SlipProcessingScreen.tsx`           | Progress states: "Uploading images…" → "Reading slip…". Cancel button. ~5-10s typical. Cancellation marks slip `cancelled`, deletes uploads + locals.                                                                                                                                 |
| `SlipConfirmScreen.tsx`              | Single scrollable list. Header: merchant + total + slip date (editable). Body: line item rows with description, amount, envelope chip. Yellow-bordered rows for unassigned envelopes. Bulk action: "Mark all uncategorised as \_\_\_". Save disabled until every row has an envelope. |
| `SlipQueueScreen.tsx`                | History view of recent slips. Tap completed → view-only. Tap processing/failed → re-open `SlipConfirmScreen` or retry extraction. Reachable from Settings → "Slip history".                                                                                                           |
| `components/SlipFrameThumbnail.tsx`  | Square thumbnail with index badge + delete overlay.                                                                                                                                                                                                                                   |
| `components/LineItemRow.tsx`         | Tap-to-edit row; envelope chip with `EnvelopePickerSheet`; confidence-based border.                                                                                                                                                                                                   |
| `components/EnvelopePickerSheet.tsx` | Bottom-sheet listing envelopes with balance. **Extracted from existing `AddTransactionScreen`** (Phase B work) so both screens reuse it.                                                                                                                                              |

### Hooks

| File                | Responsibility                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `useSlipScanner.ts` | Orchestrates capture → upload → extract. Exposes `progress` state + `cancel()`. Singleton-by-device via `slipScannerStore` Zustand store. |
| `useSlipHistory.ts` | Lists slips for current household, paginated.                                                                                             |

### Stores

| File                  | Responsibility                                                              |
| --------------------- | --------------------------------------------------------------------------- |
| `slipScannerStore.ts` | Tracks current in-flight slip (id, status). Camera FAB grays out when busy. |

### Navigation

- New stack `SlipScanningStackNavigator` registered on `MainTabNavigator`.
- Camera FAB on `DashboardScreen` and `TransactionListScreen` → `SlipCaptureScreen`.
- "Slip history" row in `SettingsScreen` → `SlipQueueScreen`.

### Dashboard integration

`DashboardScreen` shows a small "Pending slips" badge when any slip is `processing` (rare; only happens if app background while extraction in flight).

### Tests

- `SlipCaptureScreen.test.tsx` — frame add/remove, 5-frame cap, permission-denied, offline-disabled.
- `SlipProcessingScreen.test.tsx` — progress states, cancel, error rendering.
- `SlipConfirmScreen.test.tsx` — bulk-action, save-gating, row-level edit.
- `SlipQueueScreen.test.tsx` — list rendering, navigation routing per status.
- `useSlipScanner.test.ts` — happy path, upload failure, extraction failure, cancellation, singleton enforcement.

## Cross-cutting

### Happy path (online, 2 frames)

1. Tap camera FAB → `SlipCaptureScreen`.
2. Shutter → frame 1 preview. Add → frame 2. Done.
3. `useSlipScanner.start(frames)`:
   - `CaptureSlipUseCase` → `slip_queue` row created, `slipId` returned.
   - Navigate to `SlipProcessingScreen` ("Uploading images…").
   - `UploadSlipImagesUseCase` → compresses + uploads → updates `slip_queue.image_uris`.
   - Status updates to "Reading slip…".
   - `ExtractSlipUseCase` → Edge Function call → `slip_queue` updated with extraction.
4. Navigate to `SlipConfirmScreen`. User edits, taps Save.
5. `ConfirmSlipUseCase` runs in transaction:
   - Per item: insert `transactions` row with `slip_id` + `isSynced=false`.
   - Update `slip_queue.status='completed'`.
6. Toast: "Saved {n} transactions from {merchant}". Navigate back.

### Concurrency

- `slipScannerStore` singleton enforces one in-flight slip per device. Camera FAB disabled while busy.
- App-killed-mid-extraction → row stays `processing` → next app open shows it in `SlipQueueScreen` for retry/cancel.
- App-startup routine auto-flips `processing` rows older than 1 hour to `failed`.

### Sync

- `slip_queue` and `transactions` already route through `merge_*` RPCs (Phase A); migration 006 updates the RPC SET clauses to include the new columns.
- Storage objects do NOT use the existing sync pipeline — they're served directly by Supabase Storage with household-scoped RLS.

### Privacy / PII

- Slip images sent to OpenAI are NOT stripped of loyalty IDs / card-last-4. Disclosed in privacy policy (operational appendix A.5).
- Consent screen on first slip-scan use; user can decline and feature stays unavailable until they opt in via Settings.
- Local images deleted at 30 days by `CleanupExpiredSlipsUseCase`.
- Cloud images deleted at 30 days by `pg_cron` job.

### Cost protection

- Server-side: 50 scans/household/day hard cap (Edge Function).
- Client-side: daily counter shown on FAB once usage > 30/day.
- Per-call max: 5 frames × ~1MB compressed = ~5MB worst case sent to OpenAI.

### Error handling

| Failure                         | UI                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Compression fails               | "Couldn't process images" + retry button                                                                  |
| Upload network error            | "Upload failed (poor signal)" + retry; cancel cleans up                                                   |
| Edge Function 429               | "Daily scan limit reached (50)" + offer "Log manually"                                                    |
| Edge Function 503               | "Slip service unreachable" + retry; offer "Log manually"                                                  |
| Extraction `items: []`          | Skip confirm; jump to "Couldn't read — log manually" pre-fills `AddTransactionScreen` with merchant guess |
| User cancels                    | Slip `cancelled`; Storage objects + local files deleted                                                   |
| Confirm-save partial DB failure | Drizzle transaction rolls back; user stays on confirm screen with toast                                   |

### Out of scope (named, deferred)

- WhatsApp / Telegram bot capture (Phase 2 PRD)
- Per-merchant categorisation learning loop
- Multi-currency slip support
- Receipt-export PDF for SARS
- Duplicate-slip detection
- Wifi-only upload toggle

## Operational appendix (A — bundled in same PR)

A.1. **Sync hotfix deployment** — `cbfa76f` is on master; trigger CD workflow manually after this PR merges so the deployed app uses the new `{ r: ... }` RPC payload. Without this, the production app is broken.

A.2. **Play Store listing completion** — switch CD `--status` flag from `draft` to `completed` once the Play Console listing (assets, descriptions, content rating, privacy policy URL) is finished. Manual store-side work outside this codebase.

A.3. **Supabase backups** — enable Point-in-Time Recovery in the Supabase project settings UI. Document in README. New tables now hold real production data — backups are no longer optional.

A.4. **Crashlytics dashboard verification** — confirm first crash report lands in Firebase Console after the next CD ships. No code change.

A.5. **Privacy policy update** — document slip image upload + 30-day Storage retention + OpenAI processing. Required for Play Store. URL referenced in app's about-screen.

## Tech-debt appendix (D — bundled in same PR)

D.1. **Dark mode component adoption** — replace direct `colours` imports with `useAppTheme().colors` across the 15 highest-traffic components: `DashboardScreen`, `BudgetScreen`, `TransactionListScreen`, `BabyStepsScreen`, `SnowballDashboardScreen`, `MeterDashboardScreen`, `SettingsScreen`, `LoginScreen`, `SignUpScreen`, `OnboardingNavigator` step screens, `EnvelopeCard`, `MeterReadingCard`, `RamseyScoreBadge`, `BudgetBalanceBanner`, `OfflineBanner`. Full rollout still deferred.

D.2. **Detox setup** — `npm install --save-dev detox jest-circus`, `npx detox init --runner jest`. Configure `e2e/jest.config.js`. Un-skip the existing 3 specs (`signup.spec.ts`, `addTransaction.spec.ts`, `syncRoundTrip.spec.ts`). Add CI job that runs on master only (gated; emulator slow).

D.3. **Remaining repo ports** — define + wire `IDebtRepository`, `IMeterReadingRepository`, `IHouseholdRepository` following the `ISyncEnqueuer` injection pattern. Optional trailing constructor param with default; backwards-compatible with existing call sites.

D.4. **Coverage raise** — bump threshold in `jest.config.js` to lines 65% / branches 50%.

These are mechanical tasks, not new design — they get individual commits in the same PR.

## Definition of Done

- [ ] All slip-scanning use cases + tests pass
- [ ] Edge Function deployed; `extract-slip.test.ts` green in Deno
- [ ] Migrations applied to remote (006 + local 0008)
- [ ] Manual smoke: capture 2-frame Pick n Pay slip → confirm screen shows correct merchant/total/items → save → 5+ transactions appear with correct `slip_id`
- [ ] All A.1–A.5 operational items completed (or explicitly tracked as follow-up)
- [ ] All D.1–D.4 tech-debt items landed
- [ ] `npm run typecheck && npm test && npm run lint && npm run format:check` all exit 0
- [ ] Coverage ≥ 65% lines

## Verification

```bash
npm run typecheck && npm test -- --coverage && npm run lint && npm run format:check
npx supabase functions deploy extract-slip --project-ref qmfsobqpnogefvzltwyj
npx supabase db push
```

Manual smoke per Definition of Done.

## Rollback

- `slip_queue` rewrite is destructive (no production data exists). Rollback = re-running 005's slip_queue creation.
- `transactions.slip_id` column addition is additive — safe to drop.
- Storage bucket can be deleted via Supabase dashboard.
- Edge Function delete via `npx supabase functions delete extract-slip`.
- `pg_cron` job cancellable via `SELECT cron.unschedule('cleanup-old-slip-images')`.
- Tech-debt items are isolated commits — individually revertable.
