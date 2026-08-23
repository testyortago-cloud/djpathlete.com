// @vitest-environment node
//
// GET /api/ask/config — the one place a BROWSER can ask whether the chat
// assistant is switched on.
//
// THE DEFECT THIS ROUTE EXISTS FOR. The launcher's flag used to be read in
// `app/(marketing)/layout.tsx`, which wraps the entire public site — and every
// marketing page is statically generated. `.next/prerender-manifest.json` on
// this branch shows `initialRevalidateSeconds: false` for /faq, /testimonials,
// /philosophy, /services, /glossary, /education, /contact, /athletes/*,
// /privacy-policy, /terms-of-service and /sports: never revalidated until the
// next deploy. One build even disagreed with itself — `faq.rsc` carried
// `askEnabled":false` while `testimonials.rsc` carried `askEnabled":true`.
//
// So the flag was not a switch. Turning it ON did nothing on those routes
// until a redeploy, and turning it OFF could not take the launcher down: the
// visitor still saw "Ask a question", opened it, typed, and got an error back
// from a route that had correctly gated itself. For a feature whose flag is
// the emergency stop on a public box that collects free text from strangers,
// an emergency stop that needs a deploy is not one.
//
// Hence: dynamic, uncached, read fresh, and FAILING CLOSED. Each test names
// the mutant it kills.
import { readFileSync } from "fs"

import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ getSetting: vi.fn(), getBusinessSettings: vi.fn() }))

vi.mock("@/lib/db/system-settings", () => ({ getSetting: h.getSetting }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: h.getBusinessSettings }))

import { GET, dynamic } from "@/app/api/ask/config/route"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"

/** Invented. `app/api/ask` is inside the Lead Engine's brand sweep. */
const DISPLAY_NAME = "Bay Performance"

const SOURCE = readFileSync("app/api/ask/config/route.ts", "utf8")

type ConfigBody = { enabled: boolean; displayName: string }

async function get(): Promise<{ status: number; body: ConfigBody; cacheControl: string | null }> {
  const response = await GET()
  return {
    status: response.status,
    body: (await response.json()) as ConfigBody,
    cacheControl: response.headers.get("cache-control"),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("GET /api/ask/config", () => {
  it("answers with the flag and the name as they are RIGHT NOW", async () => {
    h.getSetting.mockResolvedValue(true)
    h.getBusinessSettings.mockResolvedValue({ display_name: DISPLAY_NAME })

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body).toEqual({ enabled: true, displayName: DISPLAY_NAME })
    // MUTANT: a different key, or a default of `true`. The launcher, /ask,
    // POST /api/ask and POST /api/ask/capture must all agree on both.
    expect(h.getSetting).toHaveBeenCalledWith(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT)
  })

  it("says off when the flag is off", async () => {
    h.getSetting.mockResolvedValue(false)
    h.getBusinessSettings.mockResolvedValue({ display_name: DISPLAY_NAME })

    expect((await get()).body.enabled).toBe(false)
  })

  it("is dynamic and uncached, or the switch needs a deploy all over again", async () => {
    h.getSetting.mockResolvedValue(true)
    h.getBusinessSettings.mockResolvedValue({ display_name: DISPLAY_NAME })

    // MUTANT: drop `force-dynamic`. A cached copy of this answer is the exact
    // bug the route was added to remove, one hop further out.
    expect(dynamic).toBe("force-dynamic")
    expect((await get()).cacheControl).toMatch(/no-store/)
  })

  it("fails closed when the flag cannot be read at all", async () => {
    h.getSetting.mockRejectedValue(new Error("connection reset"))
    h.getBusinessSettings.mockResolvedValue({ display_name: DISPLAY_NAME })

    // Not "we could not tell, so assume yes". "off" and "unreadable" are
    // different answers, and only one of them is safe to guess.
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body).toEqual({ enabled: false, displayName: "" })
    expect(CHAT_ASSISTANT_FLAG_DEFAULT).toBe(false)
  })

  it("fails closed when the business settings cannot be read either", async () => {
    h.getSetting.mockResolvedValue(true)
    h.getBusinessSettings.mockRejectedValue(new Error("connection reset"))

    // The name is not decoration here: the details card renders the consent
    // sentence from it, and /api/ask/capture re-renders the same sentence
    // from its own fresh read before it will file a consent row. A surface
    // that cannot say which business it is asking on behalf of does not open.
    expect((await get()).body).toEqual({ enabled: false, displayName: "" })
  })

  it("treats a value that is not a boolean as a no", async () => {
    // `system_settings.value` is JSON. A row holding the STRING "false" is
    // truthy, and `Boolean("false")` is `true` — MUTANT: `Boolean(raw)`.
    h.getSetting.mockResolvedValue("false")
    h.getBusinessSettings.mockResolvedValue({ display_name: DISPLAY_NAME })

    expect((await get()).body.enabled).toBe(false)
  })

  it("turns a missing display name into the blank string, never null", async () => {
    h.getSetting.mockResolvedValue(true)
    h.getBusinessSettings.mockResolvedValue({ display_name: null })

    // `''` is the value `hasChatConsentDisplayName` reads as "no name", and it
    // is what production and the dev clone actually hold. `null` reaching the
    // browser would be rendered as the word "null" by any careless consumer.
    expect((await get()).body).toEqual({ enabled: true, displayName: "" })
  })

  it("imports the flag key instead of retyping it", () => {
    // MUTANT: paste the literal. Two copies of a key drift, and the drift is
    // invisible — the launcher reads one row and the API routes read another.
    expect(SOURCE).toContain('from "@/lib/lead-engine/chat/constants"')
    expect(SOURCE).not.toContain('"chat_assistant_enabled"')
  })
})
