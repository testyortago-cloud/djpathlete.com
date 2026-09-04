// @vitest-environment node
//
// The 403 case is the one that matters. Calendly webhooks need a PAID plan
// (Standard, Teams or Enterprise); POST /webhook_subscriptions answers 403 on
// a Free account. That is the documented meaning of the `plan_lapsed` status
// 00240 put in the CHECK constraint, and the difference between a coach
// reading "webhooks need a paid Calendly plan" and reading "something went
// wrong".
import { describe, it, expect, vi } from "vitest"
import {
  fetchIdentity, listEventTypes, createWebhookSubscription, deleteWebhookSubscription,
  getWebhookSubscription,
  CalendlyAccountError, CalendlyPlanRequiredError,
} from "@/lib/calendly/account"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

describe("createWebhookSubscription", () => {
  it("raises CalendlyPlanRequiredError on 403 — a Free plan, not a generic failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ title: "Permission Denied" }), { status: 403 }))
    await expect(createWebhookSubscription({
      accessToken: "a", organizationUri: "https://api.calendly.com/organizations/O",
      userUri: "https://api.calendly.com/users/U", callbackUrl: "https://x/api/webhooks/calendly",
      signingKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(CalendlyPlanRequiredError)
  })

  it("subscribes to exactly invitee.created and invitee.canceled", async () => {
    let sent: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ resource: { uri: "https://api.calendly.com/webhook_subscriptions/W", state: "active" } }), { status: 201, headers: { "content-type": "application/json" } })
    })
    const out = await createWebhookSubscription({
      accessToken: "a", organizationUri: "https://api.calendly.com/organizations/O",
      userUri: "https://api.calendly.com/users/U", callbackUrl: "https://x/api/webhooks/calendly",
      signingKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sent.events).toEqual(["invitee.created", "invitee.canceled"])
    expect(sent.scope).toBe("user")
    expect(out.uri).toBe("https://api.calendly.com/webhook_subscriptions/W")
  })
})

/**
 * The screen renders this answer as "Calendly tells us as soon as someone
 * books", so the three outcomes have to stay three outcomes. Calendly disables
 * a subscription after 24 hours of failed deliveries WITHOUT changing its uri,
 * which is why the state stored at creation cannot be trusted to still be true.
 */
describe("getWebhookSubscription", () => {
  const WS = "https://api.calendly.com/webhook_subscriptions/W"
  const get = (fetchImpl: unknown) => getWebhookSubscription({ accessToken: "a", subscriptionUri: WS, fetchImpl: fetchImpl as typeof fetch })

  it("reads back the state Calendly holds NOW, not the one stored at creation", async () => {
    let calledUrl = ""
    let calledMethod: string | undefined
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calledUrl = url; calledMethod = init.method
      return ok({ resource: { uri: WS, state: "disabled" } })
    })
    expect(await get(fetchImpl)).toEqual({ uri: WS, state: "disabled" })
    // The uri IS the URL — Calendly's resource uris are absolute, so nothing is joined onto an apiBase.
    expect(calledUrl).toBe(WS)
    expect(calledMethod).toBe("GET")
  })

  it("a subscription Calendly no longer has (404) is null — an answer, not a failure", async () => {
    await expect(get(vi.fn(async () => new Response("", { status: 404 })))).resolves.toBeNull()
  })

  it("a 500 THROWS rather than reading as gone — 'could not look' is not 'not there'", async () => {
    await expect(get(vi.fn(async () => new Response("boom", { status: 500 })))).rejects.toBeInstanceOf(CalendlyAccountError)
  })

  it("an unexpected body throws rather than inventing a state", async () => {
    await expect(get(vi.fn(async () => ok({ resource: { uri: WS } })))).rejects.toMatchObject({ reason: "shape" })
  })

  it("tolerates fields Calendly adds — a new key is not a shape failure", async () => {
    const fetchImpl = vi.fn(async () => ok({ resource: { uri: WS, state: "active", retry_started_at: null }, extra: 1 }))
    expect(await get(fetchImpl)).toEqual({ uri: WS, state: "active" })
  })
})

describe("deleteWebhookSubscription", () => {
  it("treats a 404 as success — already gone is the desired end state", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }))
    await expect(deleteWebhookSubscription({ accessToken: "a", subscriptionUri: "https://api.calendly.com/webhook_subscriptions/W", fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toBeUndefined()
  })
})

describe("listEventTypes", () => {
  it("returns active event types with their public page and duration", async () => {
    const fetchImpl = vi.fn(async () => ok({ collection: [
      { uri: "https://api.calendly.com/event_types/E1", name: "Consult", duration: 30, scheduling_url: "https://calendly.com/c/consult", active: true },
    ] }))
    const types = await listEventTypes({ accessToken: "a", userUri: "https://api.calendly.com/users/U", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(types).toEqual([{ uri: "https://api.calendly.com/event_types/E1", name: "Consult", durationMinutes: 30, schedulingUrl: "https://calendly.com/c/consult", active: true }])
  })
})

describe("fetchIdentity", () => {
  it("reads uri, organization and scheduling page from GET /users/me", async () => {
    const fetchImpl = vi.fn(async () => ok({ resource: {
      uri: "https://api.calendly.com/users/U", name: "Coach", email: "coach@example.com",
      scheduling_url: "https://calendly.com/coach", current_organization: "https://api.calendly.com/organizations/O",
    } }))
    const me = await fetchIdentity({ accessToken: "a", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(me).toEqual({ uri: "https://api.calendly.com/users/U", name: "Coach", email: "coach@example.com", schedulingUrl: "https://calendly.com/coach", organizationUri: "https://api.calendly.com/organizations/O" })
  })
})
