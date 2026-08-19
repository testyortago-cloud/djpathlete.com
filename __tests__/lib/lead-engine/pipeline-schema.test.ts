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
    expect(sql).toContain("kind        text NOT NULL CHECK (kind IN ('open','won','lost'))")
  })

  it("allows only one open opportunity per contact per pipeline", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*opportunities \(contact_id, pipeline_id\) WHERE outcome IS NULL/)
  })

  it("does not decide finality from closed_by_user_id", () => {
    // Spec §2.4: ON DELETE SET NULL would un-pin cards when an admin is deleted.
    expect(sql).toContain("closed_trigger text CHECK")
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
