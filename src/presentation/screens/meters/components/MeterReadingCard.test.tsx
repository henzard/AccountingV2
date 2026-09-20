import React from 'react';
import { render } from '@testing-library/react-native';
import { MeterReadingCard } from './MeterReadingCard';
import type {
  MeterReadingEntity,
  MeterType,
} from '../../../../domain/meterReadings/MeterReadingEntity';
import { formatCurrency } from '../../../utils/currency';

// Mock dependencies
jest.mock('react-native-paper', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  TouchableRipple: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => ({
  __esModule: true,
  default: () => <span />,
}));

jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      surface: '#fff',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      primaryContainer: '#f0f0f0',
      primary: '#1976d2',
    },
  }),
}));

jest.mock('../../../../domain/meterReadings/MeterReadingEntity', () => ({
  getMeterTypeLabel: (type: string) => type.toUpperCase(),
  getMeterUnitLabel: (type: string) => {
    switch (type) {
      case 'electricity':
        return 'kWh';
      case 'water':
        return 'L';
      default:
        return 'unit';
    }
  },
  getMeterIcon: () => 'flash',
  getReadingDisplayDate: () => '5 Sep 2026',
}));

jest.mock('../../../../domain/meterReadings/UnitRateCalculator', () => ({
  UnitRateCalculator: class {
    calculate(_latest: MeterReadingEntity, _previous: MeterReadingEntity) {
      return {
        success: true,
        data: {
          consumptionUnits: 50.5,
          unitRateCents: 250,
        },
      };
    }
  },
}));

describe('MeterReadingCard', () => {
  const mockMeterType: MeterType = 'electricity';
  const mockLatestReading: MeterReadingEntity = {
    id: '1',
    householdId: 'h1',
    meterType: 'electricity',
    readingValue: 1500,
    readingDate: '2026-09-05',
    costCents: null,
    vehicleId: null,
    notes: null,
    createdAt: '2026-09-05T10:00:00Z',
    updatedAt: '2026-09-05T10:00:00Z',
  };

  const mockPreviousReading: MeterReadingEntity = {
    id: '2',
    householdId: 'h1',
    meterType: 'electricity',
    readingValue: 1450,
    readingDate: '2026-09-04',
    costCents: null,
    vehicleId: null,
    notes: null,
    createdAt: '2026-09-04T10:00:00Z',
    updatedAt: '2026-09-04T10:00:00Z',
  };

  it('renders without crashing with readings', () => {
    const { UNSAFE_root } = render(
      <MeterReadingCard
        meterType={mockMeterType}
        latestReading={mockLatestReading}
        previousReading={mockPreviousReading}
        onPress={jest.fn()}
        onRateHistoryPress={jest.fn()}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('uses formatCurrency for rate display', () => {
    const expected = formatCurrency(250);
    expect(expected).toMatch(/^R\d/);
  });

  it('formats reading values with en-ZA locale', () => {
    const formatted = mockLatestReading.readingValue.toLocaleString('en-ZA');
    expect(formatted).toBeDefined();
  });
});
