// @vitest-environment node
//
// POST /api/ask/capture is THE ONLY PATH IN THE CHAT FEATURE THAT CAN CREATE A
// CONTACT. No tool the model can call writes anything — that property is built
// structurally and pinned by a source scan over the tool executor — so every
// claim the feature makes about consent rests on this one route being right.
//
// Three of those claims are tested here, and each one has a mutation that
// breaks it:
//
//  1. THE CLIENT'S WORDING IS NEVER READ. The request schema does not even
//     accept a `wordingShown` field, and the sentence filed on the consent row
//     is re-rendered server-side from `business_settings.display_name`. A
//     consent record quoting text the browser supplied is evidence of nothing.
//
//  2. A BLANK DISPLAY NAME BLOCKS THE ROW. `hasChatConsentDisplayName` is the
//     single gate the card renderer and this route both ask, exactly as
//     `hasSmsConsentDisplayName` gates the funnel submit route. Blank name →
//     the marketing tick is never rendered AND no row can be filed. One
//     verdict on both sides, or the sentence shown and the sentence recorded
//     can disagree — which is the whole reason the pattern exists.
//     `business_settings.display_name` is `''` in the dev clone and in
//     production, so this is a live path, not a defensive flourish.
//
//  3. THE CONTACT IS ALWAYS CREATED; THE CONSENT ROW IS NOT. Submitting the
//     details form means "I am asking to be contacted about my question" —
//     that justifies a human reply and is recorded as such. Marketing consent
//     is a separate, additional act, and not ticking it means NO
//     `contact_consents` row at all, which is what keeps the sequence engine
//     away from them.
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"
import type { ChatConversation } from "@/types/database"

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getConversation: vi.fn(),
  countRecentConversationsByIp: vi.fn(),
  markCaptured: vi.fn(),
  captureLead: vi.fn(),
  recordConsent: vi.fn(),
  getBusinessSettings: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/db/system-settings", () => ({ getSetting: h.getSetting }))
vi.mock("@/lib/db/chat", () => ({
  getConversation: h.getConversation,
  countRecentConversationsByIp: h.countRecentConversationsByIp,
  markCaptured: h.markCaptured,
}))
vi.mock("@/lib/lead-engine/capture", () => ({ captureLead: h.captureLead }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: h.recordConsent }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: h.getBusinessSettings }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))

import { createHash } from "crypto"

import { POST } from "@/app/api/ask/capture/route"
import { askCaptureSchema } from "@/lib/validators/chat"
import { renderChatMarketingWording } from "@/lib/lead-engine/chat/consent-wording"
import { MAX_CONVERSATIONS_PER_IP_PER_HOUR } from "@/lib/lead-engine/chat/constants"

const CONVERSATION_ID = "8c3a1f5e-1111-4222-8333-444455556666"

const SALT = "test-salt"
const HOUR_MS = 60 * 60 * 1000

/**
 * A FRESH ORIGIN FOR EVERY TEST, because the in-memory pre-filter's Map lives
 * in the module and outlives the test that filled it. Sharing one address
 * across the file would make the sixth test in source order start 429ing for
 * reasons that have nothing to do with what it is asserting.
 */
let ipCounter = 0
let currentIp = ""

const SETTINGS: BusinessSettings = {
  business_id: "00000000-0000-0000-0000-000000000001",
  display_name: "Test Business",
  sender_name: "Test Business",
  sender_email: "hello@example.com",
  reply_to: "coach@example.com",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 500,
  postal_address: "1 Example Street",
  sms_help_text: "Reply HELP for help",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
}

function conversation(over: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: CONVERSATION_ID,
    business_id: SETTINGS.business_id,
    contact_id: null,
    status: "open",
    ip_hash: "hash",
    user_agent: null,
    landing_path: "/programs",
    attribution_session_id: null,
    message_count: 4,
    tokens_used: 900,
    escalated_at: null,
    captured_at: null,
    last_activity_at: "2026-08-23T10:00:00.000Z",
    created_at: "2026-08-23T09:59:00.000Z",
    ...over,
  }
}

function req(body: Record<string, unknown>, ip: string = currentIp): Request {
  return new Request("http://localhost/api/ask/capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Two hops, so the test also pins that only the FIRST is read. Taking
      // the whole header would give one visitor a new identity — and a fresh
      // budget — every time an edge region changed.
      "x-forwarded-for": `${ip}, 70.41.3.18`,
      "user-agent": "Mozilla/5.0 (probe)",
    },
    body: JSON.stringify(body),
  })
}

/** A complete, valid submission. Individual tests override one thing at a time. */
function submission(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: CONVERSATION_ID,
    name: "Jordan Vale",
    email: "jordan.vale@example.com",
    phone: "555-0142",
    marketingConsent: false,
    ...over,
  }
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once implementation survives
  // clearAllMocks and reappears in a later test, which misattributes the
  // failure to whichever test happens to run next.
  vi.resetAllMocks()
  ipCounter += 1
  currentIp = `203.0.113.${ipCounter}`
  vi.stubEnv("CHAT_IP_SALT", SALT)
  h.getSetting.mockResolvedValue(true)
  h.getConversation.mockResolvedValue(conversation())
  h.countRecentConversationsByIp.mockResolvedValue(0)
  h.markCaptured.mockResolvedValue(undefined)
  h.captureLead.mockResolvedValue("contact-1")
  h.recordConsent.mockResolvedValue(undefined)
  h.getBusinessSettings.mockResolvedValue(SETTINGS)
  h.recordAudit.mockResolvedValue(undefined)
})

describe("POST /api/ask/capture — the only contact-write path", () => {
  it("404s when the flag is off, and writes nothing on the way out", async () => {
    h.getSetting.mockResolvedValue(false)

    const res = await POST(req(submission()))

    expect(res.status).toBe(404)
    expect(h.captureLead).not.toHaveBeenCalled()
    expect(h.recordConsent).not.toHaveBeenCalled()
  })

  it("asks system_settings for the right key, and defaults it closed", async () => {
    // The mocked getSetting hands back whatever the test says, so the fallback
    // it is CALLED with is the only place the fail-closed default is visible.
    // A route that defaults this flag `true` is a public endpoint nobody knows
    // is open — and every other surface reads the same constant.
    await POST(req(submission()))

    expect(h.getSetting).toHaveBeenCalledWith("chat_assistant_enabled", false)
  })

  it("creates the contact with source ai_chat and links it to the conversation", async () => {
    const res = await POST(req(submission()))

    expect(res.status).toBe(200)
    expect(h.captureLead).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "ai_chat",
        name: "Jordan Vale",
        email: "jordan.vale@example.com",
        phone: "555-0142",
      }),
    )
    expect(h.markCaptured).toHaveBeenCalledWith(CONVERSATION_ID, "contact-1")
  })

  it("files NO consent row when the marketing box was not ticked", async () => {
    const res = await POST(req(submission({ marketingConsent: false })))

    expect(res.status).toBe(200)
    // The contact still exists — asking to be contacted is its own record.
    expect(h.captureLead).toHaveBeenCalledTimes(1)
    expect(h.recordConsent).not.toHaveBeenCalled()
  })

  it("files a consent row quoting the wording the server re-rendered, not the client's", async () => {
    const res = await POST(
      req(submission({ marketingConsent: true, wordingShown: "I agree to absolutely anything at all" })),
    )

    expect(res.status).toBe(200)
    expect(h.recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-1",
        channel: "email",
        granted: true,
        source: "ai_chat",
        wordingShown: renderChatMarketingWording("Test Business"),
      }),
    )
    // Belt and braces: the client's sentence reached no argument of any call.
    expect(JSON.stringify(h.recordConsent.mock.calls)).not.toContain("absolutely anything at all")
  })

  it("does not even accept a wordingShown field on the request schema", () => {
    const parsed = askCaptureSchema.parse(submission({ wordingShown: "I agree to absolutely anything at all" }))

    expect(Object.prototype.hasOwnProperty.call(parsed, "wordingShown")).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain("absolutely anything at all")
  })

  it("files no consent row when display_name is blank, even with the box ticked", async () => {
    h.getBusinessSettings.mockResolvedValue({ ...SETTINGS, display_name: "" })

    const res = await POST(req(submission({ marketingConsent: true })))

    expect(res.status).toBe(200)
    // The lead is not lost over a missing business name — only the row is.
    expect(h.captureLead).toHaveBeenCalledTimes(1)
    expect(h.recordConsent).not.toHaveBeenCalled()
    expect(await res.json()).toEqual(expect.objectContaining({ marketingConsentRecorded: false }))
  })

  // conversation.business_id is a required column and this route already
  // reads it (it is on the audit metadata a few lines below captureLead's own
  // call, at the file's step 9). A DISTINCT id from SETTINGS.business_id is
  // the presence control here: a route that dropped the argument (or that
  // called captureLead/getBusinessSettings with none, letting their own
  // singleton defaults silently apply) would keep every OTHER test in this
  // file green, since they all use a conversation whose business_id equals
  // the singleton already.
  it("files the contact under the conversation's own business, not the platform default", async () => {
    const OTHER_BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
    h.getConversation.mockResolvedValue(conversation({ business_id: OTHER_BUSINESS_ID }))

    await POST(req(submission()))

    expect(h.captureLead).toHaveBeenCalledWith(expect.objectContaining({ businessId: OTHER_BUSINESS_ID }))
  })

  it("reads business settings for the consent wording from the conversation's own business", async () => {
    const OTHER_BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
    h.getConversation.mockResolvedValue(conversation({ business_id: OTHER_BUSINESS_ID }))
    h.getBusinessSettings.mockResolvedValue({ ...SETTINGS, business_id: OTHER_BUSINESS_ID })

    await POST(req(submission({ marketingConsent: true })))

    expect(h.getBusinessSettings).toHaveBeenCalledTimes(1)
    expect(h.getBusinessSettings).toHaveBeenCalledWith(OTHER_BUSINESS_ID)
  })

  it("files the consent row under the conversation's own business too, not just the settings read", async () => {
    const OTHER_BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
    h.getConversation.mockResolvedValue(conversation({ business_id: OTHER_BUSINESS_ID }))

    await POST(req(submission({ marketingConsent: true })))

    expect(h.recordConsent).toHaveBeenCalledWith(expect.objectContaining({ businessId: OTHER_BUSINESS_ID }))
  })

  it("treats a failed business-settings read as a blank name, never as a licence to file", async () => {
    h.getBusinessSettings.mockRejectedValue(new Error("business_settings unreachable"))

    const res = await POST(req(submission({ marketingConsent: true })))

    expect(res.status).toBe(200)
    expect(h.captureLead).toHaveBeenCalledTimes(1)
    expect(h.recordConsent).not.toHaveBeenCalled()
  })

  it("refuses a second capture on the same conversation", async () => {
    h.getConversation.mockResolvedValue(
      conversation({ captured_at: "2026-08-23T10:05:00.000Z", contact_id: "contact-0" }),
    )

    const res = await POST(req(submission({ marketingConsent: true })))

    expect(res.status).toBe(409)
    expect(h.captureLead).not.toHaveBeenCalled()
    expect(h.recordConsent).not.toHaveBeenCalled()
  })

  it("400s when neither an email nor a phone was given", async () => {
    const res = await POST(req({ conversationId: CONVERSATION_ID, name: "Jordan Vale", marketingConsent: false }))

    expect(res.status).toBe(400)
    expect(h.captureLead).not.toHaveBeenCalled()
  })

  it("reads an empty string as an absent field, not as an invalid address", async () => {
    // The details card renders both inputs; the one the visitor leaves alone
    // posts "". Rejecting that as an invalid email would refuse a perfectly
    // good phone-only submission.
    const res = await POST(req(submission({ email: "", phone: "555-0142" })))

    expect(res.status).toBe(200)
    expect(h.captureLead).toHaveBeenCalledWith(expect.objectContaining({ phone: "555-0142" }))
    expect(JSON.stringify(h.captureLead.mock.calls[0])).not.toContain('"email":""')
  })

  it("404s for a conversation that does not exist", async () => {
    h.getConversation.mockResolvedValue(null)

    const res = await POST(req(submission()))

    expect(res.status).toBe(404)
    expect(h.captureLead).not.toHaveBeenCalled()
  })

  it("does not report a failed conversation read as an unknown conversation", async () => {
    // `null` and "the database was unreachable" are different answers. Only
    // one of them means it is safe to say there is no such conversation.
    h.getConversation.mockRejectedValue(new Error("PGRST connection reset"))

    const res = await POST(req(submission()))

    expect(res.status).toBe(500)
    expect(h.captureLead).not.toHaveBeenCalled()
  })

  it("keeps the lead when the contact write itself fails, by saying so", async () => {
    h.captureLead.mockResolvedValue(null)

    const res = await POST(req(submission({ marketingConsent: true })))

    expect(res.status).toBe(500)
    // No contact means nothing to attach a consent row to, and nothing to link.
    expect(h.recordConsent).not.toHaveBeenCalled()
    expect(h.markCaptured).not.toHaveBeenCalled()
  })

  it("still confirms the capture when the consent write fails, and says the row is not there", async () => {
    h.recordConsent.mockRejectedValue(new Error("contact_consents unreachable"))

    const res = await POST(req(submission({ marketingConsent: true })))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.objectContaining({ marketingConsentRecorded: false }))
  })

  it("audits the capture without carrying the visitor's details into the trail", async () => {
    await POST(req(submission({ marketingConsent: true })))

    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chat.lead_captured",
        category: "marketing",
        outcome: "success",
      }),
    )
    const serialised = JSON.stringify(h.recordAudit.mock.calls)
    expect(serialised).not.toContain("jordan.vale@example.com")
    expect(serialised).not.toContain("Jordan Vale")
    expect(serialised).not.toContain("555-0142")
    expect(serialised).not.toContain(currentIp)
  })
})

// ---------------------------------------------------------------------------
// THE THROTTLE
// ---------------------------------------------------------------------------
//
// `/api/ask` pre-filters in memory and then counts in the database. This route
// did neither, on the one path in the feature that can write to the contact
// spine — and that spine's write is not additive: `upsertContactIdentity`
// renames a matched contact and, when a submitted email matches one contact
// while the phone matches another, merges the two and deletes one of them.
//
// A rate limit does not fix that behaviour (it is shared with
// `/api/funnels/submit` and `/api/newsletter` and is not this branch's to
// change). What it fixes is that this was a brand new unauthenticated front
// door to it with nothing in the way.
describe("POST /api/ask/capture — the throttle in front of the contact spine", () => {
  it("sheds a flood in memory before it costs a database read", async () => {
    const FLOOD_IP = "198.51.100.7"

    for (let i = 0; i < MAX_CONVERSATIONS_PER_IP_PER_HOUR; i++) {
      expect((await POST(req(submission(), FLOOD_IP))).status).toBe(200)
    }

    const readsBefore = h.getConversation.mock.calls.length
    const countsBefore = h.countRecentConversationsByIp.mock.calls.length

    const res = await POST(req(submission(), FLOOD_IP))

    expect(res.status).toBe(429)
    expect(h.captureLead).toHaveBeenCalledTimes(MAX_CONVERSATIONS_PER_IP_PER_HOUR)
    // WHERE it stopped, not just that it stopped: the pre-filter exists to
    // cost nothing, so a refused request must not have reached the database at
    // all. A test that only checked the status would pass just as well for a
    // limiter that ran after both reads.
    expect(h.getConversation.mock.calls.length).toBe(readsBefore)
    expect(h.countRecentConversationsByIp.mock.calls.length).toBe(countsBefore)
  })

  it("counts the origin in the database too, keyed on the salted hash and an hour of it", async () => {
    await POST(req(submission()))

    expect(h.countRecentConversationsByIp).toHaveBeenCalledTimes(1)
    const [hash, sinceIso] = h.countRecentConversationsByIp.mock.calls[0]

    // The exact digest, not "a string came back". An unsalted sha256 of an
    // IPv4 address is walkable in seconds, so which hash it is IS the property.
    expect(hash).toBe(createHash("sha256").update(`${currentIp}${SALT}`).digest("hex"))
    expect(hash).not.toContain(currentIp)

    const elapsed = Date.now() - Date.parse(sinceIso as string)
    expect(elapsed).toBeGreaterThanOrEqual(HOUR_MS - 5_000)
    expect(elapsed).toBeLessThanOrEqual(HOUR_MS + 5_000)
  })

  it("429s on the database count even from an origin this instance has never seen", async () => {
    // The in-memory Map dies with the lambda and one instance is one of many,
    // so the count is the control and the pre-filter is only ever a discount.
    h.countRecentConversationsByIp.mockResolvedValue(MAX_CONVERSATIONS_PER_IP_PER_HOUR)

    const res = await POST(req(submission()))

    expect(res.status).toBe(429)
    expect(h.captureLead).not.toHaveBeenCalled()
    expect(h.recordConsent).not.toHaveBeenCalled()
    // Refused before the conversation was even looked up.
    expect(h.getConversation).not.toHaveBeenCalled()
  })

  it("does not report a failed limit read as a refusal, nor wave it through", async () => {
    // "Nobody has asked yet" and "we could not tell" are different answers to
    // a rate limiter, and only one of them means it is safe to write.
    h.countRecentConversationsByIp.mockRejectedValue(new Error("PGRST connection reset"))

    const res = await POST(req(submission()))

    expect(res.status).toBe(500)
    expect(h.captureLead).not.toHaveBeenCalled()
  })

  it("refuses to run at all when CHAT_IP_SALT is unset, rather than keying on a reversible hash", async () => {
    // The same hard failure `/api/ask` takes. A quiet fallback to an unsalted
    // digest is invisible in every row it writes, so there is not one.
    vi.stubEnv("CHAT_IP_SALT", "")

    await expect(POST(req(submission()))).rejects.toThrow(/CHAT_IP_SALT/)
    expect(h.captureLead).not.toHaveBeenCalled()
  })

  it("checks the flag before it reads a header or hashes anything", async () => {
    // Flag first is the file's stated order. With the flag off, a missing salt
    // must not be able to turn a soft 404 into a 500 that says the feature is
    // there after all.
    h.getSetting.mockResolvedValue(false)
    vi.stubEnv("CHAT_IP_SALT", "")

    const res = await POST(req(submission()))

    expect(res.status).toBe(404)
  })
})
