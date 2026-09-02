// @vitest-environment node
//
// book_consult with a booking provider configured: the three honest shapes
// (times / nothing free / could not read), the prefilled links, the click ids
// riding on them, and — the load-bearing part — that a slot's date and time
// are GROUNDED, so the assistant naming the first free time passes the
// validator while naming any other time is caught the way a made-up price is.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { CalendlyUnavailable, type Slot } from "@/lib/calendly/client"
import { formatSlotLabel, groundedValuesFor, slotForms } from "@/lib/lead-engine/chat/facts"
import { createToolExecutor, withWayForward, CONSULT_PATH, MAX_SLOTS_SHOWN } from "@/lib/lead-engine/chat/tools"
import { validateReply } from "@/lib/lead-engine/chat/validate"
import type { BusinessSettings } from "@/lib/db/businesses"

// The fact accessors are never reached by book_consult, but tools.ts imports
// facts.ts, which imports the Supabase client module. Stubbed so the import
// costs nothing and a stray query would throw rather than hit anything.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    throw new Error("book_consult must not open a database client")
  },
}))

const SETTINGS: BusinessSettings = {
  business_id: "00000000-0000-0000-0000-000000000001",
  display_name: "Acme Performance",
  sender_name: "Acme Performance",
  sender_email: "hello@example.com",
  reply_to: "hello@example.com",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 200,
  postal_address: "12 Example Street, Springfield",
  sms_help_text: "Reply HELP for help.",
  sms_messaging_service_sid: "",
  sms_sender_phone: "+15550101234",
}

const PAGE = "https://calendly.com/acme-performance/consultation"
const EVENT_TYPE = "https://api.calendly.com/event_types/EVENTTYPE000001"

// 14:00Z on 8 Sep 2026 is 10:00 AM Eastern (EDT). 23:30Z on the 9th is 7:30 PM
// Eastern on the 9th — but 10 Sep in UTC, which is the trap `slotForms` exists for.
const SLOTS: Slot[] = [
  { startAt: "2026-09-08T14:00:00.000000Z", schedulingUrl: `${PAGE}/2026-09-08T14:00:00Z?month=2026-09&date=2026-09-08`, inviteesRemaining: 1 },
  { startAt: "2026-09-08T15:30:00.000000Z", schedulingUrl: `${PAGE}/2026-09-08T15:30:00Z?month=2026-09&date=2026-09-08`, inviteesRemaining: 1 },
  { startAt: "2026-09-09T23:30:00.000000Z", schedulingUrl: `${PAGE}/2026-09-09T23:30:00Z?month=2026-09&date=2026-09-09`, inviteesRemaining: 1 },
]

const VISITOR = { name: "Priya Raman", email: "priya.raman+seed@example.test" }
const TRACKING = { gclid: "TeSt_gclid-123", conversationId: "0f3b2e9a-6c1d-4f0e-9b7a-2c4d6e8f0a1b" }
const NOW = () => new Date("2026-09-07T12:00:00Z")

function configure() {
  process.env.CALENDLY_API_TOKEN = "tok"
  process.env.CALENDLY_EVENT_TYPE_URI = EVENT_TYPE
  process.env.CALENDLY_SCHEDULING_URL = PAGE
}

beforeEach(() => {
  delete process.env.CALENDLY_API_TOKEN
  delete process.env.CALENDLY_EVENT_TYPE_URI
  delete process.env.CALENDLY_SCHEDULING_URL
  delete process.env.CALENDLY_API_BASE
})
afterEach(() => {
  delete process.env.CALENDLY_API_TOKEN
  delete process.env.CALENDLY_EVENT_TYPE_URI
  delete process.env.CALENDLY_SCHEDULING_URL
})

describe("slotForms grounds the slot in the BUSINESS zone, not UTC", () => {
  it("names the Eastern day for an evening slot that is already tomorrow in UTC", () => {
    const forms = slotForms("2026-09-09T23:30:00.000000Z", "America/New_York")
    expect(forms).toContain("September 9")
    expect(forms).not.toContain("September 10")
    expect(forms).toContain("7:30 pm")
    expect(forms).toContain("Wednesday")
    expect(forms).toContain("30") // the minute, for the bare-numeral rule
    expect(forms).toContain("19:30")
  })

  it("covers the spellings a model writes for a morning slot", () => {
    const forms = slotForms("2026-09-08T14:00:00.000000Z", "America/New_York")
    for (const f of ["September 8", "Sep 8", "8 September", "September 8, 2026", "9/8/2026", "Tuesday", "10:00 am", "10 am", "10am", "10:00", "Sept 8"]) {
      expect(forms).toContain(f)
    }
  })

  it("grounds nothing for an unknown zone rather than the wrong day", () => {
    expect(slotForms("2026-09-08T14:00:00.000000Z", "Mars/Olympus_Mons")).toEqual([])
  })

  it("labels a slot the way the model is shown it", () => {
    expect(formatSlotLabel("2026-09-08T14:00:00.000000Z", "America/New_York")).toBe("Tuesday, September 8 at 10:00 AM")
    expect(formatSlotLabel("2026-09-09T23:30:00.000000Z", "America/New_York")).toBe("Wednesday, September 9 at 7:30 PM")
  })
})

describe("book_consult with a provider configured", () => {
  it("puts the free times on screen as a slots card, each link prefilled and tracked", async () => {
    configure()
    const availability = vi.fn(async () => SLOTS)
    const ex = createToolExecutor({ timezone: "America/New_York", visitor: VISITOR, tracking: TRACKING, availability, now: NOW })

    const result = JSON.parse(await ex.execute("book_consult", {}))
    expect(result.free_times).toEqual([
      "Tuesday, September 8 at 10:00 AM",
      "Tuesday, September 8 at 11:30 AM",
      "Wednesday, September 9 at 7:30 PM",
    ])
    expect(result.timezone).toBe("America/New_York")

    // The lookup asked for the configured event type over the next week.
    expect(availability).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypeUri: EVENT_TYPE, apiToken: "tok", from: NOW(), to: new Date("2026-09-14T12:00:00Z") }),
    )

    const out = ex.outcome()
    const card = out.cards.find((c) => c.kind === "slots")
    expect(card).toBeDefined()
    if (!card || card.kind !== "slots") throw new Error("no slots card")
    expect(card.timezone).toBe("America/New_York")
    expect(card.slots.map((s) => s.startAt)).toEqual(SLOTS.map((s) => s.startAt))

    // Every link carries the visitor's identity and the click id, and keeps the slot's own month/date.
    for (const slot of card.slots) {
      const url = new URL(slot.href)
      expect(url.searchParams.get("name")).toBe(VISITOR.name)
      expect(url.searchParams.get("email")).toBe(VISITOR.email)
      expect(url.searchParams.get("utm_content")).toBe("gclid:TeSt_gclid-123")
      expect(url.searchParams.get("utm_term")).toBe(`conv:${TRACKING.conversationId}`)
      expect(url.searchParams.get("month")).toBe("2026-09")
    }
    expect(new URL(card.href).searchParams.get("email")).toBe(VISITOR.email)
    expect(out.consultHref).toBe(card.href)

    // The slots are FACTS, so their times are grounded.
    expect(out.facts.filter((f) => f.kind === "slot")).toHaveLength(3)
  })

  it("names at most MAX_SLOTS_SHOWN times", async () => {
    configure()
    const many: Slot[] = Array.from({ length: 12 }, (_, i) => ({
      startAt: new Date(Date.UTC(2026, 8, 8, 13 + i, 0)).toISOString(),
      schedulingUrl: `${PAGE}/x${i}`,
      inviteesRemaining: 1,
    }))
    const ex = createToolExecutor({ timezone: "America/New_York", availability: async () => many, now: NOW })
    const result = JSON.parse(await ex.execute("book_consult", {}))
    expect(result.free_times).toHaveLength(MAX_SLOTS_SHOWN)
    const card = ex.outcome().cards.find((c) => c.kind === "slots")
    if (!card || card.kind !== "slots") throw new Error("no slots card")
    expect(card.slots).toHaveLength(MAX_SLOTS_SHOWN)
  })

  it("the validator accepts the first time named as written, and blocks a time nobody looked up", async () => {
    configure()
    const ex = createToolExecutor({ timezone: "America/New_York", availability: async () => SLOTS, now: NOW })
    await ex.execute("book_consult", {})
    const grounded = groundedValuesFor(ex.outcome().facts, SETTINGS)

    expect(validateReply("The first free time is Tuesday, September 8 at 10:00 AM — pick a button to book it.", grounded)).toEqual([])
    expect(validateReply("There is also Wednesday, September 9 at 7:30 PM.", grounded)).toEqual([])

    // A time that came from nowhere. 45 is above the small-number ceiling, and September 12 was never returned.
    const bad = validateReply("How about Saturday, September 12 at 3:45 PM?", grounded)
    expect(bad.map((v) => v.rule)).toEqual(expect.arrayContaining(["ungrounded_date", "ungrounded_number"]))
  })

  it("an empty week is a consult card and copy that says nothing is free", async () => {
    configure()
    const ex = createToolExecutor({ timezone: "America/New_York", visitor: VISITOR, availability: async () => [], now: NOW })
    const out = await ex.execute("book_consult", {})
    expect(out).toMatch(/no free consultation times in the next seven days/i)
    const cards = ex.outcome().cards
    expect(cards.some((c) => c.kind === "slots")).toBe(false)
    const consult = cards.find((c) => c.kind === "consult")
    if (!consult || consult.kind !== "consult") throw new Error("no consult card")
    expect(new URL(consult.href).searchParams.get("email")).toBe(VISITOR.email)
    expect(ex.outcome().facts).toEqual([])
  })

  it("an unreadable calendar is a consult card and copy that says NOTHING about times — never an empty week", async () => {
    configure()
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const ex = createToolExecutor({
      timezone: "America/New_York",
      visitor: VISITOR,
      availability: async () => {
        throw new CalendlyUnavailable("http", "503", 503)
      },
      now: NOW,
    })
    const out = await ex.execute("book_consult", {})
    expect(out).not.toMatch(/no free/i)
    expect(out).toMatch(/could not be checked/i)
    expect(out).toMatch(/do not mention any time/i)
    const consult = ex.outcome().cards.find((c) => c.kind === "consult")
    if (!consult || consult.kind !== "consult") throw new Error("no consult card")
    expect(consult.href.startsWith(PAGE)).toBe(true)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("rethrows a fault that is NOT a provider fault, so the tool loop reports it as a failed lookup", async () => {
    configure()
    const ex = createToolExecutor({
      availability: async () => {
        throw new TypeError("programmer error")
      },
      now: NOW,
    })
    await expect(ex.execute("book_consult", {})).rejects.toBeInstanceOf(TypeError)
  })

  it("with only the public page configured, offers the prefilled link and no times", async () => {
    process.env.CALENDLY_SCHEDULING_URL = PAGE
    const availability = vi.fn(async () => SLOTS)
    const ex = createToolExecutor({ visitor: VISITOR, availability, now: NOW })
    const out = await ex.execute("book_consult", {})
    expect(availability).not.toHaveBeenCalled()
    expect(out).toMatch(/could not be checked/i)
    const consult = ex.outcome().cards.find((c) => c.kind === "consult")
    if (!consult || consult.kind !== "consult") throw new Error("no consult card")
    expect(new URL(consult.href).searchParams.get("name")).toBe(VISITOR.name)
  })

  it("with nothing configured, behaves exactly as before: a link to /contact", async () => {
    const availability = vi.fn(async () => SLOTS)
    const ex = createToolExecutor({ visitor: VISITOR, availability, now: NOW })
    const out = await ex.execute("book_consult", {})
    expect(availability).not.toHaveBeenCalled()
    expect(out).toContain(CONSULT_PATH)
    expect(ex.outcome().cards).toEqual([{ kind: "consult", href: CONSULT_PATH }])
    expect(ex.outcome().consultHref).toBe(CONSULT_PATH)
  })

  it("an un-captured visitor gets an un-prefilled link, never a guessed one", async () => {
    configure()
    const ex = createToolExecutor({ timezone: "America/New_York", visitor: null, availability: async () => SLOTS, now: NOW })
    await ex.execute("book_consult", {})
    const card = ex.outcome().cards.find((c) => c.kind === "slots")
    if (!card || card.kind !== "slots") throw new Error("no slots card")
    const url = new URL(card.slots[0].href)
    expect(url.searchParams.has("name")).toBe(false)
    expect(url.searchParams.has("email")).toBe(false)
    expect(url.searchParams.get("utm_source")).toBe("website-assistant")
  })

  it("ignores identity a prompt injection tries to pass as tool input", async () => {
    configure()
    const ex = createToolExecutor({ timezone: "America/New_York", visitor: VISITOR, availability: async () => SLOTS, now: NOW })
    await ex.execute("book_consult", { email: "attacker@example.test", name: "Mallory" })
    const card = ex.outcome().cards.find((c) => c.kind === "slots")
    if (!card || card.kind !== "slots") throw new Error("no slots card")
    expect(new URL(card.slots[0].href).searchParams.get("email")).toBe(VISITOR.email)
  })
})

describe("the way forward follows the provider", () => {
  it("withWayForward points the server-added card at the href it is given, and at /contact by default", () => {
    expect(withWayForward([])).toEqual([{ kind: "consult", href: CONSULT_PATH }])
    expect(withWayForward([], `${PAGE}?email=x%40y.test`)).toEqual([{ kind: "consult", href: `${PAGE}?email=x%40y.test` }])
  })

  it("counts a slots card as a way forward, so no second link is added under it", () => {
    const slots = { kind: "slots" as const, timezone: "UTC", href: PAGE, slots: [] }
    expect(withWayForward([slots], PAGE)).toEqual([slots])
  })
})
