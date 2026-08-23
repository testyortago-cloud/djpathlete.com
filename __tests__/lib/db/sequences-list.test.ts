// __tests__/lib/db/sequences-list.test.ts
//
// `listSequences` — the picker read behind /admin/contacts. A separate file
// from __tests__/db/sequences.test.ts, which covers the engine's IO (claiming
// runs, recording sends, advancing positions); this is the one read on that
// module that a human-facing screen depends on.
//
// The claim worth pinning: it returns the STATUS, and it does not filter to
// active. Both matter. Every sequence in this repo is seeded `draft` on
// purpose (migrations 00218 and 00223 both say so in their headers), so a
// picker that hid non-active sequences would be an empty picker on the day it
// shipped — and one that showed them without their status would let a coach
// pick a sequence that is going to refuse them with no warning.

import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { table: string; select: string; ops: [string, ...unknown[]][] }[] = []

function makeBuilder(table: string, select: string, result: () => unknown) {
  const record = { table, select, ops: [] as [string, ...unknown[]][] }
  calls.push(record)

  const builder: Record<string, unknown> = { then: undefined }
  for (const method of ["eq", "order", "limit", "in", "not"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result())
  return builder
}

let result: unknown = { data: [], error: null }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (select: string) => makeBuilder(table, select, () => result),
    }),
  }),
}))

import { listSequences } from "@/lib/db/sequences"

const BUSINESS = "00000000-0000-0000-0000-000000000001"

beforeEach(() => {
  calls.length = 0
  result = { data: [], error: null }
})

describe("listSequences", () => {
  it("reads key, name, status and trigger_source, scoped to the one business", async () => {
    // MUTANT: dropping `status` from the select. The picker would show
    // "Cold Lead Re-Engagement" with nothing to say it is a draft, and the
    // first thing the coach learns is that nobody was enrolled.
    await listSequences()
    expect(calls[0].table).toBe("sequences")
    expect(calls[0].select).toBe("id, key, name, status, trigger_source")
    expect(calls[0].ops).toContainEqual(["eq", "business_id", BUSINESS])
  })

  it("does NOT filter to status = active — every sequence here ships as a draft", async () => {
    // MUTANT: `.eq("status","active")`. Migrations 00218 and 00223 seed every
    // sequence `draft`, so this picker would be empty on day one and the
    // manual-enrol surface would look broken rather than unactivated.
    await listSequences()
    expect(calls[0].ops.filter(([method, column]) => method === "eq" && column === "status")).toEqual([])
  })

  it("returns the rows as-is, including a draft one", async () => {
    result = {
      data: [
        {
          id: "s1",
          key: "cold_lead_re_engagement",
          name: "Cold Lead Re-Engagement",
          status: "draft",
          trigger_source: null,
        },
      ],
      error: null,
    }
    const rows = await listSequences()
    expect(rows).toEqual([
      {
        id: "s1",
        key: "cold_lead_re_engagement",
        name: "Cold Lead Re-Engagement",
        status: "draft",
        trigger_source: null,
      },
    ])
  })

  it("throws rather than returning [] when the read fails", async () => {
    // `null` and `[]` are different answers: an empty picker for a failed read
    // says "this business has no sequences", which is not true.
    result = { data: null, error: { message: "boom" } }
    await expect(listSequences()).rejects.toThrow(/listSequences: boom/)
  })
})
