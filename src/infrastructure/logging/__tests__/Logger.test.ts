/* eslint-disable @typescript-eslint/no-require-imports */
const mockRecordError = jest.fn();
jest.mock('../../monitoring/crashlytics', () => ({
  recordError: mockRecordError,
}));

describe('Logger', () => {
  let logger: import('../Logger').Logger;
  const originalDev = (global as any).__DEV__;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (global as any).__DEV__ = originalDev;
    jest.restoreAllMocks();
  });

  describe('info', () => {
    it('logs to console in __DEV__ mode', () => {
      (global as any).__DEV__ = true;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('hello', { key: 'value' });

      expect(console.log).toHaveBeenCalledWith('hello', { key: 'value' });
    });

    it('does not log in production', () => {
      (global as any).__DEV__ = false;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('hello');

      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('always logs to console.warn', () => {
      (global as any).__DEV__ = true;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('watch out', { detail: 'x' });

      expect(console.warn).toHaveBeenCalledWith('watch out', { detail: 'x' });
    });

    it('logs in production mode too', () => {
      (global as any).__DEV__ = false;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('warning');

      expect(console.warn).toHaveBeenCalledWith('warning', undefined);
    });
  });

  describe('error', () => {
    it('logs to console.error and calls recordError in production', () => {
      (global as any).__DEV__ = false;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('boom');
      logger.error('something broke', err, { userId: 'u1' });

      expect(console.error).toHaveBeenCalledWith('something broke', err, { userId: 'u1' });
      expect(mockRecordError).toHaveBeenCalledWith(err, {
        msg: 'something broke',
        userId: 'u1',
      });
    });

    it('does not call recordError in __DEV__ mode', () => {
      (global as any).__DEV__ = true;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('dev error', new Error('oops'));

      expect(console.error).toHaveBeenCalled();
      expect(mockRecordError).not.toHaveBeenCalled();
    });

    it('stringifies null and undefined context values', () => {
      (global as any).__DEV__ = false;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('err', new Error('e'), { a: null, b: undefined });

      expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), {
        msg: 'err',
        a: 'null',
        b: 'undefined',
      });
    });

    it('handles circular objects as [Unserialisable]', () => {
      (global as any).__DEV__ = false;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'error').mockImplementation(() => {});
      const circular: any = {};
      circular.self = circular;
      logger.error('err', new Error('e'), { obj: circular });

      expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), {
        msg: 'err',
        obj: '[Unserialisable]',
      });
    });

    it('stringifies primitive context values', () => {
      (global as any).__DEV__ = false;
      jest.resetModules();
      jest.mock('../../monitoring/crashlytics', () => ({ recordError: mockRecordError }));
      logger = require('../Logger').logger;

      jest.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('err', new Error('e'), { count: 42 as any, flag: true as any });

      expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), {
        msg: 'err',
        count: '42',
        flag: 'true',
      });
    });
  });
});
