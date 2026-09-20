// lib/automation/campaign-revenue.ts — what each campaign actually produced.
// Read-only; writes nothing.
//
// FOUR NUMBERS, NOT ONE. Until G15 this file counted WON DEALS ONLY, which on
// a real account is the rarest thing that happens: production holds 2 won
// opportunities against 572 attribution rows. A page that reports only the
// last step of the funnel cannot answer the question it exists for — "is this
// campaign working?" — because a campaign with 40 leads and no sale yet is
// indistinguishable from one nobody clicked.
//
//   Leads          contacts created in the window whose FIRST TOUCH was this
//                  campaign's session.
//   Registrations  opportunities created in the window, ANY outcome. Somebody
//                  who asked, whether or not it turned into a sale.
//   Won deals      opportunities whose outcome is `won` and which CLOSED in the
//                  window. Unchanged.
//   Won value      from `opportunities.value_cents`, never from `payments` —
//                  that is the number the board itself shows, and re-deriving
//                  it from a second source invites the two drifting apart.
//
// PAID EVENT SIGNUPS ARE NOT READ, AND THAT IS A CORRECTION. The row that
// asked for this feature said registrations were "opportunities created in the
// window, any outcome, PLUS paid `event_signups`", and the first cut of this
// file did exactly that — which double-counted every camp ticket. A completed
// `event_signup` checkout DOES mint a pipeline card:
// `NO_PIPELINE_CARD_CHECKOUT_TYPES` in app/api/stripe/webhook/route.ts is
// `{shop_order, save_card}` and nothing else, and that file's own comment says
// outright that `event_signup` "now DOES win a pipeline card once completed".
// So every paid signup is ALREADY one of the opportunities counted above.
// Worse than the double count: the two halves attributed through different
// keys — `source_session_id` for the opportunity, `gclid` for the signup — so
// one ticket could be counted into two different campaigns.
//
// THE WINDOWS ARE DIFFERENT ON PURPOSE. Leads and registrations count when
// they were CREATED; won deals count when they CLOSED. A deal that arrived in
// March and closed in September belongs to March's registrations and to
// September's revenue, and collapsing the two would make a good month look
// like a bad one.
//
// The joins, entirely over columns that already exist — no new column, no new
// table:
//
//   marketing_attribution.session_id
//      ← contacts.first_touch_session_id                     (leads)
//      ← opportunities.source_session_id                     (registrations, won)
//
// Flat reads grouped in memory — the DAL convention here is explicit reads
// with checked errors, never a cross-table Supabase join.
//
// ORGANIC FUNNEL LANDINGS GET THEIR OWN ROW. A session that landed on
// `/go/<slug>` with no utm parameters and no click id used to collapse into
// "— / — / —" beside genuinely unknown traffic. Production has 37 such
// sessions on one funnel, which is more than every paid campaign put together,
// and a coach cannot act on them while they are hidden inside "Unattributed".
// The slug is the campaign in everything but name: the coach built that page
// and sent people to it.
//
// The line is drawn at `/go/` DELIBERATELY. Grouping every organic landing by
// path would turn each blog post and marketing page into its own row and empty
// the unattributed bucket of its meaning — "we do not know where this came
// from" is a different statement from "they arrived on a funnel you built".
//
// The unattributed bucket is not an edge case to drop, it is the point. A row
// fails to attribute in three distinct ways, and ALL are real answers this
// reader must surface rather than swallow into "this campaign earned
// everything":
//   1. no session id at all (no first touch was ever captured), or
//   2. a session id with no matching marketing_attribution row, or
//   3. a matching row that identifies no campaign — no utm, no click id, and
//      not a funnel landing either.

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
  /**
   * The funnel a session landed on, when NOTHING else identifies it — no utm,
   * no click id. Null on every row that has one of those, so a campaign is
   * never described two ways at once.
   */
  landingSlug: string | null
  /** Contacts first touched by this campaign and created in the window. */
  leadCount: number
  /**
   * Opportunities created in the window, any outcome. A paid event signup is
   * one of these already — see the header for why it is not read separately.
   */
  registrationCount: number
  wonCount: number
  wonValueCents: number
  unattributedCount: number
  isUnattributed: boolean
}

/** What one row of any of the three sources contributes to its bucket. */
type Metric = "leadCount" | "registrationCount" | "wonCount"

type Bucket = {
  utmSource: string | null
  utmCampaign: string | null
  gclid: string | null
  landingSlug: string | null
  leadCount: number
  registrationCount: number
  wonCount: number
  wonValueCents: number
}

function emptyBucket(identity: Pick<Bucket, "utmSource" | "utmCampaign" | "gclid" | "landingSlug">): Bucket {
  return { ...identity, leadCount: 0, registrationCount: 0, wonCount: 0, wonValueCents: 0 }
}

/**
 * The funnel slug in a landing url, or null when it is not a funnel landing.
 *
 * `/go/athlete-quiz` and `/go/athlete-quiz/start` are the SAME funnel and must
 * land in one row — a coach thinks in funnels, not in funnel steps, and
 * splitting them would report one campaign as two.
 *
 * Tolerant of a url that will not parse: `landing_url` is written from a
 * browser and this is a reporting path, so an unparseable one is a row that
 * attributes to nothing rather than an exception that takes the page down.
 */
export function funnelSlugFromLandingUrl(landingUrl: string | null | undefined): string | null {
  if (!landingUrl) return null
  let path: string
  try {
    path = new URL(landingUrl).pathname
  } catch {
    // Not absolute — treat it as a path already, which is what a relative
    // value would be.
    path = landingUrl.startsWith("/") ? landingUrl : ""
  }
  const match = /^\/go\/([^/?#]+)/.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    // `decodeURIComponent` THROWS a URIError on a lone `%` — `/go/100%off` is
    // enough. `landing_url` is written from the browser and reachable by
    // anybody who can request a `/go` page, so one junk row would otherwise
    // 500 this whole report permanently. The raw segment is the honest
    // fallback: it still groups that funnel's sessions together.
    return match[1]
  }
}

/**
 * PostgREST's cap, which it applies by TRUNCATING rather than erroring. Every
 * read below pages: "all time" now scans the whole contacts table, and a
 * silently truncated attribution read is the nastier half — dropped rows do not
 * vanish, they re-classify a campaign's leads as Unattributed.
 */
const PAGE = 1000

/**
 * How many ids go into one `.in(...)`. The list travels in the QUERY STRING, so
 * an unchunked one 414s at scale and takes the page to the error boundary. 200
 * is this repo's convention — bookkeeping, chat, gsc-query-daily and
 * sequence-reporting all use it.
 */
const IN_CHUNK = 200

/** Reads every page of a query, rather than the first thousand rows of it. */
async function readAllPages(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Row[]> {
  const all: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Row[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

/**
 * Which bucket an attribution row belongs to, or null for "cannot be
 * attributed" — failure mode 3 in the header.
 *
 * `landingSlug` is only ever set when the other three are ALL null, so one
 * campaign can never be described both as a utm campaign and as a funnel.
 */
function identityFor(attribution: Row | undefined): Bucket | null {
  if (!attribution) return null

  const utmSource = (attribution.utm_source as string | null) ?? null
  const utmCampaign = (attribution.utm_campaign as string | null) ?? null
  const gclid = (attribution.gclid as string | null) ?? null
  if (utmSource || utmCampaign || gclid) {
    return emptyBucket({ utmSource, utmCampaign, gclid, landingSlug: null })
  }

  const landingSlug = funnelSlugFromLandingUrl(attribution.landing_url as string | null)
  if (landingSlug) return emptyBucket({ utmSource: null, utmCampaign: null, gclid: null, landingSlug })

  return null
}

/**
 * JSON.stringify, not a delimiter-joined string: text-safe (diffs normally, no
 * raw control bytes in the source), and stays unambiguous even when a utm value
 * itself contains whatever delimiter a joined string would have used. Fix round
 * 1, Finding 1: an earlier version of this key used a literal NUL byte as the
 * separator, which made this file binary to git (`git diff`/`git blame` blind
 * on it) forever after.
 */
function keyFor(bucket: Bucket): string {
  return JSON.stringify([bucket.utmCampaign, bucket.utmSource, bucket.gclid, bucket.landingSlug])
}

/**
 * What one campaign produced in `[since, until)`, grouped by
 * (utm_campaign, utm_source, gclid) — or by funnel slug for an organic funnel
 * landing — plus one trailing "unattributed" row.
 *
 * Every campaign row carries `isUnattributed: false` and `unattributedCount:
 * 0`. The bucket row carries `isUnattributed: true` — that flag, not
 * `unattributedCount > 0`, is the contract for finding it
 * (`rows.find(r => r.isUnattributed)`). Fix round 1, Finding 2: a
 * `unattributedCount > 0` check returns `undefined` in the one case that
 * must never be hidden — everything in the window attributed cleanly — and
 * `undefined` is indistinguishable from "there is no bucket row at all".
 *
 * Returns `[]` only when the window held NOTHING AT ALL — no lead, no
 * registration, no won deal. That is a real, error-free answer and never a
 * stand-in for a failed read. Note this is wider than it used to be: before
 * G15 an empty return meant "nothing WON", which hid a window full of leads.
 */
export async function readCampaignRevenue(input: {
  since: Date
  until: Date
  businessId: string
}): Promise<CampaignRevenueRow[]> {
  const supabase = createServiceRoleClient()
  const sinceIso = input.since.toISOString()
  const untilIso = input.until.toISOString()

  // ── The three sources ──────────────────────────────────────────────────

  // WON: closed in the window. The only one keyed on `closed_at`.
  const wonOpportunities = await readAllPages((from, to) =>
    supabase
      .from("opportunities")
      .select("source_session_id, value_cents")
      .eq("business_id", input.businessId)
      .eq("outcome", "won")
      .gte("closed_at", sinceIso)
      .lt("closed_at", untilIso)
      .range(from, to),
  )

  // REGISTRATIONS: created in the window, ANY outcome — including the won ones
  // above, which are registrations too. A deal that arrived and closed inside
  // one window is one registration and one won deal, not a registration that
  // stopped counting because it succeeded. This is also where a paid event
  // signup is counted, exactly once — see the header.
  const registrations = await readAllPages((from, to) =>
    supabase
      .from("opportunities")
      .select("source_session_id")
      .eq("business_id", input.businessId)
      .gte("created_at", sinceIso)
      .lt("created_at", untilIso)
      .range(from, to),
  )

  // LEADS: contacts whose first touch was captured, created in the window.
  const leads = await readAllPages((from, to) =>
    supabase
      .from("contacts")
      .select("first_touch_session_id")
      .eq("business_id", input.businessId)
      .gte("created_at", sinceIso)
      .lt("created_at", untilIso)
      .range(from, to),
  )

  if (wonOpportunities.length === 0 && registrations.length === 0 && leads.length === 0) {
    return []
  }

  // ── The attribution rows those sources point at ────────────────────────

  const sessionIds = Array.from(
    new Set(
      [
        ...wonOpportunities.map((o) => o.source_session_id),
        ...registrations.map((o) => o.source_session_id),
        ...leads.map((c) => c.first_touch_session_id),
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  )

  // One read for every source's sessions, not one per source: the same session
  // is commonly all three (somebody landed, asked and bought). Chunked because
  // the id list travels in the query string — see IN_CHUNK.
  const attributionBySession = new Map<string, Row>()
  for (let i = 0; i < sessionIds.length; i += IN_CHUNK) {
    const chunk = sessionIds.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase
      .from("marketing_attribution")
      .select("session_id, utm_source, utm_campaign, gclid, landing_url")
      .in("session_id", chunk)
    if (error) throw error
    // No paging inside a chunk: `session_id` identifies one session, so at
    // most IN_CHUNK rows can come back and the cap is never in reach.
    for (const row of (data ?? []) as Row[]) attributionBySession.set(row.session_id, row)
  }

  // ── Grouping ───────────────────────────────────────────────────────────

  const buckets = new Map<string, Bucket>()
  const unattributed = emptyBucket({ utmSource: null, utmCampaign: null, gclid: null, landingSlug: null })
  let unattributedCount = 0

  function add(attribution: Row | undefined, metric: Metric, valueCents = 0): void {
    const identity = identityFor(attribution)
    if (!identity) {
      unattributed[metric] += 1
      unattributed.wonValueCents += valueCents
      unattributedCount += 1
      return
    }
    const key = keyFor(identity)
    const bucket = buckets.get(key) ?? identity
    bucket[metric] += 1
    bucket.wonValueCents += valueCents
    buckets.set(key, bucket)
  }

  const sessionOf = (id: unknown) => (typeof id === "string" && id ? attributionBySession.get(id) : undefined)

  for (const lead of leads) add(sessionOf(lead.first_touch_session_id), "leadCount")
  for (const reg of registrations) add(sessionOf(reg.source_session_id), "registrationCount")
  for (const won of wonOpportunities) {
    add(sessionOf(won.source_session_id), "wonCount", (won.value_cents as number | null) ?? 0)
  }

  const rows: CampaignRevenueRow[] = Array.from(buckets.values()).map((b) => ({
    ...b,
    unattributedCount: 0,
    isUnattributed: false,
  }))

  rows.push({ ...unattributed, unattributedCount, isUnattributed: true })

  return rows
}
