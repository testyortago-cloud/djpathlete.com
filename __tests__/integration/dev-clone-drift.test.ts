// INTEGRATION TEST — opt-in: `npm run test:integration:drift`. Excluded from `npm test`.
//
// Compares the DEV CLONE's catalogs with the state the migrations describe:
// every function's code (comments and layout ignored) and SECURITY DEFINER
// flag, every table's row level security flag, and every policy.
//
// WHY THIS EXISTS (G46). The clone is written to by hand — apply.mjs refuses it,
// so each session POSTs its own migration — and its supabase_migrations ledger
// does not say what ran. On 2026-09-26 the ledger listed 00256 while the clone
// ran the body from BEFORE 00256's review fix (no ROW_COUNT check in
// save_sequence_steps), so every live test of the step editor was testing the
// older function. 00231 was missing outright: RLS off on the four pipeline
// tables and anon able to read and write them. Neither shows in any other test:
// the select contract probes columns, not function bodies or policies.
//
// WHAT IT DOES NOT COVER: see scripts/lib/migration-state.ts (dynamic SQL,
// grants, columns, argument lists, search_path, overloads).
//
// RUN IT after applying a migration to the clone, and before trusting a live
// test of a function a migration changed.
//
// DEV CLONE ONLY. The project ref is fixed below and is the only one this file
// ever sends a query to; it also refuses to start unless .env.local points at
// that same clone. Every query runs in a READ ONLY transaction. It needs
// SUPABASE_ACCESS_TOKEN (a Management API token) and fails, never skips,
// without it: a skipped check reads as a passing one.

import { describe, it, expect, beforeAll } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { findDrift, readMigrationState, type Drift, type LiveState } from "@/scripts/lib/migration-state"

const CLONE_REF = "anjvztjiokcgiyhobknq"
const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations")

/**
 * Tables a migration touches that do not exist on the clone for a reason no
 * migration can fix. A ratchet, not an allowlist: a table that appears on the
 * clone fails the run until its entry is removed, and a new absent table fails
 * until someone writes down why.
 */
const KNOWN_ABSENT: { table: string; why: string }[] = [
  {
    table: "realtime.messages",
    why:
      "The clone's realtime schema is empty (measured 2026-09-26): Supabase Realtime never created its " +
      "tables there. 00199's two channel policies ('participants read/write conversation channel') " +
      "cannot exist until it does. Production has both (read 2026-09-26).",
  },
]

async function query<T>(sql: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${CLONE_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `SET TRANSACTION READ ONLY;\n${sql}` }),
  })
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`)
  return (await res.json()) as T[]
}

function describeDrift(d: Drift): string {
  switch (d.kind) {
    case "function_missing":
      return `${d.object}: missing (defined in ${d.file})`
    case "function_code_differs":
      return `${d.object}: its code is not ${d.file}'s`
    case "function_security_differs":
      return `${d.object}: should be SECURITY ${d.expected.toUpperCase()} (${d.file})`
    case "table_missing":
      return `${d.object}: table absent (${d.file} sets RLS or a policy on it)`
    case "rls_differs":
      return `${d.object}: RLS should be ${d.expected} (${d.file})`
    case "policy_missing":
      return `${d.object.replace("|", ": policy ")} is missing (${d.file})`
  }
}

describe("dev clone matches the migrations", () => {
  let drift: Drift[]
  let liveTables: Set<string>

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    if (new URL(url).host !== `${CLONE_REF}.supabase.co`) {
      throw new Error(`refusing: NEXT_PUBLIC_SUPABASE_URL is not the dev clone (${url})`)
    }
    if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is not set in .env.local")

    const files = readdirSync(MIGRATIONS)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort()
      .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS, name), "utf8") }))
    const expected = readMigrationState(files)

    const [functions, tables, policies] = await Promise.all([
      query<LiveState["functions"][number]>(`
        SELECT n.nspname AS schema, p.proname AS name, p.prosrc AS src, p.prosecdef AS "securityDefiner"
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')`),
      query<LiveState["tables"][number]>(`
        SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS "rlsEnabled"
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p')`),
      query<LiveState["policies"][number]>(
        `SELECT schemaname AS schema, tablename AS "table", policyname AS name FROM pg_policies`,
      ),
    ])
    liveTables = new Set(tables.map((t) => `${t.schema}.${t.name}`))
    drift = findDrift(expected, { functions, tables, policies })
  }, 60_000)

  it("has every function, RLS flag and policy the migrations describe", () => {
    const known = new Set(KNOWN_ABSENT.map((k) => k.table))
    const unexplained = drift.filter((d) => !(d.kind === "table_missing" && known.has(d.object)))
    expect(unexplained.map(describeDrift)).toEqual([])
  })

  it("KNOWN_ABSENT names only tables that are still absent and still referenced", () => {
    const reported = new Set(drift.filter((d) => d.kind === "table_missing").map((d) => d.object))
    const stale = KNOWN_ABSENT.filter((k) => liveTables.has(k.table) || !reported.has(k.table)).map((k) => k.table)
    expect(stale).toEqual([])
  })
})
