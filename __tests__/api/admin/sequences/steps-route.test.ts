// @vitest-environment node
// __tests__/api/admin/sequences/steps-route.test.ts
//
// PUT /api/admin/sequences/[key]/steps — saving a sequence's whole step list.
// Mocks lib/db/sequence-admin, so these assert calls and responses rather
// than a real database — `validateStepList`/`planStepSave` (the pure
// lib/lead-engine/step-list.ts) run for real, unmocked, because they are the
// business rules this route exists to enforce.
//
// Ruling 3's dual guard gets two tests that each neutralise the OTHER guard:
//   - "the route's own 409 fires without reaching the database" — the DAL's
//     saveSequenceSteps is a spy that must never be called.
//   - "the DAL surfaces the plpgsql error when the route's own check is
//     bypassed" — simulated by a fixture where the route's own guard sees
//     nothing to refuse (sentCountByStepId reports 0), but the mocked RPC
//     throws anyway, as the real plpgsql would if some other caller reached
//     it. The write must fail rather than silently succeed.

import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const loadSequenceForEditMock = vi.fn()
const saveSequenceStepsMock = vi.fn()
const recordAuditMock = vi.fn()
const resolveTenantMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/sequence-admin", () => ({
  loadSequenceForEdit: (...a: unknown[]) => loadSequenceForEditMock(...a),
  saveSequenceSteps: (...a: unknown[]) => saveSequenceStepsMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { PUT } from "@/app/api/admin/sequences/[key]/steps/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import type { SequenceForEdit } from "@/lib/db/sequence-admin"
import type { StepDraft } from "@/lib/lead-engine/step-list"

const BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

const ADMIN_SESSION = { user: { id: "admin-1", email: "coach@example.com", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: { contacts: true } } }

function req(body: unknown) {
  return new Request("http://localhost/api/admin/sequences/cold_lead/steps", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function ctx(key = "cold_lead") {
  return { params: Promise.resolve({ key }) }
}

const EMAIL_STEP = (id: string | null, extra: Partial<StepDraft> = {}): StepDraft => ({
  id,
  kind: "email",
  wait_minutes: null,
  subject: "Hello",
  body: "World",
  branch_condition: null,
  on_true_position: null,
  on_false_position: null,
  config: {},
  ...extra,
})

function sequenceFixture(overrides: Partial<SequenceForEdit> = {}): SequenceForEdit {
  return {
    id: "seq-1",
    key: "cold_lead",
    name: "Cold Lead",
    status: "active",
    steps: [{ id: "step-1", position: 0 }],
    drafts: [EMAIL_STEP("step-1")],
    sentCountByStepId: {},
    activeRuns: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: true })
  loadSequenceForEditMock.mockResolvedValue(sequenceFixture())
  saveSequenceStepsMock.mockResolvedValue(undefined)
})

describe("PUT /api/admin/sequences/[key]/steps — the gate", () => {
  it("401s when there is no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx())
    expect(res.status).toBe(401)
    expect(loadSequenceForEditMock).not.toHaveBeenCalled()
  })

  it("403s for a client session", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx())
    expect(res.status).toBe(403)
    expect(loadSequenceForEditMock).not.toHaveBeenCalled()
  })

  it("403s for staff too — editing what a sequence sends is admin-only, not permission-tiered", async () => {
    // MUTANT: removing `session.user.role !== "admin"`. Staff carrying the
    // `contacts` permission (enough to VIEW /admin/sequences) must still be
    // refused here.
    authMock.mockResolvedValue(STAFF_SESSION)
    const res = await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx())
    expect(res.status).toBe(403)
    expect(loadSequenceForEditMock).not.toHaveBeenCalled()
  })

  it("403s, saving nothing, when the caller has no accessible business", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx())
    expect(res.status).toBe(403)
    expect(loadSequenceForEditMock).not.toHaveBeenCalled()
  })
})

describe("PUT /api/admin/sequences/[key]/steps — the body", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("400s on a shape Zod rejects, before ever loading the sequence", async () => {
    const res = await PUT(req({ steps: [{ id: "step-1", kind: "not-a-real-kind" }] }) as never, ctx())
    expect(res.status).toBe(400)
    expect(loadSequenceForEditMock).not.toHaveBeenCalled()
  })

  it("400s on a body that is not JSON at all", async () => {
    const res = await PUT(
      new Request("http://localhost/api/admin/sequences/cold_lead/steps", { method: "PUT", body: "not json" }) as never,
      ctx(),
    )
    expect(res.status).toBe(400)
    expect(loadSequenceForEditMock).not.toHaveBeenCalled()
  })
})

describe("PUT /api/admin/sequences/[key]/steps — tenancy", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("loads under the RESOLVED tenant and the URL's key, not a value from the body", async () => {
    await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx("cold_lead"))
    expect(loadSequenceForEditMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead")
  })

  it("404s for another tenant's key, when loadSequenceForEdit returns null, and never validates or saves", async () => {
    loadSequenceForEditMock.mockResolvedValue(null)
    const res = await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx("someone-elses-key"))
    expect(res.status).toBe(404)
    expect(saveSequenceStepsMock).not.toHaveBeenCalled()
  })
})

describe("PUT /api/admin/sequences/[key]/steps — the route validates, it does not trust the browser", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("400s with the problems list when validateStepList finds something wrong, and never saves", async () => {
    // An email step with no subject and no body — validateStepList's real,
    // unmocked rule.
    const res = await PUT(
      req({ steps: [{ ...EMAIL_STEP("step-1"), subject: "", body: "" }] }) as never,
      ctx(),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(Array.isArray(json.problems)).toBe(true)
    expect(json.problems.length).toBeGreaterThan(0)
    expect(saveSequenceStepsMock).not.toHaveBeenCalled()
  })

  it("400s on a branch whose arm falls into the other side — the fall-through validateStepList exists to catch", async () => {
    // MUTANT: the route ignoring `problems` (e.g. `if (false)`).
    //
    // position 0: branch, true -> 1, false -> 2
    // position 1: wait, no stop of its own — advances to position+1 (= 2)
    // position 2: stop — the FALSE arm's own entry
    //
    // The true arm (starting at 1) has no ending of its own and runs straight
    // into the false arm's entry position — the exact "both endings" defect
    // §4.4 of the design doc exists to catch.
    const steps = [
      {
        id: null,
        kind: "branch",
        wait_minutes: null,
        subject: null,
        body: null,
        branch_condition: { kind: "has_phone" },
        on_true_position: 1,
        on_false_position: 2,
        config: {},
      },
      {
        id: null,
        kind: "wait",
        wait_minutes: 5,
        subject: null,
        body: null,
        branch_condition: null,
        on_true_position: null,
        on_false_position: null,
        config: {},
      },
      {
        id: null,
        kind: "stop",
        wait_minutes: null,
        subject: null,
        body: null,
        branch_condition: null,
        on_true_position: null,
        on_false_position: null,
        config: {},
      },
    ]
    const res = await PUT(req({ steps }) as never, ctx())
    expect(res.status).toBe(400)
    expect(saveSequenceStepsMock).not.toHaveBeenCalled()
  })
})

describe("PUT /api/admin/sequences/[key]/steps — §4.6 the step-removal guard (Ruling 3)", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("409s naming the sent count, WITHOUT ever calling saveSequenceSteps — the route's own guard, independent of the database", async () => {
    // The plpgsql guard is disabled here in spirit: saveSequenceSteps is a
    // bare spy that would happily resolve if called. This test proves the
    // 409 comes from the ROUTE's own check, not from the RPC.
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        sentCountByStepId: { "step-1": 12 },
      }),
    )
    // New list removes step-1 entirely.
    const res = await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain("12")
    expect(json.error).toContain("cannot be removed")
    expect(saveSequenceStepsMock).not.toHaveBeenCalled()
  })

  it("does NOT refuse removing a step that has never sent anything", async () => {
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        sentCountByStepId: {}, // step-1 absent -> undefined > 0 -> false
      }),
    )
    const res = await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx())
    expect(res.status).toBe(200)
    expect(saveSequenceStepsMock).toHaveBeenCalled()
  })

  it("does NOT refuse keeping a step that HAS sent messages — only removal is refused", async () => {
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        sentCountByStepId: { "step-1": 5 },
      }),
    )
    // step-1 is kept (same id), only its copy changes.
    const res = await PUT(req({ steps: [EMAIL_STEP("step-1", { subject: "Edited" })] }) as never, ctx())
    expect(res.status).toBe(200)
    expect(saveSequenceStepsMock).toHaveBeenCalled()
  })

  it("refuses at exactly 1 sent message — MUTANT: loosening `> 0` to `> 1` on the sent-count guard", async () => {
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        sentCountByStepId: { "step-1": 1 },
      }),
    )
    const res = await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx())
    expect(res.status).toBe(409)
    expect(saveSequenceStepsMock).not.toHaveBeenCalled()
  })

  it("sums sent counts across multiple removed steps into one sentence", async () => {
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [
          { id: "step-1", position: 0 },
          { id: "step-2", position: 1 },
        ],
        sentCountByStepId: { "step-1": 3, "step-2": 4 },
      }),
    )
    const res = await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain("7")
  })

  it("the DAL surfaces the plpgsql's own refusal when the route's own check is bypassed (nothing to refuse locally)", async () => {
    // The route's own guard sees ZERO sent messages for the removed step —
    // i.e. it would NOT refuse on its own. This simulates the route's check
    // having been weakened or skipped; the plpgsql function (migration
    // 00256) is the backstop, and here it is simulated by a rejecting mock.
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        sentCountByStepId: {}, // route sees nothing to refuse
      }),
    )
    saveSequenceStepsMock.mockRejectedValue(
      new Error("refusing to remove a step that has already sent 3 message(s)"),
    )
    const res = await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx())
    // The write must NOT silently succeed just because the route's own guard
    // stayed quiet — the DAL's rejection must still fail the request.
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(saveSequenceStepsMock).toHaveBeenCalled()
  })
})

describe("PUT /api/admin/sequences/[key]/steps — the save and the plan", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("saves via saveSequenceSteps with the sequence id, the new steps, and the computed plan", async () => {
    const activeRun = { id: "run-1", current_position: 0 }
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        id: "seq-42",
        steps: [{ id: "step-1", position: 0 }],
        activeRuns: [activeRun],
      }),
    )
    const newSteps = [EMAIL_STEP("step-1"), EMAIL_STEP(null)]
    await PUT(req({ steps: newSteps }) as never, ctx())

    expect(saveSequenceStepsMock).toHaveBeenCalledTimes(1)
    const [calledBusinessId, calledSequenceId, calledSteps, calledPlan] = saveSequenceStepsMock.mock.calls[0]
    expect(calledBusinessId).toBe(BUSINESS_ID)
    expect(calledSequenceId).toBe("seq-42")
    expect(calledSteps).toEqual(newSteps)
    // step-1 stays at position 0 in both lists -> unchanged, not repointed.
    expect(calledPlan).toEqual({ repoint: [], exit: [], unchanged: ["run-1"] })
  })

  it("responds with the plan so the screen can say what happened to people partway through", async () => {
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        activeRuns: [{ id: "run-1", current_position: 0 }],
      }),
    )
    // Removing step-1 (never sent) exits the run pointing at it.
    const res = await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.exited).toBe(1)
    expect(json.repointed).toBe(0)
    expect(json.stepCount).toBe(1)
    expect(json.plan.exit).toEqual([{ runId: "run-1", from: 0 }])
  })
})

describe("PUT /api/admin/sequences/[key]/steps — the audit row", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("records the key and counts only — MUTANT: including a contact id must fail this test", async () => {
    loadSequenceForEditMock.mockResolvedValue(
      sequenceFixture({
        steps: [{ id: "step-1", position: 0 }],
        activeRuns: [{ id: "run-1", current_position: 0 }],
      }),
    )
    await PUT(req({ steps: [EMAIL_STEP(null)] }) as never, ctx("cold_lead"))

    const call = recordAuditMock.mock.calls.at(-1)?.[0] as {
      action: string
      category: string
      outcome: string
      target?: { type: string; id: string }
      metadata?: Record<string, unknown>
    }
    expect(call.action).toBe("sequence.steps_edited")
    expect(call.category).toBe("admin_write")
    expect(call.outcome).toBe("success")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead" })
    // Exact equality — a mutation that spreads the full response body (which
    // carries `plan.exit`/`plan.repoint`, i.e. run ids) into metadata, or
    // that adds a contact id, must fail this.
    expect(call.metadata).toEqual({ sequence_key: "cold_lead", step_count: 1, repointed: 0, exited: 1 })
    const serialized = JSON.stringify(call.metadata ?? {})
    expect(serialized).not.toContain("run-1")
    expect(serialized).not.toContain("contact")
  })

  it("records a denied outcome for a non-admin, naming nobody", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    await PUT(req({ steps: [EMAIL_STEP("step-1")] }) as never, ctx("cold_lead"))
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as { outcome: string; target?: unknown }
    expect(call.outcome).toBe("denied")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead" })
  })
})
