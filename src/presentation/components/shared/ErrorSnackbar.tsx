import React from 'react';
import { Snackbar } from 'react-native-paper';
import { colours } from '../../theme/tokens';

interface Props {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export function ErrorSnackbar({
  visible,
  message,
  actionLabel = 'Dismiss',
  onAction,
  onDismiss,
}: Props): React.JSX.Element {
  return (
    <Snackbar
      visible={visible}
      onDismiss={onDismiss}
      duration={4000}
      action={{ label: actionLabel, onPress: onAction ?? onDismiss }}
      style={{ backgroundColor: colours.onSurface }}
    >
      {message}
    </Snackbar>
  );
}
