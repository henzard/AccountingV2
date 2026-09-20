import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { AuditLogger } from '../../src/data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../src/domain/envelopes/CreateEnvelopeUseCase';
import { StartNewPeriodUseCase } from '../../src/domain/budgets/StartNewPeriodUseCase';
import { AdjustSavedBalanceUseCase } from '../../src/domain/budgets/AdjustSavedBalanceUseCase';
import {
  confirmMonthlyContribution,
  ensureOpeningBalances,
  loadPersistentContributionState,
  openingContributionId,
  periodContributionId,
} from '../../src/domain/budgets/PersistentContributions';
import { getPersistentEnvelopeSavedCents } from '../../src/data/local/balances/EnvelopeBalanceQuery';
import type * as schema from '../../src/data/local/schema';

/**
 * The savings ledger's remaining semantics (REG-4, REG-7/SEC2-15, SEC2-5).
 *
 * The rule under test throughout: on a PERSISTENT envelope
 * `allocated_cents` means the MONTHLY contribution and nothing else. For a
 * LEGACY envelope it used to mean the SAVED balance, so the backfill MOVES
 * that number — into the ledger as an `opening_balance` row, out of the
 * column — and leaves the column at 0 ("amount not known yet") until the user
 * confirms a real monthly figure.
 */

const NOW = '2026-10-01T00:00:00.000Z';
const LEGACY_CREATED_AT = '2026-01-01T00:00:00.000Z'; // before LEGACY_OPENING_BALANCE_CUTOFF
const P1 = '2026-10-01';
const P2 = '2026-11-01';
const P3 = '2026-12-01';
const HOUSEHOLD_ID = 'hh-savings';
const R10K = 1_000_000;
const R500 = 50_000;

const DEPS = { deviceId: 'device-1', actorUserId: 'user-1' };

function seedHousehold(db: Database.Database): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 1, ?, ?)`,
  ).run(HOUSEHOLD_ID, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  name: string;
  envelopeType: string;
  periodStart: string;
  allocatedCents: number;
  createdAt?: string;
}

function seedEnvelope(db: Database.Database, args: SeedEnvelopeArgs): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(
    args.id,
    HOUSEHOLD_ID,
    args.name,
    args.allocatedCents,
    args.envelopeType,
    args.periodStart,
    args.createdAt ?? NOW,
    args.createdAt ?? NOW,
  );
}

/** Writes the opening row EXACTLY as 1.1.130 did: ledger row in, column untouched. */
function seedLegacyBackfillWithoutZeroing(db: Database.Database, envelopeId: string): void {
  const row = db
    .prepare('SELECT allocated_cents, period_start FROM envelopes WHERE id = ?')
    .get(envelopeId) as { allocated_cents: number; period_start: string };
  db.prepare(
    `INSERT INTO envelope_contributions
       (id, household_id, envelope_id, amount_cents, period_start, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'opening_balance', ?, ?)`,
  ).run(
    openingContributionId(HOUSEHOLD_ID, envelopeId),
    HOUSEHOLD_ID,
    envelopeId,
    row.allocated_cents,
    row.period_start,
    NOW,
    NOW,
  );
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function rollover(
  db: ExpoSQLiteDatabase<typeof schema>,
  from: string,
  to: string,
): ReturnType<StartNewPeriodUseCase['execute']> {
  return new StartNewPeriodUseCase(db, DEPS).execute({
    householdId: HOUSEHOLD_ID,
    fromPeriodStart: from,
    toPeriodStart: to,
  });
}

function savedCents(
  db: ExpoSQLiteDatabase<typeof schema>,
  envelopeId: string,
): Promise<number | undefined> {
  return getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID).then((map) => map.get(envelopeId));
}

function allocatedCents(raw: Database.Database, envelopeId: string): number {
  return (
    raw.prepare('SELECT allocated_cents AS a FROM envelopes WHERE id = ?').get(envelopeId) as {
      a: number;
    }
  ).a;
}

function countRows(raw: Database.Database, where: string): number {
  return (
    raw.prepare(`SELECT COUNT(*) AS n FROM envelope_contributions WHERE ${where}`).get() as {
      n: number;
    }
  ).n;
}

describe('legacy persistent envelopes (REG-4)', () => {
  it('keeps a legacy fund at its opening balance across rollovers until a monthly amount is confirmed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: R10K,
      createdAt: LEGACY_CREATED_AT,
    });
    const db = makeDb(raw);

    const backfill = await ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS);
    expect(backfill.success).toBe(true);
    if (!backfill.success) throw new Error('unreachable');
    expect(backfill.data).toEqual({ count: 1, zeroedCount: 1 });

    // The number MOVED: it is money in the ledger, and no longer a monthly
    // contribution sitting in the column inflating the budget.
    expect(await savedCents(db, 'env-emf')).toBe(R10K);
    expect(allocatedCents(raw, 'env-emf')).toBe(0);

    // Two rollovers add NOTHING — this is the R10 000 -> R20 000 -> R30 000
    // bug, and the false Baby Step 3 completion that came with it.
    await rollover(db, P1, P2);
    await rollover(db, P2, P3);
    expect(await savedCents(db, 'env-emf')).toBe(R10K);

    // Until the user says what they actually put in each month.
    const confirmed = await confirmMonthlyContribution(
      db,
      {
        householdId: HOUSEHOLD_ID,
        envelopeId: 'env-emf',
        monthlyCents: R500,
        periodStart: P3,
        currentMonthlyCents: 0,
      },
      DEPS,
    );
    expect(confirmed.success).toBe(true);
    expect(allocatedCents(raw, 'env-emf')).toBe(R500);
    // The marker carries no money.
    expect(await savedCents(db, 'env-emf')).toBe(R10K);

    // From here it grows by EXACTLY the confirmed amount, once per period.
    await rollover(db, P3, '2027-01-01');
    expect(await savedCents(db, 'env-emf')).toBe(R10K + R500);
    await rollover(db, '2027-01-01', '2027-02-01');
    expect(await savedCents(db, 'env-emf')).toBe(R10K + 2 * R500);

    raw.close();
  });

  it('converges a 1.1.130 device that already wrote its opening row without zeroing', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: R10K,
      createdAt: LEGACY_CREATED_AT,
    });
    seedLegacyBackfillWithoutZeroing(raw, 'env-emf');
    const db = makeDb(raw);

    // Exactly the 1.1.130 state: opening row present, column still R10 000.
    expect(await savedCents(db, 'env-emf')).toBe(R10K);
    expect(allocatedCents(raw, 'env-emf')).toBe(R10K);

    const corrected = await ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS);
    expect(corrected.success).toBe(true);
    if (!corrected.success) throw new Error('unreachable');
    // No second opening row is written — only the column is corrected.
    expect(corrected.data).toEqual({ count: 0, zeroedCount: 1 });
    expect(countRows(raw, "source = 'opening_balance'")).toBe(1);
    expect(allocatedCents(raw, 'env-emf')).toBe(0);
    expect(await savedCents(db, 'env-emf')).toBe(R10K);

    raw.close();
  });

  it('never re-zeroes a fund whose monthly amount the user has confirmed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: R10K,
      createdAt: LEGACY_CREATED_AT,
    });
    const db = makeDb(raw);

    await ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS);
    await confirmMonthlyContribution(
      db,
      {
        householdId: HOUSEHOLD_ID,
        envelopeId: 'env-emf',
        monthlyCents: R500,
        periodStart: P1,
        currentMonthlyCents: 0,
      },
      DEPS,
    );

    // A second device (or the next app foreground) runs the pass again.
    const again = await ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS);
    expect(again.success).toBe(true);
    if (!again.success) throw new Error('unreachable');
    expect(again.data).toEqual({ count: 0, zeroedCount: 0 });
    expect(allocatedCents(raw, 'env-emf')).toBe(R500);

    raw.close();
  });

  it('reports which funds still need their monthly amount confirmed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-legacy',
      name: 'Old Savings',
      envelopeType: 'savings',
      periodStart: P1,
      allocatedCents: R10K,
      createdAt: LEGACY_CREATED_AT,
    });
    seedEnvelope(raw, {
      id: 'env-new',
      name: 'Car Service',
      envelopeType: 'sinking_fund',
      periodStart: P1,
      allocatedCents: R500,
    });
    const db = makeDb(raw);
    await ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS);

    const state = await loadPersistentContributionState(db, HOUSEHOLD_ID);
    expect(state).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'env-legacy',
          monthlyCents: 0,
          needsMonthlyConfirmation: true,
        }),
        // Created after the cutoff: its allocation always meant "per month",
        // so there is nothing to ask about.
        expect.objectContaining({
          id: 'env-new',
          monthlyCents: R500,
          needsMonthlyConfirmation: false,
        }),
      ]),
    );

    raw.close();
  });

  it('never backfills a fund this client created itself, even just before the cutoff', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const db = makeDb(raw);

    // Created by THIS client, so its creation period was funded properly and
    // its allocation always meant "per month" — but its `created_at` is
    // whatever "now" is, which in the last hours before the cutoff is still
    // pre-cutoff. Its `initial` row is what proves it is not legacy.
    const created = await new CreateEnvelopeUseCase(
      db,
      new AuditLogger(db),
      {
        householdId: HOUSEHOLD_ID,
        name: 'Car Service',
        allocatedCents: R500,
        envelopeType: 'sinking_fund',
        periodStart: P1,
      },
      DEPS,
    ).execute();
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('unreachable');
    raw
      .prepare('UPDATE envelopes SET created_at = ? WHERE id = ?')
      .run(LEGACY_CREATED_AT, created.data.id);

    const backfill = await ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS);
    expect(backfill.success).toBe(true);
    if (!backfill.success) throw new Error('unreachable');
    expect(backfill.data).toEqual({ count: 0, zeroedCount: 0 });
    expect(allocatedCents(raw, created.data.id)).toBe(R500);
    expect(await savedCents(db, created.data.id)).toBe(R500);

    raw.close();
  });

  it('runs three concurrent backfills as one write, with every caller succeeding', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: R10K,
      createdAt: LEGACY_CREATED_AT,
    });
    const db = makeDb(raw);

    // The dashboard fires this three times on first mount
    // (usePersistentEnvelopeSavings + the focus effect + useBabySteps'
    // reconcile). Two of the three used to lose the primary-key race and
    // surface DB_ERROR on a screen that was otherwise fine.
    const results = await Promise.all([
      ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS),
      ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS),
      ensureOpeningBalances(db, HOUSEHOLD_ID, DEPS),
    ]);
    expect(results.every((r) => r.success)).toBe(true);

    expect(countRows(raw, "source = 'opening_balance'")).toBe(1);
    expect(await savedCents(db, 'env-emf')).toBe(R10K);

    raw.close();
  });
});

describe('funds created mid-period (REG-7)', () => {
  it('funds its creation period immediately, and the next rollover adds exactly one more', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const db = makeDb(raw);

    const created = await new CreateEnvelopeUseCase(
      db,
      new AuditLogger(db),
      {
        householdId: HOUSEHOLD_ID,
        name: 'Car Service',
        allocatedCents: R500,
        envelopeType: 'sinking_fund',
        periodStart: P1,
      },
      DEPS,
    ).execute();
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('unreachable');

    // Before this fix the fund read R0 until the NEXT payday, however much
    // the user had budgeted for it.
    expect(await savedCents(db, created.data.id)).toBe(R500);
    expect(countRows(raw, `envelope_id = '${created.data.id}'`)).toBe(1);

    // A rollover INTO the creation period cannot fund it a second time: the
    // creation row already occupies that period's deterministic id.
    const replay = await rollover(db, '2026-09-01', P1);
    expect(replay.success).toBe(true);
    if (!replay.success) throw new Error('unreachable');
    expect(replay.data.contributionCount).toBe(0);
    expect(await savedCents(db, created.data.id)).toBe(R500);

    // And the real NEXT period adds exactly one more contribution.
    const next = await rollover(db, P1, P2);
    expect(next.success).toBe(true);
    if (!next.success) throw new Error('unreachable');
    expect(next.data.contributionCount).toBe(1);
    expect(await savedCents(db, created.data.id)).toBe(2 * R500);

    const contributionId = periodContributionId(HOUSEHOLD_ID, created.data.id, P1);
    expect(countRows(raw, `id = '${contributionId}' AND source = 'initial'`)).toBe(1);

    raw.close();
  });
});

describe('manual saved-balance adjustments (SEC2-15)', () => {
  function adjust(
    db: ExpoSQLiteDatabase<typeof schema>,
    deltaCents: number,
    note = 'Moved in from the old savings account',
  ): ReturnType<AdjustSavedBalanceUseCase['execute']> {
    return new AdjustSavedBalanceUseCase(db, new AuditLogger(db), DEPS).execute({
      householdId: HOUSEHOLD_ID,
      envelopeId: 'env-emf',
      deltaCents,
      note,
      periodStart: P1,
    });
  }

  function seedFund(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: R500,
    });
    return makeDb(raw);
  }

  it('adds money the ledger never saw, and takes money back out', async () => {
    const raw = openMigratedDb();
    const db = seedFund(raw);

    const up = await adjust(db, R10K);
    expect(up.success).toBe(true);
    if (!up.success) throw new Error('unreachable');
    expect(up.data.savedCentsAfter).toBe(R10K);
    expect(await savedCents(db, 'env-emf')).toBe(R10K);

    const down = await adjust(db, -R500, 'Took R500 out for the vet');
    expect(down.success).toBe(true);
    if (!down.success) throw new Error('unreachable');
    expect(down.data.savedCentsAfter).toBe(R10K - R500);
    expect(await savedCents(db, 'env-emf')).toBe(R10K - R500);

    // Two separate adjustments, never collapsed onto one deterministic id.
    expect(countRows(raw, "source = 'adjustment'")).toBe(2);

    // The synced row carries ONLY the frozen 0016 column set: a new key would
    // throw inside the SHIPPED 1.1.130 puller (which inserts straight from
    // the pulled payload's keys) and pull-block that household. The reason
    // the user typed lives in the local audit log instead.
    const columns = Object.keys(
      raw
        .prepare("SELECT * FROM envelope_contributions WHERE source = 'adjustment' LIMIT 1")
        .get() as Record<string, unknown>,
    ).sort();
    expect(columns).toEqual([
      'amount_cents',
      'created_at',
      'deleted_at',
      'envelope_id',
      'household_id',
      'id',
      'period_start',
      'source',
      'updated_at',
    ]);
    const auditedReasons = (
      raw
        .prepare(
          "SELECT new_value_json AS j FROM audit_events WHERE entity_type = 'envelope_contribution' ORDER BY created_at, id",
        )
        .all() as { j: string }[]
    ).map((r) => (JSON.parse(r.j) as { note: string }).note);
    expect(auditedReasons.sort()).toEqual([
      'Moved in from the old savings account',
      'Took R500 out for the vet',
    ]);

    raw.close();
  });

  it('refuses to take a fund below zero, and refuses a blank reason', async () => {
    const raw = openMigratedDb();
    const db = seedFund(raw);
    await adjust(db, R500);

    const tooMuch = await adjust(db, -R10K);
    expect(tooMuch.success).toBe(false);
    if (tooMuch.success) throw new Error('unreachable');
    expect(tooMuch.error.code).toBe('NEGATIVE_BALANCE');

    const noReason = await adjust(db, R500, '   ');
    expect(noReason.success).toBe(false);
    if (noReason.success) throw new Error('unreachable');
    expect(noReason.error.code).toBe('INVALID_NOTE');

    expect(await savedCents(db, 'env-emf')).toBe(R500);
    expect(countRows(raw, "source = 'adjustment'")).toBe(1);

    raw.close();
  });

  it('refuses a period-scoped envelope, which holds no balance', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: P1,
      allocatedCents: R500,
    });
    const db = makeDb(raw);

    const result = await adjust(db, R500);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_PERSISTENT');

    raw.close();
  });
});
