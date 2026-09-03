// lib/automation/campaign-revenue.ts — traces won pipeline revenue back to
// the campaign that produced it. Read-only; writes nothing.
//
// The join, entirely over columns Tasks 1-6 already wrote (no new column,
// no new table):
//
//   marketing_attribution.session_id
//      ← contacts.first_touch_session_id   (copied to opportunities.source_session_id
//                                            at card creation, lib/db/pipeline.ts)
//      → opportunities WHERE outcome = 'won'
//
// Two flat reads, grouped in memory — the DAL convention here is explicit
// reads with checked errors, never a cross-table Supabase join across
// opportunities -> contacts -> marketing_attribution.
//
// Revenue comes from `opportunities.value_cents`, never from `payments`.
// That is the number the board itself shows; re-deriving it from a second
// source invites the two numbers drifting apart, and then nobody knows
// which one is right.
//
// The unattributed bucket is not an edge case to drop, it is the point. A
// won deal fails to attribute in two distinct ways, and BOTH are real
// answers this reader must surface rather than silently swallow into "this
// campaign earned everything":
//   1. the opportunity has no source_session_id at all (no first touch was
//      ever captured for that contact), or
//   2. it has one, but no marketing_attribution row matches it.
// Both accumulate into the same `unattributedCount`/unattributed row below;
// neither ever just vanishes from the total.

import { createServiceRoleClient } from "@/lib/supabase"

type Row = Record<string, any>

export type CampaignRevenueRow = {
  utmSource: string | null
  utmCampaign: string | null
  // Final review, Minor: spec §7 groups by utm_campaign / utm_source /
  // gclid, not utm_medium. A gclid-only paid click (no utm_* params at all,
  // common on a plain Google Ads text ad) used to render as three em-dashes
  // — visually identical to the Unattributed bucket while still counted as
  // its own real campaign row.
  gclid: string | null
  wonCount: number
  wonValueCents: number
  unattributedCount: number
  isUnattributed: boolean
}

/**
 * Won revenue in `[since, until)`, grouped by (utm_campaign, utm_source,
 * gclid) per spec §7, plus one trailing "unattributed" row for won deals
 * that could not be traced back to a campaign at all.
 *
 * Every campaign row carries `isUnattributed: false` and `unattributedCount:
 * 0`. The bucket row carries `isUnattributed: true` — that flag, not
 * `unattributedCount > 0`, is the contract for finding it
 * (`rows.find(r => r.isUnattributed)`). Fix round 1, Finding 2: a
 * `unattributedCount > 0` check returns `undefined` in the one case that
 * must never be hidden — every deal in the window attributed cleanly — and
 * `undefined` is indistinguishable from "there is no bucket row at all".
 * `isUnattributed` stays `true` on that row regardless of its counts, so a
 * caller can always find it and render "Unattributed: $0" rather than
 * silently omitting the row. (Nor is "all three utm fields are null" a safe
 * signal on its own: a genuinely matched `marketing_attribution` row can
 * itself have null utm fields — e.g. a session captured only a
 * referrer/gclid — which is a different, real answer from "no match was
 * found at all".)
 *
 * Returns `[]` when nothing won in the window at all (e.g. launch month) —
 * that is a real, error-free answer, never a stand-in for a failed read.
 * When at least one deal won in the window, the unattributed row is ALWAYS
 * included even when its counts are zero (every deal attributed cleanly) —
 * the surface layer renders it as its own row either way, so a reader can
 * tell "we checked, and everything traced" apart from "this reader forgot
 * to compute the bucket".
 */
export async function readCampaignRevenue(input: {
  since: Date
  until: Date
  businessId: string
}): Promise<CampaignRevenueRow[]> {
  const supabase = createServiceRoleClient()

  const { data: oppData, error: oppErr } = await supabase
    .from("opportunities")
    .select("source_session_id, value_cents")
    .eq("business_id", input.businessId)
    .eq("outcome", "won")
    .gte("closed_at", input.since.toISOString())
    .lt("closed_at", input.until.toISOString())
  if (oppErr) throw oppErr
  const wonOpportunities = (oppData ?? []) as Row[]

  if (wonOpportunities.length === 0) return []

  // Second read: the attribution rows for the session ids these deals
  // actually carry (skip entirely, rather than call `.in()` with an empty
  // list, when every deal is missing a session id).
  const sessionIds = Array.from(
    new Set(wonOpportunities.map((o) => o.source_session_id as string | null).filter((id): id is string => id != null)),
  )

  let attributionRows: Row[] = []
  if (sessionIds.length > 0) {
    const { data: attrData, error: attrErr } = await supabase
      .from("marketing_attribution")
      .select("session_id, utm_source, utm_campaign, gclid")
      .in("session_id", sessionIds)
    if (attrErr) throw attrErr
    attributionRows = (attrData ?? []) as Row[]
  }

  const attributionBySession = new Map<string, Row>()
  for (const row of attributionRows) attributionBySession.set(row.session_id, row)

  type Bucket = {
    utmSource: string | null
    utmCampaign: string | null
    gclid: string | null
    wonCount: number
    wonValueCents: number
  }
  const buckets = new Map<string, Bucket>()
  let unattributedCount = 0
  let unattributedValueCents = 0

  for (const opp of wonOpportunities) {
    const valueCents = (opp.value_cents as number | null) ?? 0
    const sessionId = opp.source_session_id as string | null
    const attribution = sessionId ? attributionBySession.get(sessionId) : undefined

    // Both unattributed failure modes land here: no session_id at all
    // (`sessionId` is null), or a session_id with no matching
    // marketing_attribution row (`attribution` is undefined).
    if (!attribution) {
      unattributedCount += 1
      unattributedValueCents += valueCents
      continue
    }

    const utmSource = attribution.utm_source ?? null
    const utmCampaign = attribution.utm_campaign ?? null
    const gclid = attribution.gclid ?? null
    // JSON.stringify, not a delimiter-joined string: text-safe (diffs
    // normally, no raw control bytes in the source), and stays unambiguous
    // even when a utm value itself contains whatever delimiter a joined
    // string would have used. Fix round 1, Finding 1: an earlier version of
    // this key used a literal NUL byte as the separator, which made this
    // file binary to git (`git diff`/`git blame` blind on it) forever after.
    const key = JSON.stringify([utmCampaign, utmSource, gclid])

    const existing = buckets.get(key)
    if (existing) {
      existing.wonCount += 1
      existing.wonValueCents += valueCents
    } else {
      buckets.set(key, { utmSource, utmCampaign, gclid, wonCount: 1, wonValueCents: valueCents })
    }
  }

  const rows: CampaignRevenueRow[] = Array.from(buckets.values()).map((b) => ({
    ...b,
    unattributedCount: 0,
    isUnattributed: false,
  }))

  rows.push({
    utmSource: null,
    utmCampaign: null,
    gclid: null,
    wonCount: unattributedCount,
    wonValueCents: unattributedValueCents,
    unattributedCount,
    isUnattributed: true,
  })

  return rows
}
