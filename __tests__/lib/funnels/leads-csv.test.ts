// __tests__/lib/funnels/leads-csv.test.ts
//
// The export is a file of real people's names, emails and phone numbers, built
// from text a stranger typed into a public form. Both halves of that sentence
// are why this is tested properly: the escaping has to survive hostile input,
// and the row count has to be right or the operator loses leads without knowing.

import { describe, expect, it } from "vitest"
import { csvField, leadsCsvFilename, leadsToCsv } from "@/lib/funnels/leads-csv"
import type { FunnelLead } from "@/lib/db/funnel-leads"

function lead(overrides: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: "lead-1",
    funnel_id: "f1",
    step_id: "s1",
    form_key: "waitlist",
    email: "sam@example.com",
    name: "Sam Ortiz",
    phone: "555-0100",
    payload: {},
    attribution_session_id: null,
    ip_address: null,
    user_agent: null,
    lead_user_id: null,
    created_at: "2026-08-11T09:00:00.000Z",
    status: "new",
    notes: null,
    funnel_name: "Waitlist",
    funnel_slug: "waitlist",
    step_name: "Landing",
    ...overrides,
  }
}

describe("csvField", () => {
  it("quotes and doubles quotes rather than breaking the row", () => {
    // MUTANT: `values.join(",")` with no escaping. A "anything we should know?"
    // answer containing a comma shifts every later value one column left for
    // that row — a file that opens fine and is quietly wrong.
    expect(csvField('He said "no"')).toBe('"He said ""no"""')
    expect(csvField("Smith, John")).toBe('"Smith, John"')
  })

  it("keeps a newline inside its field", () => {
    // MUTANT: not quoting on \n. A textarea answer with a line break would END
    // THE ROW, and every remaining column of that lead becomes a new, malformed
    // record. This is the failure that silently corrupts the rest of the file.
    expect(csvField("line one\nline two")).toBe('"line one\nline two"')
    expect(csvField("carriage\r\nreturn")).toBe('"carriage\r\nreturn"')
  })

  it("neutralises a value that a spreadsheet would execute", () => {
    // MUTANT: dropping the leading-character guard. `=`, `+`, `-` and `@` start
    // a FORMULA in Excel and Sheets, so anyone who can type into a public form
    // could get one evaluated on the operator's machine when they open the
    // export. CSV injection is the whole reason this branch exists.
    expect(csvField("=1+1")).toBe("'=1+1")
    expect(csvField("+44 7700 900000")).toBe("'+44 7700 900000")
    expect(csvField("-5")).toBe("'-5")
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)")
    // ...and a formula that ALSO needs quoting gets both treatments.
    expect(csvField('=HYPERLINK("http://x","click")')).toBe('"\'=HYPERLINK(""http://x"",""click"")"')
  })

  it("leaves ordinary text alone", () => {
    // MUTANT: quoting everything. Harmless but it makes every cell noisy, and a
    // test that only checked "does not crash" would not notice.
    expect(csvField("Sam Ortiz")).toBe("Sam Ortiz")
    expect(csvField(null)).toBe("")
    expect(csvField(undefined)).toBe("")
  })
})

describe("leadsToCsv", () => {
  it("gives every distinct answer key its own column, across pages", () => {
    // MUTANT: taking the keys from the first lead only. Two pages ask different
    // questions, so a waitlist lead's "sport" would be dropped from the file
    // whenever an enquiry lead happened to sort first.
    const csv = leadsToCsv([
      lead({ id: "a", payload: { sport: "Soccer" } }),
      lead({ id: "b", payload: { goal: "Get faster" } }),
    ])
    const [header, first, second] = csv.split("\r\n")

    expect(header.endsWith("goal,sport")).toBe(true)
    // Lead A was never asked about goals: an empty cell, not a shifted row.
    expect(first.endsWith(",,Soccer")).toBe(true)
    expect(second.endsWith(",Get faster,")).toBe(true)
  })

  it("writes one row per lead plus a header", () => {
    const csv = leadsToCsv([lead({ id: "a" }), lead({ id: "b" }), lead({ id: "c" })])
    expect(csv.split("\r\n")).toHaveLength(4)
  })

  it("carries the coach's own columns, not just the visitor's", () => {
    const csv = leadsToCsv([lead({ status: "contacted", notes: "Called Tuesday" })])
    expect(csv).toContain("contacted")
    expect(csv).toContain("Called Tuesday")
  })

  it("survives a lead with no payload at all", () => {
    // MUTANT: `Object.keys(lead.payload)` with no guard. A row written before
    // the column existed, or a bad read, would throw mid-export and lose the
    // whole file rather than one field.
    expect(() => leadsToCsv([lead({ payload: undefined as never })])).not.toThrow()
  })
})

describe("leadsCsvFilename", () => {
  it("dates the file so two exports do not overwrite each other", () => {
    expect(leadsCsvFilename(new Date("2026-08-11T22:00:00Z"))).toBe("funnel-leads-2026-08-11.csv")
  })

  it("still returns a usable name for an invalid date", () => {
    // MUTANT: `.toISOString()` on an invalid Date THROWS, which would turn a
    // clock problem into a failed download.
    expect(leadsCsvFilename(new Date("nonsense"))).toBe("funnel-leads-export.csv")
  })
})
