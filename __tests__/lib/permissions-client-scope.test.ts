import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  resolveClientScope,
  canViewClient,
  applyClientScope,
  scopeQueryToClients,
  NO_CLIENTS,
} from "@/lib/permissions/client-scope"
import { listAssignedClientIds as listAssignedClientIdsImport } from "@/lib/db/team-members"

vi.mock("@/lib/db/team-members", () => ({ listAssignedClientIds: vi.fn() }))

const listAssignedClientIds = vi.mocked(listAssignedClientIdsImport)

const A = "11111111-1111-1111-1111-111111111111"
const B = "22222222-2222-2222-2222-222222222222"
const C = "33333333-3333-3333-3333-333333333333"

beforeEach(() => {
  listAssignedClientIds.mockReset()
})

describe("resolveClientScope", () => {
  it("gives the owner every client without touching the assignment table", async () => {
    const scope = await resolveClientScope({ role: "admin", permissions: {} })
    expect(scope).toEqual({ mode: "all" })
    expect(listAssignedClientIds).not.toHaveBeenCalled()
  })

  it("gives a staff member only their assignments", async () => {
    listAssignedClientIds.mockResolvedValue([A, B])
    const scope = await resolveClientScope({ id: "staff-1", role: "staff", permissions: { clients: true } })
    expect(scope).toEqual({ mode: "assigned", clientIds: [A, B] })
    expect(listAssignedClientIds).toHaveBeenCalledWith("staff-1")
  })

  it("gives nothing to a staff member without the clients permission", async () => {
    const scope = await resolveClientScope({ id: "staff-1", role: "staff", permissions: { blog: true } })
    expect(scope).toEqual(NO_CLIENTS)
    expect(listAssignedClientIds).not.toHaveBeenCalled()
  })

  it("gives nothing to an anonymous, client or editor actor", async () => {
    expect(await resolveClientScope(null)).toEqual(NO_CLIENTS)
    expect(await resolveClientScope({ role: "client", permissions: {} })).toEqual(NO_CLIENTS)
    expect(await resolveClientScope({ role: "editor", permissions: {} })).toEqual(NO_CLIENTS)
  })
})

describe("canViewClient", () => {
  it("lets the owner open anything", async () => {
    expect(await canViewClient({ role: "admin", permissions: {} }, A)).toBe(true)
  })

  it("lets a staff member open an assigned client only", async () => {
    listAssignedClientIds.mockResolvedValue([A])
    const actor = { id: "staff-1", role: "staff", permissions: { clients: true } }
    expect(await canViewClient(actor, A)).toBe(true)
    expect(await canViewClient(actor, B)).toBe(false)
  })

  it("denies a staff member with no assignments", async () => {
    listAssignedClientIds.mockResolvedValue([])
    const actor = { id: "staff-1", role: "staff", permissions: { clients: true } }
    expect(await canViewClient(actor, A)).toBe(false)
  })
})

describe("applyClientScope", () => {
  it("passes everything through for the owner", () => {
    expect(applyClientScope({ mode: "all" }, [A, B, C])).toEqual([A, B, C])
  })

  it("narrows to the assignment set", () => {
    expect(applyClientScope({ mode: "assigned", clientIds: [B] }, [A, B, C])).toEqual([B])
  })

  it("returns nothing — not everything — when the assignment set is empty", () => {
    expect(applyClientScope({ mode: "assigned", clientIds: [] }, [A, B, C])).toEqual([])
  })
})

describe("scopeQueryToClients", () => {
  function fakeQuery() {
    const calls: { col: string; values: string[] }[] = []
    const q = {
      calls,
      in(col: string, values: string[]) {
        calls.push({ col, values })
        return q
      },
    }
    return q
  }

  it("leaves the owner's query untouched", () => {
    const q = fakeQuery()
    scopeQueryToClients(q, { mode: "all" })
    expect(q.calls).toHaveLength(0)
  })

  it("constrains to the assignment set", () => {
    const q = fakeQuery()
    scopeQueryToClients(q, { mode: "assigned", clientIds: [A, B] }, "client_id")
    expect(q.calls).toEqual([{ col: "client_id", values: [A, B] }])
  })

  it("still filters when the assignment set is empty, matching nothing", () => {
    const q = fakeQuery()
    scopeQueryToClients(q, { mode: "assigned", clientIds: [] })
    // The filter must be applied — skipping it would return the whole roster.
    expect(q.calls).toHaveLength(1)
    expect(q.calls[0].values).toHaveLength(1)
    expect(q.calls[0].values[0]).not.toBe(A)
  })
})
