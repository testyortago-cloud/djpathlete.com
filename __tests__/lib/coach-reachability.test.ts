// @vitest-environment node
//
// __tests__/lib/coach-reachability.test.ts
//
// The `contacts` permission, which is the whole reason a second coach can run a
// book of business rather than only take bookings.
//
// Before 2026-09-04, `/admin/contacts`, `/admin/pipeline` and `/admin/chat`
// appeared in neither OWNER_ONLY_PREFIXES nor PATH_PERMISSIONS.
// `resolvePathRequirement` answered `unmapped`, `canAccessPath` default-denied,
// and proxy.ts bounced every staff member to /admin/no-access.
//
// THE CLAIM THAT MATTERS MOST HERE IS THE NEGATIVE ONE. Making these paths
// reachable is only safe because the SIX reads and writes behind them were
// scoped in the same change. A test that only asserted "a coach can now get in"
// would be green for the dangerous version too. Those live in:
//
//   __tests__/lib/db/coach-scoped-reads.test.ts        the two unscoped reads
//   __tests__/app/admin/detail-page-tenancy.test.tsx   the two [id] pages
//   __tests__/app/api/admin/contacts/tags-route.test.ts  the two tag writes
//   __tests__/app/api/admin/pipeline/grant-route.test.ts
//   __tests__/api/admin/pipeline-move.test.ts

import { describe, expect, it } from "vitest"
import {
  PERMISSIONS,
  PRESETS,
  PATH_PERMISSIONS,
  canAccessPath,
  resolvePathRequirement,
  staffHomePath,
  isPermissionKey,
  type PermissionMap,
} from "@/lib/permissions/registry"
import { getAdminNav, getAllHrefs } from "@/components/admin/admin-nav"

const admin = { role: "admin" as const, permissions: {} }
const client = { role: "client" as const, permissions: {} }
const editor = { role: "editor" as const, permissions: {} }

function staff(permissions: PermissionMap) {
  return { role: "staff" as const, permissions }
}

/** The coach this whole change exists for. */
const coach = staff({ contacts: true })
/** Holds a DIFFERENT marketing permission — the control for every grant test. */
const inboxOnly = staff({ leads: true })

const COACH_PATHS = [
  "/admin/contacts",
  "/admin/pipeline",
  "/admin/chat",
  "/api/admin/contacts",
  "/api/admin/pipeline",
] as const

describe("the `contacts` permission exists and is grantable", () => {
  it("is a real key with an invite-screen definition", () => {
    expect(isPermissionKey("contacts")).toBe(true)
    const def = PERMISSIONS.find((d) => d.key === "contacts")
    expect(def).toBeDefined()
    expect(def?.kind).toBe("boolean")
    expect(def?.group).toBe("coaching")
  })

  it("tells the person granting it that it includes money and messages", () => {
    // Not decoration. This one checkbox opens a contact's entire history —
    // what they paid and every text they sent — and the page audits itself as
    // `admin_read_sensitive` for that reason. A description reading only
    // "contact records" would undersell what is being handed over.
    const def = PERMISSIONS.find((d) => d.key === "contacts")
    expect(def?.description.toLowerCase()).toContain("paid")
    expect(def?.description.toLowerCase()).toContain("pipeline")
  })

  it("is DISTINCT from `leads`, which stays the inquiries-only inbox", () => {
    // MUTANT: mapping these prefixes to `leads` instead. That is the design
    // this change deliberately rejected — inbox triage must not imply payment
    // history. Holding `leads` alone must reach the inbox and nothing here.
    expect(canAccessPath(inboxOnly, "/admin/inbox", "GET")).toBe(true)
    for (const path of COACH_PATHS) {
      expect(canAccessPath(inboxOnly, path, "GET")).toBe(false)
    }
  })
})

describe("the five prefixes resolve to `contacts`", () => {
  it.each(COACH_PATHS)("%s is mapped, not unmapped", (path) => {
    const requirement = resolvePathRequirement(path)
    // Asserting the KEY, not merely that something came back: a rule pointing
    // at any other permission would satisfy `kind === "permission"` too.
    expect(requirement).toEqual({ kind: "permission", permission: "contacts" })
  })

  it("covers the detail routes, which are where the UUIDs get typed", () => {
    // The [id] pages are the cross-tenant risk; prefix matching must reach them.
    for (const path of [
      "/admin/contacts/8f14e45f-ceea-467a-9b8a-000000000001",
      "/admin/chat/8f14e45f-ceea-467a-9b8a-000000000002",
      "/api/admin/contacts/8f14e45f-ceea-467a-9b8a-000000000003/tags",
      "/api/admin/pipeline/move",
      "/api/admin/pipeline/grant",
    ]) {
      expect(resolvePathRequirement(path)).toEqual({ kind: "permission", permission: "contacts" })
    }
  })

  it("does NOT swallow a neighbouring prefix by string match", () => {
    // Matching is segment-aware. `/admin/contacts-export` is not a thing today,
    // but if it were it must not inherit this grant silently.
    expect(resolvePathRequirement("/admin/contacts-export")).not.toEqual({
      kind: "permission",
      permission: "contacts",
    })
  })
})

describe("who gets in", () => {
  it.each(COACH_PATHS)("a coach holding `contacts` reaches %s", (path) => {
    expect(canAccessPath(coach, path, "GET")).toBe(true)
  })

  it("a coach holding `contacts` may WRITE through the mapped API prefixes", () => {
    // `contacts` is a boolean permission, so tierForMethod's view/manage split
    // does not gate it — POST and DELETE must pass just as GET does, or tagging
    // a contact and moving a card would 403 for the person who owns them.
    expect(canAccessPath(coach, "/api/admin/pipeline/move", "POST")).toBe(true)
    expect(canAccessPath(coach, "/api/admin/contacts/abc/tags", "DELETE")).toBe(true)
  })

  it.each(COACH_PATHS)("a staff member holding NOTHING is refused %s", (path) => {
    expect(canAccessPath(staff({}), path, "GET")).toBe(false)
  })

  it("still refuses a client and an editor outright", () => {
    for (const path of COACH_PATHS) {
      expect(canAccessPath(client, path, "GET")).toBe(false)
      expect(canAccessPath(editor, path, "GET")).toBe(false)
    }
  })

  it("changes nothing for the owner", () => {
    for (const path of COACH_PATHS) {
      expect(canAccessPath(admin, path, "GET")).toBe(true)
    }
  })

  it("does not hand a coach anything owner-only along the way", () => {
    // The regression surface of adding a permission is what ELSE it opens.
    for (const path of [
      "/admin/settings",
      "/admin/team",
      "/admin/businesses",
      "/admin/audit-logs",
      "/api/admin/users",
      "/api/admin/internal/client-risk-scan",
    ]) {
      expect(canAccessPath(coach, path, "GET")).toBe(false)
    }
  })

  it("does not imply `ads`, whose reader is still unscoped", () => {
    // lib/db/google-ads-accounts.ts:listGoogleAdsAccounts takes no tenant at
    // all. Until that is fixed, `contacts` must not become a back door to it.
    expect(canAccessPath(coach, "/admin/ads", "GET")).toBe(false)
    expect(canAccessPath(coach, "/api/admin/ads", "GET")).toBe(false)
  })
})

describe("a coach holding only `contacts` lands somewhere real", () => {
  it("goes to /admin/contacts rather than /admin/no-access", () => {
    // Without a HOME_PRIORITY entry, staffHomePath falls through to
    // NO_ACCESS_PATH and a coach signs in to a page telling them they have no
    // access — while holding a permission that works.
    expect(staffHomePath({ contacts: true })).toBe("/admin/contacts")
  })
})

describe("the sidebar agrees with the gate", () => {
  // filterNavForActor reads the same registry as canAccessPath, so this is a
  // regression test for the two drifting apart. A visible link that bounces
  // reads as a broken app, not as a permission boundary — the Pipeline board
  // shipped URL-only once already for the mirror of this reason.
  const navFor = (actor: Parameters<typeof getAdminNav>[0]["actor"]) =>
    getAllHrefs(getAdminNav({ contentStudioEnabled: false, actor }))

  it("shows a coach Contacts, Pipeline and the chat assistant", () => {
    const hrefs = navFor(coach)
    expect(hrefs).toContain("/admin/contacts")
    expect(hrefs).toContain("/admin/pipeline")
    expect(hrefs).toContain("/admin/chat")
  })

  it("shows a staff member holding nothing none of them", () => {
    // The presence control for the assertion above: without this, a nav that
    // rendered nothing at all would pass the "does not contain" form of it.
    const hrefs = navFor(staff({}))
    expect(hrefs).not.toContain("/admin/contacts")
    expect(hrefs).not.toContain("/admin/pipeline")
    expect(hrefs).not.toContain("/admin/chat")
  })

  it("every link a coach can SEE, a coach can OPEN", () => {
    const hrefs = navFor(coach).filter((href) => href !== "/admin/settings")
    for (const href of hrefs) {
      expect(canAccessPath(coach, href, "GET")).toBe(true)
    }
    // And the nav is not empty, or the loop above asserts nothing.
    expect(hrefs.length).toBeGreaterThan(0)
  })
})

describe("the Coach preset — the default path an owner takes", () => {
  // The invite dialog defaults to this preset, so a permission missing from it
  // is a permission almost nobody will ever grant. `contacts` shipped as a key
  // with no preset once; these assertions are why it will not again.
  const coachPreset = PRESETS.find((p) => p.key === "coach")!
  const presetActor = { role: "staff" as const, permissions: coachPreset.permissions }

  it("grants `contacts`, so an invited coach can actually reach their book of business", () => {
    expect(coachPreset.permissions.contacts).toBe(true)
    for (const path of COACH_PATHS) {
      expect(canAccessPath(presetActor, path, "GET")).toBe(true)
    }
  })

  it("still does not reach money, ads or anything owner-only", () => {
    // The regression surface of widening a preset is what ELSE it opens.
    for (const path of ["/admin/books", "/admin/payments", "/admin/ads", "/admin/team", "/admin/settings"]) {
      expect(canAccessPath(presetActor, path, "GET")).toBe(false)
    }
  })

  it("does NOT give Front Desk the contact record", () => {
    // Front Desk holds `leads` for inquiry triage. The entire reason `contacts`
    // is a separate key is that the contact record carries payment history and
    // every message a person sent, so inquiry triage must not imply it.
    const frontDesk = PRESETS.find((p) => p.key === "front_desk")!
    const fd = { role: "staff" as const, permissions: frontDesk.permissions }
    expect(canAccessPath(fd, "/admin/inbox", "GET")).toBe(true)
    expect(canAccessPath(fd, "/admin/contacts", "GET")).toBe(false)
  })
})

describe("the registry rows themselves", () => {
  it("maps exactly the five prefixes, so a sixth cannot be added unnoticed", () => {
    const prefixes = PATH_PERMISSIONS.filter((r) => r.permission === "contacts")
      .map((r) => r.prefix)
      .sort()
    expect(prefixes).toEqual([...COACH_PATHS].sort())
  })
})
