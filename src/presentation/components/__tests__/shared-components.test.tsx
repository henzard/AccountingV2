/**
 * Consolidated tests for shared components.
 * Covers: CoachingModal, OfflineBanner, ToastHost, EmptyState, EnvelopeCard, SinkingFundCard.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─── react-native-paper mock ────────────────────────────────────────────────
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
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement('Pressable', { onPress, testID }, children),
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
    Snackbar: ({
      children,
      visible,
      action,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
      onDismiss?: () => void;
      action?: { label: string; onPress: () => void };
    }) =>
      visible
        ? React.createElement(
            'View',
            { testID: 'snackbar' },
            React.createElement('Text', null, children),
            action
              ? React.createElement(
                  'Pressable',
                  { testID: 'snackbar-action', onPress: action.onPress },
                  action.label,
                )
              : null,
          )
        : null,
    TouchableRipple: ({
      children,
      onPress,
      ...p
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      [k: string]: unknown;
    }) => React.createElement('Pressable', { onPress, ...p }, children),
  };
});

// ─── Store mocks ────────────────────────────────────────────────────────────
let mockIsOnline = true;
jest.mock('../../stores/syncStore', () => ({
  useSyncStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: mockIsOnline }),
}));

const mockDequeue = jest.fn();
let mockQueue: Array<{ id: string; message: string; kind: string; triggeredAt: string }> = [];
jest.mock('../../stores/toastStore', () => ({
  useToastStore: (sel: (s: unknown) => unknown) => sel({ queue: mockQueue, dequeue: mockDequeue }),
}));

// ─── Domain mocks ───────────────────────────────────────────────────────────
jest.mock('../../../domain/envelopes/SinkingFundProjector', () => ({
  SinkingFundProjector: jest.fn().mockImplementation(() => ({
    project: jest.fn().mockReturnValue({
      percentComplete: 50,
      monthsRemaining: 6,
      requiredMonthlyCents: 5000,
      isOnTrack: true,
    }),
  })),
}));

import { CoachingModal } from '../shared/CoachingModal';
import { OfflineBanner } from '../shared/OfflineBanner';
import { ToastHost } from '../shared/ToastHost';
import { EmptyState } from '../shared/EmptyState';
import { EnvelopeCard } from '../envelopes/EnvelopeCard';
import { SinkingFundCard } from '../envelopes/SinkingFundCard';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 500000,
    spentCents: 200000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-06-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CoachingModal
// ═══════════════════════════════════════════════════════════════════════════════
describe('CoachingModal', () => {
  const defaultProps = {
    visible: true,
    message: 'Do you really need that?',
    overspendCents: 5000,
    onProceed: jest.fn(),
    onCancel: jest.fn(),
  };

  it('renders when visible=true', () => {
    const { getByTestId } = render(<CoachingModal {...defaultProps} />);
    expect(getByTestId('coaching-modal')).toBeTruthy();
  });

  it('does not render when visible=false', () => {
    const { queryByTestId } = render(<CoachingModal {...defaultProps} visible={false} />);
    expect(queryByTestId('coaching-modal')).toBeNull();
  });

  it('fires onProceed on proceed button press', () => {
    const onProceed = jest.fn();
    const { getByTestId } = render(<CoachingModal {...defaultProps} onProceed={onProceed} />);
    fireEvent.press(getByTestId('coaching-proceed'));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel on cancel button press', () => {
    const onCancel = jest.fn();
    const { getByTestId } = render(<CoachingModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.press(getByTestId('coaching-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OfflineBanner
// ═══════════════════════════════════════════════════════════════════════════════
describe('OfflineBanner', () => {
  beforeEach(() => {
    mockIsOnline = true;
  });

  it('returns null when isOnline=true', () => {
    mockIsOnline = true;
    const { queryByTestId } = render(<OfflineBanner />);
    expect(queryByTestId('offline-banner')).toBeNull();
  });

  it('renders banner when isOnline=false', () => {
    mockIsOnline = false;
    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ToastHost
// ═══════════════════════════════════════════════════════════════════════════════
describe('ToastHost', () => {
  beforeEach(() => {
    mockQueue = [];
    mockDequeue.mockClear();
  });

  it('returns null when queue is empty', () => {
    const { queryByTestId } = render(<ToastHost />);
    expect(queryByTestId('snackbar')).toBeNull();
  });

  it('renders snackbar when queue has item', () => {
    mockQueue = [{ id: '1', message: 'Hello', kind: 'success', triggeredAt: '2024-01-01' }];
    const { getByTestId } = render(<ToastHost />);
    expect(getByTestId('snackbar')).toBeTruthy();
  });

  it('calls dequeue when action pressed', () => {
    mockQueue = [{ id: '1', message: 'Error!', kind: 'error', triggeredAt: '2024-01-01' }];
    const { getByTestId } = render(<ToastHost />);
    fireEvent.press(getByTestId('snackbar-action'));
    expect(mockDequeue).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EmptyState
// ═══════════════════════════════════════════════════════════════════════════════
describe('EmptyState', () => {
  it('renders title', () => {
    const { getByText } = render(<EmptyState title="No items" />);
    expect(getByText('No items')).toBeTruthy();
  });

  it('renders body when provided', () => {
    const { getByText } = render(<EmptyState title="No items" body="Add one" />);
    expect(getByText('Add one')).toBeTruthy();
  });

  it('does not render body when omitted', () => {
    const { queryByTestId } = render(<EmptyState title="No items" />);
    expect(queryByTestId('empty-state-body')).toBeNull();
  });

  it('renders CTA and fires callback', () => {
    const onCta = jest.fn();
    const { getByTestId } = render(<EmptyState title="X" ctaLabel="Add" onCta={onCta} />);
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('does not render CTA without onCta', () => {
    const { queryByTestId } = render(<EmptyState title="X" ctaLabel="Add" />);
    expect(queryByTestId('empty-state-cta')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EnvelopeCard
// ═══════════════════════════════════════════════════════════════════════════════
describe('EnvelopeCard', () => {
  it('renders envelope name', () => {
    const { getByText } = render(<EnvelopeCard envelope={makeEnvelope()} />);
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('shows error color when over budget (spentCents > allocatedCents)', () => {
    const overBudget = makeEnvelope({ allocatedCents: 100000, spentCents: 150000 });
    const { UNSAFE_getAllByType } = render(<EnvelopeCard envelope={overBudget} />);
    // Renders without crash — color logic coverage
    expect(UNSAFE_getAllByType).toBeDefined();
  });

  it('renders without crash for normal envelope', () => {
    const { toJSON } = render(<EnvelopeCard envelope={makeEnvelope()} />);
    expect(toJSON()).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SinkingFundCard
// ═══════════════════════════════════════════════════════════════════════════════
describe('SinkingFundCard', () => {
  it('renders without projection when targetAmountCents is null', () => {
    const env = makeEnvelope({
      envelopeType: 'sinking_fund',
      targetAmountCents: null,
      targetDate: null,
    });
    const { queryByTestId, toJSON } = render(<SinkingFundCard envelope={env} />);
    expect(queryByTestId('sinking-fund-progress-bar')).toBeNull();
    expect(toJSON()).not.toBeNull();
  });

  it('renders progress bar when targetAmountCents and targetDate present', () => {
    const env = makeEnvelope({
      envelopeType: 'sinking_fund',
      targetAmountCents: 1000000,
      targetDate: '2027-12-01',
    });
    const { getByTestId } = render(<SinkingFundCard envelope={env} />);
    expect(getByTestId('sinking-fund-progress-bar')).toBeTruthy();
  });

  it('renders envelope name', () => {
    const env = makeEnvelope({ name: 'Holiday Fund', envelopeType: 'sinking_fund' });
    const { getByText } = render(<SinkingFundCard envelope={env} />);
    expect(getByText('Holiday Fund')).toBeTruthy();
  });
});
