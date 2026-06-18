import React from 'react';
import { render } from '@testing-library/react-native';
import { EnvelopeFillBar } from '../EnvelopeFillBar';

describe('EnvelopeFillBar', () => {
  it('renders without crashing at 50%', () => {
    const { toJSON } = render(<EnvelopeFillBar percentRemaining={50} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders with 0% remaining', () => {
    const { toJSON } = render(<EnvelopeFillBar percentRemaining={0} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders with 100% remaining', () => {
    const { toJSON } = render(<EnvelopeFillBar percentRemaining={100} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders with custom height', () => {
    const { toJSON } = render(<EnvelopeFillBar percentRemaining={75} height={16} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders with low percentage (warning zone)', () => {
    const { toJSON } = render(<EnvelopeFillBar percentRemaining={15} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders with very low percentage (danger zone)', () => {
    const { toJSON } = render(<EnvelopeFillBar percentRemaining={5} />);
    expect(toJSON()).toBeTruthy();
  });
});
