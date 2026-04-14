import React from 'react';
import { render } from '@testing-library/react-native';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);
  const Chip = ({
    children,
    testID,
    textStyle: _textStyle,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    textStyle?: object;
    [k: string]: unknown;
  }) => React.createElement('View', { testID, ...p }, React.createElement('Text', {}, children));
  return { Text, Chip };
});

jest.mock('../../../hooks/useSlipHistory', () => ({
  useSlipHistory: () => [
    {
      id: 'sq-1',
      householdId: 'hh-1',
      createdBy: 'user-1',
      imageUris: '[]',
      status: 'completed',
      merchant: 'PnP',
      slipDate: '2026-04-13',
      totalCents: 15000,
      errorMessage: null,
      rawResponseJson: null,
      imagesDeletedAt: null,
      openaiCostCents: 1,
      createdAt: '2026-04-13T10:00:00Z',
      updatedAt: '2026-04-13T10:00:00Z',
      isSynced: false,
    },
    {
      id: 'sq-2',
      householdId: 'hh-1',
      createdBy: 'user-1',
      imageUris: '[]',
      status: 'failed',
      merchant: null,
      slipDate: null,
      totalCents: null,
      errorMessage: 'Network error',
      rawResponseJson: null,
      imagesDeletedAt: null,
      openaiCostCents: 0,
      createdAt: '2026-04-12T10:00:00Z',
      updatedAt: '2026-04-12T10:00:00Z',
      isSynced: false,
    },
  ],
}));

import { SlipQueueScreen } from '../SlipQueueScreen';

describe('SlipQueueScreen', () => {
  const mockRepo = { listByHousehold: jest.fn().mockResolvedValue([]) } as any;

  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders slip items', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getByTestId('slip-item-sq-1')).toBeTruthy();
    expect(getByTestId('slip-item-sq-2')).toBeTruthy();
  });

  it('shows status chip for each item', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getByTestId('slip-status-sq-1')).toBeTruthy();
    expect(getByTestId('slip-status-sq-2')).toBeTruthy();
  });
});
