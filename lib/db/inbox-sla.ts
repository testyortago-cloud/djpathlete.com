// lib/db/inbox-sla.ts
// DAL + GHL fetcher for inbox SLA snapshots.

import type { SupabaseClient } from "@supabase/supabase-js"
import { isGHLConfigured } from "@/lib/ghl"
import type {
  ConversationRow,
  InboxSlaOutput,
} from "@/lib/automation/inbox-sla-aggregator"

const GHL_BASE_URL = "https://services.leadconnectorhq.com"

export type FetchStatus = "ok" | "degraded" | "error"

export interface FetchResult {
  rows: ConversationRow[]
  status: FetchStatus
  detail: string | null
}

/**
 * Pulls active conversations from GHL. Gracefully degrades when GHL isn't
 * configured (status='degraded', empty rows) or the API errors (status='error').
 *
 * GHL Conversations API: GET /conversations/search?locationId=...&limit=100
 * Returns conversations with lastMessageDirection + lastMessageDate. We map
 * those into our ConversationRow shape.
 */
export async function fetchInboxConversations(): Promise<FetchResult> {
  if (!isGHLConfigured()) {
    return { rows: [], status: "degraded", detail: "GHL not configured" }
  }
  const apiKey = process.env.GHL_API_KEY!
  const locationId = process.env.GHL_LOCATION_ID!

  try {
    const url = new URL(`${GHL_BASE_URL}/conversations/search`)
    url.searchParams.set("locationId", locationId)
    url.searchParams.set("limit", "100")
    url.searchParams.set("status", "all")

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-04-15",
        Accept: "application/json",
      },
    })
    if (!res.ok) {
      return { rows: [], status: "error", detail: `GHL ${res.status}: ${await res.text()}` }
    }
    const data = (await res.json()) as {
      conversations?: Array<{
        id: string
        contactId?: string
        fullName?: string
        lastMessageBody?: string
        lastMessageDate?: string
        lastMessageDirection?: "inbound" | "outbound"
        lastOutboundMessageAction?: { date?: string }
        lastInboundMessageAction?: { date?: string }
      }>
    }

    const rows: ConversationRow[] = (data.conversations ?? []).map((c) => {
      let last_inbound_at: string | null = c.lastInboundMessageAction?.date ?? null
      let last_outbound_at: string | null = c.lastOutboundMessageAction?.date ?? null
      // Fallback: use lastMessageDate + direction when fine-grained timestamps absent.
      if (!last_inbound_at && c.lastMessageDirection === "inbound") {
        last_inbound_at = c.lastMessageDate ?? null
      }
      if (!last_outbound_at && c.lastMessageDirection === "outbound") {
        last_outbound_at = c.lastMessageDate ?? null
      }
      return {
        id: c.id,
        contact_name: c.fullName?.trim() || "(unknown)",
        last_inbound_at,
        last_outbound_at,
        snippet: c.lastMessageBody?.slice(0, 200) ?? null,
      }
    })

    return { rows, status: "ok", detail: null }
  } catch (err) {
    return { rows: [], status: "error", detail: (err as Error).message }
  }
}

export interface InboxSlaSnapshot extends InboxSlaOutput {
  id: string
  snapshot_at: string
  fetch_status: FetchStatus
}

export async function insertInboxSnapshot(
  supabase: SupabaseClient,
  row: InboxSlaOutput & { fetch_status: FetchStatus; raw?: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabase.from("inbox_sla_snapshots").insert(row)
  if (error) throw new Error(`insertInboxSnapshot: ${error.message}`)
}

export async function latestInboxSnapshot(
  supabase: SupabaseClient,
): Promise<InboxSlaSnapshot | null> {
  const { data } = await supabase
    .from("inbox_sla_snapshots")
    .select("*")
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as InboxSlaSnapshot | null) ?? null
}

export async function listRecentInboxSnapshots(
  supabase: SupabaseClient,
  days = 14,
): Promise<InboxSlaSnapshot[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data } = await supabase
    .from("inbox_sla_snapshots")
    .select("*")
    .gte("snapshot_at", cutoff)
    .order("snapshot_at", { ascending: false })
  return (data ?? []) as InboxSlaSnapshot[]
}
