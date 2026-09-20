import React from 'react';
import { render } from '@testing-library/react-native';
import { CurrencyText } from '../CurrencyText';
import { formatCurrency } from '../../../utils/currency';

describe('CurrencyText', () => {
  it('renders positive amount formatted as ZAR currency', () => {
    const { getByText } = render(<CurrencyText amountCents={12345} />);
    const expected = formatCurrency(12345);
    expect(getByText(expected)).toBeTruthy();
  });

  it('renders negative amount with minus prefix', () => {
    const { getByText } = render(<CurrencyText amountCents={-5000} />);
    const expected = `-${formatCurrency(5000)}`;
    expect(getByText(expected)).toBeTruthy();
  });

  it('shows + sign for positive when showSign is true', () => {
    const { getByText } = render(<CurrencyText amountCents={1000} showSign />);
    const expected = `+${formatCurrency(1000)}`;
    expect(getByText(expected)).toBeTruthy();
  });

  it('does not show + sign when showSign is false (default)', () => {
    const { getByText } = render(<CurrencyText amountCents={1000} />);
    const expected = formatCurrency(1000);
    expect(getByText(expected)).toBeTruthy();
  });

  it('renders zero amount', () => {
    const { getByText } = render(<CurrencyText amountCents={0} />);
    const expected = formatCurrency(0);
    expect(getByText(expected)).toBeTruthy();
  });

  it('applies custom style prop', () => {
    const { getByText } = render(<CurrencyText amountCents={100} style={{ color: 'red' }} />);
    const expected = formatCurrency(100);
    const el = getByText(expected);
    expect(el).toHaveStyle({ color: 'red' });
  });
});
