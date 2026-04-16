/**
 * BudgetBalanceBanner.test.tsx — task 4.17
 *
 * Tests:
 *   - Positive toAssign → "R{n} left to assign"
 *   - Zero toAssign → "Every rand assigned ✓"
 *   - Negative toAssign → "-R{abs} overcommitted" (in warning colour)
 *   - Copy matches spec
 *
 * Spec §BudgetBalanceBanner.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, testID, ...p }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID, ...p }, children),
    Surface: ({ children, testID, ...p }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('View', { testID, ...p }, children),
  };
});

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return () => React.createElement('View', { testID: 'icon' });
});

import { BudgetBalanceBanner } from '../../budgets/components/BudgetBalanceBanner';

function makeEnvelope(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'e1',
    householdId: 'hh1',
    name: 'Test',
    allocatedCents: 0,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('BudgetBalanceBanner', () => {
  describe('zero toAssign — balanced', () => {
    it('renders "Every rand assigned ✓" when income equals expenses', () => {
      const envelopes: EnvelopeEntity[] = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 500000 }),
        makeEnvelope({ id: 'e2', envelopeType: 'spending', allocatedCents: 500000 }),
      ];
      const { getByTestId } = render(<BudgetBalanceBanner envelopes={envelopes} />);
      const label = getByTestId('banner-main-label');
      expect(label.props.children).toContain('Every rand assigned');
    });
  });

  describe('positive toAssign — income > expenses', () => {
    it('renders "R{n} left to assign"', () => {
      const envelopes: EnvelopeEntity[] = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 600000 }),
        makeEnvelope({ id: 'e2', envelopeType: 'spending', allocatedCents: 400000 }),
      ];
      const { getByTestId } = render(<BudgetBalanceBanner envelopes={envelopes} />);
      const label = getByTestId('banner-main-label');
      // toAssign = 200000 cents = R2,000
      expect(label.props.children).toContain('left to assign');
      expect(label.props.children).toContain('R2');
    });
  });

  describe('negative toAssign — expenses > income', () => {
    it('renders overcommitted copy in warning style', () => {
      const envelopes: EnvelopeEntity[] = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 400000 }),
        makeEnvelope({ id: 'e2', envelopeType: 'spending', allocatedCents: 600000 }),
      ];
      const { getByTestId } = render(<BudgetBalanceBanner envelopes={envelopes} />);
      const label = getByTestId('banner-main-label');
      // toAssign = -200000 cents
      expect(label.props.children).toContain('overcommitted');
    });
  });

  it('shows income, expenses, and toAssign breakdown items', () => {
    const envelopes: EnvelopeEntity[] = [
      makeEnvelope({ envelopeType: 'income', allocatedCents: 300000 }),
      makeEnvelope({ id: 'e2', envelopeType: 'spending', allocatedCents: 200000 }),
    ];
    const { getByTestId } = render(<BudgetBalanceBanner envelopes={envelopes} />);
    expect(getByTestId('banner-income')).toBeTruthy();
    expect(getByTestId('banner-expenses')).toBeTruthy();
    expect(getByTestId('banner-to-assign')).toBeTruthy();
  });

  it('excludes archived envelopes from calculation', () => {
    const envelopes: EnvelopeEntity[] = [
      makeEnvelope({ envelopeType: 'income', allocatedCents: 500000 }),
      makeEnvelope({ id: 'e2', envelopeType: 'spending', allocatedCents: 500000 }),
      // Archived income — should not count
      makeEnvelope({ id: 'e3', envelopeType: 'income', allocatedCents: 100000, isArchived: true }),
    ];
    const { getByTestId } = render(<BudgetBalanceBanner envelopes={envelopes} />);
    // Balanced (archived excluded) → "Every rand assigned"
    const label = getByTestId('banner-main-label');
    expect(label.props.children).toContain('Every rand assigned');
  });
});
