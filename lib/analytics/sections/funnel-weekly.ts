// lib/analytics/sections/funnel-weekly.ts
import { getSubscriberDeltaInRange } from "@/lib/db/newsletter"
import { countLeadsInRange } from "@/lib/db/shop-leads"
import { getDailyTotalsInRange } from "@/lib/db/google-ads-metrics"
import { countByAttributionSourceInRange } from "@/lib/db/marketing-attribution"
import type { DateRange, WeeklyFunnelPayload, WeeklyDelta } from "@/types/coach-emails"

interface Options {
  range: DateRange
  previousRange: DateRange
}

function delta(current: number, previous: number): WeeklyDelta {
  return { current, previous }
}

export async function buildWeeklyFunnel(opts: Options): Promise<WeeklyFunnelPayload | null> {
  const { range, previousRange } = opts
  const [
    nlCurrent,
    nlPrev,
    leadsCurrent,
    leadsPrev,
    adsCurrent,
    adsPrev,
    attribution,
  ] = await Promise.all([
    getSubscriberDeltaInRange(range.from, range.to),
    getSubscriberDeltaInRange(previousRange.from, previousRange.to),
    countLeadsInRange(range.from, range.to),
    countLeadsInRange(previousRange.from, previousRange.to),
    getDailyTotalsInRange(range.from, range.to),
    getDailyTotalsInRange(previousRange.from, previousRange.to),
    countByAttributionSourceInRange(range.from, range.to),
  ])

  const newsletterCurrent = nlCurrent.added - nlCurrent.removed
  const newsletterPrev = nlPrev.added - nlPrev.removed
  const adSpendCurrent = Math.round(adsCurrent.cost_micros / 10_000)
  const adSpendPrev = Math.round(adsPrev.cost_micros / 10_000)
  const cplCurrent =
    adsCurrent.conversions > 0 ? Math.round(adSpendCurrent / adsCurrent.conversions) : 0
  const cplPrev =
    adsPrev.conversions > 0 ? Math.round(adSpendPrev / adsPrev.conversions) : 0

  const totalInflow =
    newsletterCurrent +
    newsletterPrev +
    leadsCurrent +
    leadsPrev +
    adsCurrent.conversions +
    adsPrev.conversions
  if (totalInflow === 0) return null

  return {
    newsletterNetDelta: delta(newsletterCurrent, newsletterPrev),
    shopLeads: delta(leadsCurrent, leadsPrev),
    adSpendCents: delta(adSpendCurrent, adSpendPrev),
    adCplCents: delta(cplCurrent, cplPrev),
    adConversions: delta(adsCurrent.conversions, adsPrev.conversions),
    topCampaign: null, // wire later — needs campaign-grain rollup w/ name
    attributionBySource: attribution.slice(0, 5),
  }
}
