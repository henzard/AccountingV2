/** Extract a migration SQL section between markers; fails fast if markers missing. */
export function sliceMigrationSection(sql: string, startMarker: string, endMarker: string): string {
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start + startMarker.length);
  if (start === -1) {
    throw new Error(`Migration slice: start marker not found: ${startMarker}`);
  }
  if (end === -1) {
    throw new Error(`Migration slice: end marker not found: ${endMarker}`);
  }
  if (end <= start) {
    throw new Error(`Migration slice: end marker precedes start for: ${startMarker}`);
  }
  return sql.slice(start, end);
}

/** From startMarker through end of file (single-function migrations). */
export function sliceMigrationFrom(sql: string, startMarker: string): string {
  const start = sql.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Migration slice: start marker not found: ${startMarker}`);
  }
  return sql.slice(start);
}
