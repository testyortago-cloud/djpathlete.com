import { getUsers } from "@/lib/db/users"
import { getPrograms } from "@/lib/db/programs"
import { getPaymentsWithDetails } from "@/lib/db/payments"
import { getAssignments } from "@/lib/db/assignments"
import { getAllProgress } from "@/lib/db/progress"
import { getAllAchievements } from "@/lib/db/achievements"
import { requireAdmin } from "@/lib/auth-helpers"
import { DashboardContent } from "@/components/admin/dashboard/DashboardContent"
import type { ActivityItem } from "@/components/admin/dashboard/ActivityFeed"
import type { Payment, ProgramAssignment, User } from "@/types/database"

export const metadata = { title: "Dashboard" }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

// Guest event signups (parent pays without a user account) and external Stripe
// checkouts have payments.user_id = null. Pull a meaningful label from
// metadata so the activity feed doesn't read "Unknown made a payment of …".
function resolvePaymentDisplayName(p: {
  users: { first_name: string; last_name: string } | null
  metadata: Record<string, unknown>
}): string {
  if (p.users) return `${p.users.first_name} ${p.users.last_name}`
  const meta = p.metadata ?? {}
  if (meta.type === "event_signup" && typeof meta.athlete_name === "string" && meta.athlete_name.trim().length > 0) {
    return `${meta.athlete_name}'s parent`
  }
  if (typeof meta.parent_email === "string" && meta.parent_email.length > 0) return meta.parent_email
  if (typeof meta.customerEmail === "string" && meta.customerEmail.length > 0) return meta.customerEmail
  return "Guest"
}

export default async function DashboardPage() {
  const session = await requireAdmin()
  const adminName = session.user?.name ?? "Admin"
  const adminFirstName = adminName.split(" ")[0]

  const [users, programs, payments, assignments, progress, achievements] = await Promise.all([
    getUsers(),
    getPrograms(),
    getPaymentsWithDetails(),
    getAssignments(),
    getAllProgress(500),
    getAllAchievements(15),
  ])

  const now = new Date()
  const clients = (users as User[]).filter((u) => u.role === "client")

  // ---- Stats ----
  const totalClients = clients.length
  const activePrograms = programs.length
  const succeededPayments = (
    payments as (Payment & { users: { first_name: string; last_name: string; email: string } | null })[]
  ).filter((p) => p.status === "succeeded")
  const totalRevenue = succeededPayments.reduce((s, p) => s + p.amount_cents, 0)
  const activeAssignments = (assignments as ProgramAssignment[]).filter((a) => a.status === "active").length

  // ---- Revenue trend (this month vs last month) ----
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const thisMonthRevenue = succeededPayments
    .filter((p) => new Date(p.created_at) >= thisMonthStart)
    .reduce((s, p) => s + p.amount_cents, 0)
  const lastMonthRevenue = succeededPayments
    .filter((p) => {
      const d = new Date(p.created_at)
      return d >= lastMonthStart && d < thisMonthStart
    })
    .reduce((s, p) => s + p.amount_cents, 0)

  // ---- Revenue by month (last 6) ----
  const revenueByMonth: { label: string; revenue: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = getMonthKey(d)
    const label = getMonthLabel(d)
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const revenue = succeededPayments
      .filter((p) => {
        const pd = new Date(p.created_at)
        return pd >= d && pd < nextMonth
      })
      .reduce((s, p) => s + p.amount_cents, 0)
    revenueByMonth.push({ label, revenue })
  }

  // ---- Engagement snapshot ----
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const workoutsThisWeek = progress.filter((p) => new Date(p.completed_at) >= weekAgo).length

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const prsThisMonth = progress.filter((p) => p.is_pr && new Date(p.completed_at) >= monthStart).length

  // Avg RPE (last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const recentRPE = progress
    .filter((p) => p.rpe != null && new Date(p.completed_at) >= thirtyDaysAgo)
    .map((p) => p.rpe!)
  const avgRPE =
    recentRPE.length > 0 ? Math.round((recentRPE.reduce((s, v) => s + v, 0) / recentRPE.length) * 10) / 10 : null

  // Active streaks: count users who logged a workout today or yesterday
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`

  const usersWithRecentWorkout = new Set<string>()
  for (const p of progress) {
    const d = new Date(p.completed_at)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    if (ds === today || ds === yesterdayStr) {
      usersWithRecentWorkout.add(p.user_id)
    }
  }
  const activeStreaks = usersWithRecentWorkout.size

  // ---- Activity feed (last 10 events) ----
  const programMap = new Map<string, string>()
  for (const prog of programs as { id: string; name: string }[]) {
    programMap.set(prog.id, prog.name)
  }

  const userMap = new Map<string, string>()
  for (const u of users as User[]) {
    userMap.set(u.id, `${u.first_name} ${u.last_name}`)
  }

  const feedItems: ActivityItem[] = []

  // Recent payments
  for (const p of payments.slice(0, 15)) {
    const name = resolvePaymentDisplayName(p)
    feedItems.push({
      id: `pay-${p.id}`,
      type: "payment",
      description: `${name} made a ${p.status} payment of ${formatCents(p.amount_cents)}`,
      time: p.created_at,
      date: new Date(p.created_at),
    })
  }

  // Recent assignments
  for (const a of (assignments as ProgramAssignment[]).slice(0, 15)) {
    const name = userMap.get(a.user_id) ?? "Unknown"
    const progName = programMap.get(a.program_id) ?? "a program"
    feedItems.push({
      id: `asgn-${a.id}`,
      type: "assignment",
      description: `${name} was assigned ${progName}`,
      time: a.created_at,
      date: new Date(a.created_at),
    })
  }

  // Recent achievements
  for (const a of achievements.slice(0, 15)) {
    const name = userMap.get(a.user_id) ?? "Unknown"
    feedItems.push({
      id: `ach-${a.id}`,
      type: "achievement",
      description: `${name} earned: ${a.title}`,
      time: a.earned_at,
      date: new Date(a.earned_at),
    })
  }

  // Sort by date descending, take 10
  feedItems.sort((a, b) => b.date.getTime() - a.date.getTime())
  const activityFeed = feedItems.slice(0, 10)

  // ---- Recent clients ----
  const recentClients = clients.slice(0, 5).map((c) => ({
    id: c.id,
    firstName: c.first_name,
    lastName: c.last_name,
    email: c.email,
    createdAt: c.created_at,
    status: c.status,
    avatarUrl: c.avatar_url ?? null,
  }))

  // ---- Program popularity (top 5) ----
  const assignmentCounts = new Map<string, number>()
  for (const a of assignments as ProgramAssignment[]) {
    assignmentCounts.set(a.program_id, (assignmentCounts.get(a.program_id) ?? 0) + 1)
  }
  const programPopularity = Array.from(assignmentCounts.entries())
    .map(([id, count]) => ({
      label: programMap.get(id) ?? "Unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return (
    <DashboardContent
      adminFirstName={adminFirstName}
      totalClients={totalClients}
      activePrograms={activePrograms}
      totalRevenue={totalRevenue}
      activeAssignments={activeAssignments}
      revenueTrend={{ current: thisMonthRevenue, previous: lastMonthRevenue }}
      revenueByMonth={revenueByMonth}
      thisMonthRevenue={thisMonthRevenue}
      lastMonthRevenue={lastMonthRevenue}
      engagement={{
        workoutsThisWeek,
        activeStreaks,
        prsThisMonth,
        avgRPE,
      }}
      activityFeed={activityFeed}
      recentClients={recentClients}
      programPopularity={programPopularity}
    />
  )
}
