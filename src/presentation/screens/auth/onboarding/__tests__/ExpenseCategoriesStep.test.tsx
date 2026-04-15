/**
 * ExpenseCategoriesStep.test.tsx — B1
 *
 * Tests:
 *   - Default chips render (Groceries, Transport, Rent, Utilities pre-selected).
 *   - Next navigates to AllocateEnvelopes with selected categories as params.
 *   - Shows error when no categories are selected.
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

import { ExpenseCategoriesStep } from '../ExpenseCategoriesStep';

describe('ExpenseCategoriesStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders default category chips', () => {
    const { getByTestId } = render(<ExpenseCategoriesStep />);
    expect(getByTestId('category-Groceries')).toBeTruthy();
    expect(getByTestId('category-Transport')).toBeTruthy();
    expect(getByTestId('category-Rent')).toBeTruthy();
    expect(getByTestId('category-Utilities')).toBeTruthy();
    expect(getByTestId('category-Savings')).toBeTruthy();
    expect(getByTestId('category-Entertainment')).toBeTruthy();
  });

  it('navigates to AllocateEnvelopes with selected categories', async () => {
    const { getByText, getByTestId } = render(<ExpenseCategoriesStep />);

    // Default selection: Groceries, Transport, Rent, Utilities
    // Deselect Transport, add Entertainment
    fireEvent.press(getByTestId('category-Transport'));
    fireEvent.press(getByTestId('category-Entertainment'));

    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('AllocateEnvelopes', {
        categories: expect.arrayContaining(['Groceries', 'Rent', 'Utilities', 'Entertainment']),
      });
    });
  });

  it('shows error when no categories are selected', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<ExpenseCategoriesStep />);

    // Deselect all defaults
    fireEvent.press(getByTestId('category-Groceries'));
    fireEvent.press(getByTestId('category-Transport'));
    fireEvent.press(getByTestId('category-Rent'));
    fireEvent.press(getByTestId('category-Utilities'));

    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
