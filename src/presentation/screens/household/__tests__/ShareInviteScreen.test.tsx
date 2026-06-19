/**
 * ShareInviteScreen.test.tsx — zero-coverage screen test
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

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
});
