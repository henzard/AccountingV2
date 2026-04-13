import React from 'react';
import { render } from '@testing-library/react-native';
import { LoadingSkeletonList } from '../LoadingSkeletonList';
import { LoadingSkeletonCard } from '../LoadingSkeletonCard';

describe('LoadingSkeletonList', () => {
  it('renders default 3 skeleton cards', () => {
    const { getByTestId } = render(<LoadingSkeletonList />);
    expect(getByTestId('loading-skeleton-list')).toBeTruthy();
  });

  it('respects the count prop', () => {
    const { UNSAFE_getAllByType } = render(<LoadingSkeletonList count={5} />);
    expect(UNSAFE_getAllByType(LoadingSkeletonCard)).toHaveLength(5);
  });

  it('applies custom testID', () => {
    const { getByTestId } = render(<LoadingSkeletonList testID="my-skeleton" />);
    expect(getByTestId('my-skeleton')).toBeTruthy();
  });
});
