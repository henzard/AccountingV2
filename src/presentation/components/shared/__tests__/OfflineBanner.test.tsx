import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
  };
});

let mockIsOnline = true;
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: mockIsOnline }),
}));

import { OfflineBanner } from '../OfflineBanner';

describe('OfflineBanner', () => {
  beforeEach(() => {
    mockIsOnline = true;
  });

  it('returns null when online', () => {
    mockIsOnline = true;
    const { queryByTestId } = render(<OfflineBanner />);
    expect(queryByTestId('offline-banner')).toBeNull();
  });

  it('renders banner when offline', () => {
    mockIsOnline = false;
    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });

  it('shows offline message text', () => {
    mockIsOnline = false;
    const { getByText } = render(<OfflineBanner />);
    expect(getByText(/offline/i)).toBeTruthy();
  });
});
