import { randomUUID } from 'expo-crypto';
import { format } from 'date-fns';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { DrizzleMeterReadingRepository } from '../../data/repositories/DrizzleMeterReadingRepository';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { IMeterReadingRepository } from '../ports/IMeterReadingRepository';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
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
    // (a) readingValue must be a finite number > 0
    if (!Number.isFinite(this.input.readingValue) || this.input.readingValue <= 0) {
      return createFailure({
        code: 'INVALID_READING',
        message: 'Reading value must be greater than zero',
      });
    }

    // (b) costCents, when provided, must be a safe integer >= 0
    if (this.input.costCents !== null) {
      if (!Number.isSafeInteger(this.input.costCents) || this.input.costCents < 0) {
        return createFailure({
          code: 'INVALID_READING',
          message: 'Cost must be a non-negative integer (in cents)',
        });
      }
    }

    // (c) reading date must not be in the future
    // Local calendar date, matching how the screen stamps `readingDate`. A UTC
    // date would reject today's reading between 00:00 and 02:00 SAST.
    const today = format(new Date(), 'yyyy-MM-dd');
    if (this.input.readingDate > today) {
      return createFailure({
        code: 'FUTURE_READING_DATE',
        message: 'Reading date cannot be in the future',
      });
    }

    // (d) reading must be >= the most recent EARLIER reading for the same meter type
    const allReadings = await this.repo.findByHousehold(
      this.input.householdId,
      this.input.meterType,
    );
    const sameMeter = allReadings.filter((r) => r.vehicleId === this.input.vehicleId);
    const previousReading = sameMeter
      .filter((r) => r.readingDate < this.input.readingDate)
      .sort((a, b) => b.readingDate.localeCompare(a.readingDate))[0];
    if (previousReading && this.input.readingValue < previousReading.readingValue) {
      return createFailure({
        code: 'READING_BELOW_PREVIOUS',
        message: `Reading value (${this.input.readingValue}) cannot be lower than the previous reading (${previousReading.readingValue}) on ${previousReading.readingDate}`,
      });
    }
    // A back-dated reading must also fit under the next later one.
    const nextReading = sameMeter
      .filter((r) => r.readingDate > this.input.readingDate)
      .sort((a, b) => a.readingDate.localeCompare(b.readingDate))[0];
    if (nextReading && this.input.readingValue > nextReading.readingValue) {
      return createFailure({
        code: 'READING_ABOVE_NEXT',
        message: `Reading value (${this.input.readingValue}) cannot be higher than the later reading (${nextReading.readingValue}) on ${nextReading.readingDate}`,
      });
    }

    // (e) duplicate-reading check (includes vehicleId)
    // Checked against the full list rather than `findByDate`, which returns a
    // single row and so can miss this vehicle when another shares the date.
    if (sameMeter.some((r) => r.readingDate === this.input.readingDate)) {
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

    await bestEffortAudit(this.audit, {
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
