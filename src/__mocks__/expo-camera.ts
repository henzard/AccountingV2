import React from 'react';
import { View } from 'react-native';

export const CameraView = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<View>) =>
  React.createElement(View, { ref, testID: 'camera-view', ...props }),
);
CameraView.displayName = 'CameraView';

export const useCameraPermissions = jest
  .fn()
  .mockReturnValue([
    { granted: true, canAskAgain: true },
    jest.fn().mockResolvedValue({ granted: true }),
  ]);
