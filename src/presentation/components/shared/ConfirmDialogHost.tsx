/**
 * ConfirmDialogHost — promise-based confirm() dialog, replacing
 * react-native's Alert.alert (a no-op on web via react-native-web, so
 * sign-out/archive/delete confirmations silently did nothing on web).
 *
 * Mount <ConfirmDialogHost /> once at the navigator root (mirrors ToastHost)
 * and call `confirm({ title, message, confirmLabel, destructive })` from
 * anywhere; it resolves to `true`/`false` once the user picks an option, so
 * call sites can `if (await confirm(...))` exactly like they previously
 * branched inside Alert.alert's button callbacks.
 */
import React from 'react';
import { Dialog, Portal, Text, Button } from 'react-native-paper';
import { useConfirmStore } from '../../stores/confirmStore';
import type { ConfirmOptions } from '../../stores/confirmStore';
import { useAppTheme } from '../../theme/useAppTheme';

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().requestConfirm(options);
}

export function ConfirmDialogHost(): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const request = useConfirmStore((s) => s.request);
  const resolveConfirm = useConfirmStore((s) => s.resolveConfirm);

  if (!request) return null;

  const handleCancel = (): void => resolveConfirm(false);
  const handleConfirm = (): void => resolveConfirm(true);

  return (
    <Portal>
      <Dialog visible onDismiss={handleCancel} testID="confirm-dialog">
        <Dialog.Title>{request.title}</Dialog.Title>
        <Dialog.Content>
          <Text style={{ color: colors.onSurfaceVariant }}>{request.message}</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={handleCancel} testID="confirm-dialog-cancel">
            {request.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            onPress={handleConfirm}
            textColor={request.destructive ? colors.error : undefined}
            testID="confirm-dialog-confirm"
          >
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
