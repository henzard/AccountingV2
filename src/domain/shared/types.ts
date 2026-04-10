export interface DomainError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export type Result<T, E extends DomainError = DomainError> =
  | { success: true; data: T }
  | { success: false; error: E };

export function createSuccess<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function createFailure<E extends DomainError>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isSuccess<T, E extends DomainError>(
  result: Result<T, E>,
): result is { success: true; data: T } {
  return result.success;
}

export interface BudgetPeriod {
  startDate: Date;
  endDate: Date;
  label: string; // e.g. "20 Mar – 19 Apr"
}

export interface AuditEvent {
  id: string;
  householdId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValueJson: string | null;
  newValueJson: string | null;
  createdAt: string; // ISO 8601
  isSynced: boolean;
}
