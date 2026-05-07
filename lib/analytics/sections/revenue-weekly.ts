// lib/analytics/sections/revenue-weekly.ts
import {
  listSubscriptionsChangedInRange, countRenewalsInRange, getMrrCents,
} from "@/lib/db/subscriptions"
import { listOrdersInRange, sumRefundsInRange } from "@/lib/db/shop-orders"
import type { DateRange, WeeklyRevenuePayload } from "@/types/coach-emails"

interface Options { range: DateRange; previousRange: DateRange }

function sumOrders(orders: Array<{ total_cents?: number }>): number {
  return orders.reduce((sum, o) => sum + (o.total_cents ?? 0), 0)
}

export async function buildWeeklyRevenue(opts: Options): Promise<WeeklyRevenuePayload | null> {
  const { range, previousRange } = opts
  const [
    subsCurrent, subsPrev,
    renewCurrent, renewPrev,
    mrrCurrent,
    ordersCurrent, ordersPrev,
    refundsCurrent, refundsPrev,
  ] = await Promise.all([
    listSubscriptionsChangedInRange(range.from, range.to),
    listSubscriptionsChangedInRange(previousRange.from, previousRange.to),
    countRenewalsInRange(range.from, range.to),
    countRenewalsInRange(previousRange.from, previousRange.to),
    getMrrCents(),
    listOrdersInRange(range.from, range.to),
    listOrdersInRange(previousRange.from, previousRange.to),
    sumRefundsInRange(range.from, range.to),
    sumRefundsInRange(previousRange.from, previousRange.to),
  ])

  const shopRevenueCurrent = sumOrders(ordersCurrent as Array<{ total_cents?: number }>)
  const shopRevenuePrev = sumOrders(ordersPrev as Array<{ total_cents?: number }>)

  const allZero =
    subsCurrent.created + subsCurrent.cancelled + subsPrev.created + subsPrev.cancelled === 0 &&
    renewCurrent + renewPrev === 0 &&
    mrrCurrent === 0 &&
    shopRevenueCurrent + shopRevenuePrev === 0 &&
    refundsCurrent + refundsPrev === 0
  if (allZero) return null

  return {
    mrrCents: { current: mrrCurrent, previous: 0 }, // previous MRR not historically tracked
    newSubs: { current: subsCurrent.created, previous: subsPrev.created },
    cancelledSubs: { current: subsCurrent.cancelled, previous: subsPrev.cancelled },
    renewedSubs: { current: renewCurrent, previous: renewPrev },
    shopRevenueCents: { current: shopRevenueCurrent, previous: shopRevenuePrev },
    refundsCents: { current: refundsCurrent, previous: refundsPrev },
  }
}
