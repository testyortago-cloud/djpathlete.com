// __tests__/app/api/admin/funnels/create-route-audit.test.ts
//
// AUDIT §4 #12: `funnel.created` rows carried `target_id null` and
// `metadata {}` -- unlike PATCH/DELETE, this route has no `[id]` segment at
// all, so `ctx.params` could never have named a target even before this task.
// The created row's id, name, slug, kind and template only exist once
// `createFunnel` has run, which means they only exist in the RESPONSE this
// handler writes -- so that is what `withAudit`'s resolvers now read.
//
// `__tests__/api/funnels/create-quiz-funnel.test.ts` mocks `withAudit` itself
// as a passthrough (it is about the quiz orchestration, not the audit
// wrapper), so it cannot see this. This file uses the REAL `withAudit`.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  listFunnels: vi.fn(),
  createFunnel: vi.fn(),
}))
// vi.hoisted, not bare top-level classes: `vi.mock` factories are hoisted
// above every other top-level statement, so a plain class declaration
// referenced inside one throws "Cannot access before initialization".
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
import { recordAudit } from "@/lib/audit/record"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const NO_PARAMS = { params: Promise.resolve({}) }

const BODY = {
  name: "Free Trial Week",
  slug: "free-trial-week",
  kind: "funnel" as const,
  template: "leads" as const,
  steps: [
    { name: "Signup", slug: "index" },
    { name: "Thank you", slug: "thank-you" },
  ],
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
  mock(createFunnel).mockResolvedValue({
    id: "f1",
    slug: "free-trial-week",
    name: "Free Trial Week",
    kind: "funnel",
    template: "leads",
    entryStepId: "s1",
  })
})

describe("POST /api/admin/funnels — audit target/metadata", () => {
  it("records the created funnel as the audit target, with slug/kind/template as metadata", async () => {
    const response = await POST(post(BODY) as never, NO_PARAMS as never)
    expect(response.status).toBe(201)

    // MUTANT: options without `target` (or without `metadata`) on this route.
    // There is no `[id]` segment here, so dropping either loses the funnel
    // entirely -- unlike PATCH/DELETE, `ctx.params` was never a fallback.
    expect(mock(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: "funnel", id: "f1", label: "Free Trial Week" },
        metadata: { slug: "free-trial-week", kind: "funnel", template: "leads" },
      }),
    )
  })

  it("still lets the real caller read the created funnel back — the resolvers only see a clone", async () => {
    const response = await POST(post(BODY) as never, NO_PARAMS as never)
    const body = await response.json()
    expect(body.funnel.id).toBe("f1")
    expect(body.entryStepId).toBe("s1")
  })

  it("records no target when creation is refused before a funnel exists", async () => {
    // An invalid body (missing `name`) never reaches `createFunnel`; the error
    // body has no `funnel` key for the resolver to read an id from.
    const response = await POST(post({ slug: "x", kind: "funnel" }) as never, NO_PARAMS as never)
    expect(response.status).toBe(400)

    expect(mock(recordAudit)).toHaveBeenCalledWith(expect.objectContaining({ target: undefined }))
    expect(mock(createFunnel)).not.toHaveBeenCalled()
  })
})
