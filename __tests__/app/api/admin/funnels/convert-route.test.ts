// __tests__/app/api/admin/funnels/convert-route.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR, and it is a defect that has not happened
// yet: conversion was DELETED on 2026-08-31 rather than fixed, because
// `kind` living in the PATCH body was a door in the publish guard — demote a
// broken multi-page funnel to a "page" with one request, then publish it with
// the next, because this route family lets a PAGE publish through a plain
// `{status:"published"}` while a funnel must pass three gates.
//
// Bringing conversion back is therefore only safe if it CANNOT reassemble that
// sequence. Two things make that true, and both are pinned here:
//
//   1. Conversion is a different route. PATCH still refuses any body naming
//      `kind` — `patch-route.test.ts` owns that half and is unchanged.
//   2. A funnel may only become a page when it has EXACTLY ONE step. The
//      bypass needed unbuilt siblings to smuggle live; a one-page funnel has
//      none, so the guard that stops pages disappearing from the admin is the
//      same guard that closes the bypass. There is no second check to forget.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  updateFunnel: vi.fn(),
  listSteps: vi.fn(),
}))

import { POST } from "@/app/api/admin/funnels/[id]/convert/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { getFunnelById, updateFunnel, listSteps } from "@/lib/db/funnels"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"

const FUNNEL_ROW = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }
const PAGE_ROW = { id: FUNNEL_ID, slug: "coaching", name: "Coaching", kind: "page", status: "draft" }

const step = (n: number) => ({ id: `step-${n}`, slug: n === 0 ? "index" : `s${n}`, name: `Page ${n}`, position: n })

function convert(body: unknown): Request {
  return new Request(`http://localhost/api/admin/funnels/${FUNNEL_ID}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: FUNNEL_ID }) }

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once implementation leaking
  // across a test boundary misattributes the failure to the wrong case.
  vi.resetAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getFunnelById).mockResolvedValue(FUNNEL_ROW)
  mock(listSteps).mockResolvedValue([step(0)])
  mock(updateFunnel).mockImplementation(async (id: string, data: Record<string, unknown>) => ({
    ...FUNNEL_ROW,
    ...data,
  }))
})

describe("POST /api/admin/funnels/[id]/convert", () => {
  it("refuses a non-admin, and writes NOTHING", async () => {
    mock(canAccessAdminPath).mockResolvedValue(false)

    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    expect(response.status).toBe(403)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // funnel -> page. The guarded direction.
  // -------------------------------------------------------------------------

  it("converts a ONE-page funnel into a landing page", async () => {
    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    expect(response.status).toBe(200)
    // MUTANT: writing `{kind: "funnel"}` — the value it already had. Asserting
    // only that updateFunnel was called is green for the wrong destination, so
    // the VALUE is what is pinned. (assert-which-value, not that one came back)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { kind: "page" })
    expect((await response.json()).funnel.kind).toBe("page")
  })

  it("REFUSES to convert a funnel that has two pages, and writes NOTHING", async () => {
    mock(listSteps).mockResolvedValue([step(0), step(1)])

    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    // MUTANT: dropping the step-count guard. This is the whole reason the
    // feature is safe — without it the 2026-08-31 publish bypass is back,
    // because a demoted multi-page funnel publishes through PATCH ungated.
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain("2 pages")
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("REFUSES a funnel with five pages and counts them honestly", async () => {
    mock(listSteps).mockResolvedValue([0, 1, 2, 3, 4].map(step))

    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    // MUTANT: hardcoding "2 pages" in the message, or using `>= 2` as the
    // count. The number in the sentence has to be the real one, because the
    // owner acts on it — he goes and deletes that many pages.
    expect((await response.json()).error).toContain("5 pages")
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("REFUSES a funnel with no pages at all", async () => {
    mock(listSteps).mockResolvedValue([])

    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    // MUTANT: guarding with `steps.length > 1` instead of `!== 1`. Zero steps
    // is not a landing page either — a landing page IS its one page — and a
    // `> 1` guard waves it through into a row no board can render.
    expect(response.status).toBe(400)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // page -> funnel. Unguarded, because one step is a legal funnel.
  // -------------------------------------------------------------------------

  it("converts a landing page into a funnel", async () => {
    mock(getFunnelById).mockResolvedValue(PAGE_ROW)
    mock(updateFunnel).mockImplementation(async (id: string, data: Record<string, unknown>) => ({
      ...PAGE_ROW,
      ...data,
    }))

    const response = await POST(convert({ to: "funnel" }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { kind: "funnel" })
  })

  it("does not count steps when promoting — one page is a legal funnel", async () => {
    mock(getFunnelById).mockResolvedValue(PAGE_ROW)
    mock(listSteps).mockResolvedValue([step(0)])

    const response = await POST(convert({ to: "funnel" }) as never, ctx as never)

    // PRESENCE CONTROL for the guard tests above: proves the step count gates
    // ONE direction rather than every conversion. Without it, a guard that
    // refused everything would still pass all three refusal tests.
    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { kind: "funnel" })
  })

  // -------------------------------------------------------------------------
  // Shape and no-ops.
  // -------------------------------------------------------------------------

  it("refuses a body with no destination", async () => {
    const response = await POST(convert({}) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("refuses a destination that is not a kind", async () => {
    const response = await POST(convert({ to: "landing-page" }) as never, ctx as never)

    // MUTANT: accepting any string and writing it into `kind`. `funnels.kind`
    // has a CHECK constraint, so this would 500 from Postgres rather than 400
    // from here — and PostgREST cannot see CHECK constraints to explain it.
    expect(response.status).toBe(400)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("answers 200 and writes NOTHING when the row is already that kind", async () => {
    const response = await POST(convert({ to: "funnel" }) as never, ctx as never)

    // MUTANT: writing anyway. A no-op write is not harmless here — it emits an
    // audit row claiming a conversion that did not happen, and "where did my
    // page go" is the exact question that log gets asked.
    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // The audit row. Asserted here because the row is the ONLY record of a
  // conversion — nothing else in the product remembers that a page used to be
  // a funnel, so "where did my landing page go" is answered from this or not
  // at all.
  // -------------------------------------------------------------------------

  it("records the conversion NAMING the funnel, with both kinds", async () => {
    await POST(convert({ to: "page" }) as never, ctx as never)

    // MUTANT: returning `{type,id}` without the label. The row still points at
    // the right funnel, so every other assertion here passes — and the log
    // reads "funnel ffffffff-1111-…", which is exactly as useful as no row.
    const call = mock(recordAudit).mock.calls.at(-1)?.[0]
    expect(call.action).toBe("funnel.converted")
    expect(call.outcome).toBe("success")
    expect(call.target).toEqual({ type: "funnel", id: FUNNEL_ID, label: "Free Trial Week" })
    expect(call.metadata).toEqual({ kind: { from: "funnel", to: "page" } })
  })

  it("records NO kind metadata when nothing was converted", async () => {
    await POST(convert({ to: "funnel" }) as never, ctx as never)

    // The no-op path. MUTANT: building the metadata from the REQUEST body,
    // which is identical for a real conversion and for this — the log would
    // claim a funnel became a funnel.
    const call = mock(recordAudit).mock.calls.at(-1)?.[0]
    expect(call.metadata).toEqual({})
  })

  it("still records the row when the funnel's name cannot be read", async () => {
    // The label lookup runs after the handler and is allowed to fail. It must
    // degrade to an unlabelled row — NOT throw, which `withAudit` catches into
    // `target: undefined`, losing the id and leaving a row pointing at nothing.
    mock(getFunnelById).mockResolvedValueOnce(FUNNEL_ROW).mockRejectedValueOnce(new Error("read failed"))

    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    expect(response.status).toBe(200)
    const call = mock(recordAudit).mock.calls.at(-1)?.[0]
    expect(call.target).toEqual({ type: "funnel", id: FUNNEL_ID })
  })

  it("404s on a funnel that does not exist, before reading its steps", async () => {
    mock(getFunnelById).mockResolvedValue(null)

    const response = await POST(convert({ to: "page" }) as never, ctx as never)

    expect(response.status).toBe(404)
    expect(mock(listSteps)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("does not read steps at all when promoting to a funnel", async () => {
    mock(getFunnelById).mockResolvedValue(PAGE_ROW)

    await POST(convert({ to: "funnel" }) as never, ctx as never)

    // MUTANT: counting steps unconditionally and then branching. Harmless
    // today, but it makes the guard's SHAPE ambiguous — a later edit that
    // moves the `!== 1` check above the direction test would refuse every
    // multi-page promotion, and no other test here would notice.
    expect(mock(listSteps)).not.toHaveBeenCalled()
  })
})
