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
  const Button = ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID },
      React.createElement('Text', {}, children),
    );
  return { Text, Button };
});

jest.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: (s: { session: { user: { id: string } } | null }) => unknown) =>
    sel({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({ colors: { background: '#fff' } }),
}));

import { SlipConsentScreen } from '../SlipConsentScreen';

describe('SlipConsentScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
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

  it('calls goBack when decline is pressed', () => {
    const recordConsent = jest.fn();
    const { getByTestId } = render(<SlipConsentScreen recordConsent={recordConsent} />);

    fireEvent.press(getByTestId('consent-decline'));

    expect(mockGoBack).toHaveBeenCalled();
    expect(recordConsent).not.toHaveBeenCalled();
  });
});
