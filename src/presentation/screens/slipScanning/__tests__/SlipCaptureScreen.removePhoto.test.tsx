import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

let mockShot = 0;
jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const CameraView = React.forwardRef((_props: object, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => ({ uri: `file:///shot-${++mockShot}.jpg` }),
    }));
    return React.createElement('View', { testID: 'camera-view' });
  });
  return {
    CameraView,
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  // Coachmark already seen, so the first shutter press takes a photo.
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: true }),
}));

jest.mock('../../../stores/toastStore', () => ({
  useToastStore: (sel: (s: { enqueue: () => void }) => unknown) => sel({ enqueue: jest.fn() }),
}));

import { SlipCaptureScreen } from '../SlipCaptureScreen';

async function renderWithTwoPhotos(): Promise<ReturnType<typeof render>> {
  const utils = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
  await act(async () => {});
  for (let i = 1; i <= 2; i += 1) {
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Take photo'));
    });
    await waitFor(() => expect(utils.getByLabelText(`Remove photo ${i}`)).toBeTruthy());
  }
  return utils;
}

describe('SlipCaptureScreen — removing a photo', () => {
  beforeEach(() => {
    mockShot = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('"Remove photo 1" removes the first thumbnail after the undo window', async () => {
    const { getByLabelText, queryByLabelText } = await renderWithTwoPhotos();

    fireEvent.press(getByLabelText('Remove photo 1'));
    expect(getByLabelText('Undo delete')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(queryByLabelText('Remove photo 2')).toBeNull();
    expect(getByLabelText('Remove photo 1')).toBeTruthy();
    expect(getByLabelText('Process 1 photo')).toBeTruthy();
  });

  it('Undo keeps the photo — the removal timer is cancelled, not just hidden', async () => {
    const { getByLabelText } = await renderWithTwoPhotos();

    fireEvent.press(getByLabelText('Remove photo 1'));
    fireEvent.press(getByLabelText('Undo delete'));
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(getByLabelText('Remove photo 2')).toBeTruthy();
    expect(getByLabelText('Process 2 photos')).toBeTruthy();
  });
});
