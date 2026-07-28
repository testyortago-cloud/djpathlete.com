import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { executeAdminTool } from "../ai/admin-tools.js"
import { getSupabase } from "../lib/supabase.js"

const VIKRAM = { id: "u1", first_name: "Vikram", last_name: "Shah", email: "vikram@x.com", created_at: "2026-01-01" }
const TINA = { id: "u2", first_name: "Tina", last_name: "Nguyen", email: "tina@x.com", created_at: "2026-01-02" }

type ChainResult = { data?: unknown; error?: unknown }

/** Every chain method returns itself; `.single()` and bare-await both resolve to `result`. */
function tableStub(result: ChainResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  for (const m of ["select", "eq", "gte", "lte", "order", "limit", "ilike", "is", "or"]) c[m] = vi.fn(() => c)
  c.single = vi.fn(() => Promise.resolve({ data: null, error: null, ...result }))
  c.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data: null, error: null, ...result }).then(onFulfilled)
  return c
}

function mockSupabaseWithClients(clients: typeof VIKRAM[], assignments: unknown = null) {
  ;(getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "users") return tableStub({ data: clients })
      if (table === "program_assignments") return tableStub({ data: assignments })
      // Detail sub-queries (profile/workouts/assessments) — empty is fine, not under test.
      return tableStub({ data: null })
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("get_client_details fuzzy fallback", () => {
  it("exact substring match still wins, no fuzzy note", async () => {
    mockSupabaseWithClients([VIKRAM, TINA])
    const out = await executeAdminTool("get_client_details", { client_name: "vikram" })
    expect(out).toContain("Vikram Shah")
    expect(out).not.toContain("closest name match")
  })

  it("one-letter typo falls back to the closest name match instead of a dead end", async () => {
    mockSupabaseWithClients([VIKRAM, TINA])
    const out = await executeAdminTool("get_client_details", { client_name: "vikarm" })
    expect(out).toContain("closest name match")
    expect(out).toContain("Vikram Shah")
    expect(out).not.toContain("Tina Nguyen")
  })

  it("switching subjects mid-conversation resolves the NEW name, not the previous one", async () => {
    mockSupabaseWithClients([VIKRAM, TINA])
    const out = await executeAdminTool("get_client_details", { client_name: "tina" })
    expect(out).toContain("Tina Nguyen")
    expect(out).not.toContain("Vikram Shah")
  })

  it("no plausible match at all → explicit not-found, never a silent guess", async () => {
    mockSupabaseWithClients([VIKRAM, TINA])
    const out = await executeAdminTool("get_client_details", { client_name: "zzzxyqq" })
    expect(out).toBe('No client found matching "zzzxyqq".')
  })
})

describe("get_client_details reports the ACTUAL program week", () => {
  // Real incident: Hian Mondal sat on current_week 3 of a 10-week block six
  // weeks after assignment. The tool emitted only the assigned date, so the
  // model answered "what week is he on?" with (today - assigned)/7 and said
  // "~Week 6" as if it were a fact. The coach's client knew better.
  const ASSIGNMENT = [
    {
      status: "active",
      created_at: "2026-06-16T00:00:00Z",
      current_week: 3,
      total_weeks: 10,
      programs: { name: "Operation Athlete Build", duration_weeks: 10 },
    },
  ]

  it("states the stored current_week, not an elapsed-time estimate", async () => {
    mockSupabaseWithClients([VIKRAM], ASSIGNMENT)
    const out = await executeAdminTool("get_client_details", { client_name: "vikram" })
    expect(out).toContain("on week 3 of 10")
  })

  it("warns the model off inferring a week from the assigned date", async () => {
    mockSupabaseWithClients([VIKRAM], ASSIGNMENT)
    const out = await executeAdminTool("get_client_details", { client_name: "vikram" })
    expect(out).toMatch(/never infer a program week from the assigned date/i)
  })

  it("falls back to the program's duration when the assignment has no total_weeks", async () => {
    mockSupabaseWithClients([VIKRAM], [{ ...ASSIGNMENT[0], total_weeks: null }])
    const out = await executeAdminTool("get_client_details", { client_name: "vikram" })
    expect(out).toContain("on week 3 of 10")
  })

  it("omits the week phrase entirely rather than printing a bogus one", async () => {
    mockSupabaseWithClients([VIKRAM], [{ ...ASSIGNMENT[0], current_week: null }])
    const out = await executeAdminTool("get_client_details", { client_name: "vikram" })
    expect(out).not.toMatch(/on week/i)
    expect(out).toContain("Operation Athlete Build")
  })
})
