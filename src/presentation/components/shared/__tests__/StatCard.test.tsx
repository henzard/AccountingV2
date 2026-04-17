import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StatCard } from '../StatCard';

jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      surface: '#fff',
      onSurface: '#000',
      onSurfaceVariant: '#666',
    },
  }),
}));

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Paid" value="R12,000.00" />);
    expect(screen.getByText('TOTAL PAID')).toBeTruthy();
    expect(screen.getByText('R12,000.00')).toBeTruthy();
  });

  it('renders sublabel when provided', () => {
    render(<StatCard label="Balance" value="R5,000.00" sublabel="outstanding" />);
    expect(screen.getByText('outstanding')).toBeTruthy();
  });

  it('does not render sublabel when not provided', () => {
    render(<StatCard label="Balance" value="R5,000.00" />);
    expect(screen.queryByTestId('stat-card-sublabel')).toBeNull();
  });

  it('applies testID', () => {
    render(<StatCard label="Score" value="87" testID="score-stat" />);
    expect(screen.getByTestId('score-stat')).toBeTruthy();
  });
});
