// __tests__/app/api/funnels/preview-submit.test.ts
//
// The endpoint that lets the owner test a form on an UNPUBLISHED page.
//
// The live route cannot do this and must not be taught to: it validates against
// `getPublishedFormConfig`, which returns null until a version row exists, and
// that indirection IS its security model. So this route reads the DRAFT — and
// the price of that is the gate below and the "writes nothing" test at the end.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  getFunnelBySlug: vi.fn(),
  listSteps: vi.fn(),
  getStep: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))

import { POST } from "@/app/api/funnels/preview-submit/route"
import { auth } from "@/lib/auth"
import { getDraft } from "@/lib/db/funnel-builder"
import { getFunnelById, getFunnelBySlug, getStep, listSteps } from "@/lib/db/funnels"
import { getEventById } from "@/lib/db/events"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const NEXT_ID = "3f1b7c5e-2222-4222-8333-444444444444"
const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const EVENT_ID = "11111111-2222-4333-8444-555555555555"

/**
 * Shaped against the REAL `sectionDocSchema` — `v`/`engine`/`theme`, and a form
 * section whose props ARE the form island's props (they are an intersection).
 * An invented fixture here would pass every assertion below while pinning
 * nothing.
 */
function docWith(props: Record<string, unknown>): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "form",
        kind: "form",
        variant: "boxed",
        style: {},
        props: {
          heading: "Apply",
          formKey: "optin",
          submitLabel: "Request a spot",
          fields: [
            { name: "name", label: "Name", type: "text", required: true },
            { name: "email", label: "Email", type: "email", required: true },
          ],
          successMessage: "Thanks — you're in.",
          ...props,
        },
      },
    ],
  } as unknown as SectionDoc
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/funnels/preview-submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

const GOOD = { stepId: STEP_ID, formKey: "optin", values: { name: "Jane", email: "jane@example.com" } }

/** A funnel whose entry is STEP_ID and whose second page is `thanks`. */
function armFunnelWithSecondPage() {
  mock(getFunnelBySlug).mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", name: "Summer camp" })
  mock(listSteps).mockResolvedValue([
    { id: STEP_ID, slug: "start", name: "Start", is_entry: true },
    { id: NEXT_ID, slug: "thanks", name: "Thanks", is_entry: false },
  ])
}

beforeEach(() => {
  vi.resetAllMocks()
  mock(auth).mockResolvedValue({ user: { role: "admin" } })
  mock(getStep).mockResolvedValue({ id: STEP_ID, funnel_id: FUNNEL_ID, slug: "start", name: "Start" })
  mock(getFunnelById).mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", name: "Summer camp" })
  mock(getDraft).mockResolvedValue({ doc: docWith({}), docInvalid: false, revision: 1 })
  mock(listSteps).mockResolvedValue([{ id: STEP_ID, slug: "start", name: "Start", is_entry: true }])
})

describe("the gate", () => {
  it("404s an anonymous caller", async () => {
    mock(auth).mockResolvedValue(null)
    expect((await post(GOOD)).status).toBe(404)
  })

  it("404s a signed-in client", async () => {
    // MUTANT KILLED: gating on "is signed in". A client could otherwise read
    // the field list of a page that was never published.
    mock(auth).mockResolvedValue({ user: { role: "client" } })
    expect((await post(GOOD)).status).toBe(404)
  })

  it("lets an admin and a staff member through", async () => {
    for (const role of ["admin", "staff"]) {
      mock(auth).mockResolvedValue({ user: { role } })
      expect((await post(GOOD)).status).toBe(200)
    }
  })
})

describe("validation matches the live route", () => {
  it("rejects a missing required field, naming it the way the label does", async () => {
    const response = await post({ ...GOOD, values: { name: "Jane", email: "" } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Email is required.")
  })

  it("rejects a malformed email", async () => {
    const response = await post({ ...GOOD, values: { name: "Jane", email: "nope" } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/valid email/i)
  })

  it("discards a field the draft form does not declare", async () => {
    // MUTANT KILLED: echoing back the raw payload. The draft doc is the
    // authority on which fields exist, exactly as the published config is on
    // the live route.
    const response = await post({ ...GOOD, values: { ...GOOD.values, injected: "x" } })
    const body = await response.json()
    expect(body.captured).toEqual({ name: "Jane", email: "jane@example.com" })
  })

  it("404s a form key the draft does not contain", async () => {
    expect((await post({ ...GOOD, formKey: "not-a-form" })).status).toBe(404)
  })

  it("reports a draft it cannot read rather than throwing", async () => {
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 1 })
    expect((await post(GOOD)).status).toBe(409)
  })
})

describe("outcomes", () => {
  it("returns the success message for a message form", async () => {
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "message" })
  })

  it("rewrites an internal redirect onto the preview base", async () => {
    armFunnelWithSecondPage()
    mock(getDraft).mockImplementation(async (id: string) =>
      id === NEXT_ID
        ? { doc: docWith({}), docInvalid: false, revision: 1 }
        : { doc: docWith({ successMode: "redirect", redirectUrl: "/go/summer-camp/thanks" }), docInvalid: false, revision: 1 },
    )
    const body = await (await post(GOOD)).json()
    // MUTANT KILLED: returning the stored /go url. The owner would be thrown
    // out of the preview onto a 404 at the exact moment the walk should work.
    expect(body.outcome).toEqual({ kind: "redirect", href: "/preview/summer-camp/thanks" })
  })

  it("reports a next page with no draft instead of walking to a blank one", async () => {
    armFunnelWithSecondPage()
    mock(getDraft).mockImplementation(async (id: string) =>
      id === NEXT_ID
        ? { doc: null, docInvalid: false, revision: 0 }
        : { doc: docWith({ successMode: "redirect", redirectUrl: "/go/summer-camp/thanks" }), docInvalid: false, revision: 1 },
    )
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "no-draft", stepName: "Thanks" })
  })

  it("reports an external redirect rather than returning it as a navigation", async () => {
    mock(getDraft).mockResolvedValue({
      doc: docWith({ successMode: "redirect", redirectUrl: "https://calendly.com/djp/intro" }),
      docInvalid: false,
      revision: 1,
    })
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "external", href: "https://calendly.com/djp/intro" })
  })

  it("names the camp a checkout form sells, and starts no session", async () => {
    mock(getDraft).mockResolvedValue({
      doc: docWith({ successMode: "checkout", eventId: EVENT_ID }),
      docInvalid: false,
      revision: 1,
    })
    mock(getEventById).mockResolvedValue({ id: EVENT_ID, title: "Summer Throwing Camp" })
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "checkout", label: "Summer Throwing Camp" })
    expect(JSON.stringify(body)).not.toMatch(/stripe|sessionUrl/i)
  })

  it("still reports a checkout when the camp cannot be read", async () => {
    // MUTANT KILLED: letting a failed event read 500 the test run. The owner is
    // testing the FORM; naming the camp is a nicety.
    mock(getDraft).mockResolvedValue({
      doc: docWith({ successMode: "checkout", eventId: EVENT_ID }),
      docInvalid: false,
      revision: 1,
    })
    mock(getEventById).mockRejectedValue(new Error("unreadable"))
    const body = await (await post(GOOD)).json()
    expect(body.outcome.kind).toBe("checkout")
  })
})

describe("it writes nothing — the whole reason this route exists", () => {
  it("does not reference a single write path", async () => {
    // MUTANT KILLED: someone adding createSubmission "so the owner can see the
    // lead". The module SOURCE is the assertion: a spy would only prove this
    // request did not write, not that the route cannot.
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("app/api/funnels/preview-submit/route.ts", "utf8")
    for (const forbidden of [
      "createSubmission",
      "captureContactFromSubmission",
      "recordConsent",
      "sendNewFunnelLeadEmail",
      "createEventSignupCheckout",
      "createServiceRoleClient",
      "upsertLead",
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
