import { describe, it, expect } from "vitest"
import { partitionDue, MISSED_GRACE_MS } from "@/lib/content-schedule/due"

const NOW = new Date("2026-08-21T12:00:00.000Z")
const at = (iso: string) => ({ id: iso, scheduled_at: iso })

describe("partitionDue", () => {
  it("fires a row whose time is exactly now", () => {
    const r = at("2026-08-21T12:00:00.000Z")
    expect(partitionDue([r], NOW).fire).toEqual([r])
  })

  it("waits on a row one second in the future", () => {
    const r = at("2026-08-21T12:00:01.000Z")
    const out = partitionDue([r], NOW)
    expect(out.waiting).toEqual([r])
    expect(out.fire).toEqual([])
    expect(out.missed).toEqual([])
  })

  it("fires a row 23h59m late — an outage should not cost you the post", () => {
    const r = at("2026-08-20T12:01:00.000Z")
    expect(partitionDue([r], NOW).fire).toEqual([r])
  })

  it("misses a row exactly 24h late — the boundary is >=, not >", () => {
    const r = at("2026-08-20T12:00:00.000Z")
    const out = partitionDue([r], NOW)
    expect(out.fire).toEqual([])
    expect(out.missed).toHaveLength(1)
    expect(out.missed[0].row).toEqual(r)
  })

  it("misses a row 24h01m late", () => {
    const r = at("2026-08-20T11:59:00.000Z")
    expect(partitionDue([r], NOW).missed).toHaveLength(1)
  })

  it("gives a missed row a reason naming how late it was, in plain language rather than a raw ISO string", () => {
    const r = at("2026-08-19T12:00:00.000Z")
    const { missed } = partitionDue([r], NOW)
    expect(missed[0].reason).toMatch(/missed/i)
    // Humanised: "Wed 19 Aug 2026 at 12:00 PM UTC" — not the raw
    // "2026-08-19T12:00:00.000Z" a non-technical coach can't parse at a glance.
    expect(missed[0].reason).toMatch(/19 Aug 2026/)
    expect(missed[0].reason).toMatch(/12:00 PM UTC/)
    expect(missed[0].reason).not.toMatch(/2026-08-19T/)
  })

  it("treats a scheduled row with no time as missed, not as a crash", () => {
    // A NULL scheduled_at on a scheduled row is corrupt state. Firing it
    // would publish at an arbitrary moment; ignoring it would strand the row
    // as permanently scheduled. Missed is the only honest answer.
    const r = { id: "x", scheduled_at: null }
    const out = partitionDue([r], NOW)
    expect(out.missed).toHaveLength(1)
    expect(out.missed[0].reason).toMatch(/no scheduled time/i)
    expect(out.fire).toEqual([])
  })

  it("partitions a mixed batch without losing a row", () => {
    const rows = [
      at("2026-08-21T11:59:00.000Z"), // fire
      at("2026-08-21T12:30:00.000Z"), // waiting
      at("2026-08-18T12:00:00.000Z"), // missed
    ]
    const out = partitionDue(rows, NOW)
    expect(out.fire).toHaveLength(1)
    expect(out.waiting).toHaveLength(1)
    expect(out.missed).toHaveLength(1)
    expect(out.fire.length + out.waiting.length + out.missed.length).toBe(rows.length)
  })

  it("exports the grace window as 24 hours", () => {
    expect(MISSED_GRACE_MS).toBe(24 * 60 * 60 * 1000)
  })
})
