import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { format } from 'date-fns';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

const mockExtraction = {
  merchant: 'PnP',
  slipDate: '2026-04-13',
  totalCents: 15000,
  items: [
    {
      description: 'Bread',
      amountCents: 5000,
      quantity: 1,
      suggestedEnvelopeId: null,
      confidence: 0.9,
    },
    {
      description: 'Milk',
      amountCents: 10000,
      quantity: 2,
      suggestedEnvelopeId: 'e1',
      confidence: 0.8,
    },
  ],
  rawResponseJson: '{}',
  openaiCostCents: 1,
};

// Mutable so individual tests can exercise a missing/malformed param (H5 guard).
let mockRouteParams: { slipId: string; extraction?: unknown; readOnly?: boolean } = {
  slipId: 's1',
  extraction: mockExtraction,
};

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({
    key: 'SlipConfirm',
    name: 'SlipConfirm',
    params: mockRouteParams,
  }),
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
  const Button = ({
    children,
    onPress,
    testID,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, disabled },
      React.createElement('Text', {}, children),
    );
  const Chip = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('View', { testID, ...p }, React.createElement('Text', {}, children));
  const TouchableRipple = ({
    children,
    onPress,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('TouchableOpacity', { onPress, testID, ...p }, children);
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  const Snackbar = ({
    children,
    visible,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  return { Text, Button, Chip, TouchableRipple, Surface, Snackbar };
});

jest.mock('@react-native-community/datetimepicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return (_props: { onChange?: (e: unknown, d?: Date) => void }) =>
    React.createElement('View', { testID: 'date-picker' });
});

jest.mock('../components/EnvelopePickerSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    EnvelopePickerSheet: ({
      visible,
      onSelect,
      envelopes,
      onClose,
    }: {
      visible: boolean;
      onSelect: (e: unknown) => void;
      envelopes: { id: string; name: string }[];
      onClose: () => void;
    }) =>
      visible
        ? React.createElement(
            'View',
            { testID: 'envelope-picker-sheet' },
            envelopes.map((e: { id: string; name: string }) =>
              React.createElement(
                'TouchableOpacity',
                {
                  key: e.id,
                  testID: `envelope-option-${e.id}`,
                  onPress: () => {
                    onSelect(e);
                    onClose();
                  },
                },
                React.createElement('Text', {}, e.name),
              ),
            ),
          )
        : null,
  };
});

// UX2-1: how many times a LineItemRow with a given `lineId` has actually
// mounted (a fresh `useEffect(() => {...}, [])` firing means React tore down
// the previous instance and created a new one — exactly what an unstable
// `keyExtractor` causes on every keystroke). Reset per-test.
const mockLineItemMountCounts = new Map<string, number>();

jest.mock('../components/LineItemRow', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    LineItemRow: ({
      item,
      index,
      selectedEnvelope,
      onSelectEnvelope,
      onDescriptionChange,
      onAmountChange,
    }: {
      item: { description: string; amountCents: number; lineId?: string };
      index: number;
      selectedEnvelope: { name: string } | null;
      onSelectEnvelope: (idx: number) => void;
      onDescriptionChange?: (idx: number, description: string) => void;
      onAmountChange?: (idx: number, amountCents: number) => void;
    }) => {
      // Runs exactly once per component INSTANCE (not per render) — a
      // lazily-initialised ref instead of `useEffect(fn, [])` so this mock
      // doesn't need `item.lineId`/`index` in a dependency array (which
      // would defeat the point: re-running on every prop change instead of
      // only on mount).
      const mountedRef = React.useRef(false);
      if (!mountedRef.current) {
        mountedRef.current = true;
        const key = item.lineId ?? `no-lineId-${index}`;
        mockLineItemMountCounts.set(key, (mockLineItemMountCounts.get(key) ?? 0) + 1);
      }
      return React.createElement(
        'View',
        { testID: `line-item-${index}` },
        React.createElement('Text', {}, item.description),
        React.createElement('TouchableOpacity', {
          testID: `line-item-edit-description-${index}`,
          onPress: () => onDescriptionChange?.(index, `${item.description}!`),
        }),
        React.createElement('TouchableOpacity', {
          testID: `line-item-edit-amount-${index}`,
          onPress: () => onAmountChange?.(index, item.amountCents + 1),
        }),
        React.createElement(
          'TouchableOpacity',
          { testID: `line-item-envelope-picker-${index}`, onPress: () => onSelectEnvelope(index) },
          React.createElement(
            'Text',
            {},
            selectedEnvelope ? selectedEnvelope.name : 'Assign envelope…',
          ),
        ),
      );
    },
  };
});

import { SlipConfirmScreen } from '../SlipConfirmScreen';

const mockEnvelopes = [
  {
    id: 'e1',
    name: 'Groceries',
    allocatedCents: 50000,
    spentCents: 20000,
    envelopeType: 'spending' as const,
  },
  {
    id: 'e2',
    name: 'Fuel',
    allocatedCents: 30000,
    spentCents: 10000,
    envelopeType: 'spending' as const,
  },
];

describe('SlipConfirmScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockRouteParams = { slipId: 's1', extraction: mockExtraction };
    mockLineItemMountCounts.clear();
  });

  it('keys line items by a stable lineId, not description/amountCents/index, so editing never remounts the row (UX2-1)', () => {
    const { getByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />,
    );
    // Mount count is 1 per row right after the initial render.
    expect([...mockLineItemMountCounts.values()]).toEqual([1, 1]);

    // Editing description AND amount mutates exactly the fields the old key
    // (`${description}-${amountCents}-${idx}`) was built from — this is what
    // used to remount the row (keyboard drop / half-typed amount reset).
    fireEvent.press(getByTestId('line-item-edit-description-0'));
    fireEvent.press(getByTestId('line-item-edit-amount-0'));
    fireEvent.press(getByTestId('line-item-edit-description-0'));

    // Still exactly one mount per row — no remount occurred.
    expect([...mockLineItemMountCounts.values()]).toEqual([1, 1]);
  });

  it('does not crash when the extraction param is missing (H5 defensive guard)', () => {
    mockRouteParams = { slipId: 's1' }; // no `extraction`
    expect(() =>
      render(<SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />),
    ).not.toThrow();
  });

  it.each([
    ['unparseable OCR text', 'N/A'],
    ['day-first format', '13/04/2026'],
    ['an impossible calendar date', '2026-04-31'],
    ['an empty string', ''],
    ['null', null],
  ])('does not crash when slipDate is %s', (_label, slipDate) => {
    mockRouteParams = { slipId: 's1', extraction: { ...mockExtraction, slipDate } };
    expect(() =>
      render(<SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />),
    ).not.toThrow();
  });

  it('falls back to today when slipDate is unparseable', () => {
    mockRouteParams = { slipId: 's1', extraction: { ...mockExtraction, slipDate: 'N/A' } };
    const { getByText } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />,
    );
    expect(getByText(format(new Date(), 'd MMM yyyy'))).toBeTruthy();
  });

  it('uses the extracted slip date when it is a valid ISO date', () => {
    const { getByText } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />,
    );
    expect(getByText('13 Apr 2026')).toBeTruthy();
  });

  it('shows unassigned chip when items lack envelopes', () => {
    const { getByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />,
    );
    // Bread has no suggested envelope; Milk has e1 suggested → 1 unassigned
    expect(getByTestId('unassigned-chip')).toBeTruthy();
  });

  it('save button is disabled when items are unassigned', () => {
    const { getByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />,
    );
    const save = getByTestId('save-button');
    expect(save.props.disabled).toBeTruthy();
  });

  it('assigns envelope to item and enables save when all assigned', async () => {
    const confirmSlip = jest.fn().mockResolvedValue({ success: true });
    const { getByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={confirmSlip} />,
    );

    // Tap Bread's envelope picker (item 0 is unassigned)
    fireEvent.press(getByTestId('line-item-envelope-picker-0'));
    // Picker should be visible — select e2
    await waitFor(() => {
      expect(getByTestId('envelope-picker-sheet')).toBeTruthy();
    });
    fireEvent.press(getByTestId('envelope-option-e2'));

    // Now all items should be assigned, save button enabled
    await waitFor(() => {
      const save = getByTestId('save-button');
      expect(save.props.disabled).toBeFalsy();
    });
  });

  it('calls confirmSlip and navigates to SlipQueue on save', async () => {
    const confirmSlip = jest.fn().mockResolvedValue({ success: true });
    const { getByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={confirmSlip} />,
    );

    // Assign envelope to item 0
    fireEvent.press(getByTestId('line-item-envelope-picker-0'));
    await waitFor(() => getByTestId('envelope-picker-sheet'));
    fireEvent.press(getByTestId('envelope-option-e1'));

    // Now save
    await waitFor(() => {
      const save = getByTestId('save-button');
      expect(save.props.disabled).toBeFalsy();
    });
    fireEvent.press(getByTestId('save-button'));

    await waitFor(() => {
      expect(confirmSlip).toHaveBeenCalledWith(expect.objectContaining({ slipId: 's1' }));
      expect(mockNavigate).toHaveBeenCalledWith('SlipQueue');
    });
  });

  // UX-14: Save used to do nothing on `{ success: false }` (no error shown,
  // no `finally`, so a stuck spinner) and had no try/catch (a thrown error —
  // e.g. a network failure inside `confirmSlip` — left `saving` stuck `true`
  // forever). Both now surface a visible error and always reset `saving`.
  it('shows a visible error and re-enables Save when confirmSlip resolves { success: false }', async () => {
    const confirmSlip = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId, queryByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={confirmSlip} />,
    );

    fireEvent.press(getByTestId('line-item-envelope-picker-0'));
    await waitFor(() => getByTestId('envelope-picker-sheet'));
    fireEvent.press(getByTestId('envelope-option-e1'));

    await waitFor(() => expect(getByTestId('save-button').props.disabled).toBeFalsy());
    fireEvent.press(getByTestId('save-button'));

    await waitFor(() => {
      expect(queryByTestId('slip-confirm-error-snackbar')).toBeTruthy();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SlipQueue');
    // Save didn't get stuck disabled/loading.
    expect(getByTestId('save-button').props.disabled).toBeFalsy();
  });

  // REG-12: ConfirmSlipUseCase now fails with a specific, actionable reason
  // (e.g. the target envelope was archived) — the screen must show that
  // message, not the generic fallback.
  it('shows the specific error.message from confirmSlip instead of a generic string (REG-12)', async () => {
    const confirmSlip = jest.fn().mockResolvedValue({
      success: false,
      error: { code: 'ENVELOPE_ARCHIVED', message: 'Envelope has been archived' },
    });
    const { getByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={confirmSlip} />,
    );

    fireEvent.press(getByTestId('line-item-envelope-picker-0'));
    await waitFor(() => getByTestId('envelope-picker-sheet'));
    fireEvent.press(getByTestId('envelope-option-e1'));

    await waitFor(() => expect(getByTestId('save-button').props.disabled).toBeFalsy());
    fireEvent.press(getByTestId('save-button'));

    await waitFor(() => {
      expect(getByTestId('slip-confirm-error-snackbar').props.children).toBe(
        'Envelope has been archived',
      );
    });
  });

  it('shows a visible error and stops the spinner when confirmSlip throws', async () => {
    const confirmSlip = jest.fn().mockRejectedValue(new Error('network down'));
    const { getByTestId, queryByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={confirmSlip} />,
    );

    fireEvent.press(getByTestId('line-item-envelope-picker-0'));
    await waitFor(() => getByTestId('envelope-picker-sheet'));
    fireEvent.press(getByTestId('envelope-option-e1'));

    await waitFor(() => expect(getByTestId('save-button').props.disabled).toBeFalsy());
    fireEvent.press(getByTestId('save-button'));

    await waitFor(() => {
      expect(queryByTestId('slip-confirm-error-snackbar')).toBeTruthy();
    });
    expect(getByTestId('save-button').props.loading).toBeFalsy();
  });

  // UX-14: an already-confirmed slip (reopened from SlipQueueScreen) must
  // render read-only — no Save button, no envelope-editing affordance.
  it('renders read-only (no Save button, no unassigned chip) when route.params.readOnly is true', () => {
    mockRouteParams = { slipId: 's1', extraction: mockExtraction, readOnly: true };
    const { queryByTestId } = render(
      <SlipConfirmScreen envelopes={mockEnvelopes} confirmSlip={jest.fn()} />,
    );

    expect(queryByTestId('save-button')).toBeNull();
    expect(queryByTestId('bulk-assign-button')).toBeNull();
    expect(queryByTestId('unassigned-chip')).toBeNull();
  });
});
