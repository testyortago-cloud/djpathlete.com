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

function mockSupabaseWithClients(clients: typeof VIKRAM[]) {
  ;(getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "users") return tableStub({ data: clients })
      // Detail sub-queries (profile/programs/workouts/assessments) — empty is fine, not under test.
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
