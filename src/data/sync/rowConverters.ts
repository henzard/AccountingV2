export function toSupabaseRow(
  camelRow: Record<string, unknown>,
): Record<string, unknown> {
  const { isSynced: _isSynced, ...rest } = camelRow;
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      value,
    ]),
  );
}

export function toLocalRow(
  snakeRow: Record<string, unknown>,
): Record<string, unknown> {
  const camel = Object.fromEntries(
    Object.entries(snakeRow).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
  return { ...camel, isSynced: true };
}
