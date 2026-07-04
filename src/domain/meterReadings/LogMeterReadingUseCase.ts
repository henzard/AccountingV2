import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { DrizzleMeterReadingRepository } from '../../data/repositories/DrizzleMeterReadingRepository';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { IMeterReadingRepository } from '../ports/IMeterReadingRepository';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { MeterReadingEntity, MeterType } from './MeterReadingEntity';

export interface LogMeterReadingInput {
  householdId: string;
  meterType: MeterType;
  readingValue: number;
  readingDate: string; // YYYY-MM-DD
  costCents: number | null;
  vehicleId: string | null;
  notes: string | null;
}

export class LogMeterReadingUseCase {
  private readonly repo: IMeterReadingRepository;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogMeterReadingInput,
    private readonly deps: SyncWriteDeps = {},
    repo?: IMeterReadingRepository,
  ) {
    this.repo = repo ?? new DrizzleMeterReadingRepository(db);
  }

  async execute(): Promise<Result<MeterReadingEntity>> {
    if (this.input.readingValue <= 0) {
      return createFailure({
        code: 'INVALID_READING',
        message: 'Reading value must be greater than zero',
      });
    }

    const existing = await this.repo.findByDate(
      this.input.householdId,
      this.input.meterType,
      this.input.readingDate,
    );
    if (existing) {
      return createFailure({
        code: 'DUPLICATE_READING',
        message: `A ${this.input.meterType} reading already exists for ${this.input.readingDate}`,
      });
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const reading: MeterReadingEntity = {
      id,
      householdId: this.input.householdId,
      meterType: this.input.meterType,
      readingValue: this.input.readingValue,
      readingDate: this.input.readingDate,
      costCents: this.input.costCents,
      vehicleId: this.input.vehicleId,
      notes: this.input.notes,
      createdAt: now,
      updatedAt: now,
    };

    const row: Record<string, unknown> = {
      id: reading.id,
      household_id: reading.householdId,
      meter_type: reading.meterType,
      reading_value: reading.readingValue,
      reading_date: reading.readingDate,
      cost_cents: reading.costCents,
      vehicle_id: reading.vehicleId,
      notes: reading.notes,
      created_at: reading.createdAt,
      updated_at: reading.updatedAt,
    };

    const syncedRepo = resolveSyncedRepo(this.db, 'meter_readings', this.deps);
    syncedRepo.insert(row, resolveSyncedRepoCtx(this.deps));

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'meter_reading',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id,
        meterType: this.input.meterType,
        readingValue: this.input.readingValue,
        readingDate: this.input.readingDate,
      },
    });

    return createSuccess(reading);
  }
}
