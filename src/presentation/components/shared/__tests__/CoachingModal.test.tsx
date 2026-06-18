/**
 * CoachingModal.test.tsx — C8 component test
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

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
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});

import { CoachingModal } from '../CoachingModal';

describe('CoachingModal', () => {
  const defaultProps = {
    visible: true,
    message: 'Are you sure you need that latte?',
    overspendCents: 5000,
    onProceed: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal content when visible', () => {
    const { getByTestId } = render(<CoachingModal {...defaultProps} />);
    expect(getByTestId('coaching-modal')).toBeTruthy();
  });

  it('displays the coaching message', () => {
    const { getAllByText } = render(<CoachingModal {...defaultProps} />);
    expect(getAllByText(/latte/i).length).toBeGreaterThan(0);
  });

  it('displays overspend amount', () => {
    const { getByTestId } = render(<CoachingModal {...defaultProps} />);
    expect(getByTestId('coaching-overspend-amount')).toBeTruthy();
  });

  it('displays "WHAT WOULD DAVE SAY?" eyebrow', () => {
    const { getAllByText } = render(<CoachingModal {...defaultProps} />);
    expect(getAllByText(/DAVE/i).length).toBeGreaterThan(0);
  });

  it('calls onCancel when "Change amount" button is pressed', () => {
    const onCancel = jest.fn();
    const { getByTestId } = render(<CoachingModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.press(getByTestId('coaching-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onProceed when "Log it anyway" button is pressed', () => {
    const onProceed = jest.fn();
    const { getByTestId } = render(<CoachingModal {...defaultProps} onProceed={onProceed} />);
    fireEvent.press(getByTestId('coaching-proceed'));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('does not render modal content when not visible', () => {
    const { queryByTestId } = render(<CoachingModal {...defaultProps} visible={false} />);
    expect(queryByTestId('coaching-modal')).toBeNull();
  });

  it('renders with zero overspend amount', () => {
    const { getByTestId } = render(<CoachingModal {...defaultProps} overspendCents={0} />);
    expect(getByTestId('coaching-overspend-amount')).toBeTruthy();
  });

  it('displays formatted overspend amount in Rands', () => {
    const { getAllByText } = render(<CoachingModal {...defaultProps} overspendCents={15050} />);
    expect(getAllByText(/R150/i).length).toBeGreaterThan(0);
  });

  it('renders both action buttons', () => {
    const { getByTestId } = render(<CoachingModal {...defaultProps} />);
    expect(getByTestId('coaching-cancel')).toBeTruthy();
    expect(getByTestId('coaching-proceed')).toBeTruthy();
  });

  it('does not call callbacks when modal is not visible', () => {
    const onProceed = jest.fn();
    const onCancel = jest.fn();
    const { queryByTestId } = render(
      <CoachingModal {...defaultProps} visible={false} onProceed={onProceed} onCancel={onCancel} />,
    );
    expect(queryByTestId('coaching-proceed')).toBeNull();
    expect(queryByTestId('coaching-cancel')).toBeNull();
    expect(onProceed).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders with a long coaching message', () => {
    const longMessage =
      'You are about to spend more than your entire grocery budget for the rest of the month, are you really sure about this?';
    const { getAllByText } = render(<CoachingModal {...defaultProps} message={longMessage} />);
    expect(getAllByText(/grocery budget/i).length).toBeGreaterThan(0);
  });

  it('renders overspend sentence with "over budget" text', () => {
    const { getAllByText } = render(<CoachingModal {...defaultProps} />);
    expect(getAllByText(/over budget/i).length).toBeGreaterThan(0);
  });
});
