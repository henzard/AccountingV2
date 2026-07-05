/**
 * SlipScanningScreen
 *
 * Modal screen that wraps the full slip-scanning stack with all DI wired.
 * Extracted from RootNavigator so the navigator test can mock this file
 * without pulling in camera / AsyncStorage / expo-image-manipulator.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SlipScanningStackNavigator } from './SlipScanningStackNavigator';
import { useSlipScanner } from '../hooks/useSlipScanner';
import { SlipScanFlow } from '../../application/SlipScanFlow';
import { CaptureSlipUseCase } from '../../domain/slipScanning/CaptureSlipUseCase';
import { UploadSlipImagesUseCase } from '../../domain/slipScanning/UploadSlipImagesUseCase';
import { ExtractSlipUseCase } from '../../domain/slipScanning/ExtractSlipUseCase';
import { ConfirmSlipUseCase } from '../../domain/slipScanning/ConfirmSlipUseCase';
import { RecordSlipConsentUseCase } from '../../domain/slipScanning/RecordSlipConsentUseCase';
import { DrizzleSlipQueueRepository } from '../../data/repositories/DrizzleSlipQueueRepository';
import { DrizzleUserConsentRepository } from '../../data/repositories/DrizzleUserConsentRepository';
import { SupabaseSlipImageUploader } from '../../infrastructure/slipScanning/SupabaseSlipImageUploader';
import { ExpoSlipImageCompressor } from '../../infrastructure/slipScanning/ExpoSlipImageCompressor';
import { EdgeFunctionSlipExtractor } from '../../infrastructure/slipScanning/EdgeFunctionSlipExtractor';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../domain/shared/BudgetPeriodEngine';
import { db } from '../../data/local/db';
import { supabase } from '../../data/remote/supabaseClient';
import { envelopes as envelopesTable } from '../../data/local/schema';
import { getEnvelopeSpentCents } from '../../data/local/balances/EnvelopeBalanceQuery';
import { eq, ne, and } from 'drizzle-orm';
import { useAppStore } from '../stores/appStore';
import type { EnvelopeOption } from '../screens/slipScanning/components/EnvelopePickerSheet';

const budgetEngine = new BudgetPeriodEngine();

// Module-level singletons — stable across renders, created once per process.
const slipQueueRepo = new DrizzleSlipQueueRepository(db);
const userConsentRepo = new DrizzleUserConsentRepository(db);
const slipUploader = new SupabaseSlipImageUploader(supabase);
const slipCompressor = new ExpoSlipImageCompressor();
const slipExtractor = new EdgeFunctionSlipExtractor(supabase);
const slipAudit = new AuditLogger(db);

const captureSlipUseCase = new CaptureSlipUseCase(slipQueueRepo);
const uploadSlipImagesUseCase = new UploadSlipImagesUseCase(
  slipCompressor,
  slipUploader,
  slipQueueRepo,
);
const extractSlipUseCase = new ExtractSlipUseCase(slipExtractor, slipQueueRepo);
const slipFlow = new SlipScanFlow({
  captureSlip: captureSlipUseCase,
  uploadSlipImages: uploadSlipImagesUseCase,
  extractSlip: extractSlipUseCase,
});
const recordConsentUseCase = new RecordSlipConsentUseCase(userConsentRepo);

/**
 * Full slip-scanning modal with all DI resolved.
 * Registered as `SlipScanning` in RootNavigator.
 */
export function SlipScanningScreen(): React.JSX.Element {
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const session = useAppStore((s) => s.session);
  const createdBy = session?.user?.id ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const periodStart = formatPeriodDateKey(budgetEngine.getCurrentPeriod(paydayDay).startDate);
  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);
  // Whether the current user has already granted slip-scan consent — read
  // once per user so the queue's camera FAB can route straight to
  // SlipCapture instead of always detouring through SlipConsent. Defaults to
  // false (safe default) until resolved.
  const [hasConsented, setHasConsented] = useState(false);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setHasConsented(false);
      return;
    }
    let cancelled = false;
    userConsentRepo
      .get(userId)
      .then((row) => {
        if (!cancelled) setHasConsented(row?.slipScanConsentAt != null);
      })
      .catch(() => {
        if (!cancelled) setHasConsented(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!householdId) return;
    db.select({
      id: envelopesTable.id,
      name: envelopesTable.name,
      allocatedCents: envelopesTable.allocatedCents,
      envelopeType: envelopesTable.envelopeType,
    })
      .from(envelopesTable)
      .where(
        and(
          eq(envelopesTable.householdId, householdId),
          eq(envelopesTable.periodStart, periodStart),
          eq(envelopesTable.isArchived, false),
          ne(envelopesTable.envelopeType, 'income'),
        ),
      )
      .then(async (rows) => {
        // spentCents is derived from the transaction ledger, not a stored column.
        const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, periodStart);
        setEnvelopes(
          rows.map((row) => ({
            ...row,
            spentCents: spentByEnvelope.get(row.id) ?? 0,
          })) as EnvelopeOption[],
        );
      })
      .catch(() => {});
  }, [householdId, periodStart]);

  const { start, progress } = useSlipScanner(slipFlow);

  const confirmSlipUseCase = useMemo(
    () => new ConfirmSlipUseCase(db, slipQueueRepo, { audit: slipAudit }),
    [],
  );

  const recordConsent = useMemo(
    () =>
      async (userId: string): Promise<{ success: boolean }> => {
        const result = await recordConsentUseCase.execute({ userId });
        if (result.success) setHasConsented(true);
        return { success: result.success };
      },
    [],
  );

  const confirmSlip = useMemo(
    () =>
      async (input: {
        slipId: string;
        items: Array<{
          description: string;
          amountCents: number;
          envelopeId: string;
          transactionDate: string;
        }>;
        merchant: string | null;
        totalCents: number | null;
      }): Promise<{ success: boolean }> => {
        const result = await confirmSlipUseCase.execute({
          slipId: input.slipId,
          householdId,
          transactionDate: input.items[0]?.transactionDate ?? new Date().toISOString().slice(0, 10),
          items: input.items.map((i) => ({
            description: i.description,
            amountCents: i.amountCents,
            envelopeId: i.envelopeId,
          })),
        });
        return { success: result.success };
      },
    [confirmSlipUseCase, householdId],
  );

  const cancelSlip = useCallback(async (slipId: string): Promise<void> => {
    await slipQueueRepo.update(slipId, { status: 'cancelled' });
  }, []);

  return (
    <SlipScanningStackNavigator
      householdId={householdId}
      createdBy={createdBy}
      recordConsent={recordConsent}
      hasConsented={hasConsented}
      repo={slipQueueRepo}
      startScan={start}
      cancelSlip={cancelSlip}
      progress={progress}
      confirmSlip={confirmSlip}
      envelopes={envelopes}
    />
  );
}
