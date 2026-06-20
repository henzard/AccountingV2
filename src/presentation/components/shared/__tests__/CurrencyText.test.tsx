import React from 'react';
import { render } from '@testing-library/react-native';
import { CurrencyText } from '../CurrencyText';

describe('CurrencyText', () => {
  it('renders positive amount formatted as ZAR currency', () => {
    const { getByText } = render(<CurrencyText amountCents={12345} />);
    expect(getByText(/R.*123[.,]45/)).toBeTruthy();
  });

  it('renders negative amount with minus prefix', () => {
    const { getByText } = render(<CurrencyText amountCents={-5000} />);
    expect(getByText(/-.*R.*50[.,]00/)).toBeTruthy();
  });

  it('shows + sign for positive when showSign is true', () => {
    const { getByText } = render(<CurrencyText amountCents={1000} showSign />);
    expect(getByText(/\+/)).toBeTruthy();
  });

  it('does not show + sign when showSign is false (default)', () => {
    const { queryByText } = render(<CurrencyText amountCents={1000} />);
    expect(queryByText(/\+/)).toBeNull();
  });

  it('renders zero amount', () => {
    const { getByText } = render(<CurrencyText amountCents={0} />);
    expect(getByText(/R.*0[.,]00/)).toBeTruthy();
  });

  it('applies custom style prop', () => {
    const { getByText } = render(<CurrencyText amountCents={100} style={{ color: 'red' }} />);
    const el = getByText(/R.*1[.,]00/);
    expect(el).toHaveStyle({ color: 'red' });
  });
});
