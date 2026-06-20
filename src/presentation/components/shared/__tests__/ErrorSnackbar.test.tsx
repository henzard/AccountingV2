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
            { testID: 'error-snackbar' },
            React.createElement('Text', null, children),
            action
              ? React.createElement(
                  'Pressable',
                  { testID: 'snackbar-action', onPress: action.onPress },
                  React.createElement('Text', null, action.label),
                )
              : null,
          )
        : null,
  };
});

import { ErrorSnackbar } from '../ErrorSnackbar';

describe('ErrorSnackbar', () => {
  const defaultProps = {
    visible: true,
    message: 'Something went wrong',
    onDismiss: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when visible', () => {
    const { getByTestId } = render(<ErrorSnackbar {...defaultProps} />);
    expect(getByTestId('error-snackbar')).toBeTruthy();
  });

  it('does not render when not visible', () => {
    const { queryByTestId } = render(<ErrorSnackbar {...defaultProps} visible={false} />);
    expect(queryByTestId('error-snackbar')).toBeNull();
  });

  it('displays the error message', () => {
    const { getByText } = render(<ErrorSnackbar {...defaultProps} />);
    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('calls onDismiss via action when no onAction provided', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(<ErrorSnackbar {...defaultProps} onDismiss={onDismiss} />);
    fireEvent.press(getByTestId('snackbar-action'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onAction when provided', () => {
    const onAction = jest.fn();
    const { getByTestId } = render(<ErrorSnackbar {...defaultProps} onAction={onAction} />);
    fireEvent.press(getByTestId('snackbar-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('uses custom actionLabel', () => {
    const { getByTestId, getByText } = render(
      <ErrorSnackbar {...defaultProps} actionLabel="Retry" />,
    );
    const action = getByTestId('snackbar-action');
    expect(action).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });
});
