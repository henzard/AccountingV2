import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

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

const completedItem = {
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
};

const failedItem = {
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
};

const processingItem = {
  ...completedItem,
  id: 'sq-3',
  status: 'processing',
  merchant: null,
  totalCents: null,
  createdAt: '2026-04-14T10:00:00Z',
  updatedAt: '2026-04-14T10:00:00Z',
};

const failedWithExtraction = {
  ...failedItem,
  id: 'sq-4',
  rawResponseJson: JSON.stringify({ merchant: 'Checkers', total: 200 }),
};

let mockSlipData: any[] = [completedItem, failedItem];

jest.mock('../../../hooks/useSlipHistory', () => ({
  useSlipHistory: () => mockSlipData,
}));

import { SlipQueueScreen } from '../SlipQueueScreen';

describe('SlipQueueScreen', () => {
  const mockRepo = { listByHousehold: jest.fn().mockResolvedValue([]) } as any;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockSlipData = [completedItem, failedItem];
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

  it('renders the screen container', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getByTestId('slip-queue-screen')).toBeTruthy();
  });

  it('renders the list', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getByTestId('slip-queue-list')).toBeTruthy();
  });

  it('displays merchant name for completed items', () => {
    const { getAllByText } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getAllByText('PnP').length).toBeGreaterThan(0);
  });

  it('displays "Scanning…" for items without merchant', () => {
    const { getAllByText } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getAllByText('Scanning…').length).toBeGreaterThan(0);
  });

  it('displays total in rands for items with totalCents', () => {
    const { getAllByText } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getAllByText('R150.00').length).toBeGreaterThan(0);
  });

  it('navigates to SlipConfirm when completed item is pressed', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-1'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipConfirm', { slipId: 'sq-1' });
  });

  it('navigates to SlipCapture when failed item (no extraction) is pressed', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-2'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipCapture', {
      householdId: 'hh-1',
      slipId: 'sq-2',
    });
  });

  it('navigates to SlipProcessing when processing item is pressed', () => {
    mockSlipData = [processingItem];
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-3'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipProcessing', { slipId: 'sq-3' });
  });

  it('navigates to SlipConfirm for failed item with valid extraction', () => {
    mockSlipData = [failedWithExtraction];
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-4'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipConfirm', {
      slipId: 'sq-4',
      extraction: { merchant: 'Checkers', total: 200 },
    });
  });

  it('shows empty state when no slips', () => {
    mockSlipData = [];
    const { getAllByText } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getAllByText(/No slips yet/i).length).toBeGreaterThan(0);
  });
});
