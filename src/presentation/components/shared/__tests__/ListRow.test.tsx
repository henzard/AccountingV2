import React from 'react';
import { Text } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import { render, fireEvent } from '@testing-library/react-native';
import { ListRow } from '../ListRow';

describe('ListRow', () => {
  it('renders title', () => {
    const { getByText } = render(<ListRow title="Checkers" />);
    expect(getByText('Checkers')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    const { getByText } = render(<ListRow title="Checkers" subtitle="Groceries" />);
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('does not render subtitle when omitted', () => {
    const { queryByTestId } = render(<ListRow title="Checkers" testID="row" />);
    expect(queryByTestId('row-subtitle')).toBeNull();
  });

  it('renders trailing content', () => {
    const { getByText } = render(<ListRow title="T" trailing={<Text>R120</Text>} />);
    expect(getByText('R120')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<ListRow title="T" onPress={onPress} testID="row" />);
    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('applies testID to the container', () => {
    const { getByTestId } = render(<ListRow title="T" testID="my-row" />);
    expect(getByTestId('my-row')).toBeTruthy();
  });

  it('renders without TouchableRipple when onPress is omitted', () => {
    const { getByTestId, UNSAFE_queryByType } = render(<ListRow title="T" testID="row" />);
    expect(getByTestId('row')).toBeTruthy();
    // Should be a static View, not TouchableRipple
    expect(UNSAFE_queryByType(TouchableRipple)).toBeNull();
  });
});
