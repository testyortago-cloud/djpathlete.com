// types/coach-emails.ts
// Shared payload shapes for the Daily Brief and Weekly Review emails.
// Each section builder under lib/analytics/sections/ returns its own payload
// type or null. The orchestrator assembles them into DailyBriefPayload /
// WeeklyReviewPayload, which the React email components render conditionally.

export interface DateRange {
  from: Date
  to: Date
}

// ----- Daily sections -----

export interface DailyBookingsPayload {
  callsToday: Array<{ time: string; clientName: string; type: string }>
  newSignupsOvernight: number
}

export interface DailyCoachingPayload {
  formReviewsAwaiting: { count: number; oldestAgeHours: number } | null
  atRiskClients: Array<{ name: string; daysSinceLastLog: number }>
  lowRpeLogFlags: number
  voiceDriftFlags: number
}

export interface DailyContentPipelinePayload {
  awaitingReview: number
  readyToPublish: number
  scheduledToday: number
  videosAwaitingTranscription: number
  blogsInDraft: number
}

export interface DailyRevenueFunnelPayload {
  newOrders: number
  orderRevenueCents: number
  newSubs: number
  cancelledSubs: number
  newsletterNetDelta: number
  adSpendCents: number
  adConversions: number
  adCplCents: number | null
}

export interface DailyAnomalyFlag {
  label: string
  detail: string
}

export interface DailyAnomaliesPayload {
  flags: DailyAnomalyFlag[]
}

export interface DailyTrendingTopic {
  title: string
  summary: string
  sourceUrl: string | null
}

export interface DailyBriefPayload {
  referenceDate: Date
  isMondayEdition: boolean
  bookings: DailyBookingsPayload | null
  coaching: DailyCoachingPayload | null
  pipeline: DailyContentPipelinePayload // always present (existing behaviour)
  revenueFunnel: DailyRevenueFunnelPayload | null
  anomalies: DailyAnomaliesPayload | null
  trendingTopics: DailyTrendingTopic[] // populated only on Monday
  dashboardUrl: string
}

// ----- Weekly sections -----

export interface WeeklyDelta<T = number> {
  current: T
  previous: T
}

export interface WeeklyCoachingPayload {
  activeClients: WeeklyDelta
  sessionsCompleted: WeeklyDelta
  programCompletionRatePct: WeeklyDelta
  formReviewsDelivered: WeeklyDelta
  avgFormReviewResponseHours: WeeklyDelta
  silentClients: number // gone silent (no log in 14+ days)
}

export interface WeeklyRevenuePayload {
  mrrCents: WeeklyDelta
  newSubs: WeeklyDelta
  cancelledSubs: WeeklyDelta
  renewedSubs: WeeklyDelta
  shopRevenueCents: WeeklyDelta
  refundsCents: WeeklyDelta
}

export interface WeeklyFunnelPayload {
  newsletterNetDelta: WeeklyDelta
  shopLeads: WeeklyDelta
  adSpendCents: WeeklyDelta
  adCplCents: WeeklyDelta
  adConversions: WeeklyDelta
  topCampaign: { name: string; conversions: number; cpl: number } | null
  attributionBySource: Array<{ source: string; count: number }>
}

export interface WeeklyOpsHealthPayload {
  aiTokenSpendUsd: number | null // null when within expected band
  generationFailureRatePct: number | null // null when below threshold
  voiceDriftFlagCount: number // > 0 when surfaced
  cronSkipCount: number // > 0 when surfaced
}

export interface WeeklyTopOfMindBullet {
  text: string
  positive: boolean | null // null = neutral
}

export interface WeeklyReviewPayload {
  rangeStart: Date
  rangeEnd: Date
  topOfMind: WeeklyTopOfMindBullet[] // always at least one
  coaching: WeeklyCoachingPayload | null
  revenue: WeeklyRevenuePayload | null
  funnel: WeeklyFunnelPayload | null
  // existing payloads kept as-is
  social: import("./analytics").SocialMetrics
  content: import("./analytics").ContentMetrics
  opsHealth: WeeklyOpsHealthPayload | null
  dashboardUrl: string
}
