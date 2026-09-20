type ForegroundListener = (message: { notification?: { title?: string; body?: string } }) => void;

const mockUnsubscribe = jest.fn();
const mockOnMessage = jest.fn((_listener: ForegroundListener) => mockUnsubscribe);
jest.mock('@react-native-firebase/messaging', () => () => ({
  onMessage: mockOnMessage,
}));

const mockEnqueue = jest.fn();
jest.mock('../../../presentation/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ enqueue: mockEnqueue }) },
}));

let mockHouseholdId: string | null = 'h1';
jest.mock('../../../presentation/stores/appStore', () => ({
  useAppStore: { getState: () => ({ householdId: mockHouseholdId }) },
}));

const mockRequestSyncNow = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../data/sync/syncRuntime', () => ({
  requestSyncNow: (...args: unknown[]) => mockRequestSyncNow(...args),
}));

jest.mock('../../logging/Logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { subscribeToForegroundMessages } from '../ForegroundMessageHandler';
import { logger } from '../../logging/Logger';

const mockLoggerWarn = logger.warn as jest.Mock;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ForegroundMessageHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHouseholdId = 'h1';
  });

  it('subscribes via messaging().onMessage and returns its unsubscribe', () => {
    const unsubscribe = subscribeToForegroundMessages();
    expect(mockOnMessage).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toBe(mockUnsubscribe);
  });

  it('enqueues an in-app toast with the notification title and body', () => {
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    listener({ notification: { title: 'Groceries', body: 'R25,00 from Groceries' } });

    expect(mockEnqueue).toHaveBeenCalledWith('Groceries: R25,00 from Groceries', 'info');
  });

  it('requests an immediate sync for the current household', async () => {
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    listener({ notification: { title: 'Groceries', body: 'R25,00 from Groceries' } });
    await flushMicrotasks();

    expect(mockRequestSyncNow).toHaveBeenCalledWith('h1');
  });

  it('does nothing when the message has neither a title nor a body', () => {
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    listener({});

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });

  it('does not request a sync when there is no current household', async () => {
    mockHouseholdId = null;
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    listener({ notification: { title: 'Groceries', body: 'R25,00 from Groceries' } });
    await flushMicrotasks();

    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });

  it('swallows a requestSyncNow rejection without throwing', async () => {
    mockRequestSyncNow.mockRejectedValueOnce(new Error('sync failed'));
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    expect(() =>
      listener({ notification: { title: 'Groceries', body: 'R25,00 from Groceries' } }),
    ).not.toThrow();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});
