import type {
  User,
  Payment,
  Program,
  ProgramAssignment,
  ExerciseProgress,
  Achievement,
  ClientProfile,
  ShopOrder,
  ShopOrderStatus,
} from "@/types/database"
import type {
  DateRange,
  RevenueMetrics,
  ClientMetrics,
  ProgramMetrics,
  EngagementMetrics,
  ShopMetrics,
} from "@/types/analytics"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

export function getMonthsInRange(range: DateRange): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = []
  const d = new Date(range.from.getFullYear(), range.from.getMonth(), 1)
  while (d <= range.to) {
    months.push({ key: getMonthKey(d), label: getMonthLabel(d) })
    d.setMonth(d.getMonth() + 1)
  }
  return months
}

function inRange(dateStr: string, range: DateRange): boolean {
  const d = new Date(dateStr)
  return d >= range.from && d <= range.to
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

type PaymentWithUser = Payment & {
  users: { first_name: string; last_name: string; email: string } | null
}

export function computeRevenueMetrics(
  payments: PaymentWithUser[],
  range: DateRange,
  previousRange: DateRange | null,
): RevenueMetrics {
  const months = getMonthsInRange(range)

  const inRangePayments = payments.filter((p) => p.status === "succeeded" && inRange(p.created_at, range))

  const totalRevenue = inRangePayments.reduce((s, p) => s + p.amount_cents, 0)
  const transactionCount = inRangePayments.length
  const avgTransaction = transactionCount > 0 ? Math.round(totalRevenue / transactionCount) : 0

  // This month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthRevenue = inRangePayments
    .filter((p) => new Date(p.created_at) >= monthStart)
    .reduce((s, p) => s + p.amount_cents, 0)

  // Previous period comparison
  let previousPeriodRevenue = 0
  if (previousRange) {
    previousPeriodRevenue = payments
      .filter((p) => p.status === "succeeded" && inRange(p.created_at, previousRange))
      .reduce((s, p) => s + p.amount_cents, 0)
  }

  // By month
  const revenueByMonth = months.map((m) => ({ ...m, total: 0, count: 0 }))
  const monthMap = new Map(revenueByMonth.map((m) => [m.key, m]))
  for (const p of inRangePayments) {
    const entry = monthMap.get(getMonthKey(new Date(p.created_at)))
    if (entry) {
      entry.total += p.amount_cents
      entry.count += 1
    }
  }

  // By status (all payments in range, not just succeeded)
  const allInRange = payments.filter((p) => inRange(p.created_at, range))
  const statusMap = new Map<string, { count: number; total: number }>()
  for (const p of allInRange) {
    const entry = statusMap.get(p.status) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += p.amount_cents
    statusMap.set(p.status, entry)
  }
  const revenueByStatus = Array.from(statusMap.entries()).map(([status, v]) => ({
    status,
    ...v,
  }))

  // Top paying clients
  const clientMap = new Map<string, { name: string; email: string; total: number; count: number }>()
  for (const p of inRangePayments) {
    const name = p.users ? `${p.users.first_name} ${p.users.last_name}` : "Unknown"
    const email = p.users?.email ?? ""
    const mapKey = p.user_id ?? "external"
    const entry = clientMap.get(mapKey) ?? { name, email, total: 0, count: 0 }
    entry.total += p.amount_cents
    entry.count += 1
    clientMap.set(mapKey, entry)
  }
  const topPayingClients = Array.from(clientMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  return {
    totalRevenue,
    previousPeriodRevenue,
    thisMonthRevenue,
    avgTransaction,
    transactionCount,
    revenueByMonth,
    revenueByStatus,
    topPayingClients,
  }
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export function computeClientMetrics(
  users: User[],
  profiles: ClientProfile[],
  assignments: ProgramAssignment[],
  range: DateRange,
): ClientMetrics {
  const months = getMonthsInRange(range)
  const clients = users.filter((u) => u.role === "client")
  const totalClients = clients.length

  // Active clients = clients with at least one active assignment
  const activeUserIds = new Set(assignments.filter((a) => a.status === "active").map((a) => a.user_id))
  const activeClients = activeUserIds.size

  // New clients in range
  const newInRange = clients.filter((u) => inRange(u.created_at, range))
  const newClientsInRange = newInRange.length

  // Clients by month with cumulative
  const monthCounts = new Map<string, number>()
  for (const m of months) monthCounts.set(m.key, 0)
  for (const u of newInRange) {
    const key = getMonthKey(new Date(u.created_at))
    const current = monthCounts.get(key)
    if (current !== undefined) monthCounts.set(key, current + 1)
  }

  // Count clients before range for cumulative start
  let cumulativeBase = clients.filter((u) => new Date(u.created_at) < range.from).length

  const clientsByMonth = months.map((m) => {
    const count = monthCounts.get(m.key) ?? 0
    cumulativeBase += count
    return { ...m, count, cumulative: cumulativeBase }
  })

  // Retention rate: active / total
  const retentionRate = totalClients > 0 ? Math.round((activeClients / totalClients) * 100) : 0

  // Profile completion: profiles that have goals filled in
  const profilesWithGoals = profiles.filter((p) => p.goals)
  const profileCompletionRate = totalClients > 0 ? Math.round((profilesWithGoals.length / totalClients) * 100) : 0

  // By sport
  const sportCounts = new Map<string, number>()
  for (const p of profiles) {
    const sport = p.sport ?? "Not specified"
    sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1)
  }
  const clientsBySport = Array.from(sportCounts.entries())
    .map(([label, count]) => ({ label: capitalize(label), count }))
    .sort((a, b) => b.count - a.count)

  // By experience
  const expCounts = new Map<string, number>()
  for (const p of profiles) {
    const level = p.experience_level ?? "Not specified"
    expCounts.set(level, (expCounts.get(level) ?? 0) + 1)
  }
  const clientsByExperience = Array.from(expCounts.entries())
    .map(([label, count]) => ({ label: capitalize(label), count }))
    .sort((a, b) => b.count - a.count)

  // By goals (parse keywords)
  const goalCounts = new Map<string, number>()
  for (const p of profiles) {
    if (!p.goals) continue
    const goals = p.goals.toLowerCase()
    const keywords = [
      "strength",
      "muscle",
      "weight loss",
      "fat loss",
      "endurance",
      "flexibility",
      "performance",
      "health",
      "mobility",
      "speed",
      "power",
      "hypertrophy",
      "conditioning",
    ]
    for (const kw of keywords) {
      if (goals.includes(kw)) {
        goalCounts.set(kw, (goalCounts.get(kw) ?? 0) + 1)
      }
    }
  }
  const clientsByGoal = Array.from(goalCounts.entries())
    .map(([label, count]) => ({ label: capitalize(label), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  return {
    totalClients,
    activeClients,
    newClientsInRange,
    clientsByMonth,
    retentionRate,
    clientsByGoal,
    clientsBySport,
    clientsByExperience,
    profileCompletionRate,
  }
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export function computeProgramMetrics(
  programs: Program[],
  assignments: ProgramAssignment[],
  range: DateRange,
): ProgramMetrics {
  const totalPrograms = programs.length
  const aiGeneratedCount = programs.filter((p) => p.is_ai_generated).length

  const assignmentsInRange = assignments.filter((a) => inRange(a.created_at, range))

  const activeAssignments = assignments.filter((a) => a.status === "active").length

  // Completion rate: completed / (completed + cancelled) in range
  const completed = assignmentsInRange.filter((a) => a.status === "completed").length
  const cancelled = assignmentsInRange.filter((a) => a.status === "cancelled").length
  const completionRate = completed + cancelled > 0 ? Math.round((completed / (completed + cancelled)) * 100) : 0

  // Program popularity
  const programMap = new Map<string, Program>()
  for (const p of programs) programMap.set(p.id, p)

  const countByProgram = new Map<string, number>()
  for (const a of assignmentsInRange) {
    countByProgram.set(a.program_id, (countByProgram.get(a.program_id) ?? 0) + 1)
  }

  const programPopularity = Array.from(countByProgram.entries())
    .map(([id, count]) => {
      const prog = programMap.get(id)
      return {
        name: prog?.name ?? "Unknown",
        count,
        category: Array.isArray(prog?.category) ? prog.category.join(" / ") : (prog?.category ?? "unknown"),
        difficulty: prog?.difficulty ?? "unknown",
      }
    })
    .sort((a, b) => b.count - a.count)

  // Assignments by status
  const statusCounts = new Map<string, number>()
  for (const a of assignmentsInRange) {
    statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1)
  }
  const assignmentsByStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)

  // By category
  const catCounts = new Map<string, number>()
  for (const p of programs) {
    const cats = Array.isArray(p.category) ? p.category : [p.category]
    for (const cat of cats) {
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1)
    }
  }
  const programsByCategory = Array.from(catCounts.entries())
    .map(([label, count]) => ({ label: capitalize(label), count }))
    .sort((a, b) => b.count - a.count)

  // By difficulty
  const diffCounts = new Map<string, number>()
  for (const p of programs) {
    diffCounts.set(p.difficulty, (diffCounts.get(p.difficulty) ?? 0) + 1)
  }
  const programsByDifficulty = Array.from(diffCounts.entries())
    .map(([label, count]) => ({ label: capitalize(label), count }))
    .sort((a, b) => b.count - a.count)

  return {
    totalPrograms,
    aiGeneratedCount,
    activeAssignments,
    completionRate,
    programPopularity,
    assignmentsByStatus,
    programsByCategory,
    programsByDifficulty,
  }
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

type ProgressWithExercise = ExerciseProgress & {
  exercises: { name: string } | null
}

export function computeEngagementMetrics(
  progress: ProgressWithExercise[],
  achievements: Achievement[],
  users: User[],
  range: DateRange,
): EngagementMetrics {
  const months = getMonthsInRange(range)

  const inRangeProgress = progress.filter((p) => inRange(p.completed_at, range))

  const totalWorkoutsLogged = inRangeProgress.length
  const prsInRange = inRangeProgress.filter((p) => p.is_pr).length

  // Active users this week
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const activeThisWeek = new Set(progress.filter((p) => new Date(p.completed_at) >= weekAgo).map((p) => p.user_id))
  const activeUsersThisWeek = activeThisWeek.size

  // Average RPE
  const rpeValues = inRangeProgress.filter((p) => p.rpe != null).map((p) => p.rpe!)
  const avgRPE =
    rpeValues.length > 0 ? Math.round((rpeValues.reduce((s, v) => s + v, 0) / rpeValues.length) * 10) / 10 : null

  // Workouts by month
  const monthCounts = new Map<string, number>()
  for (const m of months) monthCounts.set(m.key, 0)
  for (const p of inRangeProgress) {
    const key = getMonthKey(new Date(p.completed_at))
    const current = monthCounts.get(key)
    if (current !== undefined) monthCounts.set(key, current + 1)
  }
  const workoutsByMonth = months.map((m) => ({
    ...m,
    count: monthCounts.get(m.key) ?? 0,
  }))

  // Top exercises
  const exerciseCounts = new Map<string, number>()
  for (const p of inRangeProgress) {
    const name = p.exercises?.name ?? "Unknown"
    exerciseCounts.set(name, (exerciseCounts.get(name) ?? 0) + 1)
  }
  const topExercises = Array.from(exerciseCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Most active clients
  const userMap = new Map<string, string>()
  for (const u of users) {
    userMap.set(u.id, `${u.first_name} ${u.last_name}`)
  }
  const clientWorkouts = new Map<string, number>()
  for (const p of inRangeProgress) {
    clientWorkouts.set(p.user_id, (clientWorkouts.get(p.user_id) ?? 0) + 1)
  }
  const mostActiveClients = Array.from(clientWorkouts.entries())
    .map(([id, count]) => ({ name: userMap.get(id) ?? "Unknown", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Achievements by type
  const inRangeAchievements = achievements.filter((a) => inRange(a.earned_at, range))
  const typeCounts = new Map<string, number>()
  for (const a of inRangeAchievements) {
    typeCounts.set(a.achievement_type, (typeCounts.get(a.achievement_type) ?? 0) + 1)
  }
  const achievementsByType = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  // Streak leaders (in-memory computation from all progress data)
  const userDates = new Map<string, Set<string>>()
  for (const p of progress) {
    if (!p.completed_at) continue
    const d = new Date(p.completed_at)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    if (!userDates.has(p.user_id)) userDates.set(p.user_id, new Set())
    userDates.get(p.user_id)!.add(dateStr)
  }

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`

  const streakResults: { name: string; streak: number }[] = []

  for (const [userId, dates] of userDates) {
    const sorted = Array.from(dates).sort().reverse()
    if (sorted.length === 0) continue

    let checkDate: Date
    if (sorted[0] === todayStr) {
      checkDate = new Date(today)
    } else if (sorted[0] === yesterdayStr) {
      checkDate = new Date(yesterday)
    } else {
      continue
    }

    let streak = 0
    for (let i = 0; i < 365; i++) {
      const ds = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}-${String(checkDate.getDate()).padStart(2, "0")}`
      if (dates.has(ds)) {
        streak++
        checkDate.setDate(checkDate.getDate() - 1)
      } else {
        break
      }
    }

    if (streak > 0) {
      streakResults.push({
        name: userMap.get(userId) ?? "Unknown",
        streak,
      })
    }
  }

  const streakLeaders = streakResults.sort((a, b) => b.streak - a.streak).slice(0, 5)

  return {
    totalWorkoutsLogged,
    prsInRange,
    activeUsersThisWeek,
    avgRPE,
    workoutsByMonth,
    topExercises,
    mostActiveClients,
    achievementsByType,
    streakLeaders,
  }
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

const SHOP_REVENUE_STATUSES: ReadonlySet<ShopOrderStatus> = new Set([
  "paid",
  "draft",
  "confirmed",
  "in_production",
  "shipped",
  "fulfilled_digital",
])

export function computeShopMetrics(
  orders: ShopOrder[],
  range: DateRange,
  previousRange: DateRange | null,
): ShopMetrics {
  const months = getMonthsInRange(range)

  const isRevenueOrder = (o: ShopOrder) => SHOP_REVENUE_STATUSES.has(o.status)
  const inRangeOrders = orders.filter(
    (o) => isRevenueOrder(o) && inRange(o.created_at, range),
  )

  let totalRevenueCents = 0
  let podRevenueCents = 0
  let digitalRevenueCents = 0
  let podCogsCents = 0

  const podOrderIds = new Set<string>()
  const digitalOrderIds = new Set<string>()

  const productMap = new Map<
    string,
    {
      product_id: string
      product_name: string
      product_type: "pod" | "digital"
      revenueCents: number
      unitsSold: number
    }
  >()

  for (const o of inRangeOrders) {
    totalRevenueCents += o.total_cents
    let hasPod = false
    let hasDigital = false

    for (const it of o.items) {
      const lineSubtotal = it.unit_price_cents * it.quantity

      // Aggregate per-product
      const existing = productMap.get(it.product_id)
      if (existing) {
        existing.revenueCents += lineSubtotal
        existing.unitsSold += it.quantity
      } else {
        productMap.set(it.product_id, {
          product_id: it.product_id,
          product_name: it.name,
          product_type: it.product_type,
          revenueCents: lineSubtotal,
          unitsSold: it.quantity,
        })
      }

      if (it.product_type === "digital") {
        digitalRevenueCents += lineSubtotal
        hasDigital = true
      } else {
        podRevenueCents += lineSubtotal
        podCogsCents += (it.printful_cost_cents ?? 0) * it.quantity
        hasPod = true
      }
    }

    if (hasPod) podOrderIds.add(o.id)
    if (hasDigital) digitalOrderIds.add(o.id)
  }

  const subtotal = podRevenueCents + digitalRevenueCents
  const grossProfitCents = subtotal - podCogsCents
  const grossMarginBps =
    subtotal > 0 ? Math.round((grossProfitCents / subtotal) * 10000) : 0

  const podProfitCents = podRevenueCents - podCogsCents
  const podMarginBps =
    podRevenueCents > 0
      ? Math.round((podProfitCents / podRevenueCents) * 10000)
      : 0
  const digitalProfitCents = digitalRevenueCents
  const digitalMarginBps = digitalRevenueCents > 0 ? 10000 : 0

  // Previous period
  let previousPeriodRevenueCents = 0
  if (previousRange) {
    previousPeriodRevenueCents = orders
      .filter((o) => isRevenueOrder(o) && inRange(o.created_at, previousRange))
      .reduce((s, o) => s + o.total_cents, 0)
  }

  // This month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthRevenueCents = inRangeOrders
    .filter((o) => new Date(o.created_at) >= monthStart)
    .reduce((s, o) => s + o.total_cents, 0)

  // Monthly stacked series
  const monthlyBase = months.map((m) => ({
    ...m,
    total: 0,
    pod: 0,
    digital: 0,
    count: 0,
  }))
  const monthMap = new Map(monthlyBase.map((m) => [m.key, m]))
  for (const o of inRangeOrders) {
    const entry = monthMap.get(getMonthKey(new Date(o.created_at)))
    if (!entry) continue
    entry.count += 1
    for (const it of o.items) {
      const lineSubtotal = it.unit_price_cents * it.quantity
      if (it.product_type === "digital") {
        entry.digital += lineSubtotal
      } else {
        entry.pod += lineSubtotal
      }
      entry.total += lineSubtotal
    }
  }

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 8)

  return {
    totalRevenueCents,
    previousPeriodRevenueCents,
    thisMonthRevenueCents,

    totalOrders: inRangeOrders.length,
    podOrders: podOrderIds.size,
    digitalOrders: digitalOrderIds.size,

    grossProfitCents,
    grossMarginBps,

    podRevenueCents,
    podCogsCents,
    podProfitCents,
    podMarginBps,
    digitalRevenueCents,
    digitalProfitCents,
    digitalMarginBps,

    revenueByMonth: monthlyBase,
    topProducts,
  }
}

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------

export function computeDateRange(
  months: number,
  customFrom?: string,
  customTo?: string,
  earliestDate?: Date,
): { range: DateRange; previousRange: DateRange | null } {
  const now = new Date()
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  // Custom date range
  if (customFrom && customTo) {
    const from = new Date(customFrom)
    const to = new Date(customTo + "T23:59:59.999")
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      const durationMs = to.getTime() - from.getTime()
      const prevFrom = new Date(from.getTime() - durationMs - 1)
      const prevTo = new Date(from.getTime() - 1)
      return {
        range: { from, to },
        previousRange: { from: prevFrom, to: prevTo },
      }
    }
  }

  // All-time
  if (months === 0) {
    const from = earliestDate ?? new Date(2020, 0, 1)
    return {
      range: { from, to: endOfToday },
      previousRange: null,
    }
  }

  // Preset months
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1)
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - months * 2, 1)
  const prevTo = new Date(from.getTime() - 1)

  return {
    range: { from, to: endOfToday },
    previousRange: { from: prevFrom, to: prevTo },
  }
}

export { formatCents }
