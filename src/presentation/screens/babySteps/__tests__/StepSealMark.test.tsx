import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', { testID: 'svg', ...p }, children),
    Circle: (p: Record<string, unknown>) => React.createElement('View', p),
    Rect: (p: Record<string, unknown>) => React.createElement('View', p),
    Path: (p: Record<string, unknown>) => React.createElement('View', p),
    Line: (p: Record<string, unknown>) => React.createElement('View', p),
    G: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
  };
});

import { StepSealMark } from '../components/StepSealMark';
import type { SealState } from '../components/StepSealMark';

describe('StepSealMark', () => {
  const states: SealState[] = ['future', 'current', 'complete'];

  it.each([1, 2, 3, 4, 5, 6, 7] as const)('renders step %i without crashing', (step) => {
    const { toJSON } = render(<StepSealMark stepNumber={step} state="current" size={48} />);
    expect(toJSON()).toBeTruthy();
  });

  it.each(states)('renders with state "%s"', (state) => {
    const { toJSON } = render(<StepSealMark stepNumber={1} state={state} size={48} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders at different sizes', () => {
    const { toJSON } = render(<StepSealMark stepNumber={3} state="complete" size={96} />);
    expect(toJSON()).toBeTruthy();
  });
});
