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
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
  };
});

import { PeriodRolloverModal } from '../PeriodRolloverModal';

describe('PeriodRolloverModal', () => {
  const defaultProps = {
    visible: true,
    periodLabel: 'June 2024',
    onAcknowledge: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal when visible', () => {
    const { getByTestId } = render(<PeriodRolloverModal {...defaultProps} />);
    expect(getByTestId('period-rollover-modal')).toBeTruthy();
  });

  it('displays period label in body text', () => {
    const { getByText } = render(<PeriodRolloverModal {...defaultProps} />);
    expect(getByText(/June 2024 has started/)).toBeTruthy();
  });

  it('displays "New budget period" title', () => {
    const { getByText } = render(<PeriodRolloverModal {...defaultProps} />);
    expect(getByText('New budget period')).toBeTruthy();
  });

  it('calls onAcknowledge when button pressed', () => {
    const onAcknowledge = jest.fn();
    const { getByTestId } = render(
      <PeriodRolloverModal {...defaultProps} onAcknowledge={onAcknowledge} />,
    );
    fireEvent.press(getByTestId('period-rollover-acknowledge'));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('renders acknowledge button', () => {
    const { getByTestId } = render(<PeriodRolloverModal {...defaultProps} />);
    expect(getByTestId('period-rollover-acknowledge')).toBeTruthy();
  });
});
