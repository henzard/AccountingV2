import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('Text', p, children);
  // `disabled` is forwarded (and suppresses onPress, like Paper's Button) so
  // tests can assert the A-4 guard on an unresolved session.
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
      {
        onPress: disabled ? undefined : onPress,
        testID,
        disabled: !!disabled,
        accessibilityState: { disabled: !!disabled },
      },
      React.createElement('Text', {}, children),
    );
  return { Text, Button };
});

// Mutable so a test can simulate an unresolved session (A-4).
let mockSession: { user: { id: string } } | null = { user: { id: 'user-1' } };

jest.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: (s: { session: { user: { id: string } } | null }) => unknown) =>
    sel({ session: mockSession }),
}));

jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({ colors: { background: '#fff', error: '#b00020' } }),
}));

import { SlipConsentScreen } from '../SlipConsentScreen';

describe('SlipConsentScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockSession = { user: { id: 'user-1' } };
  });

  it('calls recordConsent and navigates to SlipCapture on accept', async () => {
    const recordConsent = jest.fn().mockResolvedValue({ success: true });
    const { getByTestId } = render(<SlipConsentScreen recordConsent={recordConsent} />);

    fireEvent.press(getByTestId('consent-accept'));

    await waitFor(() => {
      expect(recordConsent).toHaveBeenCalledWith('user-1');
      expect(mockNavigate).toHaveBeenCalledWith('SlipCapture');
    });
  });

  it('does not navigate when recordConsent returns failure', async () => {
    const recordConsent = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId } = render(<SlipConsentScreen recordConsent={recordConsent} />);

    fireEvent.press(getByTestId('consent-accept'));

    await waitFor(() => {
      expect(recordConsent).toHaveBeenCalledWith('user-1');
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // A-4: every one of these paths used to end in a bare `return`, leaving the
  // button looking live while nothing happened.
  it('shows an error when recordConsent reports failure', async () => {
    const recordConsent = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId, findByTestId } = render(
      <SlipConsentScreen recordConsent={recordConsent} />,
    );

    fireEvent.press(getByTestId('consent-accept'));

    const error = await findByTestId('consent-error');
    expect(error).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the error message when recordConsent throws', async () => {
    const recordConsent = jest.fn().mockRejectedValue(new Error('Network down'));
    const { getByTestId, findByText } = render(<SlipConsentScreen recordConsent={recordConsent} />);

    fireEvent.press(getByTestId('consent-accept'));

    expect(await findByText('Network down')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clears a previous error once a retry succeeds', async () => {
    const recordConsent = jest
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    const { getByTestId, findByTestId, queryByTestId } = render(
      <SlipConsentScreen recordConsent={recordConsent} />,
    );

    fireEvent.press(getByTestId('consent-accept'));
    await findByTestId('consent-error');

    fireEvent.press(getByTestId('consent-accept'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('SlipCapture');
    });
    expect(queryByTestId('consent-error')).toBeNull();
  });

  it('disables accept while the session (and therefore userId) is unresolved', () => {
    mockSession = null;
    const recordConsent = jest.fn();
    const { getByTestId } = render(<SlipConsentScreen recordConsent={recordConsent} />);

    const accept = getByTestId('consent-accept');
    expect(accept.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(accept);
    expect(recordConsent).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('calls goBack when decline is pressed', () => {
    const recordConsent = jest.fn();
    const { getByTestId } = render(<SlipConsentScreen recordConsent={recordConsent} />);

    fireEvent.press(getByTestId('consent-decline'));

    expect(mockGoBack).toHaveBeenCalled();
    expect(recordConsent).not.toHaveBeenCalled();
  });
});
