// Applies any migration in supabase/migrations/ that public.repo_migrations has
// not recorded, in filename order, via the Supabase Management API.
//
// WHY THE MANAGEMENT API AND NOT psql. Connecting over the Postgres protocol
// needs the database password — a project-scoped superuser credential that
// bypasses RLS and can drop anything. The Management API needs a Personal
// Access Token instead, which is revocable from the account page and is the
// same path the Supabase MCP tooling has used for every migration on this
// project so far. No new credential class enters the system.
//
// THE PROPERTY THIS RESTS ON, WHICH WAS MEASURED, NOT ASSUMED: a multi-statement
// body sent to /database/query runs as ONE implicit transaction. Verified on
// 2026-08-13 by sending an INSERT followed by `SELECT 1/0` and confirming the
// row did not survive. That is what lets the migration and its ledger row be
// written together — there is no state where a migration is applied but
// unrecorded, which is the state that makes the next run apply it twice.
//
// If that ever stops being true, this script is unsafe and must go back to
// psql --single-transaction. The probe above is cheap; re-run it if in doubt.
//
// STOPS AT THE FIRST FAILURE. Continuing past a failed migration would apply
// later ones against a schema their author never anticipated.

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "supabase/migrations"
const DRY_RUN = process.env.DRY_RUN === "true"

/**
 * Errors travel as exceptions and the process exits by setting `exitCode`, NOT
 * by calling process.exit() mid-flight. Exiting while a fetch handle is still
 * open trips a libuv assertion on Windows and reports 127 instead of 1 — the
 * job still fails, but with a status that says "command not found" rather than
 * "the migration was rejected".
 */
class ApplyError extends Error {}

/**
 * Overridable ONLY so the request path can be exercised against a stub — the
 * logic that decides which migrations are pending is the part with teeth, and
 * "it looked right" is not a test. Never set this in the workflow.
 */
const API_BASE = process.env.SUPABASE_API_URL ?? "https://api.supabase.com"

/** One request to the query endpoint. Returns parsed rows for a SELECT. */
async function runSql(query) {
  const response = await fetch(
    `${API_BASE}/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  )

  const text = await response.text()
  if (!response.ok) {
    // The body carries the Postgres error; surface it verbatim rather than a
    // status code, because "42P07 relation already exists" is actionable and
    // "400" is not.
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

async function main() {
  if (!TOKEN) throw new ApplyError("SUPABASE_ACCESS_TOKEN is required")
  if (!PROJECT_REF) throw new ApplyError("SUPABASE_PROJECT_REF is required")

  // --- the ledger must exist, or everything looks unapplied ------------------

  let ledgerCheck
  try {
    ledgerCheck = await runSql("SELECT to_regclass('public.repo_migrations') IS NOT NULL AS present")
  } catch (error) {
    throw new ApplyError(`Could not reach the database: ${error.message}`)
  }

  if (!ledgerCheck?.[0]?.present) {
    throw new ApplyError(
      "public.repo_migrations does not exist. Run scripts/migrations/baseline.sql " +
        "against this database first — without it every migration looks unapplied " +
        "and production would be replayed from 00001.",
    )
  }

  // --- what is pending -------------------------------------------------------

  const appliedRows = await runSql("SELECT filename FROM public.repo_migrations")
  const applied = new Set(appliedRows.map((row) => row.filename))

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => !applied.has(name))

  if (pending.length === 0) {
    console.log(`No pending migrations. ${applied.size} already applied.`)
    return
  }

  console.log(`Pending migrations (${pending.length}):`)
  for (const name of pending) console.log(`  ${name}`)

  if (DRY_RUN) {
    console.log("DRY_RUN=true — nothing was applied.")
    return
  }

  // --- apply, one request per migration --------------------------------------

  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8")

    // The ledger row rides in the same body, therefore the same transaction.
    // Doubling any single quote in the filename keeps a stray apostrophe from
    // ending the literal — filenames here never contain one, but a rule that
    // depends on that staying true is not a rule.
    const body = `${sql}\n\nINSERT INTO public.repo_migrations (filename) VALUES ('${name.replaceAll("'", "''")}');`

    console.log(`--- applying ${name}`)
    try {
      await runSql(body)
    } catch (error) {
      throw new ApplyError(
        `${name} failed and was rolled back. Nothing after it was applied.\n${error.message}`,
      )
    }
    console.log(`--- applied  ${name}`)
  }

  console.log(`Applied ${pending.length} migration(s).`)
}

try {
  await main()
} catch (error) {
  console.error(`::error::${error.message}`)
  process.exitCode = 1
}
