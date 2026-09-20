import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { logger } from '../logging/Logger';

type OnConnectedCallback = () => Promise<void>;

export class NetworkObserver {
  private unsubscribe: (() => void) | null = null;
  private callbacks: OnConnectedCallback[] = [];

  /** Registers a reconnect callback. Returns an unsubscribe function — this
   * observer is an app-lifetime singleton, so a caller with a shorter life
   * (SyncScheduler, re-created on every household switch) must be able to
   * detach; without it every switch left another dead scheduler's callback
   * firing on each reconnect. */
  onConnected(callback: OnConnectedCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index >= 0) this.callbacks.splice(index, 1);
    };
  }

  start(): void {
    this.unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && state.isInternetReachable) {
        this.callbacks.forEach((cb) =>
          cb().catch((err: unknown) => logger.warn('NetworkObserver: callback error', { err })),
        );
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export const networkObserver = new NetworkObserver();
