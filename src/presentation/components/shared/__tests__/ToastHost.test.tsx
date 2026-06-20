import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Snackbar: ({
      children,
      visible,
      onDismiss: _onDismiss,
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
  };
});

const mockDequeue = jest.fn();
let mockQueue: Array<{ id: string; message: string; kind: string; triggeredAt: string }> = [];

jest.mock('../../../stores/toastStore', () => ({
  useToastStore: (sel: (s: unknown) => unknown) => sel({ queue: mockQueue, dequeue: mockDequeue }),
}));

import { ToastHost } from '../ToastHost';

describe('ToastHost', () => {
  beforeEach(() => {
    mockQueue = [];
    mockDequeue.mockClear();
  });

  it('returns null when queue is empty', () => {
    const { queryByTestId } = render(<ToastHost />);
    expect(queryByTestId('snackbar')).toBeNull();
  });

  it('renders snackbar when queue has an item', () => {
    mockQueue = [{ id: '1', message: 'Hello', kind: 'success', triggeredAt: '2024-01-01' }];
    const { getByTestId, getByText } = render(<ToastHost />);
    expect(getByTestId('snackbar')).toBeTruthy();
    expect(getByText('Hello')).toBeTruthy();
  });

  it('calls dequeue when action button pressed', () => {
    mockQueue = [{ id: '1', message: 'Error!', kind: 'error', triggeredAt: '2024-01-01' }];
    const { getByTestId } = render(<ToastHost />);
    fireEvent.press(getByTestId('snackbar-action'));
    expect(mockDequeue).toHaveBeenCalled();
  });
});
