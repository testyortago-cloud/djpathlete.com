// GET /api/admin/funnels/offers — what the create dialog's offer picker reads.
//
// It answers from `loadCatalogues().offer`, whose own documentation says it is
// "currently valid rows only — what may a NEW cta point at?". That is not a
// convenience: a picker fed from anywhere else could offer a row that
// `resolveDoc` will not resolve, and the owner would meet the difference as a
// dead button on a page they cannot see is broken.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const loadCataloguesMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...args: unknown[]) => canAccessMock(...args),
}))
vi.mock("@/lib/funnels/sections/resolve", () => ({
  loadCatalogues: () => loadCataloguesMock(),
}))

const CATALOGUE = {
  offer: {
    program: [{ id: "p1", name: "Off-Season Block" }],
    session_pack: [{ id: "sp1", name: "10-Session Pack" }],
    event: [{ id: "e1", name: "Summer Camp 2026" }],
  },
  recognition: {
    // Deliberately WIDER than `offer` — it holds rows that are no longer
    // sellable. The picker must never read from here.
    program: [
      { id: "p1", name: "Off-Season Block" },
      { id: "p-old", name: "Retired 2019 Block" },
    ],
    session_pack: [],
    event: [],
  },
  faqPageKeys: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  canAccessMock.mockResolvedValue(true)
  loadCataloguesMock.mockResolvedValue(CATALOGUE)
})

function request(kind?: string) {
  const url = kind
    ? `http://x/api/admin/funnels/offers?kind=${kind}`
    : "http://x/api/admin/funnels/offers"
  return new NextRequest(url)
}

describe("GET /api/admin/funnels/offers", () => {
  it("refuses a signed-out caller", async () => {
    // MUTANT KILLED: shipping a catalogue endpoint with no guard. It lists
    // unpublished and unlisted products by name.
    authMock.mockResolvedValue(null)
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    expect((await GET(request("program"))).status).toBe(403)
  })

  it("refuses a signed-in non-admin", async () => {
    canAccessMock.mockResolvedValue(false)
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    expect((await GET(request("program"))).status).toBe(403)
  })

  it("rejects a kind that is not an offer catalogue", async () => {
    // `leads` and `booking` are real FunnelGoals but sell nothing, so they are
    // not OfferKinds. Accepting one would read `catalogue.offer.leads`, which
    // is undefined, and return an empty picker rather than an error.
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    for (const kind of ["leads", "booking", "blog", ""]) {
      expect((await GET(request(kind))).status, kind).toBe(400)
    }
  })

  it("rejects a missing kind", async () => {
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    expect((await GET(request())).status).toBe(400)
  })

  it("returns the offer catalogue for the asked-for kind", async () => {
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    const body = await (await GET(request("event"))).json()
    expect(body.offers).toEqual([{ id: "e1", name: "Summer Camp 2026" }])
  })

  it("reads the offer set, never the recognition set", async () => {
    // MUTANT KILLED: reading `recognition`, which exists to answer "is this id
    // still real?" and deliberately includes retired rows. Offering one would
    // let the owner attach a funnel to a program they can no longer sell.
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    const body = await (await GET(request("program"))).json()
    expect(body.offers).toEqual([{ id: "p1", name: "Off-Season Block" }])
    expect(JSON.stringify(body)).not.toContain("Retired 2019 Block")
  })

  it("degrades to an error the dialog can show, not an unhandled 500", async () => {
    // loadCatalogues THROWS on a truncated read and its own doc comment says
    // every caller must wrap it. An unhandled throw here takes out the create
    // dialog for a reason the owner cannot act on.
    loadCataloguesMock.mockRejectedValue(new Error("programs came back truncated"))
    const { GET } = await import("@/app/api/admin/funnels/offers/route")
    const response = await GET(request("program"))
    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/truncated/)
  })
})
