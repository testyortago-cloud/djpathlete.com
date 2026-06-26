import { describe, it, expect, vi, beforeEach } from "vitest"
import { summarizeClientPacks, loadClientPacksView } from "@/lib/services/client-packs-view"
import type { ClientPackage } from "@/types/database"

const listPackagesForClientMock = vi.fn()
const listCheckinsForPackageMock = vi.fn()
const getAssignmentByIdMock = vi.fn()
const getProgramByIdMock = vi.fn()

vi.mock("@/lib/db/client-packages", () => ({
  listPackagesForClient: (...a: unknown[]) => listPackagesForClientMock(...a),
}))
vi.mock("@/lib/db/session-checkins", () => ({
  listCheckinsForPackage: (...a: unknown[]) => listCheckinsForPackageMock(...a),
}))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentById: (...a: unknown[]) => getAssignmentByIdMock(...a),
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramByIdMock(...a),
}))

const NOW = new Date("2026-06-26T12:00:00Z")

function pack(o: Partial<ClientPackage>): ClientPackage {
  return {
    id: "p",
    client_user_id: "c",
    product_id: null,
    assignment_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 0,
    price_cents: 0,
    payment_method: "cash",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: NOW.toISOString(),
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    created_by: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...o,
  } as ClientPackage
}

describe("summarizeClientPacks", () => {
  it("sums remaining across active packs", () => {
    const s = summarizeClientPacks([pack({ credits_used: 3 }), pack({ credits_total: 5, credits_used: 1 })], NOW)
    expect(s.activeRemaining).toBe(7 + 4)
    expect(s.hasActiveCredits).toBe(true)
  })

  it("ignores expired, depleted, and non-active packs", () => {
    const s = summarizeClientPacks(
      [
        pack({ status: "active", credits_used: 10 }), // depleted
        pack({ status: "expired", credits_used: 0 }), // not active
        pack({ status: "active", expires_at: "2026-06-01T00:00:00Z" }), // expired by date
      ],
      NOW,
    )
    expect(s.activeRemaining).toBe(0)
    expect(s.hasActiveCredits).toBe(false)
  })

  it("groups linked-assignment progress, summing multiple packs", () => {
    const s = summarizeClientPacks(
      [
        pack({ assignment_id: "a1", credits_total: 8, credits_used: 5 }),
        pack({ assignment_id: "a1", credits_total: 4, credits_used: 0 }),
        pack({ assignment_id: "a2", credits_total: 6, credits_used: 6 }), // depleted → excluded
      ],
      NOW,
    )
    expect(s.byAssignment.get("a1")).toEqual({ remaining: 7, total: 12 })
    expect(s.byAssignment.has("a2")).toBe(false)
  })

  it("handles no packs", () => {
    const s = summarizeClientPacks([], NOW)
    expect(s).toEqual({ activeRemaining: 0, hasActiveCredits: false, byAssignment: new Map() })
  })
})

describe("loadClientPacksView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listCheckinsForPackageMock.mockResolvedValue([])
  })

  it("dedups assignment lookups and attaches program_name + checkins", async () => {
    listPackagesForClientMock.mockResolvedValue([
      pack({ id: "p1", assignment_id: "a1" }),
      pack({ id: "p2", assignment_id: "a1" }),
      pack({ id: "p3", assignment_id: null }),
    ])
    getAssignmentByIdMock.mockResolvedValue({ id: "a1", program_id: "prog1" })
    getProgramByIdMock.mockResolvedValue({ id: "prog1", name: "Rotational Reboot" })

    const out = await loadClientPacksView("c1")

    // One unique assignment_id across two packs → exactly one lookup.
    expect(getAssignmentByIdMock).toHaveBeenCalledTimes(1)
    expect(out.find((p) => p.id === "p1")!.program_name).toBe("Rotational Reboot")
    expect(out.find((p) => p.id === "p2")!.program_name).toBe("Rotational Reboot")
    expect(out.find((p) => p.id === "p3")!.program_name).toBeNull()
    expect(out.every((p) => Array.isArray(p.checkins))).toBe(true)
  })

  it("falls back to program_name=null when the assignment/program lookup throws", async () => {
    listPackagesForClientMock.mockResolvedValue([pack({ id: "p1", assignment_id: "a1" })])
    getAssignmentByIdMock.mockRejectedValue(new Error("not found"))

    const out = await loadClientPacksView("c1")

    expect(out[0].program_name).toBeNull()
  })

  it("yields program_name=null when the linked program is missing", async () => {
    listPackagesForClientMock.mockResolvedValue([pack({ id: "p1", assignment_id: "a1" })])
    getAssignmentByIdMock.mockResolvedValue({ id: "a1", program_id: "prog1" })
    getProgramByIdMock.mockResolvedValue(null)

    const out = await loadClientPacksView("c1")

    expect(out[0].program_name).toBeNull()
  })
})
