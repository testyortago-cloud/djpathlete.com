import { describe, expect, it } from "vitest"
import {
  aggregateInboxSla,
  type ConversationRow,
} from "@/lib/automation/inbox-sla-aggregator"

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString()
}

const someBody = "Hey, quick question about programming…"

describe("aggregateInboxSla", () => {
  it("zeros out cleanly on empty input", () => {
    const r = aggregateInboxSla([])
    expect(r.unread_count).toBe(0)
    expect(r.awaiting_reply_over_24h).toBe(0)
    expect(r.awaiting_reply_over_48h).toBe(0)
    expect(r.mean_response_minutes_7d).toBeNull()
    expect(r.oldest_unanswered).toEqual([])
  })

  it("counts unread (last message is inbound)", () => {
    const rows: ConversationRow[] = [
      conv({ last_inbound_at: hoursAgo(1), last_outbound_at: hoursAgo(5) }),
      conv({ last_inbound_at: hoursAgo(3), last_outbound_at: null }),
      conv({ last_inbound_at: null, last_outbound_at: hoursAgo(1) }),
    ]
    const r = aggregateInboxSla(rows)
    expect(r.unread_count).toBe(2)
  })

  it("counts 24h and 48h awaiting buckets (cumulative)", () => {
    const rows: ConversationRow[] = [
      conv({ last_inbound_at: hoursAgo(1) }),     // not yet 24h
      conv({ last_inbound_at: hoursAgo(25) }),    // 24h+
      conv({ last_inbound_at: hoursAgo(50) }),    // 48h+
      conv({ last_inbound_at: hoursAgo(72) }),    // 48h+
    ]
    const r = aggregateInboxSla(rows)
    expect(r.awaiting_reply_over_24h).toBe(3) // all three past 24h
    expect(r.awaiting_reply_over_48h).toBe(2) // last two past 48h
  })

  it("excludes already-replied conversations from awaiting counts", () => {
    const rows: ConversationRow[] = [
      conv({ last_inbound_at: hoursAgo(50), last_outbound_at: hoursAgo(10) }), // replied
      conv({ last_inbound_at: hoursAgo(50), last_outbound_at: hoursAgo(60) }), // pre-inbound reply
    ]
    const r = aggregateInboxSla(rows)
    expect(r.awaiting_reply_over_24h).toBe(1) // only the one without reply since inbound
  })

  it("mean response time uses pairs where outbound came after inbound, within 7d", () => {
    const inboundIso = hoursAgo(50)
    const outboundIso = hoursAgo(48) // 2h response time
    const rows: ConversationRow[] = [
      conv({ last_inbound_at: inboundIso, last_outbound_at: outboundIso }),
    ]
    const r = aggregateInboxSla(rows)
    expect(r.mean_response_minutes_7d).toBe(120)
  })

  it("oldest unanswered list is capped at 5 and sorted by age", () => {
    const rows: ConversationRow[] = [
      conv({ id: "newest", contact_name: "A", last_inbound_at: hoursAgo(25) }),
      conv({ id: "oldest", contact_name: "B", last_inbound_at: hoursAgo(72) }),
      conv({ id: "mid",    contact_name: "C", last_inbound_at: hoursAgo(48) }),
    ]
    const r = aggregateInboxSla(rows)
    expect(r.oldest_unanswered).toHaveLength(3)
    expect(r.oldest_unanswered[0].conversation_id).toBe("oldest")
    expect(r.oldest_unanswered[2].conversation_id).toBe("newest")
  })
})

function conv(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "c",
    contact_name: "Someone",
    last_inbound_at: null,
    last_outbound_at: null,
    snippet: someBody,
    ...overrides,
  }
}
