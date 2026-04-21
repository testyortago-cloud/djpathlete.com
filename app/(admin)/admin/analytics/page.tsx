import { getUsers } from "@/lib/db/users"
import { getPrograms } from "@/lib/db/programs"
import { getPaymentsWithDetails } from "@/lib/db/payments"
import { getAssignments } from "@/lib/db/assignments"
import { getAllProgress } from "@/lib/db/progress"
import { getAllAchievements } from "@/lib/db/achievements"
import { getAllProfiles } from "@/lib/db/client-profiles"
import { listOrders } from "@/lib/db/shop-orders"
import { listSocialPosts } from "@/lib/db/social-posts"
import { listSocialAnalyticsInRange } from "@/lib/db/social-analytics"
import { getBlogPosts } from "@/lib/db/blog-posts"
import { getNewsletters } from "@/lib/db/newsletters"
import { getActiveSubscribers } from "@/lib/db/newsletter"
import {
  computeRevenueMetrics,
  computeClientMetrics,
  computeProgramMetrics,
  computeEngagementMetrics,
  computeShopMetrics,
  computeDateRange,
} from "@/lib/analytics/compute"
import { computeSocialMetrics } from "@/lib/analytics/social"
import { computeContentMetrics } from "@/lib/analytics/content"
import { AnalyticsDashboard } from "@/components/admin/analytics/AnalyticsDashboard"
import type { User, Program, ProgramAssignment } from "@/types/database"

export const metadata = { title: "Analytics" }

const VALID_TABS = ["revenue", "shop", "clients", "programs", "engagement", "social", "content"] as const
const VALID_MONTHS = [0, 1, 3, 6, 12] as const

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string
    months?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams

  // Parse tab
  const tab = VALID_TABS.includes(params.tab as (typeof VALID_TABS)[number]) ? (params.tab as string) : "revenue"

  // Parse date range
  const rawMonths = Number(params.months)
  const months = VALID_MONTHS.includes(rawMonths as (typeof VALID_MONTHS)[number]) ? rawMonths : 6
  const customFrom = params.from
  const customTo = params.to

  // Fetch all data in parallel
  const [
    users,
    programs,
    payments,
    assignments,
    progress,
    achievements,
    profiles,
    shopOrders,
    socialPosts,
    blogPosts,
    newsletters,
    activeSubscribers,
  ] = await Promise.all([
    getUsers(),
    getPrograms(),
    getPaymentsWithDetails(),
    getAssignments(),
    getAllProgress(),
    getAllAchievements(),
    getAllProfiles(),
    listOrders(),
    listSocialPosts(),
    getBlogPosts(),
    getNewsletters(),
    getActiveSubscribers(),
  ])

  // Determine earliest date for "All" range
  const allDates = [
    ...payments.map((p) => new Date(p.created_at)),
    ...(users as User[]).map((u) => new Date(u.created_at)),
    ...shopOrders.map((o) => new Date(o.created_at)),
  ]
  const earliestDate = allDates.length > 0 ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : undefined

  // Compute date range
  const { range, previousRange } = computeDateRange(months, customFrom, customTo, earliestDate)

  // Social analytics snapshots are range-scoped on read (potentially many rows per post per year).
  const socialAnalytics = await listSocialAnalyticsInRange(range.from, range.to)

  // Compute metrics for all tabs
  const revenue = computeRevenueMetrics(payments, range, previousRange)
  const shop = computeShopMetrics(shopOrders, range, previousRange)
  const clients = computeClientMetrics(users as User[], profiles, assignments as ProgramAssignment[], range)
  const programMetrics = computeProgramMetrics(programs as Program[], assignments as ProgramAssignment[], range)
  const engagement = computeEngagementMetrics(progress, achievements, users as User[], range)
  const social = computeSocialMetrics(socialPosts, socialAnalytics, range, previousRange)
  const content = computeContentMetrics(blogPosts, newsletters, activeSubscribers.length, range, previousRange)

  return (
    <AnalyticsDashboard
      activeTab={tab}
      currentMonths={months}
      customFrom={customFrom}
      customTo={customTo}
      revenue={revenue}
      shop={shop}
      clients={clients}
      programs={programMetrics}
      engagement={engagement}
      social={social}
      content={content}
    />
  )
}
