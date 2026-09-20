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

/**
 * A column named by the code does not exist YET on this database — the
 * one-deploy window described in `.github/workflows/apply-migrations.yml`:
 * Vercel builds on push to main and nothing sequences that against the
 * migration also landing, so code that names a column its own migration adds
 * can run against the pre-migration schema for one deploy.
 *
 * This repo has two competing conventions for detecting that window, and
 * they exist for different operations, not by accident:
 *
 * - **Write** paths hit PostgREST's schema cache first, so they see
 *   `PGRST204` with a SINGLE-quoted column name (`Could not find the 'x'
 *   column of 'y' in the schema cache`). Callers: `lib/db/pipeline.ts:442`
 *   (`isMissingColumnError`), `lib/bookings/ingest.ts:243`
 *   (`isMissingTenantColumnsError`).
 * - **Read** paths (`.select()`) pass straight through to Postgres, so they
 *   see `42703` (`undefined_column`) with a DOUBLE-quoted column name
 *   (`column "x" of relation "y" does not exist`). A message-text match
 *   built for the single-quoted PGRST204 shape will never fire on a
 *   double-quoted 42703 message — quoting alone defeats it.
 * - A second convention layers message-text matching on top of the code,
 *   e.g. `lib/db/funnels.ts:664` (`isPre00230SchemaError`) and
 *   `lib/db/lead-inquiries.ts:17` (`isUnknownColumnError`), both matching
 *   `message.includes("'<column>'")`. That exists because PostgREST has
 *   renumbered its own error codes before, so at the time those were written
 *   the code alone wasn't trusted as a stable contract. Message text is even
 *   less stable across Postgres/PostgREST versions, so this helper is
 *   code-keyed only — matching both known codes is the belt this repo
 *   actually needs.
 *
 * Do NOT migrate the five existing hand-rolled callers (the four above, plus
 * `lib/db/lead-inquiries.ts`'s own site) to this helper as a drive-by — that
 * is a separate, reviewable change with its own test surface.
 */
export function isPgMissingColumn(err: unknown): boolean {
  return hasCode(err, "42703") || hasCode(err, "PGRST204")
}
