// __tests__/app/ask-page.test.tsx
//
// `/ask` is the full-page half of the chat surface, and it gates itself:
// middleware.ts covers only /admin/* and /client/*, so nothing upstream is
// going to close this route when the feature is off.
//
// The gate must fail CLOSED and answer 404 — never a redirect, never a 403.
// "There is nothing here" is the honest answer for a feature that is not
// switched on; a redirect advertises that something exists.
//
// It must also read the SAME key with the SAME default as the two API routes.
// `getSetting` is mocked here, so "change the default" is not a mutation any
// assertion on the rendered output could see — the arguments are asserted
// instead (the Task 8 finding).
//
// Each test names the mutant it kills.

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))

import AskPage from "@/app/(marketing)/ask/page"
import { notFound } from "next/navigation"
import { getSetting } from "@/lib/db/system-settings"
import { getBusinessSettings } from "@/lib/db/businesses"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  mock(notFound).mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND")
  })
  mock(getBusinessSettings).mockResolvedValue({ display_name: "Bay Performance" })
})

describe("/ask", () => {
  it("is not found when the assistant is switched off", async () => {
    mock(getSetting).mockResolvedValue(false)

    await expect(AskPage()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFound).toHaveBeenCalled()
  })

  it("reads the same flag key, with the same default, as the two API routes", async () => {
    mock(getSetting).mockResolvedValue(true)

    await AskPage()

    // A page defaulting open while the routes default closed is a public
    // surface nobody knows is on — and vice versa is a dead page.
    expect(getSetting).toHaveBeenCalledWith(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT)
    expect(CHAT_ASSISTANT_FLAG_DEFAULT).toBe(false)
  })

  it("mounts the panel when the assistant is switched on", async () => {
    mock(getSetting).mockResolvedValue(true)

    const tree = await AskPage()

    expect(notFound).not.toHaveBeenCalled()
    expect(JSON.stringify(tree)).toContain("Bay Performance")
  })

  it("draws no consent tick when the business has no configured name", async () => {
    mock(getSetting).mockResolvedValue(true)
    // The production and dev-clone value. The panel is handed it as-is and
    // asks `hasChatConsentDisplayName` itself, the same gate the capture
    // route asks — one function, so the two can never disagree.
    mock(getBusinessSettings).mockResolvedValue({ display_name: "" })

    const tree = await AskPage()
    expect(JSON.stringify(tree)).toContain('"displayName":""')
  })

  it("degrades to no business name rather than a broken page when the settings read fails", async () => {
    mock(getSetting).mockResolvedValue(true)
    mock(getBusinessSettings).mockRejectedValue(new Error("connection reset"))

    // A failed read and a blank name collapse to the same verdict: no tick.
    // The panel still answers questions — the consent card is one card.
    const tree = await AskPage()
    expect(JSON.stringify(tree)).toContain('"displayName":""')
  })
})
