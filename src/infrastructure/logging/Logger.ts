import { recordError } from '../monitoring/crashlytics';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err: unknown, data?: Record<string, unknown>): void;
}

class ConsoleLogger implements Logger {
  info(msg: string, data?: Record<string, unknown>): void {
    if (__DEV__) console.log(msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    console.warn(msg, data);
  }

  error(msg: string, err: unknown, data?: Record<string, unknown>): void {
    console.error(msg, err, data);
    if (!__DEV__) {
      const ctx: Record<string, string> = { msg };
      if (data)
        Object.entries(data).forEach(([k, v]) => {
          ctx[k] = String(v);
        });
      recordError(err, ctx);
    }
  }
}

export const logger: Logger = new ConsoleLogger();
