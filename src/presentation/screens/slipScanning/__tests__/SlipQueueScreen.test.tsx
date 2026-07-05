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
  const FAB = ({
    testID,
    onPress,
    accessibilityLabel,
    accessibilityRole,
  }: {
    testID?: string;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    [k: string]: unknown;
  }) =>
    React.createElement('Pressable', { testID, onPress, accessibilityLabel, accessibilityRole });
  return { Text, Chip, FAB };
});

// Stored raw_response_json is the SNAKE_CASE OpenAI output the edge function
// persists (JSON.stringify(parsed)) — NOT a camelCase SlipExtraction.
const completedRawResponse = JSON.stringify({
  merchant: 'PnP',
  slip_date: '2026-04-13',
  total_cents: 15000,
  items: [
    {
      description: 'Bread',
      amount_cents: 5000,
      quantity: 1,
      suggested_envelope_id: 'e1',
      confidence: 0.9,
    },
  ],
});

const completedItem = {
  id: 'sq-1',
  householdId: 'hh-1',
  createdBy: 'user-1',
  imageUris: ['file:///f1.jpg'],
  status: 'completed',
  merchant: 'PnP',
  slipDate: '2026-04-13',
  totalCents: 15000,
  errorMessage: null,
  rawResponseJson: completedRawResponse,
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
  rawResponseJson: null,
  imageUris: ['file:///frame-a.jpg', 'file:///frame-b.jpg'],
  createdAt: '2026-04-14T10:00:00Z',
  updatedAt: '2026-04-14T10:00:00Z',
};

// A failed slip whose extraction had actually succeeded (raw populated) — the
// stored JSON is SNAKE_CASE, so it must be normalised before it can be handed
// to SlipConfirmScreen as a SlipExtraction.
const failedRawResponse = JSON.stringify({
  merchant: 'Checkers',
  slip_date: '2026-04-12',
  total_cents: 20000,
  items: [
    {
      description: 'Chips',
      amount_cents: 20000,
      quantity: 1,
      suggested_envelope_id: null,
      confidence: 0.7,
    },
  ],
});

const failedWithExtraction = {
  ...failedItem,
  id: 'sq-4',
  rawResponseJson: failedRawResponse,
};

// A failed slip whose raw response is present but malformed (not a valid
// extraction) — must fall back to a re-scan rather than crash.
const failedWithGarbageExtraction = {
  ...failedItem,
  id: 'sq-5',
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

  it('navigates to SlipConfirm with a hydrated extraction when completed item is pressed (H5)', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-1'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipConfirm', {
      slipId: 'sq-1',
      extraction: expect.objectContaining({
        merchant: 'PnP',
        slipDate: '2026-04-13',
        totalCents: 15000,
        items: [
          expect.objectContaining({
            description: 'Bread',
            amountCents: 5000,
            suggestedEnvelopeId: 'e1',
          }),
        ],
      }),
    });
    // The extraction is a real SlipExtraction, never the raw snake_case object.
    const [, params] = mockNavigate.mock.calls[0];
    expect(params.extraction.items[0].amountCents).toBe(5000);
    expect(params.extraction.items[0]).not.toHaveProperty('amount_cents');
  });

  it('navigates to SlipCapture when failed item (no extraction) is pressed', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-2'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipCapture', {
      householdId: 'hh-1',
      slipId: 'sq-2',
    });
  });

  it('navigates to SlipProcessing with the required resume params when processing item is pressed (M7)', () => {
    mockSlipData = [processingItem];
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-3'));
    // Must carry householdId/createdBy/frameLocalUris — NOT just { slipId } —
    // otherwise SlipProcessingScreen starts a scan with undefined frames.
    expect(mockNavigate).toHaveBeenCalledWith('SlipProcessing', {
      householdId: 'hh-1',
      createdBy: 'user-1',
      frameLocalUris: ['file:///frame-a.jpg', 'file:///frame-b.jpg'],
    });
    const [, params] = mockNavigate.mock.calls[0];
    expect(params.frameLocalUris).toBeDefined();
  });

  it('navigates to SlipConfirm for failed item with a hydrated (camelCase) extraction (H6)', () => {
    mockSlipData = [failedWithExtraction];
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-4'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipConfirm', {
      slipId: 'sq-4',
      extraction: expect.objectContaining({
        merchant: 'Checkers',
        slipDate: '2026-04-12',
        totalCents: 20000,
        items: [expect.objectContaining({ description: 'Chips', amountCents: 20000 })],
      }),
    });
    // Never the raw snake_case object (the old H6 bug passed data.raw_response).
    const [, params] = mockNavigate.mock.calls[0];
    expect(params.extraction.items[0].amountCents).toBe(20000);
    expect(params.extraction.items[0].amountCents).not.toBeUndefined();
  });

  it('falls back to SlipCapture when a failed slip has a malformed extraction (H6 guard)', () => {
    mockSlipData = [failedWithGarbageExtraction];
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-item-sq-5'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipCapture', {
      householdId: 'hh-1',
      slipId: 'sq-5',
    });
    // Must NOT navigate to SlipConfirm with a bad shape.
    expect(mockNavigate).not.toHaveBeenCalledWith('SlipConfirm', expect.anything());
  });

  it('shows empty state when no slips', () => {
    mockSlipData = [];
    const { getAllByText } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    expect(getAllByText(/No slips yet/i).length).toBeGreaterThan(0);
  });

  it('renders a camera FAB to start scanning', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    const fab = getByTestId('slip-queue-camera-fab');
    expect(fab).toBeTruthy();
    expect(fab.props.accessibilityLabel).toBe('Scan a slip');
    expect(fab.props.accessibilityRole).toBe('button');
  });

  it('navigates to SlipConsent when the camera FAB is pressed without consent', () => {
    const { getByTestId } = render(<SlipQueueScreen repo={mockRepo} householdId="hh-1" />);
    fireEvent.press(getByTestId('slip-queue-camera-fab'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipConsent');
  });

  it('navigates straight to SlipCapture when the camera FAB is pressed with consent already given', () => {
    const { getByTestId } = render(
      <SlipQueueScreen repo={mockRepo} householdId="hh-1" hasConsented />,
    );
    fireEvent.press(getByTestId('slip-queue-camera-fab'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipCapture');
  });
});
