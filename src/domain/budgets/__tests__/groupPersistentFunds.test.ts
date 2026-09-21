/**
 * `groupPersistentFunds` — the rule that decides WHICH envelope row carries a
 * persistent fund's money when a household holds several rows for one fund.
 *
 * A pure function, tested purely: it is the whole reason one month's saving is
 * credited once instead of once per duplicate, and its carrier choice has to
 * be identical on every device (the contribution's id is derived from the
 * carrier's id — see `periodContributionId`), so the ordering rule itself is
 * worth pinning independently of the rollover that consumes it.
 * `tests/realsql/rolloverRealHouseholdShape.test.ts` covers the same rule
 * end to end against the real household's 18 "Saving" rows.
 */
import { groupPersistentFunds, persistentFundKey } from '../PersistentContributions';

interface Row {
  id: string;
  name: string;
  envelopeType: string;
  isArchived: boolean;
  createdAt: string;
}

function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    name: 'Saving',
    envelopeType: 'savings',
    isArchived: false,
    createdAt: '2025-03-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('groupPersistentFunds', () => {
  it('collapses duplicates of one fund and carries it on the earliest-created row', () => {
    const groups = groupPersistentFunds([
      row({ id: 'b', createdAt: '2025-05-20T00:00:00.000Z' }),
      row({ id: 'a', createdAt: '2025-03-20T00:00:00.000Z' }),
      row({ id: 'c', createdAt: '2025-04-20T00:00:00.000Z' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].representative.id).toBe('a');
    expect(groups[0].members.map((member) => member.id)).toEqual(['a', 'c', 'b']);
  });

  it('breaks a created_at tie on the lowest id, so both devices agree', () => {
    const sameInstant = '2025-03-20T00:00:00.000Z';
    const groups = groupPersistentFunds([
      row({ id: 'env-z', createdAt: sameInstant }),
      row({ id: 'env-a', createdAt: sameInstant }),
    ]);

    expect(groups[0].representative.id).toBe('env-a');
  });

  it('does not depend on the order the rows arrive in', () => {
    const rows = [
      row({ id: 'b', createdAt: '2025-05-20T00:00:00.000Z' }),
      row({ id: 'a', createdAt: '2025-03-20T00:00:00.000Z' }),
    ];

    expect(groupPersistentFunds(rows)[0].representative.id).toBe(
      groupPersistentFunds([...rows].reverse())[0].representative.id,
    );
  });

  it('matches names case-insensitively and trimmed, the way history matching does', () => {
    const groups = groupPersistentFunds([
      row({ id: 'a', name: 'Saving' }),
      row({ id: 'b', name: '  saving ' }),
      row({ id: 'c', name: 'SAVING' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it('keeps same-named funds of DIFFERENT types apart', () => {
    const groups = groupPersistentFunds([
      row({ id: 'a', name: 'Car', envelopeType: 'sinking_fund' }),
      row({ id: 'b', name: 'Car', envelopeType: 'baby_step' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(persistentFundKey(groups[0].representative)).not.toBe(
      persistentFundKey(groups[1].representative),
    );
  });

  it('ignores period-scoped and archived rows entirely', () => {
    const groups = groupPersistentFunds([
      row({ id: 'spend', name: 'Food', envelopeType: 'spending' }),
      row({ id: 'archived', createdAt: '2025-01-20T00:00:00.000Z', isArchived: true }),
      row({ id: 'live' }),
    ]);

    expect(groups).toHaveLength(1);
    // The archived row is older, but an archived duplicate must never carry a
    // live fund's money.
    expect(groups[0].representative.id).toBe('live');
    expect(groups[0].members).toHaveLength(1);
  });

  it('returns nothing for a household with no persistent envelopes', () => {
    expect(groupPersistentFunds([])).toEqual([]);
  });
});
