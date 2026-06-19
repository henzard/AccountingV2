/**
 * notify-event-handler.test.ts — WS4
 *
 * Tests the notify-event edge function handler logic with mocked Supabase + FCM.
 * Since the real function uses Deno, we replicate its handler logic in Jest-friendly form.
 */

// ─── Handler replica (mirrors supabase/functions/notify-event/index.ts) ──────

interface NotifyPayload {
  userId: string;
  title: string;
  body: string;
}

interface MockSupabase {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => Promise<{ data: { token: string }[] | null; error: unknown }>;
    };
  };
}

async function handleNotifyEvent(
  payload: NotifyPayload,
  supabase: MockSupabase,
  fcmKey: string | undefined,
  fetchFn: typeof fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: tokens, error } = await supabase
    .from('user_fcm_tokens')
    .select('token')
    .eq('user_id', payload.userId);

  if (error || !tokens || tokens.length === 0) {
    return { status: 200, body: { sent: 0 } };
  }

  if (!fcmKey) {
    return { status: 500, body: { error: 'FCM_SERVER_KEY not set' } };
  }

  let sent = 0;
  for (const { token } of tokens) {
    const res = await fetchFn('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${fcmKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        notification: { title: payload.title, body: payload.body },
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      }),
    });
    if (res.ok) sent++;
  }

  return { status: 200, body: { sent } };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function mockSupabase(tokens: { token: string }[] | null, error: unknown = null): MockSupabase {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: tokens, error }),
      }),
    }),
  };
}

const VALID_PAYLOAD: NotifyPayload = {
  userId: 'user-1',
  title: 'Budget Alert',
  body: 'You have overspent your Groceries envelope',
};

// ═════════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════════

describe('notify-event handler', () => {
  it('valid notification send returns {sent: N}', async () => {
    const supabase = mockSupabase([{ token: 'tok-1' }, { token: 'tok-2' }, { token: 'tok-3' }]);
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });

    const result = await handleNotifyEvent(
      VALID_PAYLOAD,
      supabase,
      'fcm-key-123',
      mockFetch as any,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 3 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Verify FCM request shape
    const call = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(call.to).toBe('tok-1');
    expect(call.notification.title).toBe('Budget Alert');
    expect(call.notification.body).toBe('You have overspent your Groceries envelope');
    expect(call.android.priority).toBe('high');
  });

  it('no FCM tokens returns {sent: 0}', async () => {
    const supabase = mockSupabase([]);

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, 'fcm-key-123', jest.fn());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 0 });
  });

  it('null tokens (query error) returns {sent: 0}', async () => {
    const supabase = mockSupabase(null);

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, 'fcm-key-123', jest.fn());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 0 });
  });

  it('supabase query error returns {sent: 0}', async () => {
    const supabase = mockSupabase(null, { message: 'DB error' });

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, 'fcm-key-123', jest.fn());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 0 });
  });

  it('missing FCM_SERVER_KEY returns 500', async () => {
    const supabase = mockSupabase([{ token: 'tok-1' }]);

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, undefined, jest.fn());

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'FCM_SERVER_KEY not set' });
  });

  it('empty string FCM_SERVER_KEY returns 500', async () => {
    const supabase = mockSupabase([{ token: 'tok-1' }]);

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, '', jest.fn());

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'FCM_SERVER_KEY not set' });
  });

  it('partial send failure — sent count is accurate', async () => {
    const supabase = mockSupabase([
      { token: 'tok-good-1' },
      { token: 'tok-bad' },
      { token: 'tok-good-2' },
    ]);
    const mockFetch = jest.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const parsed = JSON.parse(opts.body);
      if (parsed.to === 'tok-bad') {
        return Promise.resolve({ ok: false, status: 400 });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, 'fcm-key', mockFetch as any);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('all sends fail — returns {sent: 0}', async () => {
    const supabase = mockSupabase([{ token: 'tok-1' }, { token: 'tok-2' }]);
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await handleNotifyEvent(VALID_PAYLOAD, supabase, 'fcm-key', mockFetch as any);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 0 });
  });

  it('FCM request includes correct Authorization header', async () => {
    const supabase = mockSupabase([{ token: 'tok-1' }]);
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    const fcmKey = 'my-secret-fcm-key';

    await handleNotifyEvent(VALID_PAYLOAD, supabase, fcmKey, mockFetch as any);

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`key=${fcmKey}`);
  });

  it('handles missing userId gracefully (empty tokens)', async () => {
    const supabase = mockSupabase([]);
    const payload = { ...VALID_PAYLOAD, userId: '' };

    const result = await handleNotifyEvent(payload, supabase, 'fcm-key', jest.fn());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: 0 });
  });
});
