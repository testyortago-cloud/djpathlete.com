// @vitest-environment node
// __tests__/lib/quizzes/quiz-schema.test.ts
//
// Reads the migration off disk and asserts its shape. Mirrors
// __tests__/lib/lead-engine/chat-schema.test.ts and pipeline-schema.test.ts,
// which exist because a migration is the one artifact no unit test otherwise
// touches — the DAL can be green against a schema that was never written the
// way the spec says.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §1
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const SQL = readFileSync("supabase/migrations/00228_athlete_quiz.sql", "utf8")

/**
 * The SQL with `--` comment lines removed.
 *
 * Use this for any assertion of the form "the schema does NOT do X". Against
 * the raw file those are unsound: this migration's comments explain at length
 * why there is no `abandoned` status, so a `not.toMatch(/'abandoned'/)` over
 * the whole file fails on the prose defending the very property it is
 * checking. Assert against the artifact you mean, not the page it is written
 * on.
 */
const DDL = SQL.replace(/^\s*--.*$/gm, "")

const TABLES = [
  "quizzes",
  "quiz_branches",
  "quiz_questions",
  "quiz_options",
  "quiz_tiers",
  "quiz_profiles",
  "quiz_attempts",
]

describe("00228 quiz tables", () => {
  it("creates all seven tables on the singleton business", () => {
    for (const table of TABLES) {
      expect(SQL, `${table} is not created`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      )
    }
    const defaults = SQL.match(/business_id\s+uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'/g)
    // Only the two top-level tables carry business_id; children reach it
    // through their parent. Asserting the exact count stops a later table
    // being added without one AND stops one being sprinkled where the parent
    // already establishes ownership.
    expect(defaults).toHaveLength(2)
  })

  it("makes a quiz key unique per business", () => {
    expect(SQL).toMatch(/UNIQUE\s*\(\s*business_id\s*,\s*key\s*\)/)
  })

  it("constrains quiz status to the three legal values", () => {
    expect(SQL).toMatch(/status\s+text NOT NULL DEFAULT 'draft'[\s\S]{0,120}CHECK[\s\S]{0,120}'archived'/)
  })

  it("lets a question belong to no branch, which is how it is asked of everyone", () => {
    // The router lives this way. A NOT NULL here would make the router
    // impossible to store and force a second table for shared questions.
    const branchFk = SQL.match(/branch_id\s+uuid[^,]*/)?.[0] ?? ""
    expect(branchFk).toMatch(/REFERENCES public\.quiz_branches\(id\) ON DELETE CASCADE/)
    expect(branchFk).not.toMatch(/NOT NULL/)
  })

  it("gives an option a weight that defaults to zero and two nullable roles", () => {
    expect(SQL).toMatch(/weight\s+numeric NOT NULL DEFAULT 0/)
    const routes = SQL.match(/routes_to_branch_id\s+uuid[^,]*/)?.[0] ?? ""
    const profile = SQL.match(/profile_id\s+uuid[^,]*/)?.[0] ?? ""
    expect(routes).not.toMatch(/NOT NULL/)
    expect(profile).not.toMatch(/NOT NULL/)
  })

  it("bounds tier bands to 0..100 at both ends", () => {
    expect(SQL).toMatch(/min_score\s+integer NOT NULL[\s\S]{0,90}CHECK[\s\S]{0,90}min_score\s*<=\s*100/)
    expect(SQL).toMatch(/max_score\s+integer NOT NULL[\s\S]{0,90}CHECK[\s\S]{0,90}max_score\s*<=\s*100/)
  })

  it("keeps an attempt's own max_score so a past result cannot be restated", () => {
    // Spec §1.10. Without max_score on the row, re-deriving an old percentage
    // needs today's weights, and a weight edit silently rewrites history.
    expect(SQL).toMatch(/raw_score\s+numeric/)
    expect(SQL).toMatch(/max_score\s+numeric/)
    expect(SQL).toMatch(/score\s+integer/)
  })

  it("has no abandoned status, because nothing observes the moment someone gives up", () => {
    const check = DDL.match(/status\s+text NOT NULL DEFAULT 'in_progress'[\s\S]{0,160}/)?.[0] ?? ""
    expect(check).toMatch(/'in_progress'/)
    expect(check).toMatch(/'completed'/)
    expect(DDL).not.toMatch(/'abandoned'/)
  })

  it("records whether the operator alert actually went out, not that it was attempted", () => {
    // lib/email.ts returns a success shape with no API key configured, so
    // "sent" has to be a claim something checked. See spec §5.4.
    expect(SQL).toMatch(/alert_status\s+text NOT NULL DEFAULT 'not_needed'[\s\S]{0,140}'failed'/)
    expect(SQL).toMatch(/alerted_at\s+timestamptz/)
  })

  it("cascades every child with its quiz", () => {
    const cascades = SQL.match(/REFERENCES public\.quiz(zes|_branches|_questions|_profiles)\([a-z_]+\) ON DELETE CASCADE/g)
    expect(cascades?.length ?? 0).toBeGreaterThanOrEqual(6)
  })

  it("indexes the reads that are not by primary key", () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_quiz_questions_order/)
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_quiz_options_order/)
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz/)
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_quiz_attempts_contact/)
  })
})

describe("00228 closes every table to the public key", () => {
  // THE DEFECT THIS EXISTS FOR, ONE MIGRATION EARLIER. 00227 shipped without
  // RLS and Supabase grants `anon` full DML on a public-schema table whose RLS
  // is off — and the anon key ships inside the browser bundle. Three reviewers
  // found it independently, and the suite that should have caught it asserted
  // five structural properties and no privilege boundary.
  //
  // These tables hold what strangers type about their injuries and their
  // children, so this is the same class of data one table over.
  it("enables row level security on all seven", () => {
    for (const table of TABLES) {
      expect(SQL, `${table} does not enable RLS`).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`),
      )
    }
  })

  it("grants only the service role", () => {
    for (const table of TABLES) {
      expect(SQL, `${table} has no service-role policy`).toMatch(
        new RegExp(`CREATE POLICY "Service role full access on ${table}"`),
      )
    }
    // No policy may name anon or authenticated. A read-only anon policy would
    // still expose every answer a visitor typed.
    expect(DDL).not.toMatch(/TO\s+anon\b/)
    expect(DDL).not.toMatch(/TO\s+authenticated\b/)
  })
})
