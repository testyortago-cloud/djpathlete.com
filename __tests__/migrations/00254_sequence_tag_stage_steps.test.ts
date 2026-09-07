// @vitest-environment node
//
// Reads the migration off disk and checks its structure, the way
// __tests__/lib/lead-engine/seed-sequences.test.ts reads 00218. That suite is
// scoped to 00218 by a hardcoded path and does NOT cover this file, so the
// equivalent assertions have to live here.
//
// The last assertion is the one that matters most. `MoveTrigger` in TypeScript
// and the CHECK constraint in SQL encode the same set in two places, and
// nothing compared them — which is exactly how `quiz` came to be a legal
// TypeScript value that the database rejects, silently swallowed by the quiz
// route's catch. This test is that comparison.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00254_sequence_tag_stage_steps.sql"), "utf8")

/** The values inside `CHECK (trigger IN ('a','b',...))`, as a Set. */
function triggerCheckValues(sql: string): Set<string> {
  const match = sql.match(/CHECK\s*\(\s*trigger\s+IN\s*\(([^)]*)\)/i)
  if (!match) throw new Error("no trigger CHECK found in 00254")
  return new Set(Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]))
}

describe("migration 00254", () => {
  it("guards tag steps at the database level", () => {
    expect(SQL).toMatch(/ADD CONSTRAINT sequence_steps_tag_needs_config/i)
    // [\s\S]* instead of a dotAll (`s`) flag: this project's tsconfig targets
    // ES6, and TS rejects the `s` regex flag at that target (TS1501) even
    // though the runtime supports it. [\s\S] matches any character including
    // newlines without needing the flag, so behaviour is identical.
    expect(SQL).toMatch(/kind\s*<>\s*'tag'[\s\S]*OR[\s\S]*config \? 'tag'/i)
  })

  it("guards stage steps at the database level", () => {
    expect(SQL).toMatch(/ADD CONSTRAINT sequence_steps_stage_needs_config/i)
    expect(SQL).toMatch(/kind\s*<>\s*'stage'[\s\S]*OR[\s\S]*config \? 'stage'/i)
  })

  // FIX 7. 00221 established the house pattern on this same table: every
  // ADD CONSTRAINT is preceded by a DROP ... IF EXISTS, so a manual re-apply
  // is idempotent instead of raising 42710 on the first statement and leaving
  // the rest of the file unrun. The trigger constraint below already had it;
  // these two did not.
  //
  // Asserted as ORDER, not as mere presence: a DROP that landed after its own
  // ADD would satisfy a `toMatch` for both and still fail on re-apply.
  it.each(["sequence_steps_tag_needs_config", "sequence_steps_stage_needs_config"])(
    "drops %s before adding it, so a re-apply is idempotent",
    (name) => {
      const drop = SQL.indexOf(`DROP CONSTRAINT IF EXISTS ${name}`)
      const add = SQL.indexOf(`ADD CONSTRAINT ${name}`)
      expect(drop).toBeGreaterThan(-1)
      expect(add).toBeGreaterThan(-1)
      expect(drop).toBeLessThan(add)
    },
  )

  it("re-adds the trigger constraint it drops", () => {
    expect(SQL).toMatch(/DROP CONSTRAINT[\s\S]*opportunity_stage_events_trigger_check/i)
    expect(SQL).toMatch(/ADD CONSTRAINT opportunity_stage_events_trigger_check/i)
  })

  it("keeps every trigger value the previous constraint allowed", () => {
    // Read from production via pg_constraint on 2026-09-07, before this change.
    for (const existing of ["booking", "payment", "manual", "reconciler", "merge"]) {
      expect(triggerCheckValues(SQL)).toContain(existing)
    }
  })

  it("allows exactly the values the MoveTrigger union declares", async () => {
    const moveTypes = readFileSync(join(process.cwd(), "lib/lead-engine/pipeline-move.ts"), "utf8")
    const unionLine = moveTypes.match(/export type MoveTrigger\s*=\s*([^\n]+)/)
    if (!unionLine) throw new Error("MoveTrigger union not found")
    const declared = new Set(Array.from(unionLine[1].matchAll(/"([^"]+)"/g), (m) => m[1]))

    expect([...triggerCheckValues(SQL)].sort()).toEqual([...declared].sort())
  })
})
