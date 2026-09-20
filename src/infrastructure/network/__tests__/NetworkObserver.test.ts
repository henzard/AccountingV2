/* eslint-disable @typescript-eslint/no-require-imports */
import { NetworkObserver } from '../NetworkObserver';

const mockAddEventListener = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (...args: any[]) => mockAddEventListener(...args),
}));

jest.mock('../../logging/Logger', () => ({
  logger: { warn: jest.fn() },
}));

describe('NetworkObserver', () => {
  let observer: NetworkObserver;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAddEventListener.mockReturnValue(jest.fn());
    observer = new NetworkObserver();
  });

  describe('onConnected', () => {
    it('registers a callback', () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      observer.onConnected(cb);
      expect(cb).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe that detaches the callback', () => {
      const staying = jest.fn().mockResolvedValue(undefined);
      const leaving = jest.fn().mockResolvedValue(undefined);
      observer.onConnected(staying);
      const unsubscribe = observer.onConnected(leaving);
      observer.start();

      unsubscribe();
      const handler = mockAddEventListener.mock.calls[0][0];
      handler({ isConnected: true, isInternetReachable: true });

      // Without this, every household switch left the previous
      // SyncScheduler's callback firing on each reconnect.
      expect(staying).toHaveBeenCalled();
      expect(leaving).not.toHaveBeenCalled();
    });

    it('unsubscribing twice is a no-op', () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      const unsubscribe = observer.onConnected(cb);
      unsubscribe();
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('start', () => {
    it('subscribes to NetInfo events', () => {
      observer.start();
      expect(mockAddEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('fires callbacks when connected and reachable', () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      observer.onConnected(cb);
      observer.start();

      const handler = mockAddEventListener.mock.calls[0][0];
      handler({ isConnected: true, isInternetReachable: true });

      expect(cb).toHaveBeenCalled();
    });

    it('does not fire callbacks when not connected', () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      observer.onConnected(cb);
      observer.start();

      const handler = mockAddEventListener.mock.calls[0][0];
      handler({ isConnected: false, isInternetReachable: false });

      expect(cb).not.toHaveBeenCalled();
    });

    it('does not fire callbacks when connected but not reachable', () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      observer.onConnected(cb);
      observer.start();

      const handler = mockAddEventListener.mock.calls[0][0];
      handler({ isConnected: true, isInternetReachable: false });

      expect(cb).not.toHaveBeenCalled();
    });

    it('logs warning when callback throws', async () => {
      const { logger } = require('../../logging/Logger');
      const cb = jest.fn().mockRejectedValue(new Error('sync failed'));
      observer.onConnected(cb);
      observer.start();

      const handler = mockAddEventListener.mock.calls[0][0];
      handler({ isConnected: true, isInternetReachable: true });

      await Promise.resolve();
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(
        'NetworkObserver: callback error',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });

    it('fires multiple callbacks', () => {
      const cb1 = jest.fn().mockResolvedValue(undefined);
      const cb2 = jest.fn().mockResolvedValue(undefined);
      observer.onConnected(cb1);
      observer.onConnected(cb2);
      observer.start();

      const handler = mockAddEventListener.mock.calls[0][0];
      handler({ isConnected: true, isInternetReachable: true });

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('unsubscribes from NetInfo', () => {
      const unsubscribe = jest.fn();
      mockAddEventListener.mockReturnValue(unsubscribe);

      observer.start();
      observer.stop();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('handles stop when not started', () => {
      expect(() => observer.stop()).not.toThrow();
    });

    it('sets unsubscribe to null after stop', () => {
      const unsubscribe = jest.fn();
      mockAddEventListener.mockReturnValue(unsubscribe);

      observer.start();
      observer.stop();
      observer.stop();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
