// __tests__/api/admin/sequences-enrol.test.ts
//
// POST /api/admin/sequences/enrol — the only surface in the whole app that
// puts a contact into a sequence on a human's say-so. Until it existed,
// `cold_lead_re_engagement` (seeded by migration 00218, whose own table
// records "No — no manual-enrol surface exists yet") could not be reached by
// anything but a script.
//
// The route is thin on purpose: auth, parse, loop, tally, respond. Every
// consequence of an enrolment — the active-sequence refusal, the duplicate-run
// guard, the one-per-contact-ever check — is `enrolContactManually`'s job
// (lib/lead-engine/enroll.ts) and is NOT reimplemented here, so these tests
// mock that function rather than a Supabase client and assert the CALLS and
// the TALLY.
//
// Four of these are not boilerplate:
//
//   * the 403. This endpoint causes EMAIL TO BE SENT TO REAL PEOPLE. It is
//     admin-only, not permission-tiered — staff are refused too.
//   * the batch cap. Uncapped, this is a request that dies mid-loop having
//     enrolled an unknowable number of people.
//   * the partial failure. One contact throwing must not abort the other
//     ninety-nine, and the ones that did work must be reported.
//   * the audit metadata. It carries counts and a sequence key and NOTHING
//     that identifies a person — same rule lib/lead-engine/unsubscribe.ts
//     states for its own row.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const enrolContactManuallyMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/lead-engine/enroll", () => ({
  enrolContactManually: (...a: unknown[]) => enrolContactManuallyMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

import { POST } from "@/app/api/admin/sequences/enrol/route"
import { MAX_ENROL_BATCH } from "@/lib/lead-engine/manual-enrol"

const ADMIN_SESSION = { user: { id: "admin-1", email: "coach@example.com", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }

function req(body: unknown) {
  return new Request("http://localhost/api/admin/sequences/enrol", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// This route has no dynamic segment, but withAudit's Handler type still
// requires a context arg (it is shared with [id] routes).
const NO_PARAMS = { params: Promise.resolve({}) }

const ids = (n: number) => Array.from({ length: n }, (_, i) => `contact-${i}`)

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: `clearAllMocks` leaves QUEUED
  // `mockRejectedValueOnce` implementations in place, so a rejection armed by
  // the partial-failure test below would leak into whichever test ran next and
  // misattribute the failure to it.
  vi.resetAllMocks()
  enrolContactManuallyMock.mockResolvedValue({ outcome: "enrolled" })
})

describe("POST /api/admin/sequences/enrol — the gate", () => {
  it("401s when there is no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req({ contactIds: ["c1"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(401)
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })

  it("403s for a client session", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await POST(req({ contactIds: ["c1"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })

  it("403s for staff too — this route sends email to real people, so it is admin-only", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    const res = await POST(req({ contactIds: ["c1"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sequences/enrol — the body", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("400s on an empty contact list, a missing key, or junk", async () => {
    for (const body of [{ sequenceKey: "k" }, { contactIds: [], sequenceKey: "k" }, { contactIds: ["c1"] }]) {
      const res = await POST(req(body) as never, NO_PARAMS)
      expect(res.status).toBe(400)
    }
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })

  it("400s on a body that is not JSON at all", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/sequences/enrol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(400)
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })

  it(`accepts exactly ${MAX_ENROL_BATCH} contacts and refuses ${MAX_ENROL_BATCH + 1} without enrolling ANY of them`, async () => {
    const atCap = await POST(req({ contactIds: ids(MAX_ENROL_BATCH), sequenceKey: "k" }) as never, NO_PARAMS)
    expect(atCap.status).toBe(200)
    expect(enrolContactManuallyMock).toHaveBeenCalledTimes(MAX_ENROL_BATCH)

    enrolContactManuallyMock.mockClear()
    const overCap = await POST(req({ contactIds: ids(MAX_ENROL_BATCH + 1), sequenceKey: "k" }) as never, NO_PARAMS)
    expect(overCap.status).toBe(400)
    // The whole batch is refused up front — NOT the first 100 enrolled and the
    // rest dropped, which would report success for a partial job.
    expect(enrolContactManuallyMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sequences/enrol — the work", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("calls enrolContactManually once per contact with the sequence key", async () => {
    const res = await POST(
      req({ contactIds: ["c1", "c2"], sequenceKey: "cold_lead_re_engagement" }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(200)
    expect(enrolContactManuallyMock).toHaveBeenCalledTimes(2)
    expect(enrolContactManuallyMock).toHaveBeenNthCalledWith(1, "c1", "cold_lead_re_engagement", {
      onePerContact: false,
    })
    expect(enrolContactManuallyMock).toHaveBeenNthCalledWith(2, "c2", "cold_lead_re_engagement", {
      onePerContact: false,
    })
  })

  it("passes onePerContact through when the caller asked for it", async () => {
    await POST(req({ contactIds: ["c1"], sequenceKey: "k", onePerContact: true }) as never, NO_PARAMS)
    expect(enrolContactManuallyMock).toHaveBeenCalledWith("c1", "k", { onePerContact: true })
  })

  it("returns a tally with one entry per outcome", async () => {
    enrolContactManuallyMock
      .mockResolvedValueOnce({ outcome: "enrolled" })
      .mockResolvedValueOnce({ outcome: "already_enrolled" })
      .mockResolvedValueOnce({ outcome: "already_enrolled_once" })
    const res = await POST(req({ contactIds: ["c1", "c2", "c3"], sequenceKey: "k" }) as never, NO_PARAMS)
    const json = await res.json()
    expect(json.tally).toEqual({
      enrolled: 1,
      already_enrolled: 1,
      already_enrolled_once: 1,
      sequence_not_found: 0,
      sequence_not_active: 0,
      failed: 0,
    })
  })

  it("sequence_not_active REACHES the caller, with the real status, instead of being swallowed", async () => {
    // The sequence this surface exists for ships `draft`, so this is the first
    // thing a real user hits. Collapsing it into a generic failure would send
    // them hunting for a bug that does not exist.
    enrolContactManuallyMock.mockResolvedValue({ outcome: "sequence_not_active", status: "draft" })
    const res = await POST(
      req({ contactIds: ["c1", "c2"], sequenceKey: "cold_lead_re_engagement" }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tally.sequence_not_active).toBe(2)
    expect(json.tally.enrolled).toBe(0)
    expect(json.sequenceStatus).toBe("draft")
  })

  it("a contact that THROWS does not abort the rest of the batch", async () => {
    enrolContactManuallyMock
      .mockResolvedValueOnce({ outcome: "enrolled" })
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({ outcome: "enrolled" })

    const res = await POST(req({ contactIds: ["c1", "c2", "c3"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(enrolContactManuallyMock).toHaveBeenCalledTimes(3)
    const json = await res.json()
    expect(json.tally.enrolled).toBe(2)
    expect(json.tally.failed).toBe(1)
  })

  it("LOGS the reason a contact failed, with the id, instead of swallowing it", async () => {
    // MUTANT: `} catch { tally.failed += 1 }` — no binding at all. The route
    // answered 200, the audit row said "success", and NOTHING anywhere held the
    // reason. A schema or RLS break would have looked exactly like a quiet
    // no-op.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      enrolContactManuallyMock
        .mockResolvedValueOnce({ outcome: "enrolled" })
        .mockRejectedValueOnce(new Error("connection reset"))

      await POST(req({ contactIds: ["c1", "c2"], sequenceKey: "k" }) as never, NO_PARAMS)

      expect(errorSpy).toHaveBeenCalled()
      const logged = errorSpy.mock.calls.map((args) => args.map((a) => String(a)).join(" ")).join(" | ")
      expect(logged).toContain("c2")
      expect(logged).toContain("connection reset")
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("hands back WHICH contacts failed, so the screen can re-tick exactly those", async () => {
    // MUTANT: returning counts only. "3 contacts could not be enrolled — try
    // those again" is an impossible instruction when nothing on the page says
    // which three. These ids are being returned to the admin who supplied them
    // one moment earlier, which is why they are safe HERE and still banned from
    // the audit row.
    enrolContactManuallyMock
      .mockResolvedValueOnce({ outcome: "enrolled" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ outcome: "enrolled" })
      .mockRejectedValueOnce(new Error("boom"))

    const res = await POST(req({ contactIds: ["c1", "c2", "c3", "c4"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.failedContactIds).toEqual(["c2", "c4"])
    expect(json.tally.failed).toBe(2)
  })

  it("answers a NON-2xx when the batch enrolled nobody and something threw", async () => {
    // MUTANT: `return NextResponse.json({...})` with no status. `withAudit`
    // classifies 200 as `outcome: "success"`, so a completely broken enrol path
    // — Supabase down, an RLS or schema break — wrote a hundred failures into
    // the audit trail as successes and the 24h-failure strip on
    // /admin/audit-logs never fired.
    enrolContactManuallyMock.mockRejectedValue(new Error("db down"))
    const res = await POST(req({ contactIds: ["c1", "c2"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBeGreaterThanOrEqual(500)

    // The tally still comes back, because the screen has something true to say
    // about it and "could not reach the server" is not it.
    const json = await res.json()
    expect(json.tally.failed).toBe(2)
    expect(json.failedContactIds).toEqual(["c1", "c2"])
  })

  it("a batch that enrolled SOMEBODY stays 200, even with failures in it", async () => {
    // The other half of the rule. A partial success is not a failed request:
    // people are in the sequence and will be emailed, and the failure count
    // rides along on the audit row.
    enrolContactManuallyMock.mockResolvedValueOnce({ outcome: "enrolled" }).mockRejectedValueOnce(new Error("boom"))
    const res = await POST(req({ contactIds: ["c1", "c2"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
  })

  it("a whole batch refused by a DRAFT sequence is not a server failure", async () => {
    // Nothing threw — the sequence simply is not switched on, which is the
    // FIRST thing a real user hits here. A 500 would call the product's own
    // seeded state an outage.
    enrolContactManuallyMock.mockResolvedValue({ outcome: "sequence_not_active", status: "draft" })
    const res = await POST(req({ contactIds: ["c1", "c2"], sequenceKey: "k" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
  })
})

describe("POST /api/admin/sequences/enrol — the audit row", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("records counts and the sequence key, and NO contact identifiers", async () => {
    enrolContactManuallyMock.mockResolvedValue({ outcome: "enrolled" })
    await POST(
      req({ contactIds: ["contact-aaa", "contact-bbb"], sequenceKey: "cold_lead_re_engagement" }) as never,
      NO_PARAMS,
    )

    expect(recordAuditMock).toHaveBeenCalled()
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as {
      action: string
      category: string
      outcome: string
      target?: { type: string; id: string }
      metadata?: Record<string, unknown>
    }
    expect(call.action).toBe("sequence.contacts_enrolled")
    expect(call.category).toBe("admin_write")
    expect(call.outcome).toBe("success")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead_re_engagement" })
    expect(call.metadata).toMatchObject({ sequence_key: "cold_lead_re_engagement", requested: 2, enrolled: 2 })

    // NO PII, and no contact ids either. The serialized row must not carry an
    // email, a phone number, or the list of people — counts answer "what
    // happened" without turning the audit trail into a second copy of the
    // contact table. Same rule lib/lead-engine/unsubscribe.ts states for its
    // own row.
    const serialized = JSON.stringify(call.metadata ?? {})
    expect(serialized).not.toContain("contact-aaa")
    expect(serialized).not.toContain("contact-bbb")
    expect(serialized).not.toContain("@")
  })

  it("records a FAILURE, not a success, when the whole batch threw", async () => {
    // MUTANT: 200 on a total failure. `classifyOutcome` in
    // lib/audit/with-audit.ts maps any 2xx to "success", so a hundred broken
    // enrolments landed in the audit trail looking like a hundred good ones and
    // the 24h-failure strip stayed quiet.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      enrolContactManuallyMock.mockRejectedValue(new Error("db down"))
      await POST(req({ contactIds: ["contact-aaa", "contact-bbb"], sequenceKey: "k" }) as never, NO_PARAMS)

      const call = recordAuditMock.mock.calls.at(-1)?.[0] as {
        outcome: string
        metadata?: Record<string, unknown>
      }
      expect(call.outcome).toBe("failure")
      // The row still says how big the damage was.
      expect(call.metadata).toMatchObject({ requested: 2, failed: 2, enrolled: 0 })
      // …and STILL names nobody, even though the response body now carries the
      // failed ids for the screen to re-tick.
      const serialized = JSON.stringify(call.metadata ?? {})
      expect(serialized).not.toContain("contact-aaa")
      expect(serialized).not.toContain("contact-bbb")
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("keeps failedContactIds out of the audit metadata on a partial failure too", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      enrolContactManuallyMock.mockResolvedValueOnce({ outcome: "enrolled" }).mockRejectedValueOnce(new Error("boom"))
      await POST(req({ contactIds: ["contact-aaa", "contact-bbb"], sequenceKey: "k" }) as never, NO_PARAMS)

      const call = recordAuditMock.mock.calls.at(-1)?.[0] as { outcome: string; metadata?: Record<string, unknown> }
      expect(call.outcome).toBe("success")
      expect(call.metadata).toMatchObject({ failed: 1, enrolled: 1 })
      expect(JSON.stringify(call.metadata ?? {})).not.toContain("contact-bbb")
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("records a denied outcome for a non-admin without naming anyone", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    await POST(req({ contactIds: ["contact-aaa"], sequenceKey: "k" }) as never, NO_PARAMS)
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as { outcome: string; metadata?: Record<string, unknown> }
    expect(call.outcome).toBe("denied")
    expect(JSON.stringify(call.metadata ?? {})).not.toContain("contact-aaa")
  })
})
