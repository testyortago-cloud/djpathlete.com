// @vitest-environment node
//
// Reads migration 00258 off disk and checks its structure, the same way
// __tests__/migrations/00254_sequence_tag_stage_steps.test.ts reads 00254 —
// the migration that most recently altered this exact CHECK constraint
// before this one.
//
// THIS FILE IS NOW THE UNION-TO-SQL PIN, not 00254's test. `MoveTrigger` in
// TypeScript and the CHECK constraint in SQL encode the same set in two
// places; 00254's test used to be the comparison, back when 00254 was the
// last word on the constraint. It no longer is — this file supersedes it,
// the same way 00258 supersedes 00254's own CHECK definition. 00254's test
// keeps a HISTORICAL, subset-only assertion instead (see that file), because
// asserting an exact match there would fail the moment this file's own
// 'inquiry' value existed, for a reason that has nothing wrong with 00254.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/00258_pipeline_inquiry_trigger.sql"), "utf8")

/** The values inside `CHECK (trigger IN ('a','b',...))`, as a Set. */
function triggerCheckValues(sql: string): Set<string> {
  const match = sql.match(/CHECK\s*\(\s*trigger\s+IN\s*\(([^)]*)\)/i)
  if (!match) throw new Error("no trigger CHECK found in 00258")
  return new Set(Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]))
}

describe("migration 00258", () => {
  // 00221 established the house pattern on this table: every ADD CONSTRAINT
  // is preceded by a DROP ... IF EXISTS, so a manual re-apply is idempotent
  // instead of raising 42710 on the first statement and leaving the rest of
  // the file unrun. Asserted as ORDER, not mere presence — a DROP that
  // landed after its own ADD would satisfy a bare `toMatch` for both and
  // still fail on re-apply.
  it("drops the trigger constraint before re-adding it, so a re-apply is idempotent", () => {
    const drop = SQL.indexOf("DROP CONSTRAINT IF EXISTS opportunity_stage_events_trigger_check")
    const add = SQL.indexOf("ADD CONSTRAINT opportunity_stage_events_trigger_check")
    expect(drop).toBeGreaterThan(-1)
    expect(add).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(add)
  })

  it("keeps every trigger value 00254's constraint allowed", () => {
    // Read from 00254 directly, before this change, rather than trusting a
    // hardcoded literal list to stay in sync with that file.
    const priorSql = readFileSync(
      join(process.cwd(), "supabase/migrations/00254_sequence_tag_stage_steps.sql"),
      "utf8",
    )
    for (const existing of triggerCheckValues(priorSql)) {
      expect(triggerCheckValues(SQL)).toContain(existing)
    }
  })

  it("adds exactly one new value: 'inquiry'", () => {
    const priorSql = readFileSync(
      join(process.cwd(), "supabase/migrations/00254_sequence_tag_stage_steps.sql"),
      "utf8",
    )
    const added = [...triggerCheckValues(SQL)].filter((v) => !triggerCheckValues(priorSql).has(v))
    expect(added).toEqual(["inquiry"])
  })

  // THE ASSERTION THAT MATTERS MOST — see the file header. `quiz` shipping
  // as a legal TypeScript MoveTrigger the database silently rejected is
  // exactly the drift this comparison exists to catch before it happens
  // again for 'inquiry'.
  it("allows exactly the values the current MoveTrigger union declares", () => {
    const moveTypes = readFileSync(join(process.cwd(), "lib/lead-engine/pipeline-move.ts"), "utf8")
    const unionLine = moveTypes.match(/export type MoveTrigger\s*=\s*([^\n]+)/)
    if (!unionLine) throw new Error("MoveTrigger union not found")
    const declared = new Set(Array.from(unionLine[1].matchAll(/"([^"]+)"/g), (m) => m[1]))

    expect([...triggerCheckValues(SQL)].sort()).toEqual([...declared].sort())
  })
})
