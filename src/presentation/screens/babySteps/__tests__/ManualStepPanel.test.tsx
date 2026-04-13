/**
 * ManualStepPanel.test.tsx — task 4.18
 *
 * Tests:
 *   - Switch has accessibilityRole='switch'
 *   - a11y state transitions (checked/unchecked)
 *   - Visually distinct container (testID present)
 *   - Verbatim label text present
 *
 * Spec §ManualStepPanel, §Accessibility.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('Text', p, children),
    Surface: ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', p, children),
    Button: ({ children, onPress, ...p }: { children?: React.ReactNode; onPress?: () => void }) =>
      React.createElement('TouchableOpacity', { onPress, ...p }, children),
  };
});

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return ({ name }: { name: string }) => React.createElement('View', { testID: `icon-${name}` });
});

import { ManualStepPanel } from '../components/ManualStepPanel';

describe('ManualStepPanel', () => {
  it('renders verbatim label text', () => {
    const { getByText } = render(
      <ManualStepPanel isCompleted={false} onToggle={() => undefined} />,
    );
    expect(getByText('You decide when this is complete — tap to mark done.')).toBeTruthy();
  });

  it('switch has accessibilityRole switch', () => {
    const { getByRole } = render(
      <ManualStepPanel isCompleted={false} onToggle={() => undefined} />,
    );
    expect(getByRole('switch')).toBeTruthy();
  });

  it('switch reports unchecked state when isCompleted=false', () => {
    const { getByRole } = render(
      <ManualStepPanel isCompleted={false} onToggle={() => undefined} />,
    );
    const sw = getByRole('switch');
    expect(sw.props.accessibilityState?.checked).toBe(false);
  });

  it('switch reports checked state when isCompleted=true', () => {
    const { getByRole } = render(<ManualStepPanel isCompleted onToggle={() => undefined} />);
    const sw = getByRole('switch');
    expect(sw.props.accessibilityState?.checked).toBe(true);
  });

  it('calls onToggle with new value when switch flipped', () => {
    const onToggle = jest.fn();
    const { getByTestId } = render(<ManualStepPanel isCompleted={false} onToggle={onToggle} />);
    fireEvent(getByTestId('manual-step-switch'), 'valueChange', true);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('renders with visually distinct container testID', () => {
    const { getByTestId } = render(
      <ManualStepPanel isCompleted={false} onToggle={() => undefined} />,
    );
    expect(getByTestId('manual-step-panel')).toBeTruthy();
  });

  it('switch is disabled when loading=true', () => {
    const { getByTestId } = render(
      <ManualStepPanel isCompleted={false} onToggle={() => undefined} loading />,
    );
    const sw = getByTestId('manual-step-switch');
    expect(sw.props.disabled).toBe(true);
  });
});
