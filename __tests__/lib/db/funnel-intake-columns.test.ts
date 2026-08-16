// Migration 00210 cannot be executed here — there is no Postgres in the unit
// suite — so this asserts the SQL says what the spec says it says. That is
// worth doing for exactly the clauses whose absence would be silent: a missing
// CHECK does not fail loudly, it just lets a bad row in months later.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00210_funnel_create_intake.sql"),
  "utf8",
)

describe("00210_funnel_create_intake", () => {
  it("adds every column the Funnel type now claims exists", () => {
    for (const column of [
      "template",
      "audience",
      "offer_kind",
      "offer_ref",
      "starts_at",
      "ends_at",
      "auto_offline_at_end",
      "notify_emails",
    ]) {
      expect(sql, column).toContain(`ADD COLUMN IF NOT EXISTS ${column}`)
    }
  })

  it("pairs offer_kind with offer_ref", () => {
    // MUTANT KILLED: two independent nullable columns. Half an offer — a kind
    // with no ref — renders as a CTA pointing at nothing, and nothing in the
    // admin UI shows the owner that it is broken.
    expect(sql).toMatch(/\(offer_kind IS NULL\) = \(offer_ref IS NULL\)/)
  })

  it("refuses a run window that ends before it starts", () => {
    expect(sql).toMatch(/ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at/)
  })

  it("does not constrain template — the code registry owns that vocabulary", () => {
    // MUTANT KILLED: adding template to the CHECK-constraint habit the
    // neighbouring columns follow. It would mean a migration for every new
    // template, which is exactly the cost the design chose a code registry to
    // avoid. This test exists because the convention pull here is strong.
    expect(sql).not.toMatch(/template\s+IN\s*\(/)
  })

  it("gives funnel_steps.goal exactly the vocabulary the validator knows", () => {
    // MUTANT KILLED: a hand-typed goal list that drifts from FUNNEL_GOALS. The
    // dialog would offer a goal the column then rejects at insert time.
    const clause = sql.match(/goal IS NULL OR goal IN \(([^)]+)\)/)
    expect(clause, "no funnel_steps.goal CHECK found").not.toBeNull()
    for (const goal of FUNNEL_GOALS) {
      expect(clause![1], goal.value).toContain(`'${goal.value}'`)
    }
    // …and nothing else. A CHECK that is a superset of the app's vocabulary
    // silently permits rows the app cannot render.
    expect(clause![1].split(",")).toHaveLength(FUNNEL_GOALS.length)
  })

  it("indexes only the rows the window closer scans", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS funnels_auto_offline_idx/)
    expect(sql).toMatch(/WHERE auto_offline_at_end AND status = 'published'/)
  })
})
