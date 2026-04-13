export interface AuditEntry {
  householdId: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

export interface IAuditPort {
  log(entry: AuditEntry): Promise<void>;
}
