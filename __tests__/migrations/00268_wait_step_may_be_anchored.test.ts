// @vitest-environment node
//
// Reads migration 00268 off disk and checks its structure. Comment lines are
// stripped before the statement assertions, because the header discusses the
// old CHECK in prose and a whole-file `includes` would match it there.
//
// The BEHAVIOUR of the widened constraint was probed against the dev clone in
// a rolled-back DO block (anchored wait accepted; a wait with neither
// wait_minutes nor wait_until still refused). What this file pins is that the
// widening stays a widening — the failure mode worth guarding is somebody
// "simplifying" this into a plain DROP.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00268_wait_step_may_be_anchored.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

describe("00268 — a wait step may be anchored", () => {
  it("re-adds the constraint under the SAME name it dropped", () => {
    // Tests and comments cite `sequence_steps_wait_needs_minutes` by name. A
    // rename would leave those pointing at nothing, and the drop-then-add is
    // only safe because the name survives it.
    expect(SQL).toMatch(/DROP CONSTRAINT IF EXISTS sequence_steps_wait_needs_minutes/i)
    expect(SQL).toMatch(/ADD CONSTRAINT\s+sequence_steps_wait_needs_minutes/i)
  })

  it("keeps both original arms and adds only a third", () => {
    // This is the assertion that makes it a WIDENING rather than a removal.
    // A migration that dropped the constraint and re-added something weaker
    // would still pass the test above.
    expect(SQL).toMatch(/kind\s*<>\s*'wait'/i)
    expect(SQL).toMatch(/wait_minutes IS NOT NULL/i)
    expect(SQL).toMatch(/config \? 'wait_until'/i)
  })

  it("never leaves the table without the constraint", () => {
    // The DROP must be paired with an ADD in the same file. A file that only
    // dropped it would make every malformed wait storable.
    expect((SQL.match(/DROP CONSTRAINT/gi) ?? []).length).toBe(1)
    expect((SQL.match(/ADD CONSTRAINT/gi) ?? []).length).toBe(1)
  })

  it("tests key presence only, leaving the shape to the shared parser", () => {
    // A CHECK that also read `days_before_anchor` would be a third validator
    // — and the one nobody could change without a migration. `parseWaitConfig`
    // is shared by the editor and the tick precisely so they cannot drift.
    expect(SQL).not.toMatch(/days_before_anchor/i)
    expect(RAW).toContain("parseWaitConfig")
  })

  it("touches no data", () => {
    // Constraint only. Catches a later edit bolting a reseed onto a file that
    // has already been applied somewhere.
    expect(SQL).not.toMatch(/\bINSERT\b/i)
    expect(SQL).not.toMatch(/\bUPDATE\b/i)
    expect(SQL).not.toMatch(/\bDELETE\b/i)
  })
})
