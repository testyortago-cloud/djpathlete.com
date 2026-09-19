// @vitest-environment node
//
// The pure half of scripts/exit-sequence-run.mjs — the hand-run repair for a
// person a trigger should never have enrolled (first use: the account holder
// the pack payment-link cron put through abandoned_checkout, 16–19 Sept 2026).
//
// A repair script's danger is never the write; it is the selection. So the
// decision of WHETHER this run may be exited, and exactly WHAT is written,
// lives here where it can be tested without a database in front of it.

import { describe, it, expect } from "vitest"
import { planExit } from "../../scripts/_exit-sequence-run-lib.mjs"

const NOW = "2026-09-20T10:00:00.000Z"
const RUN = { id: "run-1", status: "active", contact_id: "contact-1", sequence_key: "abandoned_checkout" }

describe("planExit — whether the run may be exited", () => {
  it("refuses when no run was found — a typo'd id must not read as a no-op success", () => {
    expect(planExit({ run: null, reason: "manual", now: NOW })).toEqual({ ok: false, why: "not_found" })
  })

  it("refuses a run that is not active — completed, exited and failed runs are left exactly as they are", () => {
    for (const status of ["completed", "exited", "failed"]) {
      expect(planExit({ run: { ...RUN, status }, reason: "manual", now: NOW })).toEqual({
        ok: false,
        why: "not_active",
        status,
      })
    }
  })

  it("refuses a blank reason — the person list would show nothing for why they left", () => {
    expect(planExit({ run: RUN, reason: "  ", now: NOW })).toEqual({ ok: false, why: "no_reason" })
  })
})

describe("planExit — what is written", () => {
  it("mirrors exitRun in lib/db/sequences.ts, field for field, guarded on the run still being active", () => {
    const plan = planExit({ run: RUN, reason: "manual", now: NOW })
    expect(plan).toEqual({
      ok: true,
      update: {
        status: "exited",
        exit_reason: "manual",
        completed_at: NOW,
        claimed_at: null,
        claimed_by: null,
        updated_at: NOW,
      },
      guard: { id: "run-1", status: "active" },
    })
  })

  it("trims the reason so a stray space does not mint a second spelling of 'manual'", () => {
    const plan = planExit({ run: RUN, reason: " manual ", now: NOW })
    expect(plan.ok && plan.update.exit_reason).toBe("manual")
  })
})
