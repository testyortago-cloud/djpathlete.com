import { describe, it, expect, vi, beforeEach } from "vitest"

const updateMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ update: updateMock }),
  }),
}))

import { updateMemberPermissions } from "@/lib/db/team-members"
import type { PermissionMap } from "@/lib/permissions/registry"

interface Call {
  method: string
  args: unknown[]
}

/**
 * Records the PostgREST builder chain so the filters can be asserted, not just
 * the payload — the row filter is what stops this endpoint touching the owner.
 */
function recordChain(row: unknown) {
  const calls: Call[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "in", "select"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.single = () => Promise.resolve({ data: row, error: null })
  updateMock.mockReturnValue(builder)
  return calls
}

function payload() {
  return updateMock.mock.calls[0][0] as { role: string; permissions: PermissionMap; staff_role: string | null }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("updateMemberPermissions", () => {
  it("promotes to staff when the edit grants anything", async () => {
    recordChain({ id: "m1", role: "staff" })

    await updateMemberPermissions("m1", { clients: true }, "coach")

    expect(payload().role).toBe("staff")
    expect(payload().permissions).toEqual({ clients: true })
    expect(payload().staff_role).toBe("coach")
  })

  it("demotes to editor when the last permission is cleared", async () => {
    // Otherwise the member keeps a staff role with an empty map and every page
    // bounces them to /admin/no-access, which reads as a broken app.
    recordChain({ id: "m1", role: "editor" })

    await updateMemberPermissions("m1", {}, "editor")

    expect(payload().role).toBe("editor")
  })

  it("promotes on a view-only grant too", async () => {
    recordChain({ id: "m1", role: "staff" })

    await updateMemberPermissions("m1", { analytics: "view" }, "custom")

    expect(payload().role).toBe("staff")
  })

  it("only ever touches a row that is already on the team", async () => {
    // The guard that keeps this from promoting a client or widening the owner.
    const calls = recordChain({ id: "m1", role: "staff" })

    await updateMemberPermissions("m1", { blog: true }, "marketing")

    expect(calls).toContainEqual({ method: "eq", args: ["id", "m1"] })
    const roleFilter = calls.find((c) => c.method === "in")
    expect(roleFilter).toBeDefined()
    expect(roleFilter!.args[0]).toBe("role")
    expect([...(roleFilter!.args[1] as string[])].sort()).toEqual(["editor", "staff"])
  })

  it("sanitizes before deriving, so an unknown key cannot promote anyone", async () => {
    recordChain({ id: "m1", role: "editor" })

    await updateMemberPermissions("m1", { settings: true } as unknown as PermissionMap, "custom")

    expect(payload().permissions).toEqual({})
    expect(payload().role).toBe("editor")
  })

  it("stores the sanitized map rather than the raw input", async () => {
    recordChain({ id: "m1", role: "staff" })

    await updateMemberPermissions(
      "m1",
      { clients: true, analytics: "manage" } as unknown as PermissionMap,
      "custom",
    )

    // `manage` is illegal on a view-only permission and must not be persisted.
    expect(payload().permissions).toEqual({ clients: true })
  })

  it("surfaces a DB error instead of reporting a silent success", async () => {
    const builder: Record<string, unknown> = {}
    for (const method of ["eq", "in", "select"]) builder[method] = () => builder
    builder.single = () => Promise.resolve({ data: null, error: new Error("nope") })
    updateMock.mockReturnValue(builder)

    await expect(updateMemberPermissions("m1", { blog: true }, "marketing")).rejects.toThrow("nope")
  })
})
