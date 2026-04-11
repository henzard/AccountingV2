import {
  getMeterTypeLabel,
  getMeterUnitLabel,
  getMeterIcon,
  getReadingDisplayDate,
} from '../MeterReadingEntity';
import type { MeterReadingEntity } from '../MeterReadingEntity';

const base: MeterReadingEntity = {
  id: 'm1',
  householdId: 'h1',
  meterType: 'electricity',
  readingValue: 1500,
  readingDate: '2026-04-01',
  costCents: null,
  vehicleId: null,
  notes: null,
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-01T08:00:00.000Z',
  isSynced: false,
};

describe('MeterReadingEntity', () => {
  it('getMeterTypeLabel returns human label for each type', () => {
    expect(getMeterTypeLabel('electricity')).toBe('Electricity');
    expect(getMeterTypeLabel('water')).toBe('Water');
    expect(getMeterTypeLabel('odometer')).toBe('Vehicle');
  });

  it('getMeterUnitLabel returns unit string for each type', () => {
    expect(getMeterUnitLabel('electricity')).toBe('kWh');
    expect(getMeterUnitLabel('water')).toBe('kL');
    expect(getMeterUnitLabel('odometer')).toBe('km');
  });

  it('getMeterIcon returns a non-empty string for each type', () => {
    expect(getMeterIcon('electricity').length).toBeGreaterThan(0);
    expect(getMeterIcon('water').length).toBeGreaterThan(0);
    expect(getMeterIcon('odometer').length).toBeGreaterThan(0);
  });

  it('getReadingDisplayDate formats date as "d MMM yyyy"', () => {
    expect(getReadingDisplayDate(base)).toBe('1 Apr 2026');
  });
});
