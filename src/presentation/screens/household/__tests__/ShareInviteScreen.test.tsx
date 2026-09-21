/**
 * ShareInviteScreen.test.tsx — zero-coverage screen test
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { format, parseISO } from 'date-fns';

// ─── react-native-paper mocks ─────────────────────────────────────────────────
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
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
    Button: ({
      children,
      onPress,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      [k: string]: unknown;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID, ...p },
        React.createElement('Text', {}, children),
      ),
    ActivityIndicator: ({ testID }: { testID?: string; [k: string]: unknown }) =>
      React.createElement('View', { testID: testID ?? 'activity-indicator' }),
  };
});

// ─── Theme mock ───────────────────────────────────────────────────────────────
jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      primary: '#000',
      primaryContainer: '#eee',
      onPrimary: '#fff',
      onPrimaryContainer: '#111',
      background: '#fff',
      surface: '#fff',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      error: '#f00',
    },
  }),
}));

jest.mock('../../../stores/themeStore', () => ({
  useThemeStore: jest.fn((sel: (s: object) => unknown) => sel({ preference: 'light' })),
}));

// ─── Store mock ───────────────────────────────────────────────────────────────
let mockSession: { user: { id: string } } | null = { user: { id: 'user-1' } };
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn(
    (sel: (s: { session: typeof mockSession; householdId: string }) => unknown) =>
      sel({ session: mockSession, householdId: 'hh-1' }),
  ),
}));

// ─── supabase mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {},
}));

// ─── CreateInviteUseCase mock ─────────────────────────────────────────────────
const mockExecute = jest.fn();
jest.mock('../../../../domain/households/CreateInviteUseCase', () => ({
  CreateInviteUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

import { ShareInviteScreen } from '../ShareInviteScreen';

const makeProps = () =>
  ({
    route: {
      key: 'ShareInvite',
      name: 'ShareInvite',
      params: { householdName: 'Test Home' },
    },
    navigation: {} as never,
  }) as any;

describe('ShareInviteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = { user: { id: 'user-1' } };
    mockExecute.mockResolvedValue({
      success: true,
      data: { code: 'ABC123', expiresAt: '2026-06-21T00:00:00.000Z' },
    });
  });

  it('shows loading indicator initially', () => {
    mockExecute.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<ShareInviteScreen {...makeProps()} />);
    expect(getByTestId('activity-indicator')).toBeTruthy();
  });

  it('shows invite code on success', async () => {
    const { getByText } = render(<ShareInviteScreen {...makeProps()} />);
    await waitFor(() => {
      expect(getByText('ABC123')).toBeTruthy();
    });
    expect(getByText('INVITE CODE')).toBeTruthy();
    expect(getByText('Share Code')).toBeTruthy();
  });

  it('shows error when use case fails', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { code: 'INVITE_CREATE_FAILED', message: 'Rate limit exceeded' },
    });

    const { getByText } = render(<ShareInviteScreen {...makeProps()} />);
    await waitFor(() => {
      expect(getByText('Rate limit exceeded')).toBeTruthy();
    });
  });

  it('shows fallback error when code is null', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { code: null, expiresAt: null },
    });

    const { getByText } = render(<ShareInviteScreen {...makeProps()} />);
    await waitFor(() => {
      expect(getByText('Failed to generate code')).toBeTruthy();
    });
  });

  it('does not call use case when session is null', async () => {
    mockSession = null;
    render(<ShareInviteScreen {...makeProps()} />);
    await waitFor(() => {
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  it('formats expiry date using date-fns format with d MMM yyyy', async () => {
    const isoDate = '2026-09-20T14:30:00.000Z';
    mockExecute.mockResolvedValue({
      success: true,
      data: { code: 'ABC123', expiresAt: isoDate },
    });

    const expectedDateStr = format(parseISO(isoDate), 'd MMM yyyy');
    const { getByText } = render(<ShareInviteScreen {...makeProps()} />);
    await waitFor(() => {
      expect(getByText(`Expires ${expectedDateStr} · Single use`)).toBeTruthy();
    });
  });

  it('failure shows the error and the retry button', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { code: 'INVITE_CREATE_FAILED', message: 'Rate limit exceeded' },
    });

    const { getByText, getByTestId } = render(<ShareInviteScreen {...makeProps()} />);
    await waitFor(() => {
      expect(getByText('Rate limit exceeded')).toBeTruthy();
      expect(getByTestId('share-invite-retry')).toBeTruthy();
    });
  });

  it('pressing retry calls the use case again and shows the code on success', async () => {
    // First call fails
    mockExecute.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVITE_CREATE_FAILED', message: 'Rate limit exceeded' },
    });
    // Second call (retry) succeeds
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { code: 'XYZ789', expiresAt: '2026-06-21T00:00:00.000Z' },
    });

    const { getByText, getByTestId } = render(<ShareInviteScreen {...makeProps()} />);

    // Wait for error to show
    await waitFor(() => {
      expect(getByText('Rate limit exceeded')).toBeTruthy();
    });

    // Press retry button
    const retryBtn = getByTestId('share-invite-retry');
    act(() => {
      retryBtn.props.onPress();
    });

    // Wait for success
    await waitFor(() => {
      expect(getByText('XYZ789')).toBeTruthy();
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  it('retry failure keeps the error', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { code: 'INVITE_CREATE_FAILED', message: 'Rate limit exceeded' },
    });

    const { getByText, getByTestId } = render(<ShareInviteScreen {...makeProps()} />);

    // Wait for initial error
    await waitFor(() => {
      expect(getByText('Rate limit exceeded')).toBeTruthy();
    });

    // Press retry button
    const retryBtn = getByTestId('share-invite-retry');
    act(() => {
      retryBtn.props.onPress();
    });

    // Wait for error to still be shown
    await waitFor(() => {
      expect(getByText('Rate limit exceeded')).toBeTruthy();
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  it('button is disabled while loading', async () => {
    // First call fails
    mockExecute.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVITE_CREATE_FAILED', message: 'Rate limit exceeded' },
    });
    // Second call never resolves (stays loading)
    mockExecute.mockReturnValueOnce(new Promise(() => {}));

    const { getByText, getByTestId } = render(<ShareInviteScreen {...makeProps()} />);

    // Wait for error to show
    await waitFor(() => {
      expect(getByText('Rate limit exceeded')).toBeTruthy();
    });

    // Verify button is not disabled initially
    let retryBtn = getByTestId('share-invite-retry');
    expect(retryBtn.props.disabled).toBe(false);

    // Press retry button
    act(() => {
      retryBtn.props.onPress();
    });

    // Wait for button to become disabled
    await waitFor(() => {
      retryBtn = getByTestId('share-invite-retry');
      expect(retryBtn.props.disabled).toBe(true);
    });
  });

  it('a REJECTED use case (not a failure Result) still ends loading and offers retry', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Network request failed'));
    const { findByTestId, queryByText } = render(<ShareInviteScreen {...makeProps()} />);

    const retry = await findByTestId('share-invite-retry');
    expect(retry.props.accessibilityState?.disabled ?? retry.props.disabled ?? false).toBe(false);
    expect(queryByText(/Network request failed/)).toBeNull();
  });
});
