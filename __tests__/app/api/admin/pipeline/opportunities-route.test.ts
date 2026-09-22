// @vitest-environment node
//
// __tests__/app/api/admin/pipeline/opportunities-route.test.ts
//
// G29 Task 6. POST /api/admin/pipeline/opportunities — a coach putting a
// person on a board BY HAND. Same permission/tenant shape as every other
// route in this directory (auth -> 401, canAccessAdminPath -> 403,
// resolveAdminTenantForRequest -> 403, PipelineBoardNotFoundError -> 404).
//
// UNLIKE the sibling test files in this directory, `@/lib/db/pipeline` and
// `@/lib/db/contacts` are NOT mocked here. The whole point of this task is
// that `createOpportunityManually` structurally never calls
// `recordContactEvent` (the one function that calls `enrollIfTriggered`) —
// proving that requires the REAL DAL code to run, against an in-memory
// Supabase fake, with only `enrollIfTriggered` itself replaced by a spy.
// Mocking `@/lib/db/pipeline` the way stages-route.test.ts does would make
// the enrolment test vacuously true (the route never imports
// `enrollIfTriggered` directly either way) and prove nothing about the DAL.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const resolveTenantMock = vi.fn()
const recordAuditMock = vi.fn()
// `vi.hoisted`, not a plain `const` — the `@/lib/lead-engine/enroll` factory
// below references `enrollIfTriggered` BY VALUE in an object literal (not
// inside a lazily-invoked closure, the way `canAccessMock` etc. are used
// above), so it is evaluated the moment the factory runs. `vi.mock` calls are
// hoisted above every top-level statement including `const` initializers, so
// a plain `const enrollIfTriggered = vi.fn()` here would still be in its
// temporal dead zone when the factory executes. `vi.hoisted` runs its
// callback in that same hoisted position, ahead of the TDZ.
const { enrollIfTriggered } = vi.hoisted(() => ({ enrollIfTriggered: vi.fn() }))

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

// Declared INSIDE the factory and imported back below — vi.mock is hoisted,
// so a top-level class referenced from the factory would still be in its
// temporal dead zone when the factory runs (that failure reports as "no
// tests", indistinguishable from a passing run). Same convention as every
// sibling test file in this directory.
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

// THE ONE THING THIS TEST FILE MUST GET RIGHT. Only `enrollIfTriggered` is
// replaced — `importOriginal` re-exports everything else (IS_SUPERSEDING_SOURCE,
// enrolContactManually, ...) untouched, so `lib/db/contacts.ts`'s real
// `recordContactEvent` (used only by the control test below) still resolves
// its other imports normally.
vi.mock("@/lib/lead-engine/enroll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-engine/enroll")>()),
  enrollIfTriggered,
}))

// ---------------------------------------------------------------------------
// In-memory Supabase fake. Every table `createOpportunityManually` and its
// non-enrolling identity helpers (`upsertContactIdentity`,
// `recordEventForExistingContact`) touch: contacts, contact_timeline_events,
// users (resolveLinkableUserId's email lookup), pipelines, pipeline_stages,
// opportunities, opportunity_stage_events. Same query-builder shape as
// __tests__/lib/lead-engine/import.test.ts's `makeTable`: chained .eq()/.is()
// calls filter a backing array, and the whole builder is awaited directly
// (real PostgREST chaining) when no terminal .maybeSingle()/.single() is
// called.
// ---------------------------------------------------------------------------

type Row = Record<string, any>

let state: Record<string, Row[]>
let idCounter: number
/**
 * Forces the NEXT `opportunities` insert to fail with 23505, regardless of
 * what the pre-check read saw — simulating the concurrent writer that landed
 * between this request's own pre-check and its insert. Also materialises the
 * "winning" row so the post-conflict re-read (`throwOpenCardExistsError`)
 * finds something real to name, exactly as a fresh read against real
 * Postgres would after losing the race.
 */
let forcedOpportunityConflict: { stageId: string } | null
/**
 * Every INSERT this request ATTEMPTED, by table — not every insert that
 * landed.
 *
 * The pre-check and the unique index produce the identical message, so the
 * store alone cannot tell which of the two refused a duplicate: drop the
 * pre-check's own `throw` and the insert simply falls through to the index,
 * which answers the same sentence. The one observable difference is whether
 * an insert was attempted at all — and "the ordinary, non-concurrent case
 * answers in English instead of reaching a 23505" is exactly what the
 * pre-check is for.
 */
let insertAttempts: Record<string, number>

function resetState() {
  state = {
    contacts: [],
    contact_timeline_events: [],
    users: [],
    pipelines: [],
    pipeline_stages: [],
    opportunities: [],
    opportunity_stage_events: [],
  }
  idCounter = 0
  forcedOpportunityConflict = null
  insertAttempts = {}
}

function nextId(table: string): string {
  idCounter += 1
  return `${table}-${idCounter}`
}

function rowsFor(table: string): Row[] {
  if (!state[table]) state[table] = []
  return state[table]
}

function makeTable(table: string) {
  const predicates: Array<(row: Row) => boolean> = []

  function filterRows(): Row[] {
    return rowsFor(table).filter((row) => predicates.every((p) => p(row)))
  }

  const api: any = {
    select() {
      return api
    },
    eq(field: string, value: any) {
      predicates.push((row) => row[field] === value)
      return api
    },
    is(field: string, value: null) {
      predicates.push((row) => row[field] == null)
      return api
    },
    order() {
      return api
    },
    limit() {
      return api
    },
    async maybeSingle() {
      const rows = filterRows()
      if (rows.length > 1) throw new Error(`makeTable(${table}).maybeSingle(): more than one row matched`)
      return { data: rows[0] ?? null, error: null }
    },
    // Real PostgREST chaining — a query with no terminal method is itself
    // awaited, returning every matching row.
    async then(resolve: any) {
      return resolve({ data: filterRows(), error: null })
    },
    insert(payload: any) {
      insertAttempts[table] = (insertAttempts[table] ?? 0) + 1
      let row: Row | null = null
      let error: { code: string; message: string } | null = null

      if (table === "opportunities" && forcedOpportunityConflict) {
        // The race: this request's own insert loses to a concurrent writer.
        // Materialise the winner so the post-conflict re-read finds it.
        error = {
          code: "23505",
          message: 'duplicate key value violates unique constraint "opportunities_one_open_per_contact_pipeline"',
        }
        rowsFor(table).push({
          id: nextId(table),
          created_at: new Date().toISOString(),
          ...payload,
          stage_id: forcedOpportunityConflict.stageId,
          outcome: null,
        })
        forcedOpportunityConflict = null
      } else if (table === "opportunities" && payload.outcome == null) {
        // The ordinary (non-forced) duplicate: a row already sits in state
        // matching (contact_id, pipeline_id) with outcome null — mirrors
        // `opportunities_one_open_per_contact_pipeline`'s own predicate.
        const dup = rowsFor(table).find(
          (r) => r.contact_id === payload.contact_id && r.pipeline_id === payload.pipeline_id && r.outcome == null,
        )
        if (dup) {
          error = {
            code: "23505",
            message: 'duplicate key value violates unique constraint "opportunities_one_open_per_contact_pipeline"',
          }
        }
      }

      if (!error) {
        const created: Row = { id: nextId(table), created_at: new Date().toISOString(), ...payload }
        row = created
        rowsFor(table).push(created)
      }

      const result = { data: row, error }
      return {
        ...result,
        select: () => ({ single: async () => result }),
      }
    },
    update(patch: any) {
      return {
        eq: async (field: string, value: any) => {
          const rows = rowsFor(table)
          for (let i = 0; i < rows.length; i++) {
            if (rows[i][field] === value) rows[i] = { ...rows[i], ...patch }
          }
          return { data: null, error: null }
        },
      }
    },
  }
  return api
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => makeTable(table),
    rpc: async () => ({ data: null, error: null }),
  }),
}))

import { POST } from "@/app/api/admin/pipeline/opportunities/route"
import { CARD_FILED_TIMELINE_KIND, CONTACT_ACTIVITY_KINDS } from "@/lib/lead-engine/pipeline-move"
// G29 Task 8, fix round 1. The dialog restates two of THIS route's decisions —
// the either/or sentence and the name cap — and nothing held the pair
// together. This is not hypothetical drift: `lib/db/pipeline.ts`'s refusal for
// the identical condition already says a THIRD, different sentence ("…before
// filing them."), so "they match today" proves nothing about tomorrow.
//
// Pinned from THIS side, the side that actually refuses, and by DRIVING the
// route rather than reading its source — a source grep would pass on a
// sentence buried in a comment. The import is of two plain constants; the
// component is a "use client" module but has no import-time DOM access, so a
// node-env suite loads it fine.
import { MAX_NAME_LENGTH, NEEDS_A_WAY_TO_REACH_THEM } from "@/components/admin/new-card-dialog"

const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }
const COACH_SESSION = { user: { id: "coach-1", role: "staff", permissions: { contacts: true } } }

/** The coach's own tenant — deliberately NOT the singleton. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
/** A DIFFERENT tenant — models "this board belongs to someone else". */
const OTHER_BUSINESS_ID = "33333333-3333-3333-3333-333333333333"

const BOARD_ID = "board-coaching"
const BOARD_NAME = "Coaching"

const STAGE_ENQUIRED = { id: "stage-enquired", key: "enquired", name: "Enquired", position: 1, kind: "open" }
const STAGE_CONSULTED = { id: "stage-consulted", key: "consulted", name: "Consulted", position: 2, kind: "open" }
const STAGE_WON = { id: "stage-won", key: "won", name: "Won", position: 3, kind: "won" }
const STAGE_LOST = { id: "stage-lost", key: "lost", name: "Lost", position: 4, kind: "lost" }

const DANA_ID = "contact-dana"
const DANA_EMAIL = "dana@example.com"

function seedBoard() {
  // `status` is seeded because `readBoardRow` now READS it: `pipelines.status`
  // is `'active' | 'archived'` NOT NULL DEFAULT 'active' (00219), so a fixture
  // that omitted it would leave every board `undefined` here and the archive
  // guard unfalsifiable. The archive test below flips this one column on the
  // seeded row rather than re-seeding: `seedBoard` pushes the four stages too,
  // and calling it twice would leave two rows at position 1, which
  // `.maybeSingle()` refuses.
  state.pipelines.push({ id: BOARD_ID, business_id: BUSINESS_ID, key: "coaching", name: BOARD_NAME, status: "active" })
  for (const stage of [STAGE_ENQUIRED, STAGE_CONSULTED, STAGE_WON, STAGE_LOST]) {
    state.pipeline_stages.push({ ...stage, business_id: BUSINESS_ID, pipeline_id: BOARD_ID })
  }
}

/**
 * Dana, already on file, at THE SAME ADDRESS the `person` tests below post.
 *
 * It used to be `dana-existing@example.com` while every `person` POST said
 * `dana@example.com`, so `upsertContactIdentity`'s MATCH branch never ran in
 * this file and search-or-create — the spec's own words, "a typo'd repeat
 * resolves to the existing contact instead of quietly becoming a second Dana
 * Reyes" — was never exercised at all.
 */
function seedDana() {
  state.contacts.push({
    id: DANA_ID,
    business_id: BUSINESS_ID,
    name: "Dana Reyes",
    email: DANA_EMAIL,
    phone_e164: null,
    created_at: "2020-01-01T00:00:00Z",
  })
}

function requestFor(body: unknown) {
  return new Request("https://www.darrenjpaul.com/api/admin/pipeline/opportunities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const NO_PARAMS = { params: Promise.resolve({}) }

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left
  // over from a previous test leaks across the boundary and misattributes
  // failures (this repo's own lesson).
  vi.resetAllMocks()
  authMock.mockResolvedValue(COACH_SESSION)
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  recordAuditMock.mockResolvedValue(undefined)
  resetState()
  seedBoard()
})

describe("POST /api/admin/pipeline/opportunities", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(401)
    expect(state.opportunities).toHaveLength(0)
  })

  it("403s a staff member without `contacts`", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(state.opportunities).toHaveLength(0)
  })

  it("403s when the caller resolves to no business at all", async () => {
    const { NoAccessibleBusinessError } = await import("@/lib/tenancy/resolve")
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(state.opportunities).toHaveLength(0)
  })

  it("400s (not found) when contactId belongs to a DIFFERENT tenant, rather than filing a foreign contact onto this board", async () => {
    state.contacts.push({
      id: "contact-other-tenant",
      business_id: OTHER_BUSINESS_ID,
      name: "Someone Else's Client",
      email: "foreign@example.com",
      phone_e164: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: "contact-other-tenant" }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Contact contact-other-tenant was not found for this business.")
    expect(state.opportunities).toHaveLength(0)
  })

  it("404s a board id that does not exist for this tenant, with the sibling routes' exact message", async () => {
    const res = await POST(requestFor({ pipelineId: "no-such-board", contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Board no-such-board was not found for this business.")
  })

  it("404s a board belonging to a different tenant, same status and message as the nonexistent case", async () => {
    resolveTenantMock.mockResolvedValueOnce({ businessId: OTHER_BUSINESS_ID, choices: [], isOperator: false })
    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe(`Board ${BOARD_ID} was not found for this business.`)
  })

  it("400s a body with neither contactId nor person", async () => {
    const res = await POST(requestFor({ pipelineId: BOARD_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    expect(state.opportunities).toHaveLength(0)
  })

  it("400s a person with neither email nor phone", async () => {
    const res = await POST(
      requestFor({ pipelineId: BOARD_ID, person: { name: "No Contact Info" } }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email or phone/i)
    expect(state.contacts).toHaveLength(0)
  })

  it("refuses a person with no email and no phone in the EXACT words the dialog shows", async () => {
    // The pair, pinned. The loose `/email or phone/i` above would survive the
    // route rewording to lib/db/pipeline.ts's variant, which the dialog does
    // NOT say — and a coach would then read one sentence in the browser and a
    // different one when the browser's own check was bypassed.
    const res = await POST(
      requestFor({ pipelineId: BOARD_ID, person: { name: "No Contact Info" } }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(NEEDS_A_WAY_TO_REACH_THEM)
  })

  it("refuses a name one character past the cap the dialog enforces, and accepts one exactly on it", async () => {
    // Boundary AND message, from the imported constant rather than a retyped
    // 200 — a cap pinned only by the number it happens to have is a cap that
    // can drift on one side and still read as agreement.
    const tooLong = await POST(
      requestFor({
        pipelineId: BOARD_ID,
        person: { name: "x".repeat(MAX_NAME_LENGTH + 1), email: "over@example.com" },
      }) as never,
      NO_PARAMS,
    )
    expect(tooLong.status).toBe(400)
    const body = await tooLong.json()
    expect(body.error).toBe(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`)
    expect(body.field).toBe("person.name")
    expect(state.contacts).toHaveLength(0)

    // The presence control: without it, a route that refused EVERY name would
    // pass the assertion above.
    const onTheCap = await POST(
      requestFor({
        pipelineId: BOARD_ID,
        person: { name: "y".repeat(MAX_NAME_LENGTH), email: "exact@example.com" },
      }) as never,
      NO_PARAMS,
    )
    expect(onTheCap.status).toBe(200)
  })

  // -------------------------------------------------------------------------
  // A MISTYPED IDENTIFIER (whole-branch review, Important 4).
  //
  // Nothing anywhere exercised a malformed one. The route's Zod required only
  // `.min(1)`, the DAL's friendly pre-check tested raw truthiness, and
  // `upsertContactIdentity` normalises BEFORE it checks — so `dana@gmail`
  // with no phone reached its internal throw and the coach read
  // "upsertContactIdentity needs at least one usable identifier (email or
  // phone)" in the dialog, and again in a toast.
  //
  // Task 8's `noValidate` on the form removed the browser's own check too, so
  // a string with no `@` at all now reaches the server.
  // -------------------------------------------------------------------------

  describe("an email the server cannot use", () => {
    /** The sentence a coach must never see. */
    const INTERNAL = "upsertContactIdentity"

    it("400s an address with no top-level domain, quoting it back, with no internal function name", async () => {
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: "dana@gmail" } }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe(
        '"dana@gmail" does not look like an email address. Check the spelling, or give another way to reach this person.',
      )
      expect(body.error).not.toContain(INTERNAL)
      // And nothing was written on the way to the refusal.
      expect(state.contacts).toHaveLength(0)
      expect(state.opportunities).toHaveLength(0)
    })

    it("400s a string with no @ at all — the case `noValidate` let through", async () => {
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: "danareyes" } }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('"danareyes" does not look like an email address.')
      expect(state.contacts).toHaveLength(0)
    })

    it("names BOTH when an unusable email and an unusable phone were typed", async () => {
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: "dana@gmail", phone: "555" } }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe(
        '"dana@gmail" does not look like an email address. "555" does not look like a phone number. ' +
          "Check the spelling, or give another way to reach this person.",
      )
    })

    // THE PRESENCE CONTROL. Without it, a route that refused EVERY typed
    // person would pass all three tests above.
    it("control: the same request with a usable address is accepted", async () => {
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: "dana@example.com" } }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(200)
      expect(state.contacts).toHaveLength(1)
      expect(state.opportunities).toHaveLength(1)
    })

    // The second control, in the other direction: ONE usable identifier is
    // enough, so a junk phone alongside a good email must not refuse. The
    // guard is "nothing usable at all", not "everything usable".
    it("control: a usable email with an unusable phone is still accepted", async () => {
      const res = await POST(
        requestFor({
          pipelineId: BOARD_ID,
          person: { name: "Dana Reyes", email: "dana@example.com", phone: "555" },
        }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(200)
      expect(state.opportunities).toHaveLength(1)
    })

    // A usable PHONE with no email at all — the other half of "at least one".
    it("control: a usable phone on its own is accepted", async () => {
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", phone: "+12025550188" } }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(200)
      expect(state.opportunities).toHaveLength(1)
    })
  })

  // Whole-branch review, small item 4. `valueCents` is accepted but no dialog
  // writes it; `opportunities.value_cents` is int4, so a large integer used to
  // reach the INSERT and come back as Postgres' raw 22003.
  describe("valueCents", () => {
    it("400s an amount past the cap instead of letting the column overflow", async () => {
      seedDana()
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID, valueCents: 9_999_999_999 }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe("valueCents")
      expect(state.opportunities).toHaveLength(0)
    })

    it("control: a large but sane amount still goes through and is stored", async () => {
      seedDana()
      const res = await POST(
        requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID, valueCents: 2_000_000_000 }) as never,
        NO_PARAMS,
      )
      expect(res.status).toBe(200)
      expect(state.opportunities[0].value_cents).toBe(2_000_000_000)
    })
  })

  it("400s naming the stage they're already in, for a duplicate open card", async () => {
    seedDana()
    state.opportunities.push({
      id: "opp-existing",
      business_id: BUSINESS_ID,
      pipeline_id: BOARD_ID,
      contact_id: DANA_ID,
      stage_id: STAGE_CONSULTED.id,
      outcome: null,
      value_cents: null,
    })

    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Dana Reyes is already on Coaching, in Consulted.")
    // No second row.
    expect(state.opportunities).toHaveLength(1)
    // And it never got as far as trying. The pre-check is what makes the
    // ordinary case answer in English; without its own `throw` the insert
    // falls through to the unique index, which says the same sentence — so
    // this is the only assertion that can tell the two apart.
    expect(insertAttempts.opportunities ?? 0).toBe(0)
  })

  it("400s with the SAME message when the duplicate is caught as a 23505 race instead of the pre-check", async () => {
    seedDana()
    // The pre-check sees nothing — state.opportunities is empty for Dana on
    // this board — but the insert itself loses the race.
    forcedOpportunityConflict = { stageId: STAGE_CONSULTED.id }

    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Dana Reyes is already on Coaching, in Consulted.")
    // The race-winner row is the only one — this request created no second
    // card of its own.
    expect(state.opportunities).toHaveLength(1)
  })

  it("200s a success: the card lands on the position-1 stage, outcome null, under the RESOLVED businessId", async () => {
    seedDana()
    const res = await POST(
      requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID, valueCents: 50000 }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.contactId).toBe(DANA_ID)

    expect(state.opportunities).toHaveLength(1)
    const created = state.opportunities[0]
    expect(created.id).toBe(body.opportunityId)
    expect(created.stage_id).toBe(STAGE_ENQUIRED.id)
    expect(created.outcome).toBeNull()
    expect(created.business_id).toBe(BUSINESS_ID)
    expect(created.business_id).not.toBe(OTHER_BUSINESS_ID)
    expect(created.value_cents).toBe(50000)
  })

  // -------------------------------------------------------------------------
  // THE ARCHIVE GATE (fix round 1, Important 3).
  // -------------------------------------------------------------------------

  it("400s an ARCHIVED board rather than filing a card nobody will ever see", async () => {
    state.pipelines[0].status = "archived"
    seedDana()

    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe(
      '"Coaching" has been archived, so a card filed onto it would not show up anywhere. ' +
        "Put that board back in use first, or pick a different one.",
    )
    expect(state.opportunities).toHaveLength(0)
    // Nothing on her history either — the refusal happens before any write.
    expect(state.contact_timeline_events).toHaveLength(0)
  })

  // THE PRESENCE CONTROL for the refusal above. Identical request, identical
  // fixture, one column different — without it, the 400 could be coming from
  // anywhere (a missing stage, a bad id) and the archive gate could be doing
  // nothing at all.
  it("control: the SAME request against the same board, active, is accepted", async () => {
    expect(state.pipelines[0].status).toBe("active")
    seedDana()

    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)

    expect(res.status).toBe(200)
    expect(state.opportunities).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // THE HISTORY ROW (fix round 1, Important 1 and Important 2).
  // -------------------------------------------------------------------------

  it("leaves a card_filed row on an EXISTING contact's record too, not only on a newly typed one", async () => {
    seedDana()

    const res = await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)
    expect(res.status).toBe(200)

    // The `contactId` branch used to write NO timeline row at all, so filing
    // somebody already on file left zero trace on the contact's record —
    // `lib/db/contact-detail.ts` reads neither `opportunities` nor
    // `opportunity_stage_events`, so there was nowhere else for it to show up.
    expect(state.contact_timeline_events).toHaveLength(1)
    const row = state.contact_timeline_events[0]
    expect(row.contact_id).toBe(DANA_ID)
    expect(row.business_id).toBe(BUSINESS_ID)
    expect(row.kind).toBe(CARD_FILED_TIMELINE_KIND)
    expect(row.source).toBe("manual_card")
    // The two keys `describeTimelineEvent`'s `card_filed` arm actually reads.
    expect(row.metadata.board_name).toBe(BOARD_NAME)
    expect(row.metadata.stage_name).toBe(STAGE_ENQUIRED.name)
  })

  // The consequence, not the string: `readLastContactActivity`
  // (lib/db/pipeline.ts) filters on this list to compute the staleness dot, so
  // a kind ON it makes a coach's own filing look like the PERSON getting in
  // touch — on every board they are on, because the anchor is keyed by
  // contact. The end-to-end proof that the dot does not move is in
  // __tests__/db/pipeline.test.ts; this is the membership pin that says why.
  it("writes a kind the staleness dot does NOT count as the person being in touch", async () => {
    seedDana()
    await POST(requestFor({ pipelineId: BOARD_ID, contactId: DANA_ID }) as never, NO_PARAMS)

    expect(CONTACT_ACTIVITY_KINDS).not.toContain(CARD_FILED_TIMELINE_KIND)
    for (const row of state.contact_timeline_events) {
      expect(CONTACT_ACTIVITY_KINDS).not.toContain(row.kind)
    }
  })

  it("leaves NOTHING on the person's history when the card is refused as a duplicate", async () => {
    seedDana()
    state.opportunities.push({
      id: "opp-existing",
      business_id: BUSINESS_ID,
      pipeline_id: BOARD_ID,
      contact_id: DANA_ID,
      stage_id: STAGE_CONSULTED.id,
      outcome: null,
      value_cents: null,
    })

    // THE `person` BRANCH, on purpose — the two duplicate tests above both go
    // through `contactId`, which never wrote a timeline row in the first
    // place. This is the path where a refusal used to append "added to a
    // board" to a person who had NOT been added to a board, once per retry.
    const res = await POST(
      requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: DANA_EMAIL } }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Dana Reyes is already on Coaching, in Consulted.")

    expect(state.contact_timeline_events).toHaveLength(0)
    expect(state.opportunities).toHaveLength(1)

    // And it is still nothing after the coach tries again, which is what a
    // coach actually does when told "already on this board".
    await POST(
      requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: DANA_EMAIL } }) as never,
      NO_PARAMS,
    )
    expect(state.contact_timeline_events).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // SEARCH-OR-CREATE (fix round 1, Minor 7) — the spec's own words: "a typo'd
  // repeat resolves to the existing contact instead of quietly becoming a
  // second Dana Reyes".
  // -------------------------------------------------------------------------

  it("resolves a typed person to the contact already on file instead of creating a second one", async () => {
    seedDana()

    const res = await POST(
      // Same address, a different spelling of the name — a second coach typing
      // her in from a phone call.
      requestFor({ pipelineId: BOARD_ID, person: { name: "dana reyes", email: DANA_EMAIL } }) as never,
      NO_PARAMS,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    // THE id, not "an id": a fresh contact would also come back with a
    // truthy one, and this assertion is the whole point of the test.
    expect(body.contactId).toBe(DANA_ID)
    expect(state.contacts).toHaveLength(1)
    expect(state.opportunities[0].contact_id).toBe(DANA_ID)
  })

  // -------------------------------------------------------------------------
  // THE ENROLMENT TEST, AND ITS PRESENCE CONTROL — the heart of this task.
  // -------------------------------------------------------------------------

  it("enrols nobody when a card is made by hand", async () => {
    const res = await POST(
      requestFor({ pipelineId: BOARD_ID, person: { name: "Dana Reyes", email: "dana@example.com" } }) as never,
      NO_PARAMS,
    )
    expect(res.status).toBe(200)
    expect(enrollIfTriggered).not.toHaveBeenCalled()
    // Confirms this test actually reached contact creation, not just a route
    // that 400'd before ever resolving a contact — a shallow refusal would
    // also leave enrollIfTriggered uncalled, for a reason that proves nothing.
    expect(state.contacts).toHaveLength(1)
    expect(state.contacts[0].email).toBe("dana@example.com")
    const manualCardEvents = state.contact_timeline_events.filter((e) => e.source === "manual_card")
    expect(manualCardEvents).toHaveLength(1)
    expect(manualCardEvents[0].kind).toBe(CARD_FILED_TIMELINE_KIND)
  })

  // THE PRESENCE CONTROL. Without this, the assertion above passes just as
  // well when the mock is wired to the wrong path, the import is stale, or
  // the test never reached the code. This proves the spy CAN fire — same
  // fixture, through the ONE function this whole task exists to avoid
  // calling.
  it("control: the same fixture through recordContactEvent DOES enrol", async () => {
    const { recordContactEvent } = await import("@/lib/db/contacts")
    await recordContactEvent({
      email: "dana@example.com",
      name: "Dana Reyes",
      source: "inquiry",
      businessId: BUSINESS_ID,
    })
    expect(enrollIfTriggered).toHaveBeenCalled()
  })
})
