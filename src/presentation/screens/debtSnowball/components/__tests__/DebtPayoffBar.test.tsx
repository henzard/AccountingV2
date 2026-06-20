import React from 'react';
import { render } from '@testing-library/react-native';

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
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { DebtPayoffBar } from '../DebtPayoffBar';

describe('DebtPayoffBar', () => {
  it('renders label text', () => {
    const { getByText } = render(<DebtPayoffBar progressPercent={50} label="Credit Card" />);
    expect(getByText('Credit Card')).toBeTruthy();
  });

  it('renders percentage value', () => {
    const { getByText } = render(<DebtPayoffBar progressPercent={73} label="Car Loan" />);
    expect(getByText('73%')).toBeTruthy();
  });

  it('clamps progress at 100', () => {
    const { getByText } = render(<DebtPayoffBar progressPercent={150} label="Over" />);
    expect(getByText('100%')).toBeTruthy();
  });

  it('clamps progress at 0', () => {
    const { getByText } = render(<DebtPayoffBar progressPercent={-10} label="Under" />);
    expect(getByText('0%')).toBeTruthy();
  });

  it('renders at 0% progress', () => {
    const { getByText } = render(<DebtPayoffBar progressPercent={0} label="New Debt" />);
    expect(getByText('0%')).toBeTruthy();
  });

  it('renders at 100% progress (paid off)', () => {
    const { getByText } = render(<DebtPayoffBar progressPercent={100} label="Done" />);
    expect(getByText('100%')).toBeTruthy();
  });

  it('has progressbar accessibility role', () => {
    const { getByLabelText } = render(<DebtPayoffBar progressPercent={40} label="Test" />);
    expect(getByLabelText('Test: 40% paid off')).toBeTruthy();
  });
});
