import React from 'react';
import { render } from '@testing-library/react-native';
import { CurrencyText } from './CurrencyText';

describe('CurrencyText', () => {
  it('renders positive rand amount from cents', () => {
    const { getByText } = render(<CurrencyText amountCents={12345} />);
    // R123.45 in en-ZA locale
    expect(getByText(/R\s?123[,.]45/)).toBeTruthy();
  });

  it('renders negative amount with minus sign', () => {
    const { getByText } = render(<CurrencyText amountCents={-5000} />);
    expect(getByText(/-R\s?50/)).toBeTruthy();
  });

  it('renders zero amount', () => {
    const { getByText } = render(<CurrencyText amountCents={0} />);
    expect(getByText(/R\s?0[,.]00/)).toBeTruthy();
  });

  it('renders positive sign when showSign=true and amount is positive', () => {
    const { getByText } = render(<CurrencyText amountCents={10000} showSign />);
    expect(getByText(/\+R/)).toBeTruthy();
  });
});
