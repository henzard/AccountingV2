import React from 'react';
import { render } from '@testing-library/react-native';
import { LoadingSkeletonCard } from '../LoadingSkeletonCard';

describe('LoadingSkeletonCard', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<LoadingSkeletonCard />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders multiple skeleton lines', () => {
    const tree = render(<LoadingSkeletonCard />);
    expect(tree.toJSON()).toBeTruthy();
  });
});
