/**
 * confirmStore — Zustand store backing the promise-based confirm() dialog.
 *
 * react-native-web's Alert.alert is a no-op on web, so screens that used it
 * for a destructive-action confirmation (sign out, archive envelope, delete
 * transaction) silently did nothing on web. This store holds at most one
 * pending confirm request; ConfirmDialogHost (mounted once at the navigator
 * root, mirroring ToastHost) renders it as a Paper Dialog and resolves the
 * caller's promise when the user picks an option.
 */
import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (e.g. red) when true. */
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: string;
}

interface ConfirmState {
  request: ConfirmRequest | null;
}

interface ConfirmActions {
  requestConfirm: (options: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (result: boolean) => void;
}

let _idCounter = 0;

function generateId(): string {
  _idCounter += 1;
  return `confirm-${Date.now()}-${_idCounter}`;
}

// The pending promise's resolver lives outside the store's own state (which
// stays plain/serializable, mirroring toastStore) — there is only ever one
// resolver in flight, 1:1 with `request`.
let pendingResolve: ((result: boolean) => void) | null = null;

export const useConfirmStore = create<ConfirmState & ConfirmActions>((set) => ({
  request: null,

  requestConfirm: (options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Only one confirm dialog can be shown at a time. If a previous one is
      // somehow still pending, resolve it as cancelled first so its caller
      // doesn't hang forever, then show the new one.
      if (pendingResolve) {
        const previousResolve = pendingResolve;
        previousResolve(false);
      }
      pendingResolve = resolve;
      set({ request: { id: generateId(), ...options } });
    });
  },

  resolveConfirm: (result: boolean): void => {
    const resolve = pendingResolve;
    pendingResolve = null;
    set({ request: null });
    resolve?.(result);
  },
}));
