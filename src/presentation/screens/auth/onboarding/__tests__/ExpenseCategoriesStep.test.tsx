/**
 * ExpenseCategoriesStep.test.tsx — B1
 *
 * Tests:
 *   - Default chips render (Groceries, Transport, Rent, Utilities pre-selected).
 *   - Selecting chips and saving calls CreateEnvelopeUseCase per selected category
 *     with envelopeType: 'spending' (or 'savings' for the Savings chip).
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('Text', p, children);
  const Button = ({
    children,
    onPress,
    testID,
    disabled,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, disabled, ...p },
      React.createElement('Text', {}, children),
    );
  const Chip = ({
    children,
    onPress,
    testID,
    selected,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    selected?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, accessibilityState: { selected }, ...p },
      React.createElement('Text', {}, children),
    );
  const HelperText = ({ children, type }: { children?: React.ReactNode; type?: string }) =>
    React.createElement('Text', { testID: `helper-${type}` }, children);
  return { Text, Button, Chip, HelperText };
});

// ─── appStore mock ────────────────────────────────────────────────────────────
jest.mock('../../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: 'hh-test', paydayDay: 25 }),
  ),
}));

// ─── CreateEnvelopeUseCase mock ───────────────────────────────────────────────
jest.mock('../../../../../domain/envelopes/CreateEnvelopeUseCase', () => ({
  CreateEnvelopeUseCase: jest.fn(),
}));

// ─── BudgetPeriodEngine mock ──────────────────────────────────────────────────
jest.mock('../../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    })),
  })),
}));

// ─── DB / AuditLogger mocks ───────────────────────────────────────────────────
jest.mock('../../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

import { ExpenseCategoriesStep } from '../ExpenseCategoriesStep';
import { CreateEnvelopeUseCase } from '../../../../../domain/envelopes/CreateEnvelopeUseCase';

const MockCreateEnvelopeUseCase = CreateEnvelopeUseCase as jest.Mock;

describe('ExpenseCategoriesStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const mockExecute = jest.fn().mockResolvedValue({ success: true, data: { id: 'env-new' } });
    MockCreateEnvelopeUseCase.mockImplementation(() => ({ execute: mockExecute }));
  });

  it('renders default category chips', () => {
    const { getByTestId } = render(<ExpenseCategoriesStep />);
    // Default categories are pre-selected by default state
    expect(getByTestId('category-Groceries')).toBeTruthy();
    expect(getByTestId('category-Transport')).toBeTruthy();
    expect(getByTestId('category-Rent')).toBeTruthy();
    expect(getByTestId('category-Utilities')).toBeTruthy();
    expect(getByTestId('category-Savings')).toBeTruthy();
    expect(getByTestId('category-Entertainment')).toBeTruthy();
  });

  it('calls CreateEnvelopeUseCase for each selected category with spending type', async () => {
    const { getByText, getByTestId } = render(<ExpenseCategoriesStep />);

    // Default selection: Groceries, Transport, Rent, Utilities
    // Deselect Transport to simplify assertion
    fireEvent.press(getByTestId('category-Transport'));
    // Add Entertainment
    fireEvent.press(getByTestId('category-Entertainment'));

    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      // Should be called for: Groceries, Rent, Utilities, Entertainment (4 calls)
      expect(MockCreateEnvelopeUseCase).toHaveBeenCalledTimes(4);
      // All non-Savings categories should use 'spending' type
      const calls = MockCreateEnvelopeUseCase.mock.calls;
      const envelopeTypes = calls.map(
        (c: unknown[]) => (c[2] as { envelopeType: string }).envelopeType,
      );
      expect(envelopeTypes.every((t: string) => t === 'spending')).toBe(true);
      expect(mockNavigate).toHaveBeenCalledWith('Payday');
    });
  });

  it('uses savings type for the Savings category', async () => {
    const { getByText, getByTestId } = render(<ExpenseCategoriesStep />);

    // Deselect everything except Savings
    fireEvent.press(getByTestId('category-Groceries'));
    fireEvent.press(getByTestId('category-Transport'));
    fireEvent.press(getByTestId('category-Rent'));
    fireEvent.press(getByTestId('category-Utilities'));
    // Add Savings
    fireEvent.press(getByTestId('category-Savings'));

    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      const savingsCall = MockCreateEnvelopeUseCase.mock.calls.find(
        (c: unknown[]) => (c[2] as { name: string }).name === 'Savings',
      );
      expect(savingsCall).toBeDefined();
      expect((savingsCall![2] as { envelopeType: string }).envelopeType).toBe('savings');
    });
  });
});
