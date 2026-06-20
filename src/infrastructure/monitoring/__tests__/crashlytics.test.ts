import crashlytics from '@react-native-firebase/crashlytics';
import { initCrashlytics, recordError, log } from '../crashlytics';

const mockInstance = crashlytics();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('initCrashlytics', () => {
  const originalDev = (global as any).__DEV__;
  afterEach(() => {
    (global as any).__DEV__ = originalDev;
  });

  it('__DEV__=true -> collection disabled', async () => {
    (global as any).__DEV__ = true;
    await initCrashlytics(null);

    expect(mockInstance.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(false);
  });

  it('__DEV__=false -> collection enabled', async () => {
    (global as any).__DEV__ = false;
    await initCrashlytics(null);

    expect(mockInstance.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(true);
  });

  it('userId provided -> setUserId called', async () => {
    (global as any).__DEV__ = false;
    await initCrashlytics('user-42');

    expect(mockInstance.setUserId).toHaveBeenCalledWith('user-42');
  });

  it('userId null -> setUserId NOT called', async () => {
    (global as any).__DEV__ = false;
    await initCrashlytics(null);

    expect(mockInstance.setUserId).not.toHaveBeenCalled();
  });
});

describe('recordError', () => {
  it('with context -> setAttribute loop', () => {
    const err = new Error('test');
    recordError(err, { screen: 'home', attempt: 3, retry: true });

    expect(mockInstance.setAttribute).toHaveBeenCalledTimes(3);
    expect(mockInstance.setAttribute).toHaveBeenCalledWith('screen', 'home');
    expect(mockInstance.setAttribute).toHaveBeenCalledWith('attempt', '3');
    expect(mockInstance.setAttribute).toHaveBeenCalledWith('retry', 'true');
    expect(mockInstance.recordError).toHaveBeenCalledWith(err);
  });

  it('without context -> no setAttribute calls', () => {
    const err = new Error('plain');
    recordError(err);

    expect(mockInstance.setAttribute).not.toHaveBeenCalled();
    expect(mockInstance.recordError).toHaveBeenCalledWith(err);
  });

  it('non-Error argument -> wraps in Error', () => {
    recordError('string crash');

    const recorded = (mockInstance.recordError as jest.Mock).mock.calls[0][0];
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.message).toBe('string crash');
  });

  it('non-Error object -> wraps via String()', () => {
    recordError({ code: 500 });

    const recorded = (mockInstance.recordError as jest.Mock).mock.calls[0][0];
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.message).toBe('[object Object]');
  });
});

describe('log', () => {
  it('delegates correctly', () => {
    log('test message');

    expect(mockInstance.log).toHaveBeenCalledWith('test message');
  });
});
