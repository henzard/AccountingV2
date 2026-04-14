import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISlipExtractor } from '../../domain/ports/ISlipExtractor';
import type { SlipExtraction } from '../../domain/slipScanning/types';
import type { SlipScanError, SlipScanErrorCode } from '../../domain/slipScanning/errors';
import type { ExtractSlipResponse } from '../../data/sync/extractSlipContract';

function mapStatus(status: number, message: string): SlipScanError {
  let code: SlipScanErrorCode;
  switch (status) {
    case 412:
      code = 'SLIP_CONSENT_MISSING';
      break;
    case 413:
      code = 'SLIP_PAYLOAD_TOO_LARGE';
      break;
    case 429:
      code = message.toLowerCase().includes('user')
        ? 'SLIP_RATE_LIMITED_USER'
        : 'SLIP_RATE_LIMITED_HOUSEHOLD';
      break;
    case 422:
      code = 'SLIP_UNREASONABLE_EXTRACTION';
      break;
    case 503:
      code = 'SLIP_OPENAI_UNREACHABLE';
      break;
    case 403:
      code = 'SLIP_FORBIDDEN';
      break;
    default:
      code = 'SLIP_OPENAI_UNREACHABLE';
  }
  return { code, message };
}

export class EdgeFunctionSlipExtractor implements ISlipExtractor {
  constructor(private readonly supabase: SupabaseClient) {}

  async extract({
    slipId,
    householdId,
    framesBase64,
  }: {
    slipId: string;
    householdId: string;
    framesBase64: string[];
  }): Promise<SlipExtraction> {
    const { data, error } = await this.supabase.functions.invoke<ExtractSlipResponse>(
      'extract-slip',
      {
        body: { slip_id: slipId, household_id: householdId, images_base64: framesBase64 },
      },
    );

    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status ?? 0;
      throw mapStatus(status, error.message);
    }
    if (!data) throw mapStatus(0, 'Empty response');

    return {
      merchant: data.merchant,
      slipDate: data.slip_date,
      totalCents: data.total_cents,
      items: data.items.map((i) => ({
        description: i.description,
        amountCents: i.amount_cents,
        quantity: i.quantity,
        suggestedEnvelopeId: i.suggested_envelope_id,
        confidence: i.confidence,
      })),
      rawResponseJson: data.raw_response,
      openaiCostCents: data.openai_cost_cents,
    };
  }
}
