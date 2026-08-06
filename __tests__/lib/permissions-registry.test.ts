import { describe, it, expect } from "vitest"
import {
  PERMISSIONS,
  PRESETS,
  PATH_PERMISSIONS,
  OWNER_ONLY_PREFIXES,
  canAccessPath,
  hasPermission,
  resolvePathRequirement,
  sanitizePermissionMap,
  invalidPermissionKeys,
  staffHomePath,
  tierForMethod,
  describePermissions,
  isPermissionKey,
  NO_ACCESS_PATH,
  type PermissionMap,
  type PermissionKey,
} from "@/lib/permissions/registry"

const admin = { role: "admin" as const, permissions: {} }
const client = { role: "client" as const, permissions: {} }
const editor = { role: "editor" as const, permissions: {} }

function staff(permissions: PermissionMap) {
  return { role: "staff" as const, permissions }
}

/** Every grantable permission at its highest legal level. */
const MAXIMAL_STAFF: PermissionMap = Object.fromEntries(
  PERMISSIONS.map((def) => [def.key, def.kind === "boolean" ? true : def.kind === "view_only" ? "view" : "manage"]),
) as PermissionMap

describe("hasPermission", () => {
  it("denies an absent key", () => {
    expect(hasPermission({}, "clients")).toBe(false)
    expect(hasPermission(null, "clients")).toBe(false)
    expect(hasPermission(undefined, "accounting", "view")).toBe(false)
  })

  it("grants a boolean permission only when true", () => {
    expect(hasPermission({ clients: true }, "clients")).toBe(true)
    expect(hasPermission({ clients: false }, "clients")).toBe(false)
  })

  it("does not let view imply manage", () => {
    expect(hasPermission({ accounting: "view" }, "accounting", "view")).toBe(true)
    expect(hasPermission({ accounting: "view" }, "accounting", "manage")).toBe(false)
  })

  it("lets manage satisfy a view requirement", () => {
    expect(hasPermission({ accounting: "manage" }, "accounting", "view")).toBe(true)
    expect(hasPermission({ accounting: "manage" }, "accounting", "manage")).toBe(true)
  })

  it("never grants manage on a view-only permission", () => {
    expect(hasPermission({ analytics: "view" }, "analytics", "view")).toBe(true)
    expect(hasPermission({ analytics: "manage" as never }, "analytics", "manage")).toBe(false)
  })

  it("does not let one permission leak into another", () => {
    expect(hasPermission({ accounting: "manage" }, "payments", "view")).toBe(false)
  })
})

describe("resolvePathRequirement", () => {
  it("reports an unmapped admin path as unmapped", () => {
    expect(resolvePathRequirement("/admin/some-future-page")).toEqual({ kind: "unmapped" })
    expect(resolvePathRequirement("/api/admin/some-future-thing")).toEqual({ kind: "unmapped" })
  })

  it("matches on segment boundaries, not raw string prefixes", () => {
    // /admin/team is owner-only; /admin/team-media is the `social` permission.
    expect(resolvePathRequirement("/admin/team")).toEqual({ kind: "owner_only" })
    expect(resolvePathRequirement("/admin/team-media")).toEqual({ kind: "permission", permission: "social" })
    expect(resolvePathRequirement("/api/admin/team")).toEqual({ kind: "owner_only" })
    expect(resolvePathRequirement("/api/admin/team-videos")).toEqual({ kind: "owner_only" })
  })

  it("prefers the longest matching prefix", () => {
    expect(resolvePathRequirement("/api/admin/sessions")).toEqual({ kind: "permission", permission: "schedule" })
    expect(resolvePathRequirement("/api/admin/sessions/fees")).toEqual({ kind: "permission", permission: "commerce" })
    expect(resolvePathRequirement("/admin/sessions/fees")).toEqual({ kind: "permission", permission: "commerce" })
  })

  it("treats nested paths as their parent area", () => {
    expect(resolvePathRequirement("/admin/books/reports/2026")).toEqual({
      kind: "permission",
      permission: "accounting",
    })
    expect(resolvePathRequirement("/api/admin/clients/abc-123/notes")).toEqual({
      kind: "permission",
      permission: "clients",
    })
  })
})

describe("canAccessPath — default deny", () => {
  it("denies staff any path that is not mapped", () => {
    expect(canAccessPath(staff(MAXIMAL_STAFF), "/admin/some-future-page")).toBe(false)
    expect(canAccessPath(staff(MAXIMAL_STAFF), "/api/admin/some-future-thing")).toBe(false)
  })

  it("denies every owner-only prefix even to a maximally permissioned staff member", () => {
    for (const prefix of OWNER_ONLY_PREFIXES) {
      expect(canAccessPath(staff(MAXIMAL_STAFF), prefix), `${prefix} must stay owner-only`).toBe(false)
      expect(canAccessPath(staff(MAXIMAL_STAFF), `${prefix}/nested/deep`)).toBe(false)
    }
  })

  it("denies an anonymous actor", () => {
    expect(canAccessPath(null, "/admin/clients")).toBe(false)
    expect(canAccessPath(undefined, "/admin/guide")).toBe(false)
  })

  it("denies client and editor roles", () => {
    expect(canAccessPath(client, "/admin/clients")).toBe(false)
    expect(canAccessPath(editor, "/admin/clients")).toBe(false)
    expect(canAccessPath(editor, "/admin/guide")).toBe(false)
  })
})

describe("canAccessPath — admin is unaffected", () => {
  // This is the entire regression surface of swapping `role !== "admin"` for
  // `!canAccessAdminPath(...)` across the API routes.
  it("allows admin on every mapped path, both methods", () => {
    for (const rule of PATH_PERMISSIONS) {
      expect(canAccessPath(admin, rule.prefix, "GET"), rule.prefix).toBe(true)
      expect(canAccessPath(admin, rule.prefix, "POST"), rule.prefix).toBe(true)
    }
  })

  it("allows admin on owner-only and unmapped paths", () => {
    for (const prefix of OWNER_ONLY_PREFIXES) {
      expect(canAccessPath(admin, prefix)).toBe(true)
    }
    expect(canAccessPath(admin, "/api/admin/anything/at/all", "DELETE")).toBe(true)
  })

  it("ignores an empty permission map for admin", () => {
    expect(canAccessPath({ role: "admin" }, "/admin/books")).toBe(true)
  })
})

describe("canAccessPath — staff", () => {
  it("allows a granted area and denies a neighbouring one", () => {
    const coach = staff({ clients: true, programs: true })
    expect(canAccessPath(coach, "/admin/clients")).toBe(true)
    expect(canAccessPath(coach, "/admin/exercises")).toBe(true)
    expect(canAccessPath(coach, "/admin/books")).toBe(false)
    expect(canAccessPath(coach, "/admin/payments")).toBe(false)
  })

  it("lets a view-tier member read but not write", () => {
    const bookkeeper = staff({ payments: "view" })
    expect(canAccessPath(bookkeeper, "/api/admin/payments", "GET")).toBe(true)
    expect(canAccessPath(bookkeeper, "/api/admin/payments", "POST")).toBe(false)
    expect(canAccessPath(bookkeeper, "/api/admin/payments", "DELETE")).toBe(false)
    expect(canAccessPath(bookkeeper, "/api/admin/payments", "PATCH")).toBe(false)
  })

  it("lets a manage-tier member write", () => {
    const bookkeeper = staff({ accounting: "manage" })
    expect(canAccessPath(bookkeeper, "/api/admin/bookkeeping/entries", "POST")).toBe(true)
  })

  it("opens the guide to any staff member, including one with nothing granted", () => {
    expect(canAccessPath(staff({}), "/admin/guide")).toBe(true)
    expect(canAccessPath(staff({}), NO_ACCESS_PATH)).toBe(true)
  })

  it("denies a staff member holding nothing", () => {
    expect(canAccessPath(staff({}), "/admin/clients")).toBe(false)
  })
})

describe("tierForMethod", () => {
  it("treats reads as view and everything else as manage", () => {
    expect(tierForMethod("GET")).toBe("view")
    expect(tierForMethod("head")).toBe("view")
    expect(tierForMethod("POST")).toBe("manage")
    expect(tierForMethod("PUT")).toBe("manage")
    expect(tierForMethod(undefined)).toBe("view")
  })
})

describe("presets", () => {
  it("never grants a key that is not in the catalogue", () => {
    for (const preset of PRESETS) {
      for (const key of Object.keys(preset.permissions)) {
        expect(isPermissionKey(key), `${preset.key} grants unknown key ${key}`).toBe(true)
      }
    }
  })

  it("survives sanitization unchanged — presets are already legal", () => {
    for (const preset of PRESETS) {
      expect(sanitizePermissionMap(preset.permissions), preset.key).toEqual(preset.permissions)
    }
  })

  it("never reaches an owner-only surface", () => {
    for (const preset of PRESETS) {
      const actor = { role: "staff" as const, permissions: preset.permissions }
      for (const prefix of OWNER_ONLY_PREFIXES) {
        expect(canAccessPath(actor, prefix), `${preset.key} -> ${prefix}`).toBe(false)
      }
    }
  })

  it("gives the coach preset clients but not the books", () => {
    const coach = PRESETS.find((p) => p.key === "coach")!
    const actor = { role: "staff" as const, permissions: coach.permissions }
    expect(canAccessPath(actor, "/admin/clients")).toBe(true)
    expect(canAccessPath(actor, "/admin/books")).toBe(false)
    expect(canAccessPath(actor, "/admin/payments")).toBe(false)
    expect(canAccessPath(actor, "/admin/ads")).toBe(false)
  })

  it("gives the bookkeeper preset the books but never a client record", () => {
    const bookkeeper = PRESETS.find((p) => p.key === "bookkeeper")!
    const actor = { role: "staff" as const, permissions: bookkeeper.permissions }
    expect(canAccessPath(actor, "/admin/books")).toBe(true)
    expect(canAccessPath(actor, "/api/admin/bookkeeping/x", "POST")).toBe(true)
    expect(canAccessPath(actor, "/admin/clients")).toBe(false)
    // view on payments — can look, cannot refund
    expect(canAccessPath(actor, "/api/admin/payments", "GET")).toBe(true)
    expect(canAccessPath(actor, "/api/admin/payments", "POST")).toBe(false)
  })

  it("gives the editor preset no admin permissions at all", () => {
    const ed = PRESETS.find((p) => p.key === "editor")!
    expect(ed.invitedRole).toBe("editor")
    expect(Object.keys(ed.permissions)).toHaveLength(0)
  })
})

describe("sanitizePermissionMap", () => {
  it("drops unknown keys", () => {
    expect(sanitizePermissionMap({ clients: true, wat: true })).toEqual({ clients: true })
  })

  it("drops non-object input", () => {
    expect(sanitizePermissionMap(null)).toEqual({})
    expect(sanitizePermissionMap("clients")).toEqual({})
    expect(sanitizePermissionMap([{ clients: true }])).toEqual({})
  })

  it("refuses a tier on a boolean permission", () => {
    expect(sanitizePermissionMap({ clients: "manage" })).toEqual({})
  })

  it("refuses a boolean on a tiered permission", () => {
    expect(sanitizePermissionMap({ accounting: true })).toEqual({})
  })

  it("refuses manage on a view-only permission", () => {
    expect(sanitizePermissionMap({ analytics: "manage" })).toEqual({})
    expect(sanitizePermissionMap({ analytics: "view" })).toEqual({ analytics: "view" })
  })

  it("refuses a bogus tier string", () => {
    expect(sanitizePermissionMap({ accounting: "admin" })).toEqual({})
    expect(sanitizePermissionMap({ accounting: "owner" })).toEqual({})
  })

  it("drops false rather than storing it", () => {
    expect(sanitizePermissionMap({ clients: false })).toEqual({})
  })
})

describe("invalidPermissionKeys", () => {
  it("names keys that would be silently discarded", () => {
    expect(invalidPermissionKeys({ clients: true, wat: true, accounting: "owner" }).sort()).toEqual([
      "accounting",
      "wat",
    ])
  })

  it("treats an explicit false as a legitimate not-granted, not an error", () => {
    expect(invalidPermissionKeys({ clients: false })).toEqual([])
  })

  it("returns nothing for a legal map", () => {
    expect(invalidPermissionKeys({ clients: true, accounting: "manage", analytics: "view" })).toEqual([])
  })
})

describe("staffHomePath", () => {
  it("sends a member to the first area they hold", () => {
    expect(staffHomePath({ clients: true })).toBe("/admin/clients")
    expect(staffHomePath({ blog: true })).toBe("/admin/blog")
    expect(staffHomePath({ accounting: "manage" })).toBe("/admin/books")
  })

  it("respects priority when several are held", () => {
    expect(staffHomePath({ accounting: "manage", clients: true })).toBe("/admin/clients")
  })

  it("sends a member with nothing to the no-access page", () => {
    expect(staffHomePath({})).toBe(NO_ACCESS_PATH)
    expect(staffHomePath(null)).toBe(NO_ACCESS_PATH)
  })

  it("only ever returns a path that member can actually reach", () => {
    for (const preset of PRESETS) {
      if (preset.invitedRole !== "staff") continue
      const home = staffHomePath(preset.permissions)
      const actor = { role: "staff" as const, permissions: preset.permissions }
      expect(canAccessPath(actor, home), `${preset.key} home ${home}`).toBe(true)
    }
  })
})

describe("describePermissions", () => {
  it("names the tier for tiered permissions only", () => {
    expect(describePermissions({ clients: true, accounting: "manage" })).toBe("Clients, Accounting (manage)")
  })

  it("says so when nothing is granted", () => {
    expect(describePermissions({})).toBe("No access yet")
  })
})

describe("catalogue integrity", () => {
  it("has no duplicate permission keys", () => {
    const keys = PERMISSIONS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("has no duplicate path prefixes", () => {
    const prefixes = PATH_PERMISSIONS.map((r) => r.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it("maps every path rule to a real permission", () => {
    for (const rule of PATH_PERMISSIONS) {
      expect(isPermissionKey(rule.permission), rule.prefix).toBe(true)
    }
  })

  it("never maps a path that an owner-only prefix already claims", () => {
    for (const rule of PATH_PERMISSIONS) {
      expect(resolvePathRequirement(rule.prefix)).toEqual({
        kind: "permission",
        permission: rule.permission as PermissionKey,
      })
    }
  })
})
