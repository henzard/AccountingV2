type ForegroundListener = (message: {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
}) => void;

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
let mockAvailableHouseholds: Array<{ id: string; name: string; paydayDay: number }> = [
  { id: 'h1', name: 'Household One', paydayDay: 1 },
];
jest.mock('../../../presentation/stores/appStore', () => ({
  useAppStore: {
    getState: () => ({
      householdId: mockHouseholdId,
      availableHouseholds: mockAvailableHouseholds,
    }),
  },
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
    mockAvailableHouseholds = [
      { id: 'h1', name: 'Household One', paydayDay: 1 },
      { id: 'h2', name: 'Household Two', paydayDay: 15 },
    ];
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

  it('PUSH-3: syncs the household the push is ABOUT, not the one currently viewed', async () => {
    mockHouseholdId = 'h1'; // currently viewing h1
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    // Push is about h2, and the user is a member of h2 (in availableHouseholds).
    listener({
      notification: { title: 'Groceries', body: 'R25,00 from Groceries' },
      data: { type: 'household_activity', householdId: 'h2', target: 'Transactions' },
    });
    await flushMicrotasks();

    expect(mockRequestSyncNow).toHaveBeenCalledWith('h2');
    expect(mockRequestSyncNow).not.toHaveBeenCalledWith('h1');
  });

  it('PUSH-3: falls back to the current household when the user is not a member of the pushed one', async () => {
    mockHouseholdId = 'h1';
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    // Push names a household the user has since left/been removed from.
    listener({
      notification: { title: 'Groceries', body: 'R25,00 from Groceries' },
      data: { type: 'household_activity', householdId: 'h-not-a-member', target: 'Transactions' },
    });
    await flushMicrotasks();

    expect(mockRequestSyncNow).toHaveBeenCalledWith('h1');
  });

  it('PUSH-3: falls back to the current household for a legacy push with no data.householdId', async () => {
    mockHouseholdId = 'h1';
    subscribeToForegroundMessages();
    const listener = mockOnMessage.mock.calls[0][0];

    listener({ notification: { title: 'Household activity', body: 'Open the app' } });
    await flushMicrotasks();

    expect(mockRequestSyncNow).toHaveBeenCalledWith('h1');
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
