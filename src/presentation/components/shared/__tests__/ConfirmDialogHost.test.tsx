import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Dialog = ({
    visible,
    children,
    testID,
  }: {
    visible?: boolean;
    children?: React.ReactNode;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  return {
    Portal: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    Dialog,
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        'Pressable',
        { testID, onPress },
        React.createElement('Text', null, children),
      ),
  };
});

const mockRequest: { current: unknown } = { current: null };
const mockResolveConfirm = jest.fn();
jest.mock('../../../stores/confirmStore', () => ({
  useConfirmStore: (sel: (s: unknown) => unknown) =>
    sel({ request: mockRequest.current, resolveConfirm: mockResolveConfirm }),
}));

import { ConfirmDialogHost } from '../ConfirmDialogHost';

describe('ConfirmDialogHost', () => {
  beforeEach(() => {
    mockRequest.current = null;
    mockResolveConfirm.mockClear();
  });

  it('renders nothing when there is no pending request', () => {
    const { queryByTestId } = render(<ConfirmDialogHost />);
    expect(queryByTestId('confirm-dialog')).toBeNull();
  });

  it('renders the dialog with title and message when a request is pending', () => {
    mockRequest.current = { id: '1', title: 'Sign out?', message: 'Are you sure?' };
    const { getByTestId, getByText } = render(<ConfirmDialogHost />);
    expect(getByTestId('confirm-dialog')).toBeTruthy();
    expect(getByText('Sign out?')).toBeTruthy();
    expect(getByText('Are you sure?')).toBeTruthy();
  });

  it('uses default Cancel/Confirm labels when none are given', () => {
    mockRequest.current = { id: '1', title: 't', message: 'm' };
    const { getByText } = render(<ConfirmDialogHost />);
    expect(getByText('Cancel')).toBeTruthy();
    expect(getByText('Confirm')).toBeTruthy();
  });

  it('uses custom confirmLabel/cancelLabel when given', () => {
    mockRequest.current = {
      id: '1',
      title: 't',
      message: 'm',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay',
    };
    const { getByText } = render(<ConfirmDialogHost />);
    expect(getByText('Sign out')).toBeTruthy();
    expect(getByText('Stay')).toBeTruthy();
  });

  it('pressing the cancel button resolves with false', () => {
    mockRequest.current = { id: '1', title: 't', message: 'm' };
    const { getByTestId } = render(<ConfirmDialogHost />);
    fireEvent.press(getByTestId('confirm-dialog-cancel'));
    expect(mockResolveConfirm).toHaveBeenCalledWith(false);
  });

  it('pressing the confirm button resolves with true', () => {
    mockRequest.current = { id: '1', title: 't', message: 'm' };
    const { getByTestId } = render(<ConfirmDialogHost />);
    fireEvent.press(getByTestId('confirm-dialog-confirm'));
    expect(mockResolveConfirm).toHaveBeenCalledWith(true);
  });
});
