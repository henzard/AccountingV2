import React from 'react';
import { render } from '@testing-library/react-native';
import { CurrencyText } from './CurrencyText';
import { formatCurrency } from '../../utils/currency';

describe('CurrencyText', () => {
  it('renders positive rand amount from cents', () => {
    const { getByText } = render(<CurrencyText amountCents={12345} />);
    const expected = formatCurrency(12345);
    expect(getByText(expected)).toBeTruthy();
  });

  it('renders negative amount with minus sign', () => {
    const { getByText } = render(<CurrencyText amountCents={-5000} />);
    const expected = `-${formatCurrency(5000)}`;
    expect(getByText(expected)).toBeTruthy();
  });

  it('renders zero amount', () => {
    const { getByText } = render(<CurrencyText amountCents={0} />);
    const expected = formatCurrency(0);
    expect(getByText(expected)).toBeTruthy();
  });

  it('renders positive sign when showSign=true and amount is positive', () => {
    const { getByText } = render(<CurrencyText amountCents={10000} showSign />);
    const expected = `+${formatCurrency(10000)}`;
    expect(getByText(expected)).toBeTruthy();
  });

  it('formats 123456 cents as the canonical ZAR format', () => {
    const { getByText } = render(<CurrencyText amountCents={123456} />);
    const expected = formatCurrency(123456);
    expect(getByText(expected)).toBeTruthy();
  });
});
