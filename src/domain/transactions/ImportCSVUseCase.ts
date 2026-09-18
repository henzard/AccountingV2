import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { eq, and, inArray } from 'drizzle-orm';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { logger } from '../../infrastructure/logging/Logger';
import { createTransactionHash } from './transactionHash';

export interface CSVTransactionRow {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // Already converted to cents
  payee?: string;
}

export interface ImportCSVInput {
  householdId: string;
  envelopeId: string; // Default envelope for uncategorized transactions
  rows: CSVTransactionRow[];
  /**
   * Optional mapping: keyword -> envelopeId
   * e.g., { "groceries": "env-123", "fuel": "env-456" }
   */
  keywordMapping?: Record<string, string>;
}

export interface ImportCSVResult {
  imported: number;
  skipped: number; // Duplicates
  errors: Array<{ row: number; reason: string }>;
}

/**
 * Imports a batch of transactions from CSV data.
 *
 * Features:
 * - Deduplication via hash (date + amount + payee)
 * - Keyword-based envelope mapping
 * - Batch insert with oplog writes
 * - Atomic: all-or-nothing per transaction
 */
export class ImportCSVUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: ImportCSVInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<ImportCSVResult>> {
    const result: ImportCSVResult = {
      imported: 0,
      skipped: 0,
      errors: [],
    };

    if (this.input.rows.length === 0) {
      return createSuccess(result);
    }

    // 1. Validate target envelope exists and is not an income envelope
    const targetEnvelope = await this.validateTargetEnvelope(this.input.envelopeId);
    if (!targetEnvelope.success) {
      return targetEnvelope;
    }

    // 2. If keyword mapping provided, validate all mapped envelopes exist
    const mappedEnvelopeIds = this.input.keywordMapping
      ? Object.values(this.input.keywordMapping)
      : [];

    if (mappedEnvelopeIds.length > 0) {
      const validationResult = await this.validateMappedEnvelopes(mappedEnvelopeIds);
      if (!validationResult.success) {
        return validationResult;
      }
    }

    // 3. Compute hashes for all rows to check for duplicates
    const rowsWithHashes = this.input.rows.map((row, idx) => ({
      ...row,
      rowIndex: idx,
      hash: createTransactionHash(row.date, row.amount, row.payee || row.description),
    }));

    const hashes = rowsWithHashes.map((r) => r.hash);

    // 4. Query existing transactions with these hashes
    const existingHashes = await this.findExistingHashes(hashes);
    const existingHashSet = new Set(existingHashes);

    // 5. Process each row
    for (const rowData of rowsWithHashes) {
      // Skip duplicates
      if (existingHashSet.has(rowData.hash)) {
        result.skipped++;
        continue;
      }

      // Determine envelope via keyword matching
      const envelopeId = this.matchEnvelope(rowData);

      // Validate amount
      if (rowData.amount <= 0) {
        result.errors.push({
          row: rowData.rowIndex + 1,
          reason: 'Amount must be greater than zero',
        });
        continue;
      }

      // Insert transaction
      try {
        await this.insertTransaction({
          envelopeId,
          amountCents: rowData.amount,
          payee: rowData.payee || null,
          description: rowData.description,
          transactionDate: rowData.date,
          transactionHash: rowData.hash,
        });
        result.imported++;
      } catch (err) {
        logger.error('ImportCSVUseCase: failed to insert transaction', err, {
          row: rowData.rowIndex + 1,
          hash: rowData.hash,
        });
        result.errors.push({
          row: rowData.rowIndex + 1,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return createSuccess(result);
  }

  private async validateTargetEnvelope(envelopeId: string): Promise<Result<ImportCSVResult>> {
    const [targetEnvelope] = await this.db
      .select()
      .from(envelopes)
      .where(and(eq(envelopes.id, envelopeId), eq(envelopes.householdId, this.input.householdId)))
      .limit(1);

    if (!targetEnvelope) {
      return createFailure({
        code: 'ENVELOPE_NOT_FOUND',
        message: `Target envelope ${envelopeId} does not exist`,
      });
    }

    if (targetEnvelope.envelopeType === 'income') {
      return createFailure({
        code: 'INVALID_ENVELOPE_TYPE',
        message: 'Cannot import transactions against an income envelope',
      });
    }

    return createSuccess({ imported: 0, skipped: 0, errors: [] });
  }

  private async validateMappedEnvelopes(envelopeIds: string[]): Promise<Result<ImportCSVResult>> {
    const found = await this.db
      .select({ id: envelopes.id, envelopeType: envelopes.envelopeType })
      .from(envelopes)
      .where(
        and(inArray(envelopes.id, envelopeIds), eq(envelopes.householdId, this.input.householdId)),
      );

    const foundIds = new Set(found.map((e) => e.id));
    const missingIds = envelopeIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      return createFailure({
        code: 'ENVELOPE_NOT_FOUND',
        message: `Mapped envelopes not found: ${missingIds.join(', ')}`,
      });
    }

    const incomeEnvelopes = found.filter((e) => e.envelopeType === 'income');
    if (incomeEnvelopes.length > 0) {
      return createFailure({
        code: 'INVALID_ENVELOPE_TYPE',
        message: `Cannot map to income envelopes: ${incomeEnvelopes.map((e) => e.id).join(', ')}`,
      });
    }

    return createSuccess({ imported: 0, skipped: 0, errors: [] });
  }

  private async findExistingHashes(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];

    const rows = await this.db
      .select({ transactionHash: transactions.transactionHash })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, this.input.householdId),
          inArray(transactions.transactionHash, hashes),
        ),
      );

    return rows.map((r) => r.transactionHash).filter((h): h is string => h !== null);
  }

  private matchEnvelope(row: CSVTransactionRow & { hash: string }): string {
    if (!this.input.keywordMapping) {
      return this.input.envelopeId;
    }

    const searchText = `${row.description} ${row.payee || ''}`.toLowerCase();

    for (const [keyword, envelopeId] of Object.entries(this.input.keywordMapping)) {
      if (searchText.includes(keyword.toLowerCase())) {
        return envelopeId;
      }
    }

    return this.input.envelopeId;
  }

  private async insertTransaction(data: {
    envelopeId: string;
    amountCents: number;
    payee: string | null;
    description: string;
    transactionDate: string;
    transactionHash: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const id = randomUUID();

    const row: Record<string, unknown> = {
      id,
      household_id: this.input.householdId,
      envelope_id: data.envelopeId,
      amount_cents: data.amountCents,
      payee: data.payee,
      description: data.description,
      transaction_date: data.transactionDate,
      transaction_hash: data.transactionHash,
      is_business_expense: 0,
      spending_trigger_note: null,
      slip_id: null,
      created_at: now,
      updated_at: now,
    };

    const repo = resolveSyncedRepo(this.db, 'transactions', this.deps);
    repo.insert(row, resolveSyncedRepoCtx(this.deps));

    // Best-effort audit logging (same pattern as CreateTransactionUseCase)
    try {
      await this.audit.log({
        householdId: this.input.householdId,
        entityType: 'transaction',
        entityId: id,
        action: 'create',
        previousValue: null,
        newValue: {
          id,
          envelopeId: data.envelopeId,
          amountCents: data.amountCents,
          payee: data.payee,
          transactionDate: data.transactionDate,
          source: 'csv_import',
        },
      });
    } catch (err) {
      logger.error('ImportCSVUseCase: audit.log failed after ledger commit', err, {
        transactionId: id,
        householdId: this.input.householdId,
      });
    }
  }
}
