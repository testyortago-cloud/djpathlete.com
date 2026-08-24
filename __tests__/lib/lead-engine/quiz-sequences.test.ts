// @vitest-environment node
//
// The four archetype sequences, asserted against the MIGRATION SOURCE.
//
// Reading the SQL rather than the database is deliberate: the property that
// matters is what a fresh install gets, and a clone that happens to have been
// hand-edited would hide a broken seed. The same reason 00218's own review
// read the file.
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { RPI_ATHLETE_QUIZ } from "@/lib/quizzes/seed/rpi-athlete-quiz"

const SQL = fs.readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "00229_athlete_quiz_sequences.sql"),
  "utf8",
)

/**
 * The STATEMENTS only, with `--` comment lines stripped.
 *
 * The header comment above the inserts says "SEEDED AS 'draft', NOT 'active'",
 * so a naive count of `'draft'` over the whole file reads 5 and a search for
 * `'active'` finds the prose telling you not to use it. Counting rows means
 * counting rows, not counting the documentation about them.
 */
const BODY = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")

const SEQUENCE_KEYS = ["quiz_ceiling_breaker", "quiz_rebuilder", "quiz_aspiring_pro", "quiz_parent_coach"]

describe("the four quiz sequences", () => {
  it("1. seeds four sequences, every one triggered by the quiz", () => {
    for (const key of SEQUENCE_KEYS) expect(SQL).toContain(`'${key}'`)
    // Four rows, each naming 'quiz' as its trigger source.
    expect(BODY.match(/'quiz',\n\s+'\{"branch"/g) ?? []).toHaveLength(4)
  })

  it("2. seeds EVERY one as draft — a sequence active on the day its trigger fires sends mail nobody reviewed", () => {
    // MUTANT: one row seeded 'active'. Counted rather than searched, so a
    // single flipped row among four cannot hide behind its three neighbours.
    expect(BODY.match(/'draft'/g) ?? []).toHaveLength(4)
    expect(BODY).not.toMatch(/'active'/)
  })

  it("3. filters on exactly the seed module's branch keys — both sides read, never a copied list", () => {
    // THE CONTRACT. `trigger_filter` is JSON, so there is no foreign key
    // across this boundary and there cannot be: renaming a branch key
    // silently stops enrolment. This is the only thing standing in for one.
    const filtered = [...BODY.matchAll(/'\{"branch":\s*"([a-z_]+)"\}'::jsonb/g)].map((m) => m[1])
    const seeded = RPI_ATHLETE_QUIZ.branches.map((branch) => branch.key)
    expect(filtered.slice().sort()).toEqual(seeded.slice().sort())
    expect(filtered).toHaveLength(4)
  })

  it("gives each sequence one immediate email step", () => {
    // The visitor is emailed nothing at the moment of completion — the result
    // is rendered on screen — so an immediate first step cannot double up.
    expect(BODY.match(/0, 'email', NULL,/g) ?? []).toHaveLength(4)
  })

  it("marks every placeholder body as unreviewed, in the body itself", () => {
    // A flip made without a copy pass should be visible IN THE INBOX, not
    // just in a migration comment nobody re-reads.
    expect(SQL.match(/PLACEHOLDER COPY — not reviewed/g) ?? []).toHaveLength(4)
  })

  it("is idempotent on both tables", () => {
    expect(SQL).toContain("ON CONFLICT (business_id, key) DO NOTHING")
    expect(BODY.match(/ON CONFLICT \(sequence_id, position\) DO NOTHING/g) ?? []).toHaveLength(4)
  })
})
