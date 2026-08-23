// __tests__/app/marketing-layout-ask-launcher.test.tsx
//
// `StickyApplyCTA` is a client component, so it cannot read `system_settings`
// or `business_settings` itself. This layout is its nearest server parent and
// is where both reads happen — which makes it the place the two fail-closed
// rules actually live:
//
//   * A settings OUTAGE must not switch a feature on. The flag degrades to
//     `CHAT_ASSISTANT_FLAG_DEFAULT` (false), so the launcher does not render
//     while `/api/ask` is answering 404.
//   * A failed business-settings read and a blank `display_name` must produce
//     the SAME value, because `hasChatConsentDisplayName` collapses them to
//     one verdict downstream — and `/api/ask/capture` reaches that same
//     verdict independently before it will file a consent row.
//
// `getSetting` is mocked, so "change the default" is invisible to any
// assertion on the output — the arguments are asserted instead.
//
// Each test names the mutant it kills.

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// The chrome is irrelevant here and drags framer-motion in with it.
vi.mock("@/components/SiteNavbar", () => ({ SiteNavbar: () => null }))
vi.mock("@/components/Footer", () => ({ Footer: () => null }))

import MarketingLayout from "@/app/(marketing)/layout"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getSetting } from "@/lib/db/system-settings"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

async function renderLayout(): Promise<string> {
  return JSON.stringify(await MarketingLayout({ children: null }))
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("the marketing layout feeds the chat launcher", () => {
  it("threads the flag and the business name down to the sticky bar", async () => {
    mock(getSetting).mockResolvedValue(true)
    mock(getBusinessSettings).mockResolvedValue({ display_name: "Bay Performance" })

    const tree = await renderLayout()

    expect(getSetting).toHaveBeenCalledWith(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT)
    expect(tree).toContain('"askEnabled":true')
    expect(tree).toContain('"displayName":"Bay Performance"')
  })

  it("leaves the launcher off when the assistant is switched off", async () => {
    mock(getSetting).mockResolvedValue(false)
    mock(getBusinessSettings).mockResolvedValue({ display_name: "Bay Performance" })

    expect(await renderLayout()).toContain('"askEnabled":false')
  })

  it("fails closed when the flag cannot be read at all", async () => {
    mock(getSetting).mockRejectedValue(new Error("connection reset"))
    mock(getBusinessSettings).mockResolvedValue({ display_name: "Bay Performance" })

    // Not "we could not tell, so assume yes". `null` and `[]` are different
    // answers, and so are "off" and "unreadable" — but only one of them is
    // safe to guess.
    expect(await renderLayout()).toContain('"askEnabled":false')
    expect(CHAT_ASSISTANT_FLAG_DEFAULT).toBe(false)
  })

  it("degrades a failed business-settings read to a blank name, not to a broken page", async () => {
    mock(getSetting).mockResolvedValue(true)
    mock(getBusinessSettings).mockRejectedValue(new Error("connection reset"))

    const tree = await renderLayout()
    // Same value a genuinely blank `display_name` produces, so the consent
    // tick decision is identical in both — one verdict, as designed.
    expect(tree).toContain('"displayName":""')
    expect(tree).toContain('"askEnabled":true')
  })
})
