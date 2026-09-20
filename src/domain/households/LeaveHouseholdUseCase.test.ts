import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

const mockRequestSyncNow = jest.fn<Promise<void>, [string]>();
jest.mock('../../data/sync/syncRuntime', () => ({
  requestSyncNow: (householdId: string): Promise<void> => mockRequestSyncNow(householdId),
}));

import { LeaveHouseholdUseCase } from './LeaveHouseholdUseCase';

interface MemberRow {
  id: string;
  householdId: string;
  userId: string;
  role: string;
}

/** Minimal stand-in for the one query the use case runs: every ACTIVE
 * `household_members` row for the household. */
function makeDb(rows: MemberRow[]): ExpoSQLiteDatabase<typeof schema> {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function makeRepo(): jest.Mocked<SyncedRepo> {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

const OWNER: MemberRow = { id: 'hm-owner', householdId: 'hh-1', userId: 'u-owner', role: 'owner' };
const CO_OWNER: MemberRow = {
  id: 'hm-owner-2',
  householdId: 'hh-1',
  userId: 'u-owner-2',
  role: 'owner',
};
const MEMBER: MemberRow = {
  id: 'hm-member',
  householdId: 'hh-1',
  userId: 'u-member',
  role: 'member',
};

describe('LeaveHouseholdUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestSyncNow.mockResolvedValue(undefined);
  });

  it('soft-deletes the caller’s own membership row through the synced repo', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ householdId: 'hh-1' });
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
    expect(repo.softDelete.mock.calls[0][0]).toBe('hm-member');
    expect(repo.softDelete.mock.calls[0][1]).toBe('hh-1');
    expect(mockRequestSyncNow).toHaveBeenCalledWith('hh-1');
  });

  it('lets an owner leave when another active owner remains', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, CO_OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-owner' },
      { repo },
    ).execute();

    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledWith('hm-owner', 'hh-1', expect.anything());
  });

  it('refuses BEFORE writing when the caller is the only owner and members remain', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-owner' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('LAST_OWNER');
    expect(result.error.message).toMatch(/become an owner before you can leave/);
    // The real guarantee is apply_one_op's `last_owner` rejection, but that
    // surfaces only as a dead letter long after the fact — nothing may be
    // written here.
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });

  it('refuses a sole owner with no other members, matching the server rule', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER]),
      { householdId: 'hh-1', userId: 'u-owner' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('LAST_OWNER');
    expect(result.error.message).toMatch(/nobody to hand it over to/);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('fails with NOT_A_MEMBER when the caller has no active membership row', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER]),
      { householdId: 'hh-1', userId: 'u-stranger' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('NOT_A_MEMBER');
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('fails with LEAVE_FAILED when the synced write throws', async () => {
    const repo = makeRepo();
    repo.softDelete.mockImplementation(() => {
      throw new Error('no row matched');
    });

    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({ code: 'LEAVE_FAILED', message: 'no row matched' });
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });

  it('still succeeds when the sync request rejects — the delete op is already committed locally', async () => {
    const repo = makeRepo();
    mockRequestSyncNow.mockRejectedValue(new Error('offline'));

    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
  });
});
