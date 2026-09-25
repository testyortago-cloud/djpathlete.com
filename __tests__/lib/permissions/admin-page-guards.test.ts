// @vitest-environment node
//
// __tests__/lib/permissions/admin-page-guards.test.ts
//
// A page the registry PROMISES to a teammate must not refuse them itself.
//
// The proxy decides who reaches `/admin/<area>` from PATH_PERMISSIONS. A page
// under that area can then call `requireAdmin()`, which lets the owner through
// and redirects everyone else to their home screen. The registry says yes, the
// page says no, and the teammate sees the list, clicks an item, and lands back
// on the list. The registry's own header names this failure: "a teammate sees
// a link that bounces them, which reads as a broken app".
//
// That is exactly what the owner's social-media teammate hit on 2026-09-25 in
// the blog and newsletter editors. Nothing caught it because every page-level
// test mocks the guard it expects to find; none of them asks which guard a page
// SHOULD have. This one walks every admin page and layout and asks.
//
// KNOWN_OWNER_ONLY_PAGES is the debt that existed when this test was written:
// pages under a mapped prefix that still call requireAdmin(). It is not an
// allowlist to grow. Each needs the SAME check the blog fix needed — that the
// routes the page calls already admit staff — before it can move to
// requirePermission; team-media in particular reads /api/admin/team-videos,
// which is in OWNER_ONLY_PREFIXES. The second test fails when an entry is
// fixed and not removed, so the list cannot drift into describing the past.

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, sep } from "node:path"
import { resolvePathRequirement } from "@/lib/permissions/registry"

const ADMIN_DIR = join(process.cwd(), "app", "(admin)", "admin")

const KNOWN_OWNER_ONLY_PAGES: readonly string[] = [
  "ai-assistant/page.tsx",
  "ai-insights/page.tsx",
  "ai-templates/page.tsx",
  "ai-usage/page.tsx",
  "clients/[id]/assessments/page.tsx",
  "form-reviews/[id]/page.tsx",
  "form-reviews/page.tsx",
  "legal/[id]/page.tsx",
  "legal/page.tsx",
  "performance-assessments/[id]/page.tsx",
  "performance-assessments/new/page.tsx",
  "performance-assessments/page.tsx",
  "team-media/[id]/page.tsx",
  "team-media/page.tsx",
]

/** `blog/[id]/edit/page.tsx` → `/admin/blog/x/edit`. Route groups vanish; dynamic segments become a literal. */
function routeFor(relFile: string): string {
  const segments = relFile
    .split(sep)
    .slice(0, -1)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => (s.startsWith("[") ? "x" : s))
  return ["/admin", ...segments].join("/")
}

/** Comments name requireAdmin in prose; only a call in code counts. */
function callsRequireAdmin(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  return /\brequireAdmin\s*\(/.test(code)
}

const GUARDED_FILES = (readdirSync(ADMIN_DIR, { recursive: true }) as string[])
  .filter(
    (f) => f.endsWith(`${sep}page.tsx`) || f.endsWith(`${sep}layout.tsx`) || f === "page.tsx" || f === "layout.tsx",
  )
  .map((rel) => ({
    rel: rel.split(sep).join("/"),
    route: routeFor(rel),
    ownerOnlyGuard: callsRequireAdmin(readFileSync(join(ADMIN_DIR, rel), "utf8")),
  }))

describe("admin page guards agree with the permission registry", () => {
  it("walks a real tree", () => {
    // Presence control: an empty walk would pass every assertion below.
    expect(GUARDED_FILES.length).toBeGreaterThan(100)
    expect(GUARDED_FILES.some((f) => f.rel === "blog/[id]/edit/page.tsx")).toBe(true)
    // And the detector itself: the owner-only dashboard still uses requireAdmin.
    expect(GUARDED_FILES.find((f) => f.rel === "dashboard/page.tsx")?.ownerOnlyGuard).toBe(true)
  })

  it("no page a teammate can be granted calls requireAdmin() — beyond the known list", () => {
    const offenders = GUARDED_FILES.filter(
      (f) => f.ownerOnlyGuard && resolvePathRequirement(f.route).kind === "permission",
    )
      .map((f) => f.rel)
      .filter((rel) => !KNOWN_OWNER_ONLY_PAGES.includes(rel))
    // A new entry here: use requirePermission("<key>") from
    // lib/permissions/guard, the key being whatever the route resolves to.
    expect(offenders).toEqual([])
  })

  it("every entry on the known list is still a real offender", () => {
    // Fails when a page is fixed (or moved, or deleted) and the list is not
    // updated. Remove the entry; do not keep it "just in case".
    const stale = KNOWN_OWNER_ONLY_PAGES.filter((rel) => {
      const file = GUARDED_FILES.find((f) => f.rel === rel)
      return !file || !file.ownerOnlyGuard || resolvePathRequirement(file.route).kind !== "permission"
    })
    expect(stale).toEqual([])
  })

  it("the blog and newsletter editors are not on it", () => {
    for (const rel of [
      "blog/new/page.tsx",
      "blog/[id]/edit/page.tsx",
      "newsletter/new/page.tsx",
      "newsletter/[id]/edit/page.tsx",
    ]) {
      expect(KNOWN_OWNER_ONLY_PAGES).not.toContain(rel)
      expect(GUARDED_FILES.find((f) => f.rel === rel)?.ownerOnlyGuard).toBe(false)
    }
  })
})
