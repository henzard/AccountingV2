import { recordError } from '../monitoring/crashlytics';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err: unknown, data?: Record<string, unknown>): void;
}

class ConsoleLogger implements Logger {
  info(msg: string, data?: Record<string, unknown>) {
    if (__DEV__) console.log(msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>) {
    console.warn(msg, data);
  }
  error(msg: string, err: unknown, data?: Record<string, unknown>) {
    console.error(msg, err, data);
    recordError(err, data as Record<string, string | number | boolean> | undefined);
  }
}

export const logger: Logger = new ConsoleLogger();
