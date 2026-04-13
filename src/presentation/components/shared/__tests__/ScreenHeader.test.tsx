import React from 'react';
import { render } from '@testing-library/react-native';
import { ScreenHeader } from '../ScreenHeader';

describe('ScreenHeader', () => {
  it('renders the title', () => {
    const { getByText } = render(<ScreenHeader title="Budget" />);
    expect(getByText('Budget')).toBeTruthy();
  });

  it('renders eyebrow text when provided', () => {
    const { getByTestId } = render(<ScreenHeader eyebrow="Overview" title="Budget" />);
    expect(getByTestId('screen-header-eyebrow')).toBeTruthy();
  });

  it('does not render eyebrow when omitted', () => {
    const { queryByTestId } = render(<ScreenHeader title="Budget" />);
    expect(queryByTestId('screen-header-eyebrow')).toBeNull();
  });

  it('applies custom testID', () => {
    const { getByTestId } = render(<ScreenHeader title="Budget" testID="my-header" />);
    expect(getByTestId('my-header')).toBeTruthy();
  });
});
