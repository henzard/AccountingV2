import { EdgeFunctionSlipExtractor } from '../EdgeFunctionSlipExtractor';

function makeExtractor(invokeResult: { data: any; error: any }) {
  const invoke = jest.fn().mockResolvedValue(invokeResult);
  const supabase = { functions: { invoke } } as any;
  return new EdgeFunctionSlipExtractor(supabase);
}

describe('EdgeFunctionSlipExtractor', () => {
  it('returns parsed extraction on 200', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: {
        merchant: 'PnP',
        slip_date: '2026-04-13',
        total_cents: 1000,
        items: [],
        raw_response: '{}',
        openai_cost_cents: 1,
      },
      error: null,
    });
    const supabase = { functions: { invoke } } as any;
    const extractor = new EdgeFunctionSlipExtractor(supabase);
    const result = await extractor.extract({
      slipId: 's1',
      householdId: 'h1',
      framesBase64: ['b'],
    });
    expect(result.merchant).toBe('PnP');
    expect(result.openaiCostCents).toBe(1);
  });

  it('maps items from response correctly', async () => {
    const extractor = makeExtractor({
      data: {
        merchant: 'Checkers',
        slip_date: '2026-05-01',
        total_cents: 5000,
        items: [
          {
            description: 'Milk',
            amount_cents: 2500,
            quantity: 2,
            suggested_envelope_id: 'env-1',
            confidence: 0.95,
          },
        ],
        raw_response: '{"ok":true}',
        openai_cost_cents: 2,
      },
      error: null,
    });
    const result = await extractor.extract({
      slipId: 's1',
      householdId: 'h1',
      framesBase64: ['b'],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      description: 'Milk',
      amountCents: 2500,
      quantity: 2,
      suggestedEnvelopeId: 'env-1',
      confidence: 0.95,
    });
  });

  it('throws SLIP_RATE_LIMITED_HOUSEHOLD on 429 household', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: null,
      error: { context: { status: 429 }, message: 'Household rate limit' },
    });
    const supabase = { functions: { invoke } } as any;
    const extractor = new EdgeFunctionSlipExtractor(supabase);
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({
      code: 'SLIP_RATE_LIMITED_HOUSEHOLD',
    });
  });

  it('throws SLIP_RATE_LIMITED_USER on 429 with user message', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { context: { status: 429 }, message: 'User rate limit exceeded' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_RATE_LIMITED_USER' });
  });

  it('throws SLIP_CONSENT_MISSING on 412', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: null,
      error: { context: { status: 412 }, message: 'Consent required' },
    });
    const supabase = { functions: { invoke } } as any;
    const extractor = new EdgeFunctionSlipExtractor(supabase);
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_CONSENT_MISSING' });
  });

  it('throws SLIP_PAYLOAD_TOO_LARGE on 413', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { context: { status: 413 }, message: 'Payload too large' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_PAYLOAD_TOO_LARGE' });
  });

  it('throws SLIP_UNREASONABLE_EXTRACTION on 422', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { context: { status: 422 }, message: 'Unreasonable' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_UNREASONABLE_EXTRACTION' });
  });

  it('throws SLIP_OPENAI_UNREACHABLE on 503', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { context: { status: 503 }, message: 'Service unavailable' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_OPENAI_UNREACHABLE' });
  });

  it('throws SLIP_FORBIDDEN on 403', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { context: { status: 403 }, message: 'Forbidden' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_FORBIDDEN' });
  });

  it('throws SLIP_OPENAI_UNREACHABLE on unknown status code', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { context: { status: 500 }, message: 'Internal error' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_OPENAI_UNREACHABLE' });
  });

  it('throws on empty data (no error, but null data)', async () => {
    const extractor = makeExtractor({ data: null, error: null });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_OPENAI_UNREACHABLE', message: 'Empty response' });
  });

  it('defaults to status 0 when error.context is missing', async () => {
    const extractor = makeExtractor({
      data: null,
      error: { message: 'Network failure' },
    });
    await expect(
      extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
    ).rejects.toMatchObject({ code: 'SLIP_OPENAI_UNREACHABLE', message: 'Network failure' });
  });

  // A-3: a request that never settles (captive portal, mobile data dropped
  // mid-flight) previously left "Reading slip…" spinning forever — invoke()
  // has no client-side deadline of its own.
  describe('client-side timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('fails with SLIP_OPENAI_UNREACHABLE when the edge function never responds', async () => {
      // A promise that never settles — exactly what a dead socket looks like.
      const invoke = jest.fn().mockReturnValue(new Promise(() => {}));
      const supabase = { functions: { invoke } } as any;
      const extractor = new EdgeFunctionSlipExtractor(supabase);

      const promise = extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] });
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'SLIP_OPENAI_UNREACHABLE',
      });

      // The edge function aborts its own OpenAI call at 30s, so the client
      // deadline must sit beyond that — nothing may fire at 30s.
      await jest.advanceTimersByTimeAsync(30_000);
      await jest.advanceTimersByTimeAsync(20_000);

      await assertion;
    });

    it('aborts the in-flight request when the timeout fires', async () => {
      const invoke = jest.fn().mockReturnValue(new Promise(() => {}));
      const supabase = { functions: { invoke } } as any;
      const extractor = new EdgeFunctionSlipExtractor(supabase);

      const promise = extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] });
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'SLIP_OPENAI_UNREACHABLE',
      });

      const signal: AbortSignal = invoke.mock.calls[0][1].signal;
      expect(signal.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(50_000);
      await assertion;

      expect(signal.aborted).toBe(true);
    });

    it('clears the timeout timer on a successful response', async () => {
      const extractor = makeExtractor({
        data: {
          merchant: 'PnP',
          slip_date: '2026-04-13',
          total_cents: 1000,
          items: [],
          raw_response: '{}',
          openai_cost_cents: 1,
        },
        error: null,
      });
      await extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('clears the timeout timer on a mapped failure response', async () => {
      const extractor = makeExtractor({
        data: null,
        error: { context: { status: 429 }, message: 'Household rate limit' },
      });
      await expect(
        extractor.extract({ slipId: 's1', householdId: 'h1', framesBase64: ['b'] }),
      ).rejects.toMatchObject({ code: 'SLIP_RATE_LIMITED_HOUSEHOLD' });
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
