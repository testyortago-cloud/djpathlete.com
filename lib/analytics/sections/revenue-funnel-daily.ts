// lib/analytics/sections/revenue-funnel-daily.ts
import { listOrdersInRange } from "@/lib/db/shop-orders"
import { listSubscriptionsChangedInRange } from "@/lib/db/subscriptions"
import { getSubscriberDeltaInRange } from "@/lib/db/newsletter"
import { getDailyTotalsInRange } from "@/lib/db/google-ads-metrics"
import type { DailyRevenueFunnelPayload } from "@/types/coach-emails"

interface Options {
  referenceDate: Date
}

export async function buildDailyRevenueFunnel(opts: Options): Promise<DailyRevenueFunnelPayload | null> {
  const yesterdayStart = new Date(opts.referenceDate)
  yesterdayStart.setHours(0, 0, 0, 0)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)
  const todayStart = new Date(opts.referenceDate)
  todayStart.setHours(0, 0, 0, 0)

  const [orders, subs, newsletter, ads] = await Promise.all([
    listOrdersInRange(yesterdayStart, todayStart),
    listSubscriptionsChangedInRange(yesterdayStart, todayStart),
    getSubscriberDeltaInRange(yesterdayStart, todayStart),
    getDailyTotalsInRange(yesterdayStart, todayStart),
  ])

  const newOrders = orders.length
  const orderRevenueCents = orders.reduce(
    (sum, o) => sum + ((o as unknown as { total_cents?: number }).total_cents ?? 0),
    0,
  )
  const adSpendCents = Math.round(ads.cost_micros / 10_000)
  const adCplCents = ads.conversions > 0 ? Math.round(adSpendCents / ads.conversions) : null
  const newsletterNetDelta = newsletter.added - newsletter.removed

  const allZero =
    newOrders === 0 &&
    orderRevenueCents === 0 &&
    subs.created === 0 &&
    subs.cancelled === 0 &&
    newsletterNetDelta === 0 &&
    adSpendCents === 0 &&
    ads.conversions === 0
  if (allZero) return null

  return {
    newOrders,
    orderRevenueCents,
    newSubs: subs.created,
    cancelledSubs: subs.cancelled,
    newsletterNetDelta,
    adSpendCents,
    adConversions: ads.conversions,
    adCplCents,
  }
}
