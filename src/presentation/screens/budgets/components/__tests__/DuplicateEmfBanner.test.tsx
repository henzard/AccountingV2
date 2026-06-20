import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Text', { testID, ...p }, children),
    Surface: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('View', { testID, ...p }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const mockDismiss = jest.fn();
let mockHasFlag = true;

jest.mock('../../../../hooks/useEmergencyFundReconcileFlag', () => ({
  useEmergencyFundReconcileFlag: () => ({ hasFlag: mockHasFlag, dismiss: mockDismiss }),
}));

import { DuplicateEmfBanner } from '../DuplicateEmfBanner';

describe('DuplicateEmfBanner', () => {
  beforeEach(() => {
    mockHasFlag = true;
    mockDismiss.mockClear();
  });

  it('renders banner when hasFlag is true', () => {
    const { getByTestId } = render(<DuplicateEmfBanner />);
    expect(getByTestId('duplicate-emf-banner')).toBeTruthy();
  });

  it('shows the duplicate EMF copy', () => {
    const { getByTestId } = render(<DuplicateEmfBanner />);
    expect(getByTestId('duplicate-emf-copy')).toBeTruthy();
  });

  it('returns null when hasFlag is false', () => {
    mockHasFlag = false;
    const { queryByTestId } = render(<DuplicateEmfBanner />);
    expect(queryByTestId('duplicate-emf-banner')).toBeNull();
  });

  it('calls dismiss when close button pressed', () => {
    const { getByTestId } = render(<DuplicateEmfBanner />);
    fireEvent.press(getByTestId('duplicate-emf-dismiss'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
