/**
 * Helpers for detecting common Postgres SQLSTATE errors that surface from
 * Supabase / PostgREST as objects with a `.code` field. Use code-based
 * checks (stable) over message-string parsing (fragile across PG versions).
 */

function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err
    && (err as { code?: string }).code === code
}

/** Postgres 23505: unique_violation */
export function isPgUniqueViolation(err: unknown): boolean {
  return hasCode(err, "23505")
}

/** Postgres 23503: foreign_key_violation */
export function isPgForeignKeyViolation(err: unknown): boolean {
  return hasCode(err, "23503")
}

/** Postgres 23514: check_violation */
export function isPgCheckViolation(err: unknown): boolean {
  return hasCode(err, "23514")
}
