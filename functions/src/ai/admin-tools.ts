import type Anthropic from "@anthropic-ai/sdk"
import { getSupabase } from "../lib/supabase.js"

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const ADMIN_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_platform_overview",
    description:
      "Get high-level platform statistics: total clients, active/inactive counts, new signups this month. Use for general dashboard questions.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_client_list",
    description:
      "Get a list of all clients with their activity status and last workout date. Can filter by active/inactive.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["all", "active", "inactive"],
          description:
            "Filter by activity status. Active = logged workout in last 14 days. Default: all.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_client_details",
    description:
      "Get detailed info about a specific client: profile, recent workouts, PRs, assigned programs. Use when asked about a specific person.",
    input_schema: {
      type: "object" as const,
      properties: {
        client_name: {
          type: "string",
          description: "The client's name to search for (partial match supported)",
        },
      },
      required: ["client_name"],
    },
  },
  {
    name: "get_revenue",
    description:
      "Get revenue analytics: total, this month vs last month, MoM change, breakdown by program.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_programs",
    description:
      "Get all active programs with pricing, total sales, active assignments, and new sales this month.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_recent_activity",
    description:
      "Get recent platform events: new signups, purchases, PRs hit, reviews. Defaults to last 7 days.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Days to look back (default: 7, max: 30)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_client_progress",
    description:
      "Get workout and PR analytics: total workouts, total PRs, top performers, clients needing attention, stalled progress.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Days to look back (default: 30, max: 90)",
        },
      },
      required: [],
    },
  },
]

// ─── Tool Display Labels ────────────────────────────────────────────────────

export const TOOL_LABELS: Record<string, string> = {
  get_platform_overview: "Looking up platform stats",
  get_client_list: "Fetching client list",
  get_client_details: "Looking up client details",
  get_revenue: "Analyzing revenue",
  get_programs: "Checking programs",
  get_recent_activity: "Loading recent activity",
  get_client_progress: "Analyzing client progress",
}

// ─── Tool Executor ──────────────────────────────────────────────────────────

export async function executeAdminTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "get_platform_overview":
        return await getPlatformOverview()
      case "get_client_list":
        return await getClientList(input.status as string | undefined)
      case "get_client_details":
        return await getClientDetails(input.client_name as string)
      case "get_revenue":
        return await getRevenue()
      case "get_programs":
        return await getPrograms()
      case "get_recent_activity":
        return await getRecentActivity(input.days as number | undefined)
      case "get_client_progress":
        return await getClientProgress(input.days as number | undefined)
      default:
        return `Unknown tool: ${name}`
    }
  } catch (err) {
    console.error(`[admin-tools] ${name} failed:`, err)
    return `Error executing ${name}: ${err instanceof Error ? err.message : "Unknown error"}`
  }
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function getPlatformOverview(): Promise<string> {
  const supabase = getSupabase()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const { data: clients } = await supabase
    .from("users")
    .select("id, first_name, last_name, created_at")
    .eq("role", "client")
    .limit(500)

  const allClients = clients ?? []
  const newThisMonth = allClients.filter(
    (c) => new Date(c.created_at) >= startOfMonth
  ).length

  // Get latest workout per user
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const { data: progressData } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at")
    .gte("completed_at", thirtyDaysAgo.toISOString())
    .order("completed_at", { ascending: false })
    .limit(5000)

  const lastActive = new Map<string, string>()
  for (const row of progressData ?? []) {
    if (!lastActive.has(row.user_id)) lastActive.set(row.user_id, row.completed_at)
  }

  let activeCount = 0
  let inactiveCount = 0
  for (const client of allClients) {
    const last = lastActive.get(client.id)
    if (last && new Date(last) >= fourteenDaysAgo) activeCount++
    else inactiveCount++
  }

  return [
    `Total Clients: ${allClients.length}`,
    `New This Month: ${newThisMonth}`,
    `Active (workout in last 14 days): ${activeCount}`,
    `Inactive (no workout in 14+ days): ${inactiveCount}`,
  ].join("\n")
}

async function getClientList(statusFilter?: string): Promise<string> {
  const supabase = getSupabase()
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const { data: clients } = await supabase
    .from("users")
    .select("id, first_name, last_name, email, created_at")
    .eq("role", "client")
    .order("created_at", { ascending: false })
    .limit(500)

  const allClients = clients ?? []
  if (allClients.length === 0) return "No clients found."

  // Get latest workout per user
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const { data: progressData } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at")
    .gte("completed_at", thirtyDaysAgo.toISOString())
    .order("completed_at", { ascending: false })
    .limit(5000)

  const lastActive = new Map<string, string>()
  for (const row of progressData ?? []) {
    if (!lastActive.has(row.user_id)) lastActive.set(row.user_id, row.completed_at)
  }

  const lines: string[] = []

  for (const client of allClients) {
    const name = `${client.first_name} ${client.last_name}`
    const last = lastActive.get(client.id)
    const isActive = last && new Date(last) >= fourteenDaysAgo

    if (statusFilter === "active" && !isActive) continue
    if (statusFilter === "inactive" && isActive) continue

    const lastStr = last
      ? new Date(last).toLocaleDateString()
      : "Never"
    const status = isActive ? "Active" : "Inactive"
    const joined = new Date(client.created_at).toLocaleDateString()

    lines.push(`${name} | ${status} | Last workout: ${lastStr} | Joined: ${joined}`)
  }

  if (lines.length === 0) return `No ${statusFilter ?? ""} clients found.`
  return lines.join("\n")
}

async function getClientDetails(clientName: string): Promise<string> {
  const supabase = getSupabase()
  const searchTerms = clientName.toLowerCase().split(/\s+/)

  // Find matching clients
  const { data: clients } = await supabase
    .from("users")
    .select("id, first_name, last_name, email, created_at")
    .eq("role", "client")
    .limit(500)

  const matches = (clients ?? []).filter((c) => {
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase()
    return searchTerms.every((term) => fullName.includes(term))
  })

  if (matches.length === 0) return `No client found matching "${clientName}".`

  const sections: string[] = []

  for (const client of matches.slice(0, 3)) {
    const name = `${client.first_name} ${client.last_name}`
    const clientSections: string[] = [
      `── ${name} ──`,
      `Email: ${client.email}`,
      `Joined: ${new Date(client.created_at).toLocaleDateString()}`,
    ]

    // Client profile/questionnaire
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("*")
      .eq("user_id", client.id)
      .single()

    if (profile) {
      const profileParts: string[] = []
      if (profile.age) profileParts.push(`Age: ${profile.age}`)
      if (profile.gender) profileParts.push(`Gender: ${profile.gender}`)
      if (profile.primary_goal) profileParts.push(`Goal: ${profile.primary_goal}`)
      if (profile.experience_level) profileParts.push(`Level: ${profile.experience_level}`)
      if (profile.training_days_per_week) profileParts.push(`Training days: ${profile.training_days_per_week}/week`)
      if (profileParts.length > 0) clientSections.push(`Profile: ${profileParts.join(", ")}`)
    }

    // Assigned programs
    const { data: assignments } = await supabase
      .from("program_assignments")
      .select("status, created_at, programs(name)")
      .eq("user_id", client.id)
      .order("created_at", { ascending: false })
      .limit(5)

    if (assignments && assignments.length > 0) {
      const programLines = assignments.map((a) => {
        const prog = a.programs as unknown as { name: string } | null
        return `  ${prog?.name ?? "Unknown"} (${a.status}, assigned ${new Date(a.created_at).toLocaleDateString()})`
      })
      clientSections.push(`Programs:\n${programLines.join("\n")}`)
    } else {
      clientSections.push("Programs: None assigned")
    }

    // Recent workouts (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { data: workouts } = await supabase
      .from("exercise_progress")
      .select("exercise_id, weight_kg, reps_completed, sets_completed, is_pr, pr_type, completed_at, exercises(name)")
      .eq("user_id", client.id)
      .gte("completed_at", thirtyDaysAgo.toISOString())
      .order("completed_at", { ascending: false })
      .limit(20)

    if (workouts && workouts.length > 0) {
      const totalWorkouts = workouts.length
      const prs = workouts.filter((w) => w.is_pr)

      clientSections.push(`Recent Activity (30 days): ${totalWorkouts} exercises logged, ${prs.length} PRs`)

      // Show last 10 entries
      const workoutLines = workouts.slice(0, 10).map((w) => {
        const ex = w.exercises as unknown as { name: string } | null
        const prTag = w.is_pr ? ` [PR: ${w.pr_type}]` : ""
        return `  ${ex?.name ?? "Unknown"} - ${w.weight_kg}kg × ${w.reps_completed} reps (${new Date(w.completed_at).toLocaleDateString()})${prTag}`
      })
      clientSections.push(`Last 10 Entries:\n${workoutLines.join("\n")}`)
    } else {
      clientSections.push("Recent Activity: No workouts in last 30 days")
    }

    // Assessment results
    const { data: assessments } = await supabase
      .from("performance_assessments")
      .select("exercise_id, metric_type, value, unit, assessed_at, exercises(name)")
      .eq("user_id", client.id)
      .order("assessed_at", { ascending: false })
      .limit(10)

    if (assessments && assessments.length > 0) {
      const assessmentLines = assessments.map((a) => {
        const ex = a.exercises as unknown as { name: string } | null
        return `  ${ex?.name ?? "Unknown"} - ${a.metric_type}: ${a.value}${a.unit} (${new Date(a.assessed_at).toLocaleDateString()})`
      })
      clientSections.push(`Assessments:\n${assessmentLines.join("\n")}`)
    }

    sections.push(clientSections.join("\n"))
  }

  if (matches.length > 3) {
    sections.push(`... and ${matches.length - 3} more matching clients`)
  }

  return sections.join("\n\n")
}

async function getRevenue(): Promise<string> {
  const supabase = getSupabase()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  const { data: payments } = await supabase
    .from("payments")
    .select("amount_cents, created_at, description, user_id, users(first_name, last_name)")
    .eq("status", "succeeded")
    .gte("created_at", startOfLastMonth.toISOString())

  const allPayments = payments ?? []

  // All-time revenue
  const { data: allTimePayments } = await supabase
    .from("payments")
    .select("amount_cents")
    .eq("status", "succeeded")

  const totalRevenue = (allTimePayments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)

  const thisMonthPayments = allPayments.filter((p) => new Date(p.created_at) >= startOfMonth)
  const thisMonthRevenue = thisMonthPayments.reduce((sum, p) => sum + p.amount_cents, 0)

  const lastMonthPayments = allPayments.filter((p) => {
    const d = new Date(p.created_at)
    return d >= startOfLastMonth && d <= endOfLastMonth
  })
  const lastMonthRevenue = lastMonthPayments.reduce((sum, p) => sum + p.amount_cents, 0)

  let momChange = "N/A"
  if (lastMonthRevenue > 0) {
    const pct = ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    momChange = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
  } else if (thisMonthRevenue > 0) {
    momChange = "+100% (no revenue last month)"
  }

  // Breakdown by description
  const byDesc = new Map<string, { total: number; count: number }>()
  for (const p of allPayments) {
    const key = p.description || "Other"
    const entry = byDesc.get(key) ?? { total: 0, count: 0 }
    entry.total += p.amount_cents
    entry.count++
    byDesc.set(key, entry)
  }

  const lines = [
    `Total Revenue (all time): $${(totalRevenue / 100).toFixed(2)}`,
    `This Month: $${(thisMonthRevenue / 100).toFixed(2)}`,
    `Last Month: $${(lastMonthRevenue / 100).toFixed(2)}`,
    `MoM Change: ${momChange}`,
  ]

  if (thisMonthPayments.length > 0) {
    lines.push("\nThis Month's Sales:")
    for (const p of thisMonthPayments) {
      const user = p.users as unknown as { first_name: string; last_name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      lines.push(`  ${name} - ${p.description || "Payment"} - $${(p.amount_cents / 100).toFixed(2)} (${new Date(p.created_at).toLocaleDateString()})`)
    }
  }

  if (byDesc.size > 0) {
    lines.push("\nRevenue by Product (recent 2 months):")
    const sorted = Array.from(byDesc.entries()).sort((a, b) => b[1].total - a[1].total)
    for (const [desc, data] of sorted) {
      lines.push(`  ${desc}: $${(data.total / 100).toFixed(2)} (${data.count} sales)`)
    }
  }

  return lines.join("\n")
}

async function getPrograms(): Promise<string> {
  const supabase = getSupabase()
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, price_cents, is_active")
    .eq("is_active", true)

  const { data: assignments } = await supabase
    .from("program_assignments")
    .select("program_id, status, created_at")
    .limit(2000)

  const { data: reviews } = await supabase
    .from("reviews")
    .select("rating")
    .limit(1000)

  const assignmentsByProgram = new Map<string, { total: number; active: number; thisMonth: number }>()
  for (const a of assignments ?? []) {
    const entry = assignmentsByProgram.get(a.program_id) ?? { total: 0, active: 0, thisMonth: 0 }
    entry.total++
    if (a.status === "active") entry.active++
    if (new Date(a.created_at) >= startOfMonth) entry.thisMonth++
    assignmentsByProgram.set(a.program_id, entry)
  }

  const allReviews = reviews ?? []
  const avgRating = allReviews.length > 0
    ? (allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length).toFixed(1)
    : "N/A"

  const lines = [
    `Active Programs: ${(programs ?? []).length}`,
    `Platform Rating: ${avgRating} (${allReviews.length} reviews)`,
    "",
  ]

  for (const program of programs ?? []) {
    const stats = assignmentsByProgram.get(program.id) ?? { total: 0, active: 0, thisMonth: 0 }
    const price = program.price_cents ? `$${(program.price_cents / 100).toFixed(2)}` : "Free"
    lines.push(`${program.name}: ${price} | ${stats.total} total sales | ${stats.active} active | ${stats.thisMonth} new this month`)
  }

  const noSales = (programs ?? []).filter((p) => {
    const stats = assignmentsByProgram.get(p.id)
    return !stats || stats.thisMonth === 0
  })
  if (noSales.length > 0) {
    lines.push(`\nNo sales this month: ${noSales.map((p) => p.name).join(", ")}`)
  }

  return lines.join("\n")
}

async function getRecentActivity(days?: number): Promise<string> {
  const lookback = Math.min(Math.max(days ?? 7, 1), 30)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)
  const supabase = getSupabase()

  const [signupsResult, purchasesResult, prsResult, reviewsResult] = await Promise.all([
    supabase
      .from("users")
      .select("first_name, last_name, created_at")
      .eq("role", "client")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),

    supabase
      .from("payments")
      .select("amount_cents, description, created_at, users(first_name, last_name)")
      .eq("status", "succeeded")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),

    supabase
      .from("exercise_progress")
      .select("user_id, pr_type, weight_kg, reps_completed, completed_at, exercises(name), users(first_name, last_name)")
      .eq("is_pr", true)
      .gte("completed_at", since.toISOString())
      .order("completed_at", { ascending: false }),

    supabase
      .from("reviews")
      .select("rating, comment, created_at, users(first_name, last_name)")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
  ])

  const lines = [`Activity in the last ${lookback} days:`]

  // Signups
  const signups = signupsResult.data ?? []
  lines.push(signups.length > 0
    ? `\nNew Signups (${signups.length}): ${signups.map((s) => `${s.first_name} ${s.last_name}`).join(", ")}`
    : "\nNew Signups: None"
  )

  // Purchases
  const purchases = purchasesResult.data ?? []
  if (purchases.length > 0) {
    lines.push(`\nPurchases (${purchases.length}):`)
    for (const p of purchases) {
      const user = p.users as unknown as { first_name: string; last_name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      lines.push(`  ${name} - ${p.description || "Payment"} - $${(p.amount_cents / 100).toFixed(2)}`)
    }
  } else {
    lines.push("\nPurchases: None")
  }

  // PRs
  const prs = prsResult.data ?? []
  if (prs.length > 0) {
    lines.push(`\nPRs Hit (${prs.length}):`)
    for (const p of prs.slice(0, 15)) {
      const user = p.users as unknown as { first_name: string; last_name: string } | null
      const exercise = p.exercises as unknown as { name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      const value = p.pr_type === "weight" ? `${p.weight_kg}kg` : `${p.reps_completed} reps`
      lines.push(`  ${name} - ${exercise?.name ?? "Unknown"} - ${p.pr_type}: ${value}`)
    }
  } else {
    lines.push("\nPRs Hit: None")
  }

  // Reviews
  const reviews = reviewsResult.data ?? []
  if (reviews.length > 0) {
    lines.push(`\nReviews (${reviews.length}):`)
    for (const r of reviews) {
      const user = r.users as unknown as { first_name: string; last_name: string } | null
      const name = user ? `${user.first_name} ${user.last_name}` : "Unknown"
      const excerpt = r.comment ? (r.comment.length > 80 ? r.comment.slice(0, 80) + "..." : r.comment) : "No comment"
      lines.push(`  ${name} - ${r.rating}/5 - "${excerpt}"`)
    }
  } else {
    lines.push("\nReviews: None")
  }

  return lines.join("\n")
}

async function getClientProgress(days?: number): Promise<string> {
  const lookback = Math.min(Math.max(days ?? 30, 1), 90)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const supabase = getSupabase()

  const { data: progressData } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at, is_pr, pr_type")
    .gte("completed_at", since.toISOString())
    .limit(10000)

  const progressRows = progressData ?? []
  const totalWorkouts = progressRows.length
  const totalPRs = progressRows.filter((p) => p.is_pr).length

  const workoutsByUser = new Map<string, number>()
  const prsByUser = new Map<string, number>()
  const latestByUser = new Map<string, string>()

  for (const row of progressRows) {
    workoutsByUser.set(row.user_id, (workoutsByUser.get(row.user_id) ?? 0) + 1)
    if (row.is_pr) prsByUser.set(row.user_id, (prsByUser.get(row.user_id) ?? 0) + 1)
    if (!latestByUser.has(row.user_id) || row.completed_at > latestByUser.get(row.user_id)!) {
      latestByUser.set(row.user_id, row.completed_at)
    }
  }

  // Get user names
  const { data: users } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("role", "client")
    .limit(500)

  const nameMap = new Map<string, string>()
  const allClientIds = new Set<string>()
  for (const u of users ?? []) {
    nameMap.set(u.id, `${u.first_name} ${u.last_name}`)
    allClientIds.add(u.id)
  }

  // Top performers
  const topPerformers = Array.from(workoutsByUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid, count]) =>
      `${nameMap.get(uid) ?? "Unknown"} (${count} exercises logged, ${prsByUser.get(uid) ?? 0} PRs)`
    )

  // Needs attention
  const needsAttention: string[] = []
  for (const uid of allClientIds) {
    const last = latestByUser.get(uid)
    if (!last || new Date(last) < fourteenDaysAgo) {
      needsAttention.push(
        `${nameMap.get(uid) ?? "Unknown"} (last: ${last ? new Date(last).toLocaleDateString() : "No workouts"})`
      )
    }
  }

  // Stalled progress
  const stalledProgress: string[] = []
  for (const uid of workoutsByUser.keys()) {
    if (!prsByUser.has(uid) || prsByUser.get(uid) === 0) {
      stalledProgress.push(nameMap.get(uid) ?? "Unknown")
    }
  }

  const lines = [
    `Progress Report (last ${lookback} days):`,
    `Total Exercises Logged: ${totalWorkouts}`,
    `Total PRs Hit: ${totalPRs}`,
  ]

  if (topPerformers.length > 0) {
    lines.push(`\nTop Performers:\n${topPerformers.map((p) => `  ${p}`).join("\n")}`)
  }

  if (needsAttention.length > 0) {
    lines.push(`\nNeeds Attention (inactive 14+ days):\n${needsAttention.map((p) => `  ${p}`).join("\n")}`)
  } else {
    lines.push("\nAll clients are active!")
  }

  if (stalledProgress.length > 0) {
    lines.push(`\nStalled Progress (logging but no PRs):\n${stalledProgress.map((p) => `  ${p}`).join("\n")}`)
  }

  return lines.join("\n")
}
