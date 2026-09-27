// @vitest-environment node
//
// Small admin fixes, 2026-09-27: the business settings form
// (components/admin/businesses/BusinessSettingsForm.tsx, at /admin/businesses)
// had no link anywhere in the admin UI -- reachable only by typing its URL,
// the same defect class fixed for the pipeline board, the texts inbox and the
// chat assistant (see __tests__/components/admin/admin-nav.test.ts). It does
// not belong in the sidebar itself -- it is a per-business configuration
// screen, not a work surface -- so it goes on the Settings page's own
// "Configuration" link list instead.
//
// SOURCE-LEVEL, NOT RENDERED: the Settings page is a server component that
// calls `auth()` and `getUserById()` before it renders anything, and no test
// for it exists yet to build that harness on. Reading the source for the
// object literal is exactly what admin-nav.test.ts already does for the
// funnels board's quiz wiring, for the same reason -- matched on the actual
// prop/data wiring, not on a page render.
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

describe("the Settings page's Configuration list", () => {
  it("links to Business Settings at /admin/businesses", () => {
    const source = readFileSync("app/(admin)/admin/settings/page.tsx", "utf8")
    expect(source).toContain('{ label: "Business Settings", href: "/admin/businesses"')
  })
})

// Whole-branch review, 2026-09-27: the old "Platform Settings" card sat
// directly above the new Business Settings link and told the reader its own
// fields were "configurable in a future update" -- true of the greyed-out
// inputs in that card, but read next to a working link to the real settings
// screen it looked like the whole feature was unbuilt.
describe("the Platform Settings card's caption", () => {
  it("points the reader at Business Settings instead of promising a future update", () => {
    const source = readFileSync("app/(admin)/admin/settings/page.tsx", "utf8")
    expect(source).not.toContain("configurable in a future update")
    expect(source).toContain("Your business name, sender details and sending hours are edited in Business Settings")
  })
})
