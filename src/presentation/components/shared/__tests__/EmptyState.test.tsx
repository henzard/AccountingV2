import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    const { getByText } = render(<EmptyState title="Nothing here" />);
    expect(getByText('Nothing here')).toBeTruthy();
  });

  it('renders body when provided', () => {
    const { getByText } = render(<EmptyState title="Nothing here" body="Add one to get started" />);
    expect(getByText('Add one to get started')).toBeTruthy();
  });

  it('does not render body when omitted', () => {
    const { queryByTestId } = render(<EmptyState title="Nothing here" />);
    expect(queryByTestId('empty-state-body')).toBeNull();
  });

  it('renders CTA button and fires callback', () => {
    const onCta = jest.fn();
    const { getByTestId } = render(
      <EmptyState title="Nothing here" ctaLabel="Add item" onCta={onCta} />,
    );
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('does not render CTA when no handler provided', () => {
    const { queryByTestId } = render(<EmptyState title="Nothing here" ctaLabel="Add item" />);
    expect(queryByTestId('empty-state-cta')).toBeNull();
  });
});
