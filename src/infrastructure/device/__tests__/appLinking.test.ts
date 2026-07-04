// A narrow, self-contained mock (no `jest.requireActual('react-native')`) —
// spreading/mutating the real module hits react-native's getter-backed
// exports (see appLinking.ts's own doc comment); this file only needs
// `Linking.addEventListener`/`getInitialURL` to exist.
const mockAddEventListener = jest.fn(
  (_event: string, _handler: (event: { url: string }) => void) => ({
    remove: jest.fn(),
  }),
);
const mockGetInitialURL = jest.fn((): Promise<string | null> => Promise.resolve(null));
jest.mock('react-native', () => ({
  Linking: {
    addEventListener: (event: string, handler: (e: { url: string }) => void) =>
      mockAddEventListener(event, handler),
    getInitialURL: () => mockGetInitialURL(),
  },
}));

import { addUrlListener, getInitialURL } from '../appLinking';

describe('appLinking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('addUrlListener registers a "url" listener with react-native Linking and returns its subscription', () => {
    const remove = jest.fn();
    mockAddEventListener.mockReturnValue({ remove });
    const handler = jest.fn();

    const subscription = addUrlListener(handler);

    expect(mockAddEventListener).toHaveBeenCalledWith('url', handler);
    expect(subscription.remove).toBe(remove);
  });

  it('getInitialURL delegates to react-native Linking.getInitialURL', async () => {
    mockGetInitialURL.mockResolvedValue('accountingv2://reset-password');

    await expect(getInitialURL()).resolves.toBe('accountingv2://reset-password');
    expect(mockGetInitialURL).toHaveBeenCalled();
  });
});
