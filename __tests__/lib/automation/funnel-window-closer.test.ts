// The job that takes a finished camp offline.
//
// EVERY TEST HERE IS ABOUT WHAT IT MUST NOT TOUCH. Unpublishing is destructive
// from the visitor's side — a page that was accepting registrations stops — and
// the owner does not watch a 04:00 cron. So the selection rule is pure, and each
// excluded row below differs from the included one by exactly ONE field.

import { describe, it, expect } from "vitest"
import { selectFunnelsToClose } from "@/lib/automation/funnel-window-closer"
import type { Funnel } from "@/types/database"

function funnel(overrides: Partial<Funnel> & { id: string }): Funnel {
  return {
    slug: overrides.id,
    name: overrides.id,
    description: null,
    status: "published",
    kind: "funnel",
    goal: null,
    template: "event",
    audience: null,
    offer_kind: null,
    offer_ref: null,
    starts_at: null,
    ends_at: null,
    auto_offline_at_end: true,
    notify_emails: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Funnel
}

const NOW = new Date("2026-09-01T00:00:00.000Z")

describe("selectFunnelsToClose", () => {
  it("closes only the published, opted-in, past-end funnel", () => {
    // MUTANT KILLED: any relaxation of the three conditions. Each row here is
    // one field away from qualifying, so dropping any single check makes this
    // fail with a named id rather than a vague count.
    const rows = [
      funnel({ id: "yes", ends_at: "2026-08-15T00:00:00.000Z" }),
      funnel({ id: "not-opted-in", ends_at: "2026-08-15T00:00:00.000Z", auto_offline_at_end: false }),
      funnel({ id: "still-running", ends_at: "2026-09-30T00:00:00.000Z" }),
      funnel({ id: "already-draft", ends_at: "2026-08-15T00:00:00.000Z", status: "draft" }),
      funnel({ id: "archived", ends_at: "2026-08-15T00:00:00.000Z", status: "archived" }),
      funnel({ id: "no-end-date", ends_at: null }),
    ]
    expect(selectFunnelsToClose(rows, NOW)).toEqual(["yes"])
  })

  it("does not close a funnel whose window ends exactly now", () => {
    // The window INCLUDES its final instant, matching the migration's own
    // `ends_at > starts_at`. A camp ending at midnight is still running at
    // midnight — closing it there would cut off the last day's signups.
    const at = new Date("2026-08-15T00:00:00.000Z")
    const rows = [funnel({ id: "edge", ends_at: "2026-08-15T00:00:00.000Z" })]
    expect(selectFunnelsToClose(rows, at)).toEqual([])
    // One millisecond later, it closes.
    expect(selectFunnelsToClose(rows, new Date(at.getTime() + 1))).toEqual(["edge"])
  })

  it("closes a landing page too, if someone gave one a window", () => {
    // `kind` is not part of the rule. Only templates ask for dates today, but
    // the columns are on `funnels` and a page carrying one means the same thing.
    const rows = [funnel({ id: "page", kind: "page", ends_at: "2026-08-15T00:00:00.000Z" })]
    expect(selectFunnelsToClose(rows, NOW)).toEqual(["page"])
  })

  it("ignores an unparseable end date rather than closing on it", () => {
    // MUTANT KILLED: `new Date(junk) < now` is false, but `!(now > NaN)` is
    // also false — the comparison direction decides whether garbage data takes
    // a live page down. It must not.
    const rows = [funnel({ id: "junk", ends_at: "not-a-date" })]
    expect(selectFunnelsToClose(rows, NOW)).toEqual([])
  })

  it("returns an empty list for an empty input", () => {
    expect(selectFunnelsToClose([], NOW)).toEqual([])
  })

  it("closes every qualifying row, not just the first", () => {
    const rows = [
      funnel({ id: "a", ends_at: "2026-08-15T00:00:00.000Z" }),
      funnel({ id: "b", ends_at: "2026-07-01T00:00:00.000Z" }),
    ]
    expect(selectFunnelsToClose(rows, NOW)).toEqual(["a", "b"])
  })
})
