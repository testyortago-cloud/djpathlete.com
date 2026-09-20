// @vitest-environment node
//
// Reads migration 00269 off disk and checks its structure. Comment lines are
// stripped before the statement assertions: the header quotes the email copy
// and discusses the old minute values in prose, so a whole-file `includes`
// would match those for entirely the wrong reason.
//
// The RESULT was read back from the dev clone after applying (positions 1/3/5
// carrying 14/7/3 with wait_minutes null, copy and positions untouched). What
// this file pins is the properties a later edit could quietly break.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(
  join(process.cwd(), "supabase/migrations/00269_camp_deadline_counts_down_to_the_camp.sql"),
  "utf8",
)
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")

describe("00269 — camp_clinic_deadline counts down to the camp", () => {
  it("anchors exactly the three wait steps, at 14 / 7 / 3 days before", () => {
    expect((SQL.match(/UPDATE public\.sequence_steps/gi) ?? []).length).toBe(3)
    for (const days of [14, 7, 3]) {
      expect(SQL).toContain(`'days_before_anchor', ${days}`)
    }
  })

  it("leaves step 0 alone, so the acknowledgement still sends immediately", () => {
    // The one mistake this migration exists NOT to make. Step 0 is "About the
    // camp you asked about" — "your place isn't held yet" — so putting a
    // 14-day wait in front of it would leave somebody who signs up four
    // months out hearing nothing for three and a half of them.
    expect(SQL).not.toMatch(/st\.position\s*=\s*0/)
    expect(SQL).toMatch(/st\.position\s*=\s*1/)
    expect(SQL).toMatch(/st\.position\s*=\s*3/)
    expect(SQL).toMatch(/st\.position\s*=\s*5/)
  })

  it("clears wait_minutes, so no stale number is left reading like the answer", () => {
    // The tick ignores wait_minutes once wait_until is present, so a leftover
    // 2880 would change nothing and mislead everyone reading the row.
    expect((SQL.match(/wait_minutes = NULL/gi) ?? []).length).toBe(3)
  })

  it("changes no copy, no positions, and no step list", () => {
    // G03 signed the copy off AS SEEDED. This migration re-times it and must
    // never rewrite it — and an INSERT or DELETE here would cascade
    // sequence_messages rows away with the step.
    expect(SQL).not.toMatch(/\bINSERT\b/i)
    expect(SQL).not.toMatch(/\bDELETE\b/i)
    expect(SQL).not.toMatch(/\bDROP\b/i)
    expect(SQL).not.toMatch(/\bsubject\s*=/i)
    expect(SQL).not.toMatch(/\bbody\s*=/i)
    expect(SQL).not.toMatch(/\bposition\s*=\s*\d+\s*,/i) // an assignment, not a predicate
  })

  it("keys on the sequence KEY, never an id read off one database", () => {
    // An id read from the dev clone is a different row on production, which
    // is how a data migration succeeds and matches nothing.
    expect((SQL.match(/s\.key = 'camp_clinic_deadline'/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(SQL).not.toMatch(/sequence_id\s*=\s*'[0-9a-f-]{36}'/i)
  })

  it("guards each UPDATE with kind = 'wait', so a changed shape matches nothing instead of the wrong step", () => {
    // Five occurrences: one per UPDATE, plus two in the DO block's
    // FILTER/HAVING pair. The count alone is brittle, which is what the
    // per-statement loop below is for.
    expect((SQL.match(/st\.kind = 'wait'/g) ?? []).length).toBe(5)
    // And the load-bearing half — every UPDATE carries one. Each statement is
    // checked in isolation, which a whole-file count cannot do.
    for (const statement of SQL.split(/;\s*/).filter((s) => /UPDATE public\.sequence_steps/i.test(s))) {
      expect(statement).toMatch(/st\.kind = 'wait'/)
    }
  })

  it("RAISES when the result is not three anchored waits", () => {
    // A data migration that silently matches nothing is indistinguishable
    // from success in every log. This repo has already paid for that once.
    expect(SQL).toMatch(/RAISE EXCEPTION/i)
    expect(SQL).toMatch(/<> 3/)
  })

  it("checks each sequence ROW, so a second tenant does not trip the guard", () => {
    // Review finding. `sequences` is unique on (business_id, key) and the
    // UPDATEs are deliberately not business-scoped, so a single table-wide
    // `count(*) = 3` would RAISE the day a second business is seeded, having
    // found 6 — a migration that fails precisely because the product grew.
    expect(SQL).toMatch(/GROUP BY\s+s\.id,\s*s\.business_id/i)
    expect(SQL).toMatch(/HAVING/i)
    // The negative half: no bare table-wide count assigned into a scalar.
    expect(SQL).not.toMatch(/SELECT count\(\*\) INTO/i)
  })

  it("records that the quotation's fourth moment has no email, rather than inventing one", () => {
    // Read RAW: this is the prose, and it is the one open decision the row
    // leaves with the owner.
    expect(RAW).toContain("FOURTH MOMENT")
    expect(RAW).toContain("G03")
  })
})
