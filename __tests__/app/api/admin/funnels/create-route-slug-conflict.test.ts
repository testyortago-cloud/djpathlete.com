// __tests__/app/api/admin/funnels/create-route-slug-conflict.test.ts
//
// WHOLE-BRANCH REVIEW ITEM 1: `createFunnel` throws `SlugTakenError` on a
// per-tenant slug collision (migration 00278's `funnels_business_id_slug_key`),
// with the message "The web address "<slug>" is already taken"
// (lib/db/businesses.ts). This route used to classify that error by matching
// "duplicate" or "unique" as a SUBSTRING of `error.message` — which worked
// against the OLD generic Postgres message but does not appear anywhere in
// `SlugTakenError`'s wording, so every duplicate-slug create fell through to
// the generic 500 instead of the 409 field error `CreateFunnelDialog` renders.
//
// Before per-tenant slugs, a coach reusing a slug got 409 "That slug is
// already in use." — this pins that it still does, now caught by TYPE
// (`instanceof SlugTakenError`) rather than by matching the exception's text.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  listFunnels: vi.fn(),
  createFunnel: vi.fn(),
}))
const { NoAccessibleBusinessError, QuizNotInBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {}
  class QuizNotInBusinessError extends Error {}
  return { NoAccessibleBusinessError, QuizNotInBusinessError }
})
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => Promise.resolve({ businessId: "bbb", choices: [], isOperator: true }),
  NoAccessibleBusinessError,
}))
vi.mock("@/lib/db/quizzes", () => ({
  createQuizFrom: vi.fn(),
  deleteQuiz: vi.fn(),
  getQuizDefinition: vi.fn(),
  assertQuizInBusiness: vi.fn(),
  QuizNotInBusinessError,
}))

import { POST } from "@/app/api/admin/funnels/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { createFunnel } from "@/lib/db/funnels"
import { SlugTakenError } from "@/lib/db/businesses"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const NO_PARAMS = { params: Promise.resolve({}) }

const BODY = {
  name: "Free Trial Week",
  slug: "free-trial-week",
  kind: "funnel" as const,
}

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3050/api/admin/funnels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
})

describe("POST /api/admin/funnels — duplicate slug", () => {
  it("answers 409 with a field error, not a 500, when createFunnel throws SlugTakenError", async () => {
    mock(createFunnel).mockRejectedValue(new SlugTakenError("free-trial-week"))

    const response = await POST(post(BODY) as never, NO_PARAMS as never)

    // MUTANT: classifying by `error.message.includes("duplicate" | "unique")`
    // instead of `instanceof SlugTakenError` — SlugTakenError's message
    // ("The web address ... is already taken") contains neither substring, so
    // that classification falls through to the 500 below.
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe("That slug is already in use.")
  })

  it("does not answer 500 for a plain SlugTakenError", async () => {
    mock(createFunnel).mockRejectedValue(new SlugTakenError("free-trial-week"))

    const response = await POST(post(BODY) as never, NO_PARAMS as never)

    expect(response.status).not.toBe(500)
  })

  it("still answers 500 for an unrelated failure — the 409 is not a blanket catch", async () => {
    mock(createFunnel).mockRejectedValue(new Error("connection reset"))

    const response = await POST(post(BODY) as never, NO_PARAMS as never)

    expect(response.status).toBe(500)
  })
})
