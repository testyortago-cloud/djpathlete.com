// lib/analytics/sections/top-of-mind.ts
import type {
  WeeklyCoachingPayload,
  WeeklyRevenuePayload,
  WeeklyFunnelPayload,
  WeeklyTopOfMindBullet,
} from "@/types/coach-emails"

interface Candidate {
  label: string
  current: number
  previous: number
  floor: number // skip the metric if previous < floor
  /** When `false`, an INCREASE is interpreted as bad (e.g., response time, refunds). */
  higherIsBetter: boolean
  formatter: (current: number, deltaPct: number) => string
}

interface Options {
  coaching: WeeklyCoachingPayload | null
  revenue: WeeklyRevenuePayload | null
  funnel: WeeklyFunnelPayload | null
}

const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`

export function buildTopOfMind(opts: Options): WeeklyTopOfMindBullet[] {
  const candidates: Candidate[] = []

  if (opts.coaching) {
    candidates.push({
      label: "Active clients",
      current: opts.coaching.activeClients.current,
      previous: opts.coaching.activeClients.previous,
      floor: 3,
      higherIsBetter: true,
      formatter: (c, d) => `Active clients ${c} (${fmtPct(d)} vs prev week)`,
    })
    candidates.push({
      label: "Sessions completed",
      current: opts.coaching.sessionsCompleted.current,
      previous: opts.coaching.sessionsCompleted.previous,
      floor: 5,
      higherIsBetter: true,
      formatter: (c, d) => `Sessions completed ${c} (${fmtPct(d)})`,
    })
    candidates.push({
      label: "Form review response time",
      current: opts.coaching.avgFormReviewResponseHours.current,
      previous: opts.coaching.avgFormReviewResponseHours.previous,
      floor: 4,
      higherIsBetter: false,
      formatter: (c, d) => `Form review response time ${c}h (${fmtPct(d)})`,
    })
  }
  if (opts.revenue) {
    candidates.push({
      label: "MRR",
      current: opts.revenue.mrrCents.current,
      previous: opts.revenue.mrrCents.previous,
      floor: 5000,
      higherIsBetter: true,
      formatter: (c, d) => `MRR $${(c / 100).toFixed(0)} (${fmtPct(d)})`,
    })
    candidates.push({
      label: "Shop revenue",
      current: opts.revenue.shopRevenueCents.current,
      previous: opts.revenue.shopRevenueCents.previous,
      floor: 5000,
      higherIsBetter: true,
      formatter: (c, d) => `Shop revenue $${(c / 100).toFixed(0)} (${fmtPct(d)})`,
    })
  }
  if (opts.funnel) {
    candidates.push({
      label: "Newsletter net",
      current: opts.funnel.newsletterNetDelta.current,
      previous: opts.funnel.newsletterNetDelta.previous,
      floor: 5,
      higherIsBetter: true,
      formatter: (c, d) => `Newsletter +${c} (${fmtPct(d)})`,
    })
    candidates.push({
      label: "Ad CPL",
      current: opts.funnel.adCplCents.current,
      previous: opts.funnel.adCplCents.previous,
      floor: 1000,
      higherIsBetter: false,
      formatter: (c, d) => `Ad CPL $${(c / 100).toFixed(2)} (${fmtPct(d)})`,
    })
  }

  type Scored = { bullet: WeeklyTopOfMindBullet; absDelta: number }
  const scored: Scored[] = []
  for (const c of candidates) {
    if (c.previous < c.floor) continue
    if (c.previous === 0) continue
    const deltaPct = ((c.current - c.previous) / c.previous) * 100
    const positive = c.higherIsBetter ? deltaPct >= 0 : deltaPct <= 0
    scored.push({
      bullet: {
        text: c.formatter(c.current, deltaPct),
        positive: deltaPct === 0 ? null : positive,
      },
      absDelta: Math.abs(deltaPct),
    })
  }
  scored.sort((a, b) => b.absDelta - a.absDelta)
  const top = scored.slice(0, 5).map((s) => s.bullet)
  if (top.length === 0) return [{ text: "Quiet week across the board.", positive: null }]
  return top
}
