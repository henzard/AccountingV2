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
import { CreateTransactionUseCase } from '../../domain/transactions/CreateTransactionUseCase';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { BudgetPeriodEngine } from '../../domain/shared/BudgetPeriodEngine';
import { db } from '../../data/local/db';
import { supabase } from '../../data/remote/supabaseClient';
import { envelopes as envelopesTable } from '../../data/local/schema';
import { eq, ne, and } from 'drizzle-orm';
import { format } from 'date-fns';
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
  const periodStart = format(budgetEngine.getCurrentPeriod(paydayDay).startDate, 'yyyy-MM-dd');
  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);

  useEffect(() => {
    if (!householdId) return;
    db.select({
      id: envelopesTable.id,
      name: envelopesTable.name,
      allocatedCents: envelopesTable.allocatedCents,
      spentCents: envelopesTable.spentCents,
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
      .then((rows) => setEnvelopes(rows as EnvelopeOption[]))
      .catch(() => {});
  }, [householdId, periodStart]);

  const { start, progress } = useSlipScanner(slipFlow);

  const confirmSlipUseCase = useMemo(
    () =>
      new ConfirmSlipUseCase(
        db,
        (tx, input) =>
          new CreateTransactionUseCase(tx as unknown as typeof db, slipAudit, {
            householdId: input.householdId,
            envelopeId: input.envelopeId,
            amountCents: input.amountCents,
            transactionDate: input.transactionDate,
            payee: null,
            description: input.description,
            slipId: input.slipId,
          }),
        slipQueueRepo,
      ),
    [],
  );

  const recordConsent = useMemo(
    () =>
      async (userId: string): Promise<{ success: boolean }> => {
        const result = await recordConsentUseCase.execute({ userId });
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
      repo={slipQueueRepo}
      startScan={start}
      cancelSlip={cancelSlip}
      progress={progress}
      confirmSlip={confirmSlip}
      envelopes={envelopes}
    />
  );
}
