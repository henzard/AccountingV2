/**
 * DateField.web.test.tsx — web variant (UX-12).
 *
 * @react-native-community/datetimepicker renders null on web, so this
 * variant (metro/react-native-web platform resolution picks it automatically
 * for web builds) renders a plain themed `<input type="date">` instead.
 * Imported by its explicit '.web' path since Jest's default resolution here
 * is the native platform.
 *
 * Queries by `data-testid` via UNSAFE_getByProps rather than getByTestId:
 * this file renders raw DOM tags (for real react-dom in a browser), not
 * react-native primitives, so RNTL's `testID`-based query doesn't apply.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { DateField } from '../DateField.web';

describe('DateField (web)', () => {
  it('renders an <input type="date"> with the given value', () => {
    const { UNSAFE_getByProps } = render(
      <DateField value="2027-12-01" onChange={jest.fn()} testID="my-date-field" />,
    );
    const input = UNSAFE_getByProps({ 'data-testid': 'my-date-field' });
    expect(input.props.type).toBe('date');
    expect(input.props.value).toBe('2027-12-01');
  });

  it('renders an empty value when value is null', () => {
    const { UNSAFE_getByProps } = render(
      <DateField value={null} onChange={jest.fn()} testID="my-date-field" />,
    );
    expect(UNSAFE_getByProps({ 'data-testid': 'my-date-field' }).props.value).toBe('');
  });

  it('sets max to the given maximumDate formatted as yyyy-MM-dd', () => {
    const { UNSAFE_getByProps } = render(
      <DateField
        value="2027-12-01"
        onChange={jest.fn()}
        maximumDate={new Date(2026, 8, 20)}
        testID="my-date-field"
      />,
    );
    expect(UNSAFE_getByProps({ 'data-testid': 'my-date-field' }).props.max).toBe('2026-09-20');
  });

  it('omits max when maximumDate is null', () => {
    const { UNSAFE_getByProps } = render(
      <DateField
        value="2027-12-01"
        onChange={jest.fn()}
        maximumDate={null}
        testID="my-date-field"
      />,
    );
    expect(UNSAFE_getByProps({ 'data-testid': 'my-date-field' }).props.max).toBeUndefined();
  });

  it('calls onChange with the raw yyyy-MM-dd string from the input', () => {
    const onChange = jest.fn();
    const { UNSAFE_getByProps } = render(
      <DateField value="2027-12-01" onChange={onChange} testID="my-date-field" />,
    );
    fireEvent(UNSAFE_getByProps({ 'data-testid': 'my-date-field' }), 'change', {
      target: { value: '2028-01-15' },
    });
    expect(onChange).toHaveBeenCalledWith('2028-01-15');
  });

  it('does not call onChange when the input is cleared', () => {
    const onChange = jest.fn();
    const { UNSAFE_getByProps } = render(
      <DateField value="2027-12-01" onChange={onChange} testID="my-date-field" />,
    );
    fireEvent(UNSAFE_getByProps({ 'data-testid': 'my-date-field' }), 'change', {
      target: { value: '' },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables the input when disabled is true', () => {
    const { UNSAFE_getByProps } = render(
      <DateField value="2027-12-01" onChange={jest.fn()} disabled testID="my-date-field" />,
    );
    expect(UNSAFE_getByProps({ 'data-testid': 'my-date-field' }).props.disabled).toBe(true);
  });
});
