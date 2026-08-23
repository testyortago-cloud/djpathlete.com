// @vitest-environment node
//
// The SMS consent page, and the one design constraint that separates it from
// every other link in this engine's mail.
//
// THE UNSUBSCRIBE PAGE WRITES ON GET. THIS ONE MUST NOT. lib/lead-engine/
// email.ts (~lines 157-165) records why: corporate mail scanners — Safe
// Links, Mimecast, Barracuda — GET every URL in an inbound message before a
// human ever sees it. For the unsubscribe page that behaviour costs a
// falsified revocation, which errs toward NOT contacting somebody. Here it
// would run the other way and FABRICATE CONSENT: a `contact_consents` row
// asserting a person agreed to be texted, written by a robot in their
// employer's mail gateway, and produced as evidence if a carrier or a
// regulator ever asks. So the GET renders wording and a button, and only an
// explicit POST writes. The first two suites below are that constraint.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url })
  }),
}))

const headerBag = new Map<string, string>()
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headerBag.get(k.toLowerCase()) ?? null }),
}))

type Row = Record<string, any>

const store: {
  contacts: Row[]
  consents: Row[]
  suppressions: Row[]
  timeline: Row[]
  settings: Row[]
} = { contacts: [], consents: [], suppressions: [], timeline: [], settings: [] }

function collectionFor(table: string): Row[] {
  switch (table) {
    case "contacts":
      return store.contacts
    case "contact_consents":
      return store.consents
    case "contact_suppressions":
      return store.suppressions
    case "contact_timeline_events":
      return store.timeline
    case "business_settings":
      return store.settings
    default:
      return []
  }
}

// Only @/lib/supabase is mocked. recordConsent, hasConsent, isSuppressed and
// getBusinessSettings all run for real against this in-memory store — the
// suppression gate and the "have they already said yes" read are the two
// decisions this whole page turns on, and a mock of either would prove
// nothing about them. `.eq()` genuinely narrows, and `.order()` / `.limit()`
// genuinely sort and slice, because `hasConsent`'s "most recent row wins"
// rule is load-bearing for the STOP-after-YES case below.
let insertSeq = 0
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Array<[string, any]> = []
      const orders: Array<[string, boolean]> = []
      let limitN: number | null = null

      const resolveRows = () => {
        let rows = collectionFor(table).filter((row) => filters.every(([k, v]) => row[k] === v))
        for (const [col, ascending] of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => {
            const av = a[col] ?? ""
            const bv = b[col] ?? ""
            if (av === bv) return 0
            return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
          })
        }
        return limitN === null ? rows : rows.slice(0, limitN)
      }

      const api: any = {
        select: () => api,
        eq(col: string, val: any) {
          filters.push([col, val])
          return api
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orders.push([col, opts?.ascending !== false])
          return api
        },
        limit(n: number) {
          limitN = n
          return api
        },
        insert(payload: Row) {
          insertSeq += 1
          // Mimics the DB defaults on contact_consents: occurred_at and
          // created_at are set by Postgres, not by recordConsent. Sequenced
          // rather than Date.now() so two rows written in the same
          // millisecond still order deterministically — otherwise the
          // STOP-after-YES case would be a coin flip.
          const stamp = new Date(Date.UTC(2026, 0, 1) + insertSeq * 1000).toISOString()
          const row = { id: `row-${insertSeq}`, occurred_at: stamp, created_at: stamp, ...payload }
          collectionFor(table).push(row)
          return Promise.resolve({ data: row, error: null })
        },
        maybeSingle: async () => ({ data: resolveRows()[0] ?? null, error: null }),
        then(resolve: any) {
          return resolve({ data: resolveRows(), error: null })
        },
      }
      return api
    },
  }),
}))

import { recordAudit } from "@/lib/audit/record"
import { redirect } from "next/navigation"
import { signSmsConsentToken } from "@/lib/lead-engine/sms-consent-token"
import { signUnsubscribeToken } from "@/lib/lead-engine/unsubscribe-token"
import { renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { confirmSmsConsent, readSmsConsentState } from "@/lib/lead-engine/sms-consent"
import SmsConsentPage from "@/app/(marketing)/sms-consent/[token]/page"
import { confirmSmsConsentAction } from "@/app/(marketing)/sms-consent/[token]/actions"

const CONTACT = "c-1"
const BUSINESS = "00000000-0000-0000-0000-000000000001"
const DISPLAY_NAME = "Acme Fitness"
const EMAIL = "marissa@example.com"
const PHONE = "+15551234567"
const WORDING = renderSmsConsentWording(DISPLAY_NAME)

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret"
})

beforeEach(() => {
  insertSeq = 0
  // A second, unrelated same-business contact FIRST — if the lookup ever
  // drops its `.eq("id", ...)` filter, `rows[0]` is this row instead, and the
  // consent assertions catch it.
  store.contacts = [
    { id: "some-other-contact", business_id: BUSINESS, email: "nobody@example.com", phone_e164: "+15550000000" },
    { id: CONTACT, business_id: BUSINESS, email: EMAIL, phone_e164: PHONE },
  ]
  store.consents = []
  store.suppressions = []
  store.timeline = []
  store.settings = [{ business_id: BUSINESS, display_name: DISPLAY_NAME }]
  headerBag.clear()
  headerBag.set("x-forwarded-for", "203.0.113.7, 70.41.3.18")
  headerBag.set("user-agent", "Mozilla/5.0 (iPhone)")
  vi.clearAllMocks()
})

/**
 * Walks the element tree the page returns and joins every string it renders.
 *
 * Sync function components are CALLED rather than skipped — the page splits
 * its six states into one small component each, and a walker that only
 * followed `props.children` would read every one of them as empty and pass
 * vacuously — the "found nothing / looked at nothing" trap
 * no-brand-literals.test.ts guards itself against. Every negative assertion
 * below is therefore paired with a positive one on the same render, so an
 * empty walk fails rather than passes.
 *
 * One component cannot be called this way: `AgreeButton` is a client
 * component and calls `useFormStatus`, which needs React's real render to be
 * in progress and throws outside one. It is walked as a labelled leaf rather
 * than swallowed, so a component that starts throwing for some OTHER reason
 * shows up in the collected text instead of disappearing into an empty
 * string. Its own behaviour has its own suite
 * (__tests__/app/sms-consent-agree-button.test.tsx).
 */
function collectText(node: any): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(collectText).join(" ")
  if (typeof node === "object" && node.type) {
    if (typeof node.type === "function") {
      let rendered
      try {
        rendered = node.type(node.props)
      } catch {
        return `[uncallable:${node.type.name || "anonymous"}]`
      }
      return collectText(rendered)
    }
    return collectText(node.props?.children)
  }
  return ""
}

async function renderPage(token: string, searchParams: Record<string, string> = {}) {
  return SmsConsentPage({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve(searchParams),
  })
}

/** Submits the form the way the browser does, returning the redirect target. */
async function submit(token: string): Promise<string> {
  const fd = new FormData()
  fd.set("token", token)
  try {
    await confirmSmsConsentAction(fd)
  } catch (err) {
    if ((err as Error).message === "NEXT_REDIRECT") return (err as { url: string }).url
    throw err
  }
  throw new Error("the action returned without redirecting")
}

// ---------------------------------------------------------------------------

describe("a GET on the consent page writes NOTHING", () => {
  it("renders the ask without recording consent, a timeline row or an audit row", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const el = await renderPage(token)
    expect(el).toBeTruthy()

    expect(store.consents).toEqual([])
    expect(store.timeline).toEqual([])
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("still writes nothing when the page is fetched over and over, as a scanner would", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    for (let i = 0; i < 5; i++) await renderPage(token)
    expect(store.consents).toEqual([])
    expect(store.timeline).toEqual([])
  })

  it("writes nothing even when the URL claims the deed is already done", async () => {
    // `?done=1` only ever chooses between two headings. It cannot BE the
    // consent — a scanner appending query strings must not be able to talk
    // this page into a record, nor into claiming one exists.
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const el = await renderPage(token, { done: "1" })
    expect(store.consents).toEqual([])
    expect(collectText(el)).toContain(WORDING)
  })

  it("puts the ask behind the pending-aware button, not a plain submit", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))

    expect(shown).toContain(WORDING)
    // A plain <Button> is callable and would have contributed "I agree" to the
    // walk. The label is the walker saying it met a client component instead —
    // which is the whole point: only that one can disable itself mid-press.
    expect(shown).toContain("[uncallable:AgreeButton]")
  })

  it("shows the exact sentence the write will later file", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))
    expect(shown).toContain(WORDING)

    await submit(token)
    expect(store.consents[0].wording_shown).toBe(WORDING)
  })
})

describe("only an explicit POST records consent", () => {
  it("records exactly one row, with the exact wording and the request's evidence", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)

    expect(store.consents).toHaveLength(1)
    expect(store.consents[0]).toMatchObject({
      business_id: BUSINESS,
      contact_id: CONTACT,
      channel: "sms",
      granted: true,
      source: "sms_consent_link",
      wording_shown: WORDING,
      // Only the first hop of x-forwarded-for; the rest are proxies.
      ip_address: "203.0.113.7",
      user_agent: "Mozilla/5.0 (iPhone)",
    })
  })

  it("appends a timeline event", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({
      business_id: BUSINESS,
      contact_id: CONTACT,
      kind: "sms_consent_confirmed",
      source: "sms_consent_link",
    })
  })

  it("sends the reader back to the page, which then shows the confirmation", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const target = await submit(token)
    expect(target).toContain(`/sms-consent/${encodeURIComponent(token)}`)
    expect(target).toContain("done=1")

    const shown = collectText(await renderPage(token, { done: "1" }))
    expect(shown).toMatch(/all set/i)
  })

  it("is idempotent — a second POST does not throw and does not file a second row", async () => {
    // A double tap, a back-button resubmit, a retried request. The unsubscribe
    // flow treats a repeat as a legitimate second append-only record, and for
    // a REVOCATION that is right. A pile of duplicate GRANTS is different:
    // each one is legal evidence of an agreement, and there was only ever one
    // agreement. `hasConsent` already answers this, so the repeat is refused
    // rather than recorded.
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)
    await expect(submit(token)).resolves.toBeTruthy()

    expect(store.consents).toHaveLength(1)
    expect(store.timeline).toHaveLength(1)
  })

  it("shows the already-said-yes wording on a later visit, not the ask", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)
    const shown = collectText(await renderPage(token))
    expect(shown).toMatch(/already/i)
    expect(shown).not.toContain(WORDING)
  })
})

describe("a token this page must refuse", () => {
  it("404s on a malformed token, and writes nothing", async () => {
    await expect(renderPage("garbage")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(store.consents).toEqual([])
  })

  it("404s on an unsubscribe token — a revocation link must never grant consent", async () => {
    const foreign = signUnsubscribeToken(CONTACT, BUSINESS)
    await expect(renderPage(foreign)).rejects.toThrow("NEXT_NOT_FOUND")
    expect(store.consents).toEqual([])
  })

  it("refuses the POST for a foreign token too — the page is not the only gate", async () => {
    const foreign = signUnsubscribeToken(CONTACT, BUSINESS)
    await submit(foreign)
    expect(store.consents).toEqual([])
    expect(store.timeline).toEqual([])
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("404s when the contact belongs to another business", async () => {
    const token = signSmsConsentToken(CONTACT, "00000000-0000-0000-0000-0000000000ff")
    await expect(renderPage(token)).rejects.toThrow("NEXT_NOT_FOUND")
    expect(store.consents).toEqual([])
  })

  it("404s when the contact no longer exists", async () => {
    store.contacts = []
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await expect(renderPage(token)).rejects.toThrow("NEXT_NOT_FOUND")
  })
})

describe("a phone that already said STOP", () => {
  beforeEach(() => {
    store.suppressions = [{ business_id: BUSINESS, identifier: PHONE, reason: "sms_stop" }]
  })

  it("records no consent and returns the suppressed outcome", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const outcome = await confirmSmsConsent(token)

    expect(outcome).toMatchObject({ ok: false, reason: "phone_suppressed" })
    expect(store.consents).toEqual([])
    expect(store.timeline).toEqual([])
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("leaves the suppression in place — a STOP is not undone by tapping a link", async () => {
    // The STOP arrived through a verified channel: an SMS from the handset
    // itself, signature-checked by app/api/webhooks/twilio/inbound/route.ts.
    // A link tapped in an email is a weaker signal than that, so it does not
    // get to overrule it.
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)
    expect(store.suppressions).toHaveLength(1)
  })

  it("tells the reader the truth — text START, not 'you are all set'", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))
    expect(shown).toMatch(/START/)
    expect(shown).not.toMatch(/all set/i)
    // The ask must not be on the page at all: a button that cannot work is
    // worse than no button.
    expect(shown).not.toContain(WORDING)
  })

  it("does not promise the emails carry on — a suppression exits every run, email steps included", async () => {
    // `loadRunContext` (lib/db/sequences.ts) sets `isSuppressed` from EITHER
    // identifier, and `decideStep` exits the run on that flag before it ever
    // looks at the step kind. So a suppressed phone stops this engine's
    // automatic EMAILS too, and "Our emails are not affected. Those carry on
    // as before." was simply false.
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))
    expect(shown).not.toMatch(/emails are not affected/i)
    expect(shown).not.toMatch(/carry on as before/i)
    expect(shown).toMatch(/also stops the automatic emails/i)
  })

  it("still refuses after a YES that was later followed by a STOP", async () => {
    // The realistic shape: they agreed once, changed their mind by text, and
    // then tapped the old email link again. `hasConsent` reads the most
    // recent row, so consent is already false — but suppression is checked
    // FIRST regardless, because the two could disagree.
    store.consents = [
      {
        business_id: BUSINESS,
        contact_id: CONTACT,
        channel: "sms",
        granted: true,
        occurred_at: "2026-01-01T00:00:00Z",
      },
      {
        business_id: BUSINESS,
        contact_id: CONTACT,
        channel: "sms",
        granted: false,
        occurred_at: "2026-02-01T00:00:00Z",
      },
    ]
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const outcome = await confirmSmsConsent(token)
    expect(outcome).toMatchObject({ ok: false, reason: "phone_suppressed" })
    expect(store.consents).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// The suppression gate has to ask the SAME question the send path asks.
//
// `loadRunContext` (lib/db/sequences.ts, ~lines 118-127) sets `isSuppressed`
// from EITHER identifier — "Check whichever identifiers this contact actually
// has; either one being suppressed suppresses the whole run" — and
// `decideStep` exits the run on that flag on its very first line. A gate here
// that looked only at the phone therefore showed the ask, took the press,
// filed a granted consent row and said "You are all set. We can now send you
// text messages." to somebody the engine would never send anything to.
//
// One unsubscribe is enough to put her there, and the re-permission email
// carries an unsubscribe footer of its own — so a corporate mail scanner
// GETting every link in that message is a way to acquire the row without her
// doing anything at all.
describe("an email address that already unsubscribed", () => {
  beforeEach(() => {
    store.suppressions = [{ business_id: BUSINESS, identifier: EMAIL, reason: "unsubscribe" }]
  })

  it("records no consent and returns a suppressed outcome", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const outcome = await confirmSmsConsent(token)

    expect(outcome).toMatchObject({ ok: false, reason: "email_suppressed" })
    expect(store.consents).toEqual([])
    expect(store.timeline).toEqual([])
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("does not show the ask — a button that cannot work is worse than no button", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))

    expect(shown).not.toContain(WORDING)
    expect(shown).not.toMatch(/all set/i)
  })

  it("says so in plain words, and does not send her off to text START", async () => {
    // START clears a PHONE suppression. Hers is on her email address, so that
    // instruction would waste her time and still leave her blocked.
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))

    expect(shown).toMatch(/unsubscribed/i)
    expect(shown).not.toMatch(/\bSTART\b/)
  })

  it("still refuses after a POST, not only on the page", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)
    expect(store.consents).toEqual([])
    expect(store.timeline).toEqual([])
  })

  it("answers the phone case when BOTH are suppressed — a texted STOP is the stronger signal", async () => {
    store.suppressions.push({ business_id: BUSINESS, identifier: PHONE, reason: "sms_stop" })
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await confirmSmsConsent(token)).toMatchObject({ ok: false, reason: "phone_suppressed" })
  })

  it("matches on a differently-cased address, because contact_suppressions is stored lowercased", async () => {
    store.contacts = [{ id: CONTACT, business_id: BUSINESS, email: EMAIL.toUpperCase(), phone_e164: PHONE }]
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await readSmsConsentState(token)).toMatchObject({ state: "email_suppressed" })
  })
})

describe("the audit row", () => {
  it("records marketing.sms_consent_confirmed against the contact, with a system actor", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "marketing.sms_consent_confirmed",
        category: "compliance",
        outcome: "success",
        actor: expect.objectContaining({ role: "system" }),
        target: expect.objectContaining({ type: "contact", id: CONTACT }),
      }),
    )
  })

  it("carries no email address and no phone number", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)

    const arg = (recordAudit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const serialised = JSON.stringify(arg)
    expect(serialised).not.toContain(EMAIL)
    expect(serialised).not.toContain(PHONE)
    expect(serialised).not.toContain("5551234567")
  })

  it("still names the wording that was agreed to", async () => {
    // The taxonomy entry for this slug promises the trail can answer "who
    // agreed, to what wording, and when" on its own. The sentence names the
    // business, not the person, so it is not PII.
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    await submit(token)
    const arg = (recordAudit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.metadata.wording_shown).toBe(WORDING)
  })

  it("uses a slug that exists in the closed taxonomy", async () => {
    const { getActionDef } = await import("@/lib/audit/actions")
    const def = getActionDef("marketing.sms_consent_confirmed")
    expect(def).toBeDefined()
    expect(def?.category).toBe("compliance")
  })
})

describe("a business with no name configured", () => {
  beforeEach(() => {
    // business_settings.display_name is seeded '' (migration 00212) and stays
    // that way until somebody fills it in. `renderSmsConsentWording` fed a
    // blank name produces "I agree to receive text messages from about my
    // inquiry." — a sentence naming nobody is not consent to anything.
    store.settings = [{ business_id: BUSINESS, display_name: "  " }]
  })

  it("files no consent row", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const outcome = await confirmSmsConsent(token)
    expect(outcome).toMatchObject({ ok: false, reason: "wording_unavailable" })
    expect(store.consents).toEqual([])
  })

  it("shows no agree button rather than a sentence naming nobody", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const shown = collectText(await renderPage(token))
    expect(shown).toMatch(/not ready yet/i)
    expect(shown).not.toMatch(/text messages from\s+about/i)
    expect(shown).not.toMatch(/all set/i)
  })
})

describe("readSmsConsentState — what the page renders is what the write decides", () => {
  it("reports the ask, carrying the sentence to show", async () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await readSmsConsentState(token)).toEqual({
      state: "ask",
      contactId: CONTACT,
      businessId: BUSINESS,
      wording: WORDING,
    })
    // Reading the state is a read. It must not write.
    expect(store.consents).toEqual([])
  })

  it("reports a contact with no phone number as askable", async () => {
    // Consent is contact-keyed, not phone-keyed (`hasConsent` takes a contact
    // id), and suppression cannot be checked without an identifier. Someone
    // who agrees before a number is on file is still someone who agreed.
    store.contacts = [{ id: CONTACT, business_id: BUSINESS, email: EMAIL, phone_e164: null }]
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await readSmsConsentState(token)).toMatchObject({ state: "ask" })
  })
})
