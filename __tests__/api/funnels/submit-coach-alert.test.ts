// @vitest-environment node
//
// Pinned to node for the same reason as submit-lead-name.test.ts: jsdom
// crashes on worker start in this repo and reports "no tests".
//
// POST /api/funnels/submit — telling the coach about a lead.
//
// 2026-10-06: the first real landing-page lead on production reached neither
// the coach's inbox nor the admin bell. The alert was a bare `void` promise,
// the Vercel instance froze as soon as the response went out, and when the
// next request thawed it 46 s later the Resend call failed with "Unable to
// fetch data". The bell had never been rung by this route at all. These tests
// pin both halves: the alert is handed to `after()` so the function stays
// alive until it settles, and the page's owners and coaches get a bell row.

import { describe, expect, it, vi, beforeEach } from "vitest"

const after = vi.fn()
const getPublishedFormConfig = vi.fn()
const sendNewFunnelLeadEmail = vi.fn()
const listBusinessMemberUserIds = vi.fn()
const insertedNotifications: unknown[] = []
const notificationsInsertError = { current: null as null | { code: string; message: string } }

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (...a: unknown[]) => after(...a),
}))
vi.mock("@/lib/db/funnels", () => ({
  getPublishedFormConfig: (...a: unknown[]) => getPublishedFormConfig(...a),
  createSubmission: vi.fn(async () => ({ id: "sub1" })),
  getFunnelById: vi.fn(async () => ({
    id: "f1",
    name: "Off-Season Speed Camp",
    status: "published",
    notify_emails: null,
  })),
  getStep: vi.fn(async () => ({ id: STEP_ID, funnel_id: FUNNEL_ID, slug: "signup", name: "Sign up" })),
  listSteps: vi.fn(async () => []),
}))
vi.mock("@/lib/funnels/capture-contact", () => ({ captureContactFromSubmission: vi.fn(async () => null) }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendNewFunnelLeadEmail: (...a: unknown[]) => sendNewFunnelLeadEmail(...a) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(async () => false) }))
vi.mock("@/lib/db/marketing-attribution", () => ({ getAttributionBySession: vi.fn(async () => null) }))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: () => null }))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn(async () => null) }))
vi.mock("@/lib/events/checkout", () => ({ createEventSignupCheckout: vi.fn() }))
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))
vi.mock("@/lib/db/business-members", () => ({
  LEAD_ALERT_ROLES: ["owner", "coach"],
  listBusinessMemberUserIds: (...a: unknown[]) => listBusinessMemberUserIds(...a),
}))
// `users` answers "already a lead" so upsertLead writes nothing; `notifications`
// records what the bell would have filed.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) =>
      table === "notifications"
        ? {
            insert: async (rows: unknown[]) => {
              insertedNotifications.push(...rows)
              return { error: notificationsInsertError.current }
            },
          }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "u1" }, error: null }) }) }) },
  }),
}))

import { POST } from "@/app/api/funnels/submit/route"

const FUNNEL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const STEP_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"

let ipCounter = 0
function request() {
  ipCounter += 1
  return new Request("http://t.test/api/funnels/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ipCounter}` },
    body: JSON.stringify({
      funnelId: FUNNEL_ID,
      stepId: STEP_ID,
      formKey: "signup",
      values: { parent_name: "Aean Audit", email: "aean@example.com" },
      elapsedMs: 9000,
    }),
  })
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Settles when everything handed to `after()` has, in either of its forms. */
function afterWork(): Promise<unknown[]> {
  return Promise.all(after.mock.calls.map(([task]) => (typeof task === "function" ? task() : task)))
}

beforeEach(() => {
  after.mockReset()
  getPublishedFormConfig.mockReset().mockResolvedValue({
    formKey: "signup",
    fields: [
      { name: "parent_name", label: "Your name", type: "text", role: "parent_name" },
      { name: "email", label: "Email", type: "email" },
    ],
  })
  sendNewFunnelLeadEmail.mockReset().mockResolvedValue(undefined)
  listBusinessMemberUserIds.mockReset().mockResolvedValue(["owner-1", "coach-1"])
  insertedNotifications.length = 0
  notificationsInsertError.current = null
})

describe("POST /api/funnels/submit — telling the coach", () => {
  it("keeps the function alive until the alert email has been sent", async () => {
    // MUTANT: going back to `void notifyCoachOfLead(...)` leaves nothing in
    // after(), so the work below "settles" while the send is still pending —
    // exactly the window in which production froze and lost the alert.
    let release!: () => void
    sendNewFunnelLeadEmail.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))

    const res = await POST(request())
    expect(res.status).toBe(200)

    let settled = false
    void afterWork().then(() => (settled = true))
    await flush()
    expect(sendNewFunnelLeadEmail).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)

    release()
    await flush()
    expect(settled).toBe(true)
  })

  it("rings the bell for this business's owners and coaches, linked to this page's leads", async () => {
    await POST(request())
    await afterWork()

    expect(listBusinessMemberUserIds).toHaveBeenCalledWith("host-biz", ["owner", "coach"])
    expect(insertedNotifications).toEqual(
      ["owner-1", "coach-1"].map((userId) => ({
        user_id: userId,
        type: "info",
        title: "New Lead — Aean Audit",
        message: "Page: Off-Season Speed Camp · Sign up\nEmail: aean@example.com",
        is_read: false,
        link: `/admin/funnels/leads?funnelId=${FUNNEL_ID}`,
      })),
    )
  })

  it("still sends the email when the bell cannot be rung", async () => {
    // MUTANT: dropping the bell's own try/catch lets this rejection skip the
    // email, trading the alert the coach was already getting for one they
    // were not.
    listBusinessMemberUserIds.mockRejectedValue(new Error("members read failed"))
    const res = await POST(request())
    await afterWork()

    expect(res.status).toBe(200)
    expect(sendNewFunnelLeadEmail).toHaveBeenCalledTimes(1)
  })

  it("still rings the bell when the email fails", async () => {
    // MUTANT: moving the bell after the email, without its own try, means a
    // Resend outage costs the coach both alerts.
    sendNewFunnelLeadEmail.mockRejectedValue(new Error("Failed to send new funnel lead email"))
    const res = await POST(request())
    await afterWork()

    expect(res.status).toBe(200)
    expect(insertedNotifications).toHaveLength(2)
  })
})
