// __tests__/lib/lead-engine/pipeline-schema.test.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/00219_lead_engine_pipeline.sql"),
  "utf8",
)

describe("00219 pipeline schema", () => {
  it("puts business_id on all four tables", () => {
    const tables = sql.split("CREATE TABLE").slice(1)
    expect(tables).toHaveLength(4)
    for (const t of tables) expect(t).toContain("business_id")
  })

  it("keys the state machine on kind, and constrains it to three values", () => {
    // Whitespace-tolerant on purpose: column alignment has no bearing on the
    // invariant this test pins (kind is NOT NULL and limited to exactly these
    // three values), so a harmless reformat must not fail it.
    expect(sql).toMatch(/kind\s+text NOT NULL CHECK \(kind IN \('open','won','lost'\)\)/)
  })

  it("allows only one open opportunity per contact per pipeline", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*opportunities \(contact_id, pipeline_id\) WHERE outcome IS NULL/)
  })

  it("does not decide finality from closed_by_user_id", () => {
    // Spec §2.4: finality must come from closed_trigger = 'manual', never from
    // closed_by_user_id — that column is ON DELETE SET NULL, so deriving
    // finality from it would un-pin cards when an admin is deleted. Pin both
    // halves of the rule: 'manual' is an allowed closed_trigger value, AND
    // closed_by_user_id is declared ON DELETE SET NULL (so it structurally
    // cannot carry the semantics). Also confirm the fields-agree CHECK that
    // ties outcome/closed_at/closed_trigger together never mentions
    // closed_by_user_id, so identity can't sneak into the rule there either.
    expect(sql).toMatch(/closed_trigger text CHECK \(closed_trigger IN \([^)]*'manual'[^)]*\)\)/)
    expect(sql).toContain("closed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL")

    const agreeConstraint = sql.match(/CONSTRAINT opportunities_closed_fields_agree[\s\S]*?\);/)
    expect(agreeConstraint).not.toBeNull()
    expect(agreeConstraint![0]).not.toContain("closed_by_user_id")
  })

  it("seeds exactly one pipeline and four stages", () => {
    expect(sql.match(/INSERT INTO public.pipelines/g)).toHaveLength(1)
    for (const key of ["consult_booked", "consulted", "won", "lost"]) {
      expect(sql).toContain(`'${key}'`)
    }
  })

  it("contains no brand literals", () => {
    expect(sql.toLowerCase()).not.toContain("djpathlete")
    expect(sql.toLowerCase()).not.toContain("darren")
  })
})
