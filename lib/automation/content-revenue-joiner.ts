// Pure first-touch-landing attribution. For each published blog post:
// - Sum GSC clicks/impressions for pages matching /blog/<slug>
// - Count marketing_attribution sessions whose landing_url matches that path
// - Sum succeeded payments from users that landed there (full credit, no decay)
//
// The caller is responsible for windowing the inputs (e.g. last 7d for GSC,
// last 30d for attribution lookback, ever for payments).

export interface JoinerInput {
  posts: Array<{ id: string; slug: string }>
  gsc: Array<{ page: string; clicks: number; impressions: number }>
  attributions: Array<{ user_id: string | null; landing_url: string | null }>
  payments: Array<{ user_id: string | null; amount_cents: number; status: string }>
}

export interface JoinerRow {
  blog_post_id: string
  gsc_clicks_7d: number
  gsc_impressions_7d: number
  sessions_from_post_7d: number
  bookings_attributed: number
  revenue_attributed_cents: number
}

/**
 * Returns true when `url` (relative or absolute) targets the blog post at
 * `/blog/<slug>` exactly — trailing slash and query string allowed; sub-paths
 * like /blog/<slug>-other don't match.
 */
export function matchesSlug(url: string | null, slug: string): boolean {
  if (!url) return false
  let path: string
  try {
    path = new URL(url, "https://example.com").pathname
  } catch {
    path = url
  }
  // strip trailing slash for comparison
  if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1)
  return path === `/blog/${slug}`
}

export function joinContentToRevenue(input: JoinerInput): JoinerRow[] {
  // Pre-index successful payments per user so we don't loop the whole list per post.
  const paymentsByUser: Record<string, number> = {}
  for (const p of input.payments) {
    if (p.status !== "succeeded" || !p.user_id) continue
    paymentsByUser[p.user_id] = (paymentsByUser[p.user_id] ?? 0) + p.amount_cents
  }

  return input.posts.map((post) => {
    let gsc_clicks_7d = 0
    let gsc_impressions_7d = 0
    for (const row of input.gsc) {
      if (!matchesSlug(row.page, post.slug)) continue
      gsc_clicks_7d += row.clicks
      gsc_impressions_7d += row.impressions
    }

    const landedUsers = new Set<string>()
    let sessions_from_post_7d = 0
    for (const a of input.attributions) {
      if (!matchesSlug(a.landing_url, post.slug)) continue
      sessions_from_post_7d += 1
      if (a.user_id) landedUsers.add(a.user_id)
    }

    let revenue_attributed_cents = 0
    for (const uid of landedUsers) {
      revenue_attributed_cents += paymentsByUser[uid] ?? 0
    }

    return {
      blog_post_id: post.id,
      gsc_clicks_7d,
      gsc_impressions_7d,
      sessions_from_post_7d,
      bookings_attributed: 0, // not derived here — bookings are keyed by email not user_id
      revenue_attributed_cents,
    }
  })
}
