import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISlipExtractor } from '../../domain/ports/ISlipExtractor';
import type { SlipExtraction } from '../../domain/slipScanning/types';
import type { SlipScanError, SlipScanErrorCode } from '../../domain/slipScanning/errors';
import type { ExtractSlipResponse } from '../../data/sync/extractSlipContract';

/**
 * Client-side ceiling on one `extract-slip` round trip.
 *
 * Without it a request that never settles (captive portal, dropped mobile
 * data mid-flight) left SlipProcessingScreen spinning on "Reading slip…"
 * forever — no error, no retry button, and the slip_queue row stuck at
 * 'processing'.
 *
 * Sized from the edge function's OWN budget (supabase/functions/extract-slip):
 * it aborts its OpenAI call at 30s, so a normal slow success — including the
 * membership/consent/rate-limit round trips and the writes either side —
 * still lands comfortably under 45s. (Its one retry only fires when the first
 * OpenAI call already returned 5xx, i.e. not a "normal slow success", so the
 * 60s worst case is deliberately not accommodated: at that point the user is
 * better served by the failure path than by a longer spinner.)
 */
const EXTRACT_TIMEOUT_MS = 45_000;

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
    // AbortController is guarded because this file also runs under
    // react-native-web/older RN runtimes where it may be absent; the
    // Promise.race below still produces the timeout failure there, the
    // request is simply left to finish unobserved.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        // Same shape the status mapping throws, so ExtractSlipUseCase marks
        // the row 'failed' and SlipProcessingScreen shows the existing
        // SLIP_OPENAI_UNREACHABLE copy + "Try again" / "Log manually".
        reject(mapStatus(0, 'Slip service timed out'));
      }, EXTRACT_TIMEOUT_MS);
    });

    let data: ExtractSlipResponse | null;
    let error: { message: string; context?: { status?: number } } | null;
    try {
      ({ data, error } = await Promise.race([
        this.supabase.functions.invoke<ExtractSlipResponse>('extract-slip', {
          body: { slip_id: slipId, household_id: householdId, images_base64: framesBase64 },
          ...(controller ? { signal: controller.signal } : {}),
        }),
        timeout,
      ]));
    } finally {
      // Cleared on every path — success, mapped failure, and timeout — so a
      // pending 45s timer can never keep the JS timer queue (or a Jest fake
      // timer run) alive after the call settles.
      clearTimeout(timer);
    }

    if (error) {
      const status = error.context?.status ?? 0;
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
