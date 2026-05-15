// Pure aggregator for the inbox SLA digest.
// "Unread"        = conversation whose last message is inbound (no outbound after it).
// "Awaiting >24h" = unread AND last_inbound_at >= 24h ago.
// "Awaiting >48h" = unread AND last_inbound_at >= 48h ago.
// Mean response time = avg(outbound - matching inbound) over the last 7d,
// only for pairs where outbound came AFTER inbound (= actual replies).

export interface ConversationRow {
  id: string
  contact_name: string
  last_inbound_at: string | null
  last_outbound_at: string | null
  snippet: string | null
}

export interface OldestUnanswered {
  conversation_id: string
  contact_name: string
  last_inbound_at: string
  snippet: string | null
  hours_waiting: number
}

export interface InboxSlaOutput {
  unread_count: number
  awaiting_reply_over_24h: number
  awaiting_reply_over_48h: number
  mean_response_minutes_7d: number | null
  oldest_unanswered: OldestUnanswered[]
}

const MS_PER_HOUR = 3600_000
const SEVEN_DAYS_MS = 7 * 24 * MS_PER_HOUR
const OLDEST_CAP = 5

function isUnread(row: ConversationRow): boolean {
  if (!row.last_inbound_at) return false
  if (!row.last_outbound_at) return true
  return new Date(row.last_inbound_at).getTime() > new Date(row.last_outbound_at).getTime()
}

export function aggregateInboxSla(rows: ConversationRow[]): InboxSlaOutput {
  const now = Date.now()
  const unread: Array<{ row: ConversationRow; hours: number }> = []
  for (const row of rows) {
    if (!isUnread(row)) continue
    const inboundMs = new Date(row.last_inbound_at as string).getTime()
    const hours = (now - inboundMs) / MS_PER_HOUR
    unread.push({ row, hours })
  }

  const awaiting_reply_over_24h = unread.filter((u) => u.hours >= 24).length
  const awaiting_reply_over_48h = unread.filter((u) => u.hours >= 48).length

  // Mean response time — pairs where outbound > inbound, within last 7d.
  const responseMins: number[] = []
  for (const row of rows) {
    if (!row.last_inbound_at || !row.last_outbound_at) continue
    const inMs = new Date(row.last_inbound_at).getTime()
    const outMs = new Date(row.last_outbound_at).getTime()
    if (outMs <= inMs) continue
    if (now - outMs > SEVEN_DAYS_MS) continue
    responseMins.push((outMs - inMs) / 60_000)
  }
  const mean_response_minutes_7d =
    responseMins.length === 0
      ? null
      : Math.round((responseMins.reduce((s, x) => s + x, 0) / responseMins.length) * 100) / 100

  const oldest_unanswered: OldestUnanswered[] = unread
    .sort((a, b) => b.hours - a.hours)
    .slice(0, OLDEST_CAP)
    .map(({ row, hours }) => ({
      conversation_id: row.id,
      contact_name: row.contact_name,
      last_inbound_at: row.last_inbound_at as string,
      snippet: row.snippet,
      hours_waiting: Math.round(hours * 10) / 10,
    }))

  return {
    unread_count: unread.length,
    awaiting_reply_over_24h,
    awaiting_reply_over_48h,
    mean_response_minutes_7d,
    oldest_unanswered,
  }
}
