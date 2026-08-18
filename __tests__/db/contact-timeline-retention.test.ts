// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { scrubContactTimeline } from "@/lib/db/contact-timeline-retention"

type Row = Record<string, any>

// A hand-rolled Supabase query-builder fake for exactly the chain
// `.from("contact_timeline_events").update(values, { count }).lt(col, val).is(col, val)`.
//
// It is a *thenable* (has `.then`) so `await builder` resolves the same way
// a real Supabase PostgrestFilterBuilder does without needing a separate
// terminal call. Filters are tracked and genuinely applied to `rows` before
// the update is written and the count computed — per CONTEXT.md's mock
// trap, a `.lt()`/`.is()` that returned the builder unconditionally would
// let every assertion below pass while scrubbing every row regardless of
// window or existing scrubbed_at.
function makeFakeSupabase(rows: Row[]): SupabaseClient {
  const from = (table: string) => {
    if (table !== "contact_timeline_events") {
      throw new Error(`unexpected table: ${table}`)
    }
    let updateValues: Row | null = null
    const filters: Array<{ type: "lt" | "is"; col: string; val: unknown }> = []

    const api: any = {
      update: (values: Row) => {
        updateValues = values
        return api
      },
      lt: (col: string, val: unknown) => {
        filters.push({ type: "lt", col, val })
        return api
      },
      is: (col: string, val: unknown) => {
        filters.push({ type: "is", col, val })
        return api
      },
      then: (resolve: (v: { count: number; error: null }) => void) => {
        const matched = rows.filter((row) =>
          filters.every((f) => {
            const rowVal = row[f.col]
            if (f.type === "lt") return rowVal < (f.val as string)
            // .is(col, null) => IS NULL
            return f.val === null ? rowVal === null : rowVal === f.val
          }),
        )
        for (const row of matched) Object.assign(row, updateValues)
        resolve({ count: matched.length, error: null })
      },
    }
    return api
  }

  return { from } as unknown as SupabaseClient
}

describe("scrubContactTimeline", () => {
  let rows: Row[]

  beforeEach(() => {
    rows = []
  })

  it("scrubs metadata on rows older than the window", async () => {
    rows.push({
      id: "old-1",
      kind: "form_submitted",
      source: "funnel",
      occurred_at: "2024-01-01T00:00:00.000Z",
      metadata: { email: "lead@example.com", name: "Pat Lead" },
      scrubbed_at: null,
    })

    const supabase = makeFakeSupabase(rows)
    await scrubContactTimeline(supabase, 365)

    expect(rows[0].metadata).toEqual({})
    expect(rows[0].scrubbed_at).toBeTruthy()
  })

  it("leaves kind, source and occurred_at intact", async () => {
    rows.push({
      id: "old-2",
      kind: "form_submitted",
      source: "funnel",
      occurred_at: "2024-01-01T00:00:00.000Z",
      metadata: { email: "lead@example.com" },
      scrubbed_at: null,
    })

    const supabase = makeFakeSupabase(rows)
    await scrubContactTimeline(supabase, 365)

    expect(rows[0].kind).toBe("form_submitted")
    expect(rows[0].source).toBe("funnel")
    expect(rows[0].occurred_at).toBe("2024-01-01T00:00:00.000Z")
  })

  it("does not touch rows inside the window", async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days ago
    rows.push({
      id: "recent-1",
      kind: "form_submitted",
      source: "funnel",
      occurred_at: recent,
      metadata: { email: "fresh@example.com" },
      scrubbed_at: null,
    })

    const supabase = makeFakeSupabase(rows)
    const count = await scrubContactTimeline(supabase, 365)

    expect(count).toBe(0)
    expect(rows[0].metadata).toEqual({ email: "fresh@example.com" })
    expect(rows[0].scrubbed_at).toBeNull()
  })

  it("does not re-scrub a row that already has scrubbed_at", async () => {
    rows.push({
      id: "already-scrubbed",
      kind: "form_submitted",
      source: "funnel",
      occurred_at: "2024-01-01T00:00:00.000Z",
      metadata: {}, // already scrubbed by an earlier run
      scrubbed_at: "2024-06-01T00:00:00.000Z",
    })

    const supabase = makeFakeSupabase(rows)
    const count = await scrubContactTimeline(supabase, 365)

    expect(count).toBe(0)
    // The pre-existing scrubbed_at timestamp must survive untouched — a
    // re-scrub would stamp a NEW one, silently destroying "when was this
    // actually scrubbed" history.
    expect(rows[0].scrubbed_at).toBe("2024-06-01T00:00:00.000Z")
  })

  it("returns the number of rows scrubbed", async () => {
    rows.push(
      {
        id: "old-a",
        kind: "form_submitted",
        source: "funnel",
        occurred_at: "2024-01-01T00:00:00.000Z",
        metadata: { email: "a@example.com" },
        scrubbed_at: null,
      },
      {
        id: "old-b",
        kind: "page_viewed",
        source: "funnel",
        occurred_at: "2024-02-01T00:00:00.000Z",
        metadata: { email: "b@example.com" },
        scrubbed_at: null,
      },
      {
        id: "recent-c",
        kind: "form_submitted",
        source: "funnel",
        occurred_at: new Date().toISOString(),
        metadata: { email: "c@example.com" },
        scrubbed_at: null,
      },
    )

    const supabase = makeFakeSupabase(rows)
    const count = await scrubContactTimeline(supabase, 365)

    expect(count).toBe(2)
  })
})
