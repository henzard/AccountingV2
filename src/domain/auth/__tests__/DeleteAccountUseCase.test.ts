import { DeleteAccountUseCase } from '../DeleteAccountUseCase';
import type { PortableDb } from '../../../data/uow/UnitOfWork';

// ─── Fakes ────────────────────────────────────────────────────────────────
// Hand-rolled, like the other domain use-case tests (no real Supabase, no
// real SQLite): a fake client exposing only `functions.invoke` and
// `auth.signOut`, and an injected `wipe` so the local-database step is
// observable without a database.

interface InvokeResult {
  data: { deleted?: boolean } | null;
  error: unknown;
}

function makeSupabase(invokeResult: InvokeResult, signOutError: { message: string } | null = null) {
  const invoke = jest.fn().mockResolvedValue(invokeResult);
  const signOut = jest.fn().mockResolvedValue({ error: signOutError });
  return {
    client: { functions: { invoke }, auth: { signOut } },
    invoke,
    signOut,
  };
}

const fakeDb = {} as PortableDb;

function makeUseCase(
  supabase: ReturnType<typeof makeSupabase>,
  opts: { isOnline?: boolean; wipe?: jest.Mock } = {},
) {
  const wipe = opts.wipe ?? jest.fn().mockReturnValue(['households', 'transactions']);
  const uc = new DeleteAccountUseCase(supabase.client as any, fakeDb, {
    isOnline: () => opts.isOnline !== false,
    wipe,
  });
  return { uc, wipe };
}

describe('DeleteAccountUseCase', () => {
  it('invokes the edge function, wipes local data, then signs out', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const { uc, wipe } = makeUseCase(supabase);

    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(supabase.invoke).toHaveBeenCalledWith('delete-account', { body: {} });
    expect(wipe).toHaveBeenCalledWith(fakeDb);
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

  it('reports LOCAL_WIPE_FAILED without signing out when the wipe throws', async () => {
    const supabase = makeSupabase({ data: { deleted: true }, error: null });
    const wipe = jest.fn(() => {
      throw new Error('database is locked');
    });
    const { uc } = makeUseCase(supabase, { wipe });

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LOCAL_WIPE_FAILED');
    expect(supabase.signOut).not.toHaveBeenCalled();
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
