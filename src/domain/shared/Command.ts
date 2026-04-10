import type { Result, DomainError } from './types';

export interface Command<T, E extends DomainError = DomainError> {
  execute(): Promise<Result<T, E>>;
  undo?(): Promise<Result<void, E>>;
}
