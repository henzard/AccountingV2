import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      style,
      ...p
    }: {
      children?: React.ReactNode;
      style?: unknown;
      [k: string]: unknown;
    }) => React.createElement('Text', { style, ...p }, children),
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Circle: () => React.createElement('View'),
  };
});

import { RamseyScoreBadge } from '../RamseyScoreBadge';

describe('RamseyScoreBadge', () => {
  it('renders score value', () => {
    const { getByText } = render(<RamseyScoreBadge score={85} />);
    expect(getByText('85')).toBeTruthy();
  });

  it('shows "Excellent" for score >= 80', () => {
    const { getByText } = render(<RamseyScoreBadge score={80} />);
    expect(getByText('Excellent')).toBeTruthy();
  });

  it('shows "Good" for score >= 60', () => {
    const { getByText } = render(<RamseyScoreBadge score={65} />);
    expect(getByText('Good')).toBeTruthy();
  });

  it('shows "Fair" for score >= 40', () => {
    const { getByText } = render(<RamseyScoreBadge score={45} />);
    expect(getByText('Fair')).toBeTruthy();
  });

  it('shows "Keep going" for score < 40', () => {
    const { getByText } = render(<RamseyScoreBadge score={20} />);
    expect(getByText('Keep going')).toBeTruthy();
  });

  it('clamps score at 0', () => {
    const { UNSAFE_root } = render(<RamseyScoreBadge score={-5} />);
    const progressBar = UNSAFE_root.findByProps({ accessibilityRole: 'progressbar' });
    expect(progressBar.props.accessibilityValue.now).toBe(0);
  });

  it('renders at boundary score 100', () => {
    const { getByText } = render(<RamseyScoreBadge score={100} />);
    expect(getByText('100')).toBeTruthy();
    expect(getByText('Excellent')).toBeTruthy();
  });
});
