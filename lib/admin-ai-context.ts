import { createServiceRoleClient } from "@/lib/supabase"

// ─── In-memory cache (5 min TTL) ─────────────────────────────────────────────

const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000

let _cachedContext: string | null = null
let _cachedAt = 0

/**
 * Returns cached platform context if fresh, otherwise rebuilds it.
 */
export async function buildAdminContext(): Promise<string> {
  const now = Date.now()
  if (_cachedContext && now - _cachedAt < CONTEXT_CACHE_TTL_MS) {
    return _cachedContext
  }

  const context = await _buildAdminContextFresh()
  _cachedContext = context
  _cachedAt = now
  return context
}

/**
 * Build a comprehensive platform context string for the admin AI assistant.
 * Each section is fetched independently — if a query fails, that section is
 * skipped rather than failing the entire context build.
 */
async function _buildAdminContextFresh(): Promise<string> {
  const supabase = createServiceRoleClient()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const sections: string[] = []

  // ─── Parallel batch 1: Core data ──────────────────────────────────────────
  const [
    platformOverview,
    revenueSection,
    programsSection,
    progressSection,
    recentActivity,
    aiGenSection,
  ] = await Promise.all([
    buildPlatformOverview(supabase, startOfMonth, fourteenDaysAgo).catch(() => null),
    buildRevenueSection(supabase, startOfMonth, startOfLastMonth, endOfLastMonth).catch(() => null),
    buildProgramsSection(supabase, startOfMonth).catch(() => null),
    buildProgressSection(supabase, thirtyDaysAgo, fourteenDaysAgo).catch(() => null),
    buildRecentActivity(supabase, sevenDaysAgo).catch(() => null),
    buildAiGenerationSection(supabase).catch(() => null),
  ])

  if (platformOverview) sections.push(platformOverview)
  if (revenueSection) sections.push(revenueSection)
  if (programsSection) sections.push(programsSection)
  if (progressSection) sections.push(progressSection)
  if (recentActivity) sections.push(recentActivity)
  if (aiGenSection) sections.push(aiGenSection)

  return sections.join("\n\n")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createServiceRoleClient>

// ─── PLATFORM OVERVIEW ───────────────────────────────────────────────────────

async function buildPlatformOverview(
  supabase: SupabaseClient,
  startOfMonth: Date,
  fourteenDaysAgo: Date
): Promise<string> {
  // Fetch all clients (non-admin users)
  const { data: clients } = await supabase
    .from("users")
    .select("id, first_name, last_name, created_at")
    .eq("role", "client")
    .limit(500)

  const allClients = clients ?? []
  const totalClients = allClients.length

  // New this month
  const newThisMonth = allClients.filter(
    (c) => new Date(c.created_at) >= startOfMonth
  ).length

  // Get latest workout date per client (last 30 days)
  const thirtyDaysAgoLocal = new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000)
  const { data: progressData } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at")
    .gte("completed_at", thirtyDaysAgoLocal.toISOString())
    .order("completed_at", { ascending: false })
    .limit(5000)

  // Build a map of user_id -> latest completed_at
  const lastActive = new Map<string, string>()
  for (const row of progressData ?? []) {
    if (!lastActive.has(row.user_id)) {
      lastActive.set(row.user_id, row.completed_at)
    }
  }

  const activeClients: string[] = []
  const inactiveClients: { name: string; lastActive: string }[] = []

  for (const client of allClients) {
    const last = lastActive.get(client.id)
    if (last && new Date(last) >= fourteenDaysAgo) {
      activeClients.push(`${client.first_name} ${client.last_name}`)
    } else {
      inactiveClients.push({
        name: `${client.first_name} ${client.last_name}`,
        lastActive: last
          ? new Date(last).toLocaleDateString()
          : "Never logged a workout",
      })
    }
  }

  const lines = [
    "=== PLATFORM OVERVIEW ===",
    `Total Clients: ${totalClients} (${newThisMonth} new this month)`,
    `Active Clients (logged workout in last 14 days): ${activeClients.length}`,
  ]

  if (inactiveClients.length > 0) {
    lines.push(
      `Inactive Clients (no workout in 14+ days): ${inactiveClients
        .map((c) => `${c.name} (last active: ${c.lastActive})`)
        .join(", ")}`
    )
  } else {
    lines.push("Inactive Clients: None")
  }

  return lines.join("\n")
}

// ─── REVENUE ─────────────────────────────────────────────────────────────────

async function buildRevenueSection(
  supabase: SupabaseClient,
  startOfMonth: Date,
  startOfLastMonth: Date,
  endOfLastMonth: Date
): Promise<string> {
  // Succeeded payments (last 2 months)
  const twoMonthsAgo = new Date(startOfLastMonth)
  const { data: payments } = await supabase
    .from("payments")
    .select("amount_cents, created_at, description, user_id")
    .eq("status", "succeeded")
    .gte("created_at", twoMonthsAgo.toISOString())

  const allPayments = payments ?? []

  const totalRevenue = allPayments.reduce((sum, p) => sum + p.amount_cents, 0)

  const thisMonthPayments = allPayments.filter(
    (p) => new Date(p.created_at) >= startOfMonth
  )
  const thisMonthRevenue = thisMonthPayments.reduce(
    (sum, p) => sum + p.amount_cents,
    0
  )

  const lastMonthPayments = allPayments.filter((p) => {
    const d = new Date(p.created_at)
    return d >= startOfLastMonth && d <= endOfLastMonth
  })
  const lastMonthRevenue = lastMonthPayments.reduce(
    (sum, p) => sum + p.amount_cents,
    0
  )

  let momChange = "N/A"
  if (lastMonthRevenue > 0) {
    const pctChange =
      ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    momChange = `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`
  } else if (thisMonthRevenue > 0) {
    momChange = "+100% (no revenue last month)"
  }

  // Revenue by program — join payments with program assignments via metadata or description
  // Since payments don't have a direct program_id, we'll group by description
  const revenueByDesc = new Map<string, { total: number; count: number }>()
  for (const p of allPayments) {
    const key = p.description || "Other"
    const entry = revenueByDesc.get(key) ?? { total: 0, count: 0 }
    entry.total += p.amount_cents
    entry.count++
    revenueByDesc.set(key, entry)
  }

  const lines = [
    "=== REVENUE ===",
    `Total Revenue (all time): $${(totalRevenue / 100).toFixed(2)}`,
    `This Month: $${(thisMonthRevenue / 100).toFixed(2)}`,
    `Last Month: $${(lastMonthRevenue / 100).toFixed(2)}`,
    `Month-over-month change: ${momChange}`,
  ]

  if (revenueByDesc.size > 0) {
    const revenueLines = Array.from(revenueByDesc.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(
        ([desc, data]) =>
          `  ${desc}: $${(data.total / 100).toFixed(2)} (${data.count} sales)`
      )
    lines.push("Revenue by Program:", ...revenueLines)
  }

  return lines.join("\n")
}

// ─── PROGRAMS ────────────────────────────────────────────────────────────────

async function buildProgramsSection(
  supabase: SupabaseClient,
  startOfMonth: Date
): Promise<string> {
  // Get all active programs
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, price_cents, is_active")
    .eq("is_active", true)

  const allPrograms = programs ?? []

  // Get assignment counts per program
  const { data: assignments } = await supabase
    .from("program_assignments")
    .select("program_id, status, created_at")
    .limit(2000)

  const assignmentsByProgram = new Map<
    string,
    { total: number; active: number; thisMonth: number }
  >()
  for (const a of assignments ?? []) {
    const entry = assignmentsByProgram.get(a.program_id) ?? {
      total: 0,
      active: 0,
      thisMonth: 0,
    }
    entry.total++
    if (a.status === "active") entry.active++
    if (new Date(a.created_at) >= startOfMonth) entry.thisMonth++
    assignmentsByProgram.set(a.program_id, entry)
  }

  // Get reviews for avg rating per program (reviews don't have program_id directly,
  // so we'll compute a platform-wide average instead)
  const { data: reviews } = await supabase
    .from("reviews")
    .select("rating")
    .limit(1000)

  const allReviews = reviews ?? []
  const avgRating =
    allReviews.length > 0
      ? (
          allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
        ).toFixed(1)
      : "N/A"

  const lines = [
    "=== PROGRAMS ===",
    `Total Active Programs: ${allPrograms.length}`,
    `Platform Average Rating: ${avgRating} (${allReviews.length} reviews)`,
  ]

  const noSalesThisMonth: string[] = []

  for (const program of allPrograms) {
    const stats = assignmentsByProgram.get(program.id) ?? {
      total: 0,
      active: 0,
      thisMonth: 0,
    }
    const price = program.price_cents
      ? `$${(program.price_cents / 100).toFixed(2)}`
      : "Free"
    lines.push(
      `  ${program.name}: ${price}, ${stats.total} total sales, ${stats.active} active assignments`
    )

    if (stats.thisMonth === 0) {
      noSalesThisMonth.push(program.name)
    }
  }

  if (noSalesThisMonth.length > 0) {
    lines.push(
      `Programs with 0 sales this month: ${noSalesThisMonth.join(", ")}`
    )
  }

  return lines.join("\n")
}

// ─── CLIENT PROGRESS ─────────────────────────────────────────────────────────

async function buildProgressSection(
  supabase: SupabaseClient,
  thirtyDaysAgo: Date,
  fourteenDaysAgo: Date
): Promise<string> {
  // All workouts in the last 30 days
  const { data: recentProgress } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at, is_pr, pr_type, exercise_id")
    .gte("completed_at", thirtyDaysAgo.toISOString())
    .limit(5000)

  const progressRows = recentProgress ?? []
  const totalWorkouts = progressRows.length
  const totalPRs = progressRows.filter((p) => p.is_pr).length

  // Workouts per user for top performers
  const workoutsByUser = new Map<string, number>()
  const prsByUser = new Map<string, number>()
  const latestByUser = new Map<string, string>()

  for (const row of progressRows) {
    workoutsByUser.set(row.user_id, (workoutsByUser.get(row.user_id) ?? 0) + 1)
    if (row.is_pr) {
      prsByUser.set(row.user_id, (prsByUser.get(row.user_id) ?? 0) + 1)
    }
    if (
      !latestByUser.has(row.user_id) ||
      row.completed_at > latestByUser.get(row.user_id)!
    ) {
      latestByUser.set(row.user_id, row.completed_at)
    }
  }

  // Get user names for referenced users
  const { data: users } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("role", "client")
    .limit(500)

  const nameMap = new Map<string, string>()
  for (const u of users ?? []) {
    nameMap.set(u.id, `${u.first_name} ${u.last_name}`)
  }

  // Top performers — most workouts
  const topPerformers = Array.from(workoutsByUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(
      ([uid, count]) =>
        `${nameMap.get(uid) ?? "Unknown"} (${count} workouts, ${prsByUser.get(uid) ?? 0} PRs)`
    )

  // Clients needing attention — no workouts in last 14 days
  // Derived from the already-fetched 30-day progress data
  const allClientIds = new Set((users ?? []).map((u) => u.id))
  const needsAttention: string[] = []

  for (const uid of allClientIds) {
    const last = latestByUser.get(uid)
    if (!last || new Date(last) < fourteenDaysAgo) {
      needsAttention.push(
        `${nameMap.get(uid) ?? "Unknown"} (last active: ${last ? new Date(last).toLocaleDateString() : "No workouts in 30 days"})`
      )
    }
  }

  // Clients with stalled progress — logged workouts in last 30 days but no PR in 30+ days
  const stalledProgress: string[] = []
  for (const uid of workoutsByUser.keys()) {
    if (!prsByUser.has(uid) || prsByUser.get(uid) === 0) {
      stalledProgress.push(nameMap.get(uid) ?? "Unknown")
    }
  }

  const lines = [
    "=== CLIENT PROGRESS (last 30 days) ===",
    `Total Workouts Logged: ${totalWorkouts}`,
    `Total PRs Hit: ${totalPRs}`,
  ]

  if (topPerformers.length > 0) {
    lines.push(`Top Performers: ${topPerformers.join("; ")}`)
  }

  if (needsAttention.length > 0) {
    lines.push(
      `Clients Needing Attention (no workouts in 14+ days): ${needsAttention.join("; ")}`
    )
  } else {
    lines.push("Clients Needing Attention: None - all clients are active!")
  }

  if (stalledProgress.length > 0) {
    lines.push(
      `Clients with Stalled Progress (workouts but no PRs in 30 days): ${stalledProgress.join(", ")}`
    )
  }

  return lines.join("\n")
}

// ─── RECENT ACTIVITY ─────────────────────────────────────────────────────────

async function buildRecentActivity(
  supabase: SupabaseClient,
  sevenDaysAgo: Date
): Promise<string> {
  // Parallel queries for recent activity
  const [signupsResult, purchasesResult, prsResult, reviewsResult] =
    await Promise.all([
      // New signups
      supabase
        .from("users")
        .select("first_name, last_name, created_at")
        .eq("role", "client")
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("created_at", { ascending: false }),

      // New purchases (payments)
      supabase
        .from("payments")
        .select("amount_cents, description, created_at, users(first_name, last_name)")
        .eq("status", "succeeded")
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("created_at", { ascending: false }),

      // New PRs
      supabase
        .from("exercise_progress")
        .select("user_id, pr_type, weight_kg, reps_completed, completed_at, exercises(name), users(first_name, last_name)")
        .eq("is_pr", true)
        .gte("completed_at", sevenDaysAgo.toISOString())
        .order("completed_at", { ascending: false }),

      // New reviews
      supabase
        .from("reviews")
        .select("rating, comment, created_at, users(first_name, last_name)")
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("created_at", { ascending: false }),
    ])

  const lines = ["=== RECENT ACTIVITY (last 7 days) ==="]

  // Signups
  const signups = signupsResult.data ?? []
  if (signups.length > 0) {
    lines.push(
      `New Signups: ${signups.map((s) => `${s.first_name} ${s.last_name}`).join(", ")}`
    )
  } else {
    lines.push("New Signups: None")
  }

  // Purchases
  const purchases = purchasesResult.data ?? []
  if (purchases.length > 0) {
    const purchaseLines = purchases.map((p) => {
      const user = p.users as unknown as { first_name: string; last_name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      return `  ${name} - ${p.description || "Payment"} - $${(p.amount_cents / 100).toFixed(2)}`
    })
    lines.push("New Purchases:", ...purchaseLines)
  } else {
    lines.push("New Purchases: None")
  }

  // PRs
  const prs = prsResult.data ?? []
  if (prs.length > 0) {
    const prLines = prs.slice(0, 10).map((p) => {
      const user = p.users as unknown as { first_name: string; last_name: string } | null
      const exercise = p.exercises as unknown as { name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      const exName = exercise?.name ?? "Unknown exercise"
      const value =
        p.pr_type === "weight"
          ? `${p.weight_kg}kg`
          : p.pr_type === "reps"
            ? `${p.reps_completed} reps`
            : `${p.pr_type}`
      return `  ${name} - ${exName} - ${p.pr_type ?? "PR"} - ${value}`
    })
    lines.push(`New PRs (${prs.length} total):`, ...prLines)
  } else {
    lines.push("New PRs: None")
  }

  // Reviews
  const reviews = reviewsResult.data ?? []
  if (reviews.length > 0) {
    const reviewLines = reviews.map((r) => {
      const user = r.users as unknown as { first_name: string; last_name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      const excerpt = r.comment
        ? r.comment.length > 80
          ? r.comment.slice(0, 80) + "..."
          : r.comment
        : "No comment"
      return `  ${name} - ${r.rating}/5 - "${excerpt}"`
    })
    lines.push("New Reviews:", ...reviewLines)
  } else {
    lines.push("New Reviews: None")
  }

  return lines.join("\n")
}

// ─── AI GENERATION ───────────────────────────────────────────────────────────

async function buildAiGenerationSection(
  supabase: SupabaseClient
): Promise<string> {
  const { data: logs } = await supabase
    .from("ai_generation_log")
    .select("status, tokens_used, model_used")
    .order("created_at", { ascending: false })
    .limit(500)

  const allLogs = logs ?? []

  if (allLogs.length === 0) {
    return "=== AI GENERATION ===\nNo AI generations recorded yet."
  }

  const total = allLogs.length
  const successful = allLogs.filter((l) => l.status === "completed").length
  const failed = allLogs.filter((l) => l.status === "failed").length
  const totalTokens = allLogs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0)

  // Rough cost estimate: $3/1M input + $15/1M output tokens for Sonnet
  // Simplified: ~$9/1M tokens blended average
  const avgCost =
    successful > 0
      ? ((totalTokens / successful) * 9) / 1_000_000
      : 0

  return [
    "=== AI GENERATION ===",
    `Total Generations: ${total} (${successful} successful, ${failed} failed)`,
    `Total Tokens Used: ${totalTokens.toLocaleString()}`,
    `Avg Cost per Generation: $${avgCost.toFixed(4)}`,
  ].join("\n")
}
