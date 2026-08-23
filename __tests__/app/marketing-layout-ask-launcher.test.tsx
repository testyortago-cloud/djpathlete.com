// __tests__/app/marketing-layout-ask-launcher.test.tsx
//
// THE MARKETING LAYOUT READS NOTHING. That is the whole test.
//
// It used to read `chat_assistant_enabled` and `business_settings.display_name`
// and thread both into `StickyApplyCTA` as props. The layout wraps the ENTIRE
// public site, and every page under it is statically generated — the branch's
// own `.next/prerender-manifest.json` reports `initialRevalidateSeconds: false`
// for /faq, /testimonials, /philosophy, /services, /glossary, /education,
// /contact, /athletes/*, /privacy-policy, /terms-of-service and /sports. So
// both values were baked into each page at build time and never re-read. One
// build baked two different answers: `faq.rsc` carried `askEnabled":false`
// while `testimonials.rsc` carried `askEnabled":true`.
//
// Three bugs came out of that one read:
//
//   * The kill switch needed a deploy. Off could not take the launcher down —
//     the visitor still saw "Ask a question", opened it, typed, and got an
//     error back from a route that had correctly gated itself.
//   * Two uncached database reads on every marketing page render.
//   * A stale consent name. The details card renders the marketing wording
//     from this value while /api/ask/capture re-renders it from a FRESH read,
//     so a renamed business meant the visitor read one name and `wording_shown`
//     recorded another — for as long as the page's build lasted.
//
// The launcher now asks `GET /api/ask/config` from the browser instead. So the
// assertions here are absences, and each names the mutant it kills.

import { readFileSync } from "fs"

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// The chrome is irrelevant here and drags framer-motion in with it.
vi.mock("@/components/SiteNavbar", () => ({ SiteNavbar: () => null }))
vi.mock("@/components/Footer", () => ({ Footer: () => null }))

import MarketingLayout from "@/app/(marketing)/layout"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getSetting } from "@/lib/db/system-settings"

const SOURCE = readFileSync("app/(marketing)/layout.tsx", "utf8")

beforeEach(() => {
  vi.resetAllMocks()
})

describe("the marketing layout", () => {
  it("reads nothing from the database while rendering every public page", () => {
    const tree = MarketingLayout({ children: null })

    // MUTANT: put either read back. Both are uncached, both run on every
    // marketing page render, and both get frozen into the static output.
    expect(getSetting).not.toHaveBeenCalled()
    expect(getBusinessSettings).not.toHaveBeenCalled()
    expect(tree).toBeTruthy()
  })

  it("is not async, so it cannot be awaiting a read at all", () => {
    // The strongest form of the assertion above: a synchronous function has
    // nowhere to put an `await`, and a promise returned here would be a read
    // whose call the spies above could still miss (a lazily-imported DAL, a
    // fetch, a cached wrapper).
    expect(MarketingLayout({ children: null })).not.toBeInstanceOf(Promise)
    expect(SOURCE).not.toMatch(/export default async function/)
  })

  it("imports no data-access module", () => {
    // MUTANT: read the flag through a helper instead. The spies above only see
    // the two modules they mock; this sees any of them.
    expect(SOURCE).not.toMatch(/from "@\/lib\/db\//)
  })

  it("bakes no answer about the assistant into the page", () => {
    // MUTANT: `<StickyApplyCTA askEnabled={true} />`, or a hardcoded name. A
    // literal in the layout is baked into the static HTML exactly as the read
    // was, and is just as impossible to switch off without a deploy.
    const rendered = JSON.stringify(MarketingLayout({ children: null }))

    expect(rendered).not.toContain("askEnabled")
    expect(rendered).not.toContain("displayName")
  })
})
