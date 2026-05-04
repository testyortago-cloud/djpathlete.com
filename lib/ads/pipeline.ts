// lib/ads/pipeline.ts
// Phase 1.5f — pipeline funnel aggregator. Builds the visit → signup →
// booking → payment funnel and breaks it down by utm_source + utm_campaign.
//
// Joining model: action tables (newsletter_subscribers, bookings, payments)
// only have gclid columns (utm_* lives on marketing_attribution). To bucket
// actions by utm_campaign we look up the action's gclid in
// marketing_attribution and pull its utm_campaign forward. Actions without
// a gclid match fall into "(direct)" — typically organic traffic that the
// admin reaches via newsletter sign-ups or direct booking links.
//
// JS-side joining vs raw SQL: for one advertiser's traffic (low thousands
// of rows) the network round-trips dominate, not the join. Pulling full
// rows and merging in memory keeps the code in one place and avoids a
// Postgres function for now. If volumes grow > ~50k rows, lift this into
// a SECURITY DEFINER RPC.

import { createServiceRoleClient } from "@/lib/supabase"

type ClickIdSource = "gclid" | "gbraid" | "wbraid" | "fbclid"

interface AttributionRow {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
}

interface ActionRow {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

interface AttributionMap {
  byGclid: Map<string, AttributionRow>
  byGbraid: Map<string, AttributionRow>
  byWbraid: Map<string, AttributionRow>
  byFbclid: Map<string, AttributionRow>
}

export interface FunnelTotals {
  visits: number
  signups: number
  bookings: number
  payments: number
  revenue_cents: number
}

export interface FunnelDeltaPct {
  visits: number | null
  signups: number | null
  bookings: number | null
  payments: number | null
  revenue_cents: number | null
}

export interface FunnelBreakdownRow {
  /** "(direct)" if the dimension wasn't tagged */
  dimension: string
  visits: number
  signups: number
  bookings: number
  payments: number
  revenue_cents: number
}

export interface PipelineFunnel {
  rangeStart: Date
  rangeEnd: Date
  totals: FunnelTotals
  deltaPct?: FunnelDeltaPct
  bySource: FunnelBreakdownRow[]
  byCampaign: FunnelBreakdownRow[]
}

interface RangeParams {
  rangeStart: Date
  rangeEnd: Date
}

function isoDate(d: Date): string {
  return d.toISOString()
}

async function fetchAttributionInRange({ rangeStart, rangeEnd }: RangeParams): Promise<AttributionRow[]> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("gclid, gbraid, wbraid, fbclid, utm_source, utm_medium, utm_campaign")
    .gte("first_seen_at", isoDate(rangeStart))
    .lte("first_seen_at", isoDate(rangeEnd))
  if (error) throw error
  return (data ?? []) as AttributionRow[]
}

async function fetchSignupsInRange({ rangeStart, rangeEnd }: RangeParams): Promise<ActionRow[]> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("gclid, gbraid, wbraid, fbclid")
    .is("unsubscribed_at", null)
    .gte("subscribed_at", isoDate(rangeStart))
    .lte("subscribed_at", isoDate(rangeEnd))
  if (error) throw error
  return (data ?? []) as ActionRow[]
}

async function fetchBookingsInRange({ rangeStart, rangeEnd }: RangeParams): Promise<ActionRow[]> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("gclid, gbraid, wbraid, fbclid")
    .gte("created_at", isoDate(rangeStart))
    .lte("created_at", isoDate(rangeEnd))
  if (error) throw error
  return (data ?? []) as ActionRow[]
}

interface PaymentRow extends ActionRow {
  amount_cents: number
}

async function fetchPaymentsInRange({ rangeStart, rangeEnd }: RangeParams): Promise<PaymentRow[]> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("payments")
    .select("gclid, gbraid, wbraid, fbclid, amount_cents")
    .eq("status", "succeeded")
    .gte("created_at", isoDate(rangeStart))
    .lte("created_at", isoDate(rangeEnd))
  if (error) throw error
  return (data ?? []) as PaymentRow[]
}

function buildAttributionMap(rows: AttributionRow[]): AttributionMap {
  const byGclid = new Map<string, AttributionRow>()
  const byGbraid = new Map<string, AttributionRow>()
  const byWbraid = new Map<string, AttributionRow>()
  const byFbclid = new Map<string, AttributionRow>()
  for (const r of rows) {
    if (r.gclid) byGclid.set(r.gclid, r)
    if (r.gbraid) byGbraid.set(r.gbraid, r)
    if (r.wbraid) byWbraid.set(r.wbraid, r)
    if (r.fbclid) byFbclid.set(r.fbclid, r)
  }
  return { byGclid, byGbraid, byWbraid, byFbclid }
}

function resolveAttribution(
  action: ActionRow,
  map: AttributionMap,
): AttributionRow | null {
  if (action.gclid && map.byGclid.has(action.gclid)) return map.byGclid.get(action.gclid)!
  if (action.gbraid && map.byGbraid.has(action.gbraid)) return map.byGbraid.get(action.gbraid)!
  if (action.wbraid && map.byWbraid.has(action.wbraid)) return map.byWbraid.get(action.wbraid)!
  if (action.fbclid && map.byFbclid.has(action.fbclid)) return map.byFbclid.get(action.fbclid)!
  return null
}

interface DimensionBucket {
  visits: number
  signups: number
  bookings: number
  payments: number
  revenue_cents: number
}

function emptyBucket(): DimensionBucket {
  return { visits: 0, signups: 0, bookings: 0, payments: 0, revenue_cents: 0 }
}

const DIRECT_DIMENSION = "(direct)"

function bumpDimension(
  map: Map<string, DimensionBucket>,
  dimension: string,
  field: keyof DimensionBucket,
  amount: number,
): void {
  const cur = map.get(dimension) ?? emptyBucket()
  cur[field] += amount
  map.set(dimension, cur)
}

function dimensionsFromMap(map: Map<string, DimensionBucket>): FunnelBreakdownRow[] {
  return Array.from(map.entries())
    .map(([dimension, b]) => ({ dimension, ...b }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents || b.bookings - a.bookings || b.visits - a.visits)
}

export async function buildPipelineFunnel(params: RangeParams): Promise<PipelineFunnel> {
  const { rangeStart, rangeEnd } = params
  const [attribution, signups, bookings, payments] = await Promise.all([
    fetchAttributionInRange(params),
    fetchSignupsInRange(params),
    fetchBookingsInRange(params),
    fetchPaymentsInRange(params),
  ])

  const attrMap = buildAttributionMap(attribution)

  const bySource = new Map<string, DimensionBucket>()
  const byCampaign = new Map<string, DimensionBucket>()

  // Visits: every attribution row counts as one visit. Bucketed by its own
  // utm_source / utm_campaign.
  for (const a of attribution) {
    const source = a.utm_source ?? DIRECT_DIMENSION
    const campaign = a.utm_campaign ?? DIRECT_DIMENSION
    bumpDimension(bySource, source, "visits", 1)
    bumpDimension(byCampaign, campaign, "visits", 1)
  }

  function attribute(action: ActionRow, field: keyof DimensionBucket, amount: number) {
    const ref = resolveAttribution(action, attrMap)
    const source = ref?.utm_source ?? DIRECT_DIMENSION
    const campaign = ref?.utm_campaign ?? DIRECT_DIMENSION
    bumpDimension(bySource, source, field, amount)
    bumpDimension(byCampaign, campaign, field, amount)
  }

  for (const s of signups) attribute(s, "signups", 1)
  for (const b of bookings) attribute(b, "bookings", 1)
  for (const p of payments) {
    attribute(p, "payments", 1)
    attribute(p, "revenue_cents", p.amount_cents)
  }

  const totals: FunnelTotals = {
    visits: attribution.length,
    signups: signups.length,
    bookings: bookings.length,
    payments: payments.length,
    revenue_cents: payments.reduce((sum, p) => sum + p.amount_cents, 0),
  }

  return {
    rangeStart,
    rangeEnd,
    totals,
    bySource: dimensionsFromMap(bySource),
    byCampaign: dimensionsFromMap(byCampaign),
  }
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

export async function buildPipelineFunnelWithComparison(
  params: RangeParams,
): Promise<PipelineFunnel> {
  const span = params.rangeEnd.getTime() - params.rangeStart.getTime()
  const previous = {
    rangeStart: new Date(params.rangeStart.getTime() - span),
    rangeEnd: params.rangeStart,
  }
  const [current, prior] = await Promise.all([
    buildPipelineFunnel(params),
    buildPipelineFunnel(previous),
  ])
  const deltaPct: FunnelDeltaPct = {
    visits: pctDelta(current.totals.visits, prior.totals.visits),
    signups: pctDelta(current.totals.signups, prior.totals.signups),
    bookings: pctDelta(current.totals.bookings, prior.totals.bookings),
    payments: pctDelta(current.totals.payments, prior.totals.payments),
    revenue_cents: pctDelta(current.totals.revenue_cents, prior.totals.revenue_cents),
  }
  return { ...current, deltaPct }
}

/**
 * Conversion ratios at each funnel stage. Returned as 0-1 floats; UI
 * formats as percentages. Defaults to 0 when the upstream stage is empty
 * (avoids divide-by-zero NaN bleeding into the UI).
 */
export interface FunnelRates {
  visit_to_signup: number
  signup_to_booking: number
  booking_to_payment: number
}

export function computeRates(totals: FunnelTotals): FunnelRates {
  return {
    visit_to_signup: totals.visits > 0 ? totals.signups / totals.visits : 0,
    signup_to_booking: totals.signups > 0 ? totals.bookings / totals.signups : 0,
    booking_to_payment: totals.bookings > 0 ? totals.payments / totals.bookings : 0,
  }
}

export type { ClickIdSource }
