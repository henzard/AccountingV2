import React from 'react';
import { render } from '@testing-library/react-native';
import { SectionHeader } from '../SectionHeader';

describe('SectionHeader', () => {
  it('renders title in upper case', () => {
    const { getByText } = render(<SectionHeader title="january" />);
    expect(getByText('JANUARY')).toBeTruthy();
  });

  it('applies testID', () => {
    const { getByTestId } = render(<SectionHeader title="foo" testID="sh" />);
    expect(getByTestId('sh')).toBeTruthy();
  });

  it('renders Divider when showDivider is true', () => {
    const { getByTestId } = render(<SectionHeader title="foo" showDivider testID="sh" />);
    expect(getByTestId('sh-divider')).toBeTruthy();
  });

  it('does not render Divider by default', () => {
    const { queryByTestId } = render(<SectionHeader title="foo" testID="sh" />);
    expect(queryByTestId('sh-divider')).toBeNull();
  });
});
