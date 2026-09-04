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
  CalendlyPlanRequiredError,
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
