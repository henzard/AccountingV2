jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { DeleteAccountUseCase } from '../DeleteAccountUseCase';
import type { PortableDb } from '../../../data/uow/UnitOfWork';

// ─── Fakes ───────────────────────────────────────────────────────────────
// Hand-rolled, like the other domain use-case tests (no real Supabase, no
// real SQLite): a fake client exposing only `auth.getSession`,
// `functions.invoke` and `auth.signOut`, a `db.all()` that answers the
// pre-delete flush query from a scripted list, and injected `wipe`/`stopSync`
// so the local steps are observable without a database.

const USER = 'user-1';

interface InvokeResult {
  data: { deleted?: boolean; data_deleted?: boolean } | null;
  error: unknown;
}

function makeSupabase(invokeResult: InvokeResult, signOutError: { message: string } | null = null) {
  const invoke = jest.fn().mockResolvedValue(invokeResult);
  const signOut = jest.fn().mockResolvedValue({ error: signOutError });
  const getSession = jest.fn().mockResolvedValue({ data: { session: { user: { id: USER } } } });
  return {
    client: { functions: { invoke }, auth: { signOut, getSession } },
    invoke,
    signOut,
    getSession,
  };
}

/** One row of the per-household flush state the use case reads. */
interface FlushRow {
  household_id: string;
  unpushed_ops: number;
  other_members: number;
}

/**
 * A db whose `all()` returns the CURRENT scripted flush state. `onQuery` runs
 * before each read, so a test can model "the sync round pushed the backlog".
 */
function makeFlushDb(
  rows: FlushRow[],
  onQuery?: (reads: number) => FlushRow[] | undefined,
): { db: PortableDb } {
  let current = rows;
  let reads = 0;
  const db = {
    all: (): FlushRow[] => {
      reads += 1;
      const next = onQuery?.(reads);
      if (next) current = next;
      return current;
    },
  } as unknown as PortableDb;
  return { db };
}

function makeUseCase(
  supabase: ReturnType<typeof makeSupabase>,
  opts: {
    isOnline?: boolean;
    wipe?: jest.Mock;
    db?: PortableDb;
    requestSync?: jest.Mock;
    stopSync?: jest.Mock;
    order?: string[];
  } = {},
) {
  const order = opts.order ?? [];
  const wipe =
    opts.wipe ??
    jest.fn(() => {
      order.push('wipe');
      return ['households', 'transactions'];
    });
  const stopSync =
    opts.stopSync ??
    jest.fn(async () => {
      order.push('stopSync');
    });
  const requestSync = opts.requestSync ?? jest.fn().mockResolvedValue(undefined);
  const db = opts.db ?? makeFlushDb([]).db;
  const uc = new DeleteAccountUseCase(supabase.client as never, db, {
    isOnline: () => opts.isOnline !== false,
    wipe,
    stopSync,
    requestSync,
  });
  return { uc, wipe, stopSync, requestSync, db, order };
}

describe('DeleteAccountUseCase', () => {
  it('invokes the edge function, wipes local data, then signs out', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(supabase.invoke).toHaveBeenCalledWith('delete-account', { body: {} });
    expect(wipe).toHaveBeenCalled();
    expect(supabase.signOut).toHaveBeenCalled();
  });

  it('refuses offline without touching the server or the local database', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const { uc, wipe } = makeUseCase(supabase, { isOnline: false });

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NETWORK_REQUIRED');
    expect(supabase.invoke).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
    expect(supabase.signOut).not.toHaveBeenCalled();
  });

  it('does NOT wipe local data when the edge function returns an error', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { message: 'boom', context: { status: 500 } },
    });
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DELETE_FAILED');
    expect(wipe).not.toHaveBeenCalled();
    expect(supabase.signOut).not.toHaveBeenCalled();
  });

  it('maps a 401 from the edge function to NOT_AUTHENTICATED', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { message: 'Unauthorized', context: { status: 401 } },
    });
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_AUTHENTICATED');
    expect(wipe).not.toHaveBeenCalled();
  });

  it('does NOT wipe local data on a 200 that is not { deleted: true }', async () => {
    const supabase = makeSupabase({ data: { deleted: false }, error: null });
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DELETE_FAILED');
    expect(wipe).not.toHaveBeenCalled();
  });

  it('treats a thrown invoke as a failure and leaves local data alone', async () => {
    const supabase = makeSupabase({ data: null, error: null });
    supabase.invoke.mockRejectedValue(new Error('network down'));
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DELETE_FAILED');
    expect(wipe).not.toHaveBeenCalled();
  });

  it('still signs out when the wipe throws, and reports LOCAL_WIPE_FAILED afterwards', async () => {
    // REG-11: leaving the device signed in as a deleted account on top of a
    // half-wiped database is the worst of both outcomes.
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const wipe = jest.fn(() => {
      throw new Error('database is locked');
    });
    const { uc } = makeUseCase(supabase, { wipe });

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LOCAL_WIPE_FAILED');
    expect(supabase.signOut).toHaveBeenCalled();
  });

  it('reports SIGN_OUT_FAILED when sign-out fails after a successful delete', async () => {
    const supabase = makeSupabase(
      { data: { deleted: true }, error: null },
      {
        message: 'no session',
      },
    );
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SIGN_OUT_FAILED');
    expect(wipe).toHaveBeenCalled();
  });
});

describe('DeleteAccountUseCase — pre-delete flush gate (REG-11 / SEC2-6)', () => {
  it('runs a sync round for every household that still owes the server ops', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const { db } = makeFlushDb(
      [
        { household_id: 'hh-1', unpushed_ops: 3, other_members: 1 },
        { household_id: 'hh-2', unpushed_ops: 0, other_members: 1 },
      ],
      (reads) =>
        reads === 1
          ? undefined
          : [
              { household_id: 'hh-1', unpushed_ops: 0, other_members: 1 },
              { household_id: 'hh-2', unpushed_ops: 0, other_members: 1 },
            ],
    );
    const requestSync = jest.fn().mockResolvedValue(undefined);
    const { uc } = makeUseCase(supabase, { db, requestSync });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    // Only the household with a backlog is pushed.
    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(requestSync).toHaveBeenCalledWith('hh-1');
  });

  it('refuses the deletion when a SHARED household still has unpushed ops', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    // The round never lands the backlog (offline): the state never changes.
    const { db } = makeFlushDb([{ household_id: 'hh-1', unpushed_ops: 2, other_members: 1 }]);
    const requestSync = jest.fn().mockRejectedValue(new Error('could not reach the server'));
    const { uc, wipe } = makeUseCase(supabase, { db, requestSync });

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('UNSYNCED_CHANGES');
      expect(result.error.message).toMatch(/synced yet/);
    }
    expect(supabase.invoke).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
    expect(supabase.signOut).not.toHaveBeenCalled();
  });

  it('proceeds when the only household with unpushed ops is solo', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const { db } = makeFlushDb([{ household_id: 'hh-solo', unpushed_ops: 5, other_members: 0 }]);
    const requestSync = jest.fn().mockRejectedValue(new Error('offline'));
    const { uc, wipe } = makeUseCase(supabase, { db, requestSync });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(wipe).toHaveBeenCalled();
  });

  it('reports NOT_AUTHENTICATED (and touches nothing) without a session', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    supabase.getSession.mockResolvedValue({ data: { session: null } });
    const { uc, wipe, requestSync } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_AUTHENTICATED');
    expect(requestSync).not.toHaveBeenCalled();
    expect(supabase.invoke).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
  });
});

describe('DeleteAccountUseCase — teardown ordering and partial delete (REG-11)', () => {
  it('stops the sync runtime BEFORE wiping the local database', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const order: string[] = [];
    const { uc } = makeUseCase(supabase, { order });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(order).toEqual(['stopSync', 'wipe']);
  });

  it('still wipes and signs out when stopping the sync runtime throws', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const stopSync = jest.fn().mockRejectedValue(new Error('scheduler stuck'));
    const { uc, wipe } = makeUseCase(supabase, { stopSync });

    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(wipe).toHaveBeenCalled();
    expect(supabase.signOut).toHaveBeenCalled();
  });

  it('reports PARTIAL_DELETE for a data-only erasure and keeps the session', async () => {
    const supabase = makeSupabase({ data: { deleted: false, data_deleted: true }, error: null });
    const { uc, wipe, stopSync } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('PARTIAL_DELETE');
      expect(result.error.message).toMatch(/try again/i);
    }
    // Retryable: nothing local is destroyed and the user stays signed in.
    expect(stopSync).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
    expect(supabase.signOut).not.toHaveBeenCalled();
  });
});
