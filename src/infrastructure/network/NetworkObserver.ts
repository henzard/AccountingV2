import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

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
        this.callbacks.forEach((cb) => cb().catch(console.warn));
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export const networkObserver = new NetworkObserver();
