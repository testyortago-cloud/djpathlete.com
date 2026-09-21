// @vitest-environment node
//
// Structure of migration 00274 — row level security on the thirteen public
// tables that had none.
//
// WHY THERE ARE NO POLICIES. Every reader of all thirteen tables goes through
// `createServiceRoleClient()` (10 DALs call it directly; `agent_tool_baselines`
// and `chief_strategist_memos` take an injected client, and every injector is
// service-role too). `createBrowserSupabaseClient` and
// `createServerSupabaseClient` have ZERO callers anywhere in the repo, so no
// query in this product ever runs as `anon` or `authenticated` against these
// tables. `service_role` carries `rolbypassrls = true` (verified on production
// 2026-09-21), so RLS with no policy denies the internet and changes nothing
// for the app. Twenty-eight tables in this database already run exactly this
// configuration — `audit_logs`, `funnels`, `cron_runs` among them.
//
// A POLICY HERE WOULD BE A REGRESSION, not an improvement. The obvious-looking
// `select using (true)` on the "public" reference tables (`events`,
// `membership_plans`, `assessment_questions`) would PRESERVE the anon read that
// this migration exists to close, and buy nothing: those pages render
// server-side through the service-role client. Hence the no-CREATE-POLICY
// assertion below — it is a guard, not tidiness.
//
// Comment lines are stripped before the statement assertions, whole-line and
// trailing both, because the header names every one of the thirteen tables in
// prose and discusses `CREATE POLICY` and `FORCE` in order to explain why they
// are absent. Without stripping, the negative assertions would match the
// explanation instead of the code. Trailing comments are only cut from lines
// with no single quote, so a `--` inside a string literal survives.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00274_enable_rls_on_open_tables.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .map((line) => (line.includes("'") ? line : line.replace(/--.*$/, "")))
  .join("\n")

/**
 * The thirteen tables measured on production 2026-09-21 as
 * `pg_class.relrowsecurity = false` with zero policies, and independently
 * flagged ERROR / EXTERNAL by Supabase's own `rls_disabled_in_public` linter.
 */
const OPEN_TABLES = [
  "agent_tool_baselines",
  "assessment_questions",
  "assessment_results",
  "chief_strategist_memos",
  "coach_ai_policy",
  "event_signups",
  "events",
  "exercise_blocks",
  "generated_exercise_usage",
  "membership_plans",
  "program_week_access",
  "program_week_pricing",
  "repo_migrations",
]

/** The `tables text[] := ARRAY[...]` the DO block loops over. */
function declaredTables(): string[] {
  const m = SQL.match(/tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/)
  expect(m, "migration declares no tables array").not.toBeNull()
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe("00274 — RLS on the thirteen tables that had none", () => {
  it("covers the EXACT set of thirteen, so dropping or adding one fails here", () => {
    // An exact set, not a contains-check. A contains-check stays green if a
    // table is quietly dropped from the list, which is precisely the failure
    // that would leave 5,687 rows of `generated_exercise_usage` readable by
    // anyone holding the publishable key.
    expect(declaredTables().slice().sort()).toEqual(OPEN_TABLES.slice().sort())
    expect(declaredTables().length).toBe(13)
  })

  it("enables RLS through the loop rather than naming tables in bare DDL", () => {
    // One `EXECUTE format(...)` driven by the array is what makes the set
    // assertion above meaningful. Thirteen hand-written ALTER statements would
    // pass the set check while enabling RLS on something else entirely.
    expect(SQL).toMatch(/EXECUTE format\('ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY', t\)/)
    expect(SQL).not.toMatch(/^\s*ALTER TABLE public\.\w+ ENABLE ROW LEVEL SECURITY/m)
  })

  it("creates NO policy — deny-all is the intended end state", () => {
    // See the header. A policy here would re-open what the migration closes.
    expect(SQL).not.toMatch(/\bCREATE POLICY\b/i)
    expect(SQL).not.toMatch(/\busing\s*\(\s*true\s*\)/i)
  })

  it("does not use FORCE, and grants nothing", () => {
    // FORCE only strips the table-OWNER exemption; `service_role` bypasses RLS
    // by role attribute (`rolbypassrls`), so FORCE would not affect the app --
    // but it is not what this change is for, and it changes owner-side
    // behaviour that nothing here has measured.
    expect(SQL).not.toMatch(/FORCE ROW LEVEL SECURITY/i)
    expect(SQL).not.toMatch(/\bGRANT\b/i)
  })

  it("tolerates ONLY repo_migrations being absent, by an explicit allowlist", () => {
    // Measured: the dev clone (anjvztjiokcgiyhobknq) has 12 of the 13 -- it has
    // no `public.repo_migrations`. An unguarded ALTER would abort the whole
    // migration there, so the rehearsal could never run.
    //
    // But a BLANKET skip is the bug, not the fix: the `still_off` read-back
    // filters on the same array, so any table that was renamed or misspelled
    // would be skipped, never verified, and reported as success -- the
    // migration announcing thirteen closed tables having closed twelve.
    expect(SQL).toMatch(/to_regclass/)
    expect(SQL).toMatch(/may_be_absent\s+text\[\]\s*:=\s*ARRAY\['repo_migrations'\]/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,140}not on the may-be-absent list/)
  })

  it("revokes the privileges RLS does NOT constrain", () => {
    // ENABLE ROW LEVEL SECURITY leaves `relacl` untouched, and RLS governs
    // only SELECT/INSERT/UPDATE/DELETE. TRUNCATE, REFERENCES, TRIGGER and
    // MAINTAIN are decided by the grant alone -- so without this the thirteen
    // tables end the migration with `anon` still holding TRUNCATE while the
    // header claims the internet has been denied.
    expect(SQL).toMatch(/REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public\.%I FROM anon, authenticated/)
    // And it is verified, not assumed.
    expect(SQL).toMatch(/has_table_privilege\('anon', c\.oid, 'TRUNCATE'\)/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,160}still hold RLS-exempt privileges/)
  })

  it("VERIFIES the end state instead of trusting the loop ran", () => {
    // The loop can succeed and still leave a table open if the array is wrong.
    // This reads `pg_class.relrowsecurity` back and raises.
    expect(SQL).toMatch(/relrowsecurity/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,160}RLS still disabled/)
  })

  it("verifies against pg_class, NOT information_schema", () => {
    // `information_schema.role_table_grants` returns zero rows here for every
    // role, and would read as a clean bill of health. It hides grants exactly
    // as it hides constraints.
    expect(SQL).toMatch(/pg_class/)
    expect(SQL).not.toMatch(/information_schema/i)
  })

  it("raises if it enabled nothing at all, which a still-disabled check cannot see", () => {
    // If every name in the array were misspelled, `to_regclass` would skip all
    // thirteen, the read-back would find no matching row still disabled, and
    // the migration would finish green having done nothing.
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,160}enabled nothing/)
  })

  it("asserts zero policies at apply time, so 'deny all' is measured and not assumed", () => {
    expect(SQL).toMatch(/pg_policy/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,160}unexpected polic/)
  })

  it("touches no data and drops nothing", () => {
    // The REVOKE statements are removed before this check, because they name
    // DELETE-adjacent privileges (`TRUNCATE`, `REFERENCES`, ...) as the OBJECT
    // of a grant rather than performing them. Matching the bare word would
    // fail on the very line that closes the TRUNCATE hole -- a test that
    // forbids the fix. What must be absent is the STATEMENT.
    // Two constructs legitimately NAME these verbs without performing them:
    // the REVOKE string literal, and the privilege names passed to
    // `has_table_privilege`. Both are replaced by placeholders -- deliberately
    // narrow, rather than stripping every string literal, because this
    // migration builds its DDL with `format()` and a blanket literal-strip
    // would hide a real `EXECUTE format('DELETE FROM ...')`.
    const stripped = SQL.replace(/'REVOKE[^']*'/gi, "'<revoke-stmt>'").replace(
      /has_table_privilege\([^)]*\)/gi,
      "<priv-check>",
    )
    // Presence controls: if either replacement matched nothing, the
    // assertions below would be checking an unmodified string and this test
    // would be measuring nothing.
    expect(stripped, "no REVOKE literal was found to strip").toContain("<revoke-stmt>")
    expect(stripped, "no has_table_privilege call was found to strip").toContain("<priv-check>")

    expect(stripped).not.toMatch(/\bDELETE\b/i)
    expect(stripped).not.toMatch(/\bDROP\b/i)
    expect(stripped).not.toMatch(/\bTRUNCATE\b/i)
    expect(stripped).not.toMatch(/\bUPDATE\b/i)
    expect(stripped).not.toMatch(/\bINSERT\b/i)
  })

  it("hard-codes no id, not even the platform business", () => {
    // NOT `/'<uuid>'/` -- requiring the quotes to sit immediately either side
    // of the uuid lets one embedded in a longer string literal straight
    // through, which is how this assertion survived its own mutant. The claim
    // in the test name is "no id at all", so the regex has to be "anywhere".
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })
})
