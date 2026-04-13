import { recordError } from '../monitoring/crashlytics';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err: unknown, data?: Record<string, unknown>): void;
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '[Unserialisable]';
    }
  }
  return String(v);
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
          ctx[k] = stringifyValue(v);
        });
      recordError(err, ctx);
    }
  }
}

export const logger: Logger = new ConsoleLogger();
