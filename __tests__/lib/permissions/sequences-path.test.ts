// The registry is DEFAULT-DENY: a path in no rule is denied to staff. A new
// admin surface that nobody registers therefore ships as a nav link that
// bounces the person who clicks it, which reads as a broken app rather than as
// a permission boundary.

import { describe, expect, it } from "vitest"
import { canAccessPath } from "@/lib/permissions/registry"

const staff = (permissions: Record<string, unknown>) => ({ role: "staff", permissions }) as never

describe("/admin/sequences", () => {
  it("is reachable by staff who have the contacts permission", () => {
    expect(canAccessPath(staff({ contacts: true }), "/admin/sequences")).toBe(true)
    expect(canAccessPath(staff({ contacts: true }), "/admin/sequences/new_lead_nurture")).toBe(true)
  })

  it("is denied to staff without it", () => {
    // Presence control for the assertion above: without this, the test would
    // pass just as well against a rule that granted everybody.
    expect(canAccessPath(staff({ clients: true }), "/admin/sequences")).toBe(false)
  })

  it("is reachable by the owner", () => {
    expect(canAccessPath({ role: "admin", permissions: {} } as never, "/admin/sequences")).toBe(true)
  })
})
