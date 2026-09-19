/**
 * For inserts/updates that should always produce exactly one row (no
 * onConflictDoNothing / optional match). If this ever throws, something is
 * structurally wrong (e.g. a unique constraint silently swallowed elsewhere),
 * not a normal "not found" case — those use NotFoundError instead.
 */
export function assertDefined<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
