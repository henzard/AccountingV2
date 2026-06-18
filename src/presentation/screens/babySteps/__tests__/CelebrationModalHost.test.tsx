import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
      React.createElement('Pressable', { onPress }, children),
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Circle: () => React.createElement('View'),
    Rect: () => React.createElement('View'),
    Path: () => React.createElement('View'),
    Line: () => React.createElement('View'),
    G: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

let mockQueue: Array<{ stepNumber: number }> = [];
let mockHouseholdId: string | null = 'h1';

jest.mock('../../../stores/celebrationStore', () => ({
  useCelebrationStore: (sel: (s: { queue: Array<{ stepNumber: number }> }) => unknown) =>
    sel({ queue: mockQueue }),
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: (s: { householdId: string | null }) => unknown) =>
    sel({ householdId: mockHouseholdId }),
}));

jest.mock('../../../../domain/babySteps/StampCelebratedUseCase', () => ({
  StampCelebratedUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../../infrastructure/logging/Logger', () => ({
  logger: { warn: jest.fn() },
}));

import { CelebrationModalHost } from '../CelebrationModalHost';

describe('CelebrationModalHost', () => {
  beforeEach(() => {
    mockQueue = [];
    mockHouseholdId = 'h1';
  });

  it('returns null when queue is empty', () => {
    const { toJSON } = render(<CelebrationModalHost />);
    expect(toJSON()).toBeNull();
  });

  it('returns null when householdId is null', () => {
    mockHouseholdId = null;
    mockQueue = [{ stepNumber: 1 }];
    const { toJSON } = render(<CelebrationModalHost />);
    expect(toJSON()).toBeNull();
  });

  it('renders CelebrationModal when queue has an item', () => {
    mockQueue = [{ stepNumber: 3 }];
    const { toJSON } = render(<CelebrationModalHost />);
    expect(toJSON()).toBeTruthy();
  });
});
