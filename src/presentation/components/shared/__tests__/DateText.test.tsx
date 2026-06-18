import React from 'react';
import { render } from '@testing-library/react-native';
import { DateText } from '../DateText';

describe('DateText', () => {
  it('renders ISO date with default format', () => {
    const { getByText } = render(<DateText isoDate="2024-03-15" />);
    expect(getByText('15 Mar 2024')).toBeTruthy();
  });

  it('renders ISO date with custom format string', () => {
    const { getByText } = render(<DateText isoDate="2024-12-01" formatStr="yyyy/MM/dd" />);
    expect(getByText('2024/12/01')).toBeTruthy();
  });

  it('applies custom style prop', () => {
    const { getByText } = render(<DateText isoDate="2024-01-10" style={{ fontSize: 20 }} />);
    expect(getByText('10 Jan 2024')).toBeTruthy();
  });

  it('handles ISO datetime string', () => {
    const { getByText } = render(<DateText isoDate="2024-06-20T15:30:00Z" />);
    expect(getByText('20 Jun 2024')).toBeTruthy();
  });
});
