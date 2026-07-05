/**
 * Timezone period-key sweep (L7 generalization, 2026-07-05 audit).
 *
 * Batch 6 fixed DashboardScreen's period-key derivation and exported a
 * UTC-consistent `formatPeriodDateKey` helper from `BudgetPeriodEngine`. The
 * exact same local-timezone bug existed at every other call site that turned
 * a `BudgetPeriodEngine` period boundary (a UTC-midnight `Date`) into a
 * `period_start` scope/query key via date-fns `format(date, 'yyyy-MM-dd')` —
 * that call reads the HOST's LOCAL calendar day, which is one day off from
 * the UTC instant actually stored on any UTC-negative device, so the
 * envelope/transaction/baby-step queries silently miss the period's own
 * rows.
 *
 * This is a source-level regression guard (matching the pattern of
 * `src/__tests__/sync/non-atomic-writes.test.ts`): it proves each
 * previously-buggy screen (a) no longer derives its `period_start` key via
 * local `format(period.startDate/endDate, 'yyyy-MM-dd')`, and (b) does call
 * the UTC-safe `formatPeriodDateKey` helper instead. Behavioral tz-shift
 * proof of `formatPeriodDateKey` itself lives in
 * `src/domain/shared/BudgetPeriodEngine.test.ts` ("does not shift a day even
 * when the host TZ offset would move the local calendar date").
 */
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf-8');
}

// Every site swept in this pass. Each derives a `period_start`/`periodEnd`
// SCOPE KEY (used to query/scope envelopes, transactions, or baby-step
// status) from a `BudgetPeriodEngine` boundary — not a user-facing display
// label, which correctly keeps using local `format()`.
const SWEPT_FILES = [
  'src/presentation/navigation/SlipScanningScreen.tsx',
  'src/presentation/screens/auth/onboarding/AllocateEnvelopesStep.tsx',
  'src/presentation/screens/babySteps/BabyStepsScreen.tsx',
  'src/presentation/screens/budgets/BudgetScreen.tsx',
  'src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx',
  'src/presentation/screens/forecasting/ForecastScreen.tsx',
  'src/presentation/screens/sinkingFunds/SinkingFundsScreen.tsx',
  'src/presentation/screens/transactions/AddTransactionScreen.tsx',
  'src/presentation/screens/transactions/TransactionListScreen.tsx',
  // Fixed in the prior batch (DashboardScreen) — included here so the whole
  // swept set is asserted from one place and a future edit can't quietly
  // regress it back to local `format()`.
  'src/presentation/screens/dashboard/DashboardScreen.tsx',
];

// A local-tz period-key derivation looks like `format(period.startDate, 'yyyy-MM-dd')`
// or `format(<expr>.startDate, 'yyyy-MM-dd')` / `...endDate...` — i.e. date-fns
// `format` applied directly to a period boundary field with a bare date key.
const LOCAL_TZ_PERIOD_KEY_PATTERN = /format\([^)]*\.(?:startDate|endDate)[^)]*,\s*'yyyy-MM-dd'\)/;

describe('Timezone period-key sweep — swept screens use formatPeriodDateKey, not local format()', () => {
  it.each(SWEPT_FILES)('%s no longer derives a period key via local format(...)', (file) => {
    const source = readSource(file);
    expect(source).not.toMatch(LOCAL_TZ_PERIOD_KEY_PATTERN);
  });

  it.each(SWEPT_FILES)('%s imports and calls formatPeriodDateKey', (file) => {
    const source = readSource(file);
    expect(source).toMatch(/formatPeriodDateKey/);
    // Imported specifically from the shared BudgetPeriodEngine module, not a
    // same-named local shadow.
    expect(source).toMatch(
      /import\s*\{[^}]*formatPeriodDateKey[^}]*\}\s*from\s*['"].*BudgetPeriodEngine['"]/,
    );
  });
});

describe('Timezone period-key sweep — display-only labels are left alone', () => {
  it('DashboardScreen keeps periodLabel on local format() (a display string, not a key)', () => {
    const source = readSource('src/presentation/screens/dashboard/DashboardScreen.tsx');
    expect(source).toMatch(/periodLabel = format\(period\.startDate, 'MMMM yyyy'\)/);
  });

  it('MeterDashboardScreen only uses period.label for display — no period_start query key derived', () => {
    const source = readSource('src/presentation/screens/meters/MeterDashboardScreen.tsx');
    expect(source).not.toMatch(LOCAL_TZ_PERIOD_KEY_PATTERN);
    expect(source).not.toMatch(/formatPeriodDateKey/);
    expect(source).toMatch(/period\.label/);
  });
});
