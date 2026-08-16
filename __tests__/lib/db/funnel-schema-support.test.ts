// Does this database have migration 00210 yet?
//
// `.github/workflows/apply-migrations.yml` states the contract this satisfies,
// in its own words: "Vercel also builds on push to main, and nothing sequences
// the two. Keep migrations additive and let code tolerate the old schema for
// one deploy."
//
// It is not only about that race. `.env.local` points at a stale clone that has
// never seen 00210, so without this every local funnel create would 500 too.

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  hasIntakeColumns,
  __resetIntakeColumnCache,
  INTAKE_PROBE_COLUMN,
} from "@/lib/db/funnel-schema-support"

const limit = vi.fn()
const select = vi.fn(() => ({ limit }))
const from = vi.fn(() => ({ select }))
const client = { from } as never

/** PostgREST's shape for "you asked for a column that does not exist". */
const UNDEFINED_COLUMN = {
  code: "42703",
  message: `column funnels.${INTAKE_PROBE_COLUMN} does not exist`,
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetIntakeColumnCache()
})

describe("hasIntakeColumns", () => {
  it("is true when the probe column reads cleanly", async () => {
    limit.mockResolvedValue({ data: [], error: null })
    expect(await hasIntakeColumns(client)).toBe(true)
  })

  it("is false when the column does not exist", async () => {
    // MUTANT KILLED: treating any error as "present". A missing column would
    // then be reported as present and every insert would 500 — the exact
    // failure this module exists to prevent.
    limit.mockResolvedValue({ data: null, error: UNDEFINED_COLUMN })
    expect(await hasIntakeColumns(client)).toBe(false)
  })

  it("probes the funnels table for a column 00210 adds", async () => {
    limit.mockResolvedValue({ data: [], error: null })
    await hasIntakeColumns(client)
    expect(from).toHaveBeenCalledWith("funnels")
    expect(select).toHaveBeenCalledWith(INTAKE_PROBE_COLUMN)
  })

  it("caches a true answer and never probes again", async () => {
    // Columns cannot disappear, so one successful probe settles it forever.
    // Probing per create would put an extra round trip on every funnel.
    limit.mockResolvedValue({ data: [], error: null })
    await hasIntakeColumns(client)
    await hasIntakeColumns(client)
    await hasIntakeColumns(client)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it("re-probes after a false answer so a running instance recovers", async () => {
    // MUTANT KILLED: caching `false` permanently. The migration lands ~15s
    // after the deploy; an instance that cached "absent" at second 3 would
    // serve degraded funnels until its next cold start, which on a warm
    // serverless instance could be hours.
    limit.mockResolvedValue({ data: null, error: UNDEFINED_COLUMN })
    expect(await hasIntakeColumns(client)).toBe(false)

    limit.mockResolvedValue({ data: [], error: null })
    expect(await hasIntakeColumns(client, { now: Date.now() + 120_000 })).toBe(true)
  })

  it("does not re-probe on every call while the answer is false", async () => {
    // The recovery above must not become a probe per create during the window.
    limit.mockResolvedValue({ data: null, error: UNDEFINED_COLUMN })
    await hasIntakeColumns(client)
    await hasIntakeColumns(client)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it("treats an unrelated error as columns-absent rather than throwing", async () => {
    // Failing SAFE here means degrading to the pre-00210 insert, which always
    // works. Failing "present" would mean a 500. A transient network error
    // must not take funnel creation down.
    limit.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } })
    expect(await hasIntakeColumns(client)).toBe(false)
  })

  it("does not throw when the probe itself rejects", async () => {
    limit.mockRejectedValue(new Error("boom"))
    await expect(hasIntakeColumns(client)).resolves.toBe(false)
  })
})
