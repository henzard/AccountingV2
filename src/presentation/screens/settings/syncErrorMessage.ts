/**
 * syncErrorMessage — D-2: raw `Error.message` strings must never reach a
 * user (they can be bare SQL/HTTP internals). Known shapes get a plain-
 * language rewrite; everything else falls back to one honest generic
 * message. Callers are responsible for logging the raw error via the
 * existing `logger` themselves — this module never logs anything, it only
 * maps text.
 *
 * Used by `SyncHealthScreen`'s discard failure. `SyncScheduler`'s
 * unclassified catch (~line 445 of data/sync/SyncScheduler.ts) needs the
 * same categories but duplicates them locally instead of importing this
 * module — `data/sync/*` must never import `presentation/*` (dependencies
 * point inward only; see that file's module doc). Keep the two in sync by
 * hand if the categories change.
 */

const GENERIC_MESSAGE = "Something went wrong while syncing. We'll try again.";

const KNOWN_SHAPES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  {
    // network / timeout / fetch (and common synonyms a transport error
    // throws with: "unreachable", "connection").
    pattern: /network|timeout|fetch|unreachable|connection/i,
    message: "Can't reach the server. Check your connection and try again.",
  },
  {
    // auth / JWT expired.
    pattern: /jwt|unauthorized|unauthenticated|token.*expired|expired.*token|auth/i,
    message: 'Your session expired. Sign in again to keep syncing.',
  },
  {
    // permission.
    pattern: /permission|forbidden|denied|not[_ ]?member/i,
    message: "You don't have permission to make this change.",
  },
];

/**
 * Maps a raw sync error to plain language safe to show a user. Unknown
 * shapes always get the same generic message — never the raw text.
 */
export function syncErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!raw) return GENERIC_MESSAGE;
  const known = KNOWN_SHAPES.find(({ pattern }) => pattern.test(raw));
  return known ? known.message : GENERIC_MESSAGE;
}
