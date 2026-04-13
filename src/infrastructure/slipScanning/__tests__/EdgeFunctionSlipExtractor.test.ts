import { EdgeFunctionSlipExtractor } from '../EdgeFunctionSlipExtractor';

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
});
