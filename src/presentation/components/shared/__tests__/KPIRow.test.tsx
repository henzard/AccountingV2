import React from 'react';
import { render } from '@testing-library/react-native';
import { KPIRow } from '../KPIRow';

const items = [
  { label: 'Allocated', valueCents: 500000 },
  { label: 'Spent', valueCents: 120050 },
  { label: 'Remaining', valueCents: 379950, errorWhenNegative: true },
];

describe('KPIRow', () => {
  it('renders all item labels in upper case', () => {
    const { getByText } = render(<KPIRow items={items} />);
    expect(getByText('ALLOCATED')).toBeTruthy();
    expect(getByText('SPENT')).toBeTruthy();
    expect(getByText('REMAINING')).toBeTruthy();
  });

  it('applies testID to the surface', () => {
    const { getByTestId } = render(<KPIRow items={items} testID="kpi" />);
    expect(getByTestId('kpi')).toBeTruthy();
  });

  it('renders without crashing when items list is empty', () => {
    expect(() => render(<KPIRow items={[]} />)).not.toThrow();
  });
});
