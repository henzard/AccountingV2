import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { logger } from '../logging/Logger';

type OnConnectedCallback = () => Promise<void>;

export class NetworkObserver {
  private unsubscribe: (() => void) | null = null;
  private callbacks: OnConnectedCallback[] = [];

  onConnected(callback: OnConnectedCallback): void {
    this.callbacks.push(callback);
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
