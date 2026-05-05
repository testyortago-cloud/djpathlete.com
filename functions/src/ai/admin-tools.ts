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
          description: "Filter by activity status. Active = logged workout in last 14 days. Default: all.",
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
    description: "Get revenue analytics: total, this month vs last month, MoM change, breakdown by program.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_programs",
    description: "Get all active programs with pricing, total sales, active assignments, and new sales this month.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_recent_activity",
    description: "Get recent platform events: new signups, purchases, PRs hit, reviews. Defaults to last 7 days.",
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
  {
    name: "get_events",
    description:
      "List clinics / camps / events with capacity, signup counts, status, dates, location, and price. Use for questions about upcoming or past events.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          enum: ["all", "upcoming", "past"],
          description: "Filter by start_date relative to today. Default: all.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_event_signups",
    description:
      "List event signups. Pass event_query to drill into a specific event by title (partial match) and see its signup roster + status breakdown. Without event_query, returns recent signups across all events.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_query: {
          type: "string",
          description: "Event title fragment to search for (optional). Without this, returns recent signups across all events.",
        },
        days: {
          type: "number",
          description: "When event_query is omitted, days to look back for cross-event signups (default: 30, max: 90).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_shop_orders",
    description:
      "Get shop / merchandise order analytics: revenue, status breakdown, pending fulfillment (paid but no tracking), refunds, recent order list.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Days to look back (default: 30, max: 365)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_subscriptions",
    description:
      "Get subscription analytics: active count, MRR (monthly recurring revenue), past_due, churn this month, and customers scheduled to cancel at period end.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_ads_performance",
    description:
      "Get Google Ads performance: spend, clicks, impressions, CTR, CPC, conversions, CPA, ROAS, broken down by campaign. Pulls from cached google_ads_daily_metrics.",
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
  {
    name: "get_marketing_attribution",
    description:
      "Get traffic attribution: visits from Google Ads (gclid/gbraid/wbraid), Facebook (fbclid), organic; top utm_source/medium/campaign; how many were claimed (linked to a user).",
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
  {
    name: "get_ai_usage",
    description:
      "Get AI assistant / generation usage: total runs, completed vs failed, total tokens used, breakdown by model and feature, recent failure messages.",
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
  {
    name: "get_content_overview",
    description:
      "Get content state across blog posts, video uploads, social posts, and newsletters: published/draft counts, scheduled posts, posts pending approval, newsletters sent.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_bookings",
    description:
      "Get coaching call / consultation bookings: status breakdown (scheduled/completed/no-show/cancelled), upcoming vs past, paid-ads vs organic source.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          enum: ["all", "upcoming", "past"],
          description: "Filter by booking_date relative to today. Default: all.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_reviews_summary",
    description:
      "Get reviews moderation overview: internal review average + rating distribution + unpublished queue, Google Reviews count + average, testimonials active/featured counts.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_form_reviews_queue",
    description:
      "Get the form review (video form-check) queue submitted by clients: pending count, in-progress count, list of submissions awaiting your review.",
    input_schema: {
      type: "object" as const,
      properties: {},
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
  get_events: "Loading events",
  get_event_signups: "Looking up event signups",
  get_shop_orders: "Checking shop orders",
  get_subscriptions: "Analyzing subscriptions",
  get_ads_performance: "Pulling Google Ads performance",
  get_marketing_attribution: "Reading attribution data",
  get_ai_usage: "Checking AI usage",
  get_content_overview: "Loading content overview",
  get_bookings: "Loading bookings",
  get_reviews_summary: "Summarizing reviews",
  get_form_reviews_queue: "Checking form-review queue",
}

// ─── Tool Executor ──────────────────────────────────────────────────────────

export async function executeAdminTool(name: string, input: Record<string, unknown>): Promise<string> {
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
      case "get_events":
        return await getEvents(input.filter as string | undefined)
      case "get_event_signups":
        return await getEventSignups(input.event_query as string | undefined, input.days as number | undefined)
      case "get_shop_orders":
        return await getShopOrders(input.days as number | undefined)
      case "get_subscriptions":
        return await getSubscriptions()
      case "get_ads_performance":
        return await getAdsPerformance(input.days as number | undefined)
      case "get_marketing_attribution":
        return await getMarketingAttribution(input.days as number | undefined)
      case "get_ai_usage":
        return await getAiUsage(input.days as number | undefined)
      case "get_content_overview":
        return await getContentOverview()
      case "get_bookings":
        return await getBookings(input.filter as string | undefined)
      case "get_reviews_summary":
        return await getReviewsSummary()
      case "get_form_reviews_queue":
        return await getFormReviewsQueue()
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
  const newThisMonth = allClients.filter((c) => new Date(c.created_at) >= startOfMonth).length

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

    const lastStr = last ? new Date(last).toLocaleDateString() : "Never"
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
    const { data: profile } = await supabase.from("client_profiles").select("*").eq("user_id", client.id).single()

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
  const { data: allTimePayments } = await supabase.from("payments").select("amount_cents").eq("status", "succeeded")

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
      lines.push(
        `  ${name} - ${p.description || "Payment"} - $${(p.amount_cents / 100).toFixed(2)} (${new Date(p.created_at).toLocaleDateString()})`,
      )
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

  const { data: reviews } = await supabase.from("reviews").select("rating").limit(1000)

  const assignmentsByProgram = new Map<string, { total: number; active: number; thisMonth: number }>()
  for (const a of assignments ?? []) {
    const entry = assignmentsByProgram.get(a.program_id) ?? { total: 0, active: 0, thisMonth: 0 }
    entry.total++
    if (a.status === "active") entry.active++
    if (new Date(a.created_at) >= startOfMonth) entry.thisMonth++
    assignmentsByProgram.set(a.program_id, entry)
  }

  const allReviews = reviews ?? []
  const avgRating =
    allReviews.length > 0 ? (allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length).toFixed(1) : "N/A"

  const lines = [
    `Active Programs: ${(programs ?? []).length}`,
    `Platform Rating: ${avgRating} (${allReviews.length} reviews)`,
    "",
  ]

  for (const program of programs ?? []) {
    const stats = assignmentsByProgram.get(program.id) ?? { total: 0, active: 0, thisMonth: 0 }
    const price = program.price_cents ? `$${(program.price_cents / 100).toFixed(2)}` : "Free"
    lines.push(
      `${program.name}: ${price} | ${stats.total} total sales | ${stats.active} active | ${stats.thisMonth} new this month`,
    )
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
      .select(
        "user_id, pr_type, weight_kg, reps_completed, completed_at, exercises(name), users(first_name, last_name)",
      )
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
  lines.push(
    signups.length > 0
      ? `\nNew Signups (${signups.length}): ${signups.map((s) => `${s.first_name} ${s.last_name}`).join(", ")}`
      : "\nNew Signups: None",
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
    .map(
      ([uid, count]) => `${nameMap.get(uid) ?? "Unknown"} (${count} exercises logged, ${prsByUser.get(uid) ?? 0} PRs)`,
    )

  // Needs attention
  const needsAttention: string[] = []
  for (const uid of allClientIds) {
    const last = latestByUser.get(uid)
    if (!last || new Date(last) < fourteenDaysAgo) {
      needsAttention.push(
        `${nameMap.get(uid) ?? "Unknown"} (last: ${last ? new Date(last).toLocaleDateString() : "No workouts"})`,
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

// ─── Events / clinics / camps ───────────────────────────────────────────────

async function getEvents(filter?: string): Promise<string> {
  const supabase = getSupabase()
  const now = new Date()

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, title, type, status, start_date, end_date, capacity, signup_count, price_cents, location_name",
    )
    .order("start_date", { ascending: true })
    .limit(100)

  const all = events ?? []
  if (all.length === 0) return "No events found."

  const f = filter ?? "all"
  const filtered = all.filter((e) => {
    const start = e.start_date ? new Date(e.start_date) : null
    if (f === "upcoming") return start && start >= now
    if (f === "past") return start && start < now
    return true
  })
  if (filtered.length === 0) return `No ${f} events.`

  const lines = [`Events (${f}, ${filtered.length}):`]
  for (const e of filtered) {
    const cap = e.capacity ? `${e.signup_count ?? 0}/${e.capacity}` : `${e.signup_count ?? 0} signups`
    const price = e.price_cents != null ? `$${(e.price_cents / 100).toFixed(2)}` : "Free"
    const date = e.start_date ? new Date(e.start_date).toLocaleDateString() : "TBD"
    const loc = e.location_name ? ` | ${e.location_name}` : ""
    lines.push(`${e.title} (${e.type}, ${e.status}) | ${date} | ${cap} | ${price}${loc}`)
  }
  return lines.join("\n")
}

async function getEventSignups(eventQuery?: string, days?: number): Promise<string> {
  const supabase = getSupabase()

  if (eventQuery) {
    const { data: events } = await supabase
      .from("events")
      .select("id, title, type, capacity, signup_count, start_date")
      .ilike("title", `%${eventQuery}%`)
      .limit(5)

    const matches = events ?? []
    if (matches.length === 0) return `No event found matching "${eventQuery}".`

    const sections: string[] = []
    for (const ev of matches) {
      const { data: signups } = await supabase
        .from("event_signups")
        .select("athlete_name, parent_email, status, signup_type, amount_paid_cents, created_at")
        .eq("event_id", ev.id)
        .order("created_at", { ascending: false })
        .limit(50)

      const list = signups ?? []
      const byStatus = new Map<string, number>()
      for (const s of list) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1)

      const sec = [
        `── ${ev.title} (${ev.type}) ──`,
        `Capacity: ${ev.signup_count ?? 0}/${ev.capacity ?? "∞"}`,
        `Signups by status: ${
          Array.from(byStatus.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join(", ") || "none"
        }`,
      ]
      if (list.length > 0) {
        sec.push("Recent signups:")
        for (const s of list.slice(0, 15)) {
          const amt = s.amount_paid_cents ? `$${(s.amount_paid_cents / 100).toFixed(2)}` : "—"
          sec.push(
            `  ${s.athlete_name ?? "?"} (${s.parent_email ?? "?"}) | ${s.status} | ${amt} | ${new Date(s.created_at).toLocaleDateString()}`,
          )
        }
      }
      sections.push(sec.join("\n"))
    }
    return sections.join("\n\n")
  }

  const lookback = Math.min(Math.max(days ?? 30, 1), 90)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)

  const { data: signups } = await supabase
    .from("event_signups")
    .select(
      "athlete_name, parent_email, status, signup_type, amount_paid_cents, created_at, events(title, type)",
    )
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(50)

  const list = signups ?? []
  if (list.length === 0) return `No event signups in the last ${lookback} days.`

  const lines = [`Event signups (last ${lookback} days, ${list.length}):`]
  for (const s of list) {
    const ev = s.events as unknown as { title: string; type: string } | null
    const amt = s.amount_paid_cents ? `$${(s.amount_paid_cents / 100).toFixed(2)}` : "—"
    lines.push(
      `  ${s.athlete_name ?? "?"} → ${ev?.title ?? "?"} | ${s.status} | ${amt} | ${new Date(s.created_at).toLocaleDateString()}`,
    )
  }
  return lines.join("\n")
}

// ─── Shop orders ────────────────────────────────────────────────────────────

async function getShopOrders(days?: number): Promise<string> {
  const supabase = getSupabase()
  const lookback = Math.min(Math.max(days ?? 30, 1), 365)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)

  const { data: orders } = await supabase
    .from("shop_orders")
    .select(
      "order_number, customer_email, customer_name, status, total_cents, refund_amount_cents, items, tracking_number, shipped_at, created_at",
    )
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(100)

  const list = orders ?? []
  if (list.length === 0) return `No shop orders in the last ${lookback} days.`

  const grossCents = list.reduce((s, o) => s + (o.total_cents ?? 0), 0)
  const refundCents = list.reduce((s, o) => s + (o.refund_amount_cents ?? 0), 0)
  const netCents = grossCents - refundCents

  const byStatus = new Map<string, number>()
  for (const o of list) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1)

  const refundedCount = list.filter((o) => (o.refund_amount_cents ?? 0) > 0).length
  const pendingFulfillment = list.filter((o) => o.status === "paid" && !o.tracking_number).length

  const lines = [
    `Shop Orders (last ${lookback} days):`,
    `Total: ${list.length} orders`,
    `Gross revenue: $${(grossCents / 100).toFixed(2)} | Refunds: $${(refundCents / 100).toFixed(2)} | Net: $${(netCents / 100).toFixed(2)}`,
    `By status: ${
      Array.from(byStatus.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    }`,
    `Pending fulfillment (paid, no tracking): ${pendingFulfillment}`,
    `Orders with refunds: ${refundedCount}`,
    "",
    "Recent orders:",
  ]
  for (const o of list.slice(0, 15)) {
    const items = Array.isArray(o.items) ? `${o.items.length} item(s)` : "?"
    lines.push(
      `  ${o.order_number} | ${o.customer_name ?? o.customer_email} | ${o.status} | $${((o.total_cents ?? 0) / 100).toFixed(2)} | ${items} | ${new Date(o.created_at).toLocaleDateString()}`,
    )
  }
  return lines.join("\n")
}

// ─── Subscriptions (MRR / churn) ────────────────────────────────────────────

async function getSubscriptions(): Promise<string> {
  const supabase = getSupabase()

  const { data: subs } = await supabase
    .from("subscriptions")
    .select(
      "status, current_period_end, cancel_at_period_end, canceled_at, user_id, program_id, created_at, programs(name, price_cents), users(first_name, last_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(500)

  const list = subs ?? []
  if (list.length === 0) return "No subscriptions on file."

  const byStatus = new Map<string, number>()
  for (const s of list) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1)

  const active = list.filter((s) => s.status === "active" || s.status === "trialing")
  let mrrCents = 0
  for (const s of active) {
    const prog = s.programs as unknown as { price_cents: number | null } | null
    mrrCents += prog?.price_cents ?? 0
  }

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const churnedThisMonth = list.filter((s) => s.canceled_at && new Date(s.canceled_at) >= monthStart).length
  const scheduledCancel = active.filter((s) => s.cancel_at_period_end).length
  const pastDue = list.filter((s) => s.status === "past_due").length

  const lines = [
    "Subscriptions:",
    `Total: ${list.length} | Active: ${active.length} | Past due: ${pastDue}`,
    `Status breakdown: ${Array.from(byStatus.entries()).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `MRR (sum of active program prices): $${(mrrCents / 100).toFixed(2)}`,
    `Churned this month: ${churnedThisMonth}`,
    `Scheduled to cancel at period end: ${scheduledCancel}`,
  ]

  if (scheduledCancel > 0) {
    lines.push("\nScheduled cancellations:")
    for (const s of active.filter((x) => x.cancel_at_period_end).slice(0, 10)) {
      const u = s.users as unknown as { first_name: string; last_name: string; email: string } | null
      const prog = s.programs as unknown as { name: string } | null
      const end = s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : "?"
      lines.push(
        `  ${u ? `${u.first_name} ${u.last_name}` : "?"} (${u?.email ?? "?"}) | ${prog?.name ?? "?"} | ends ${end}`,
      )
    }
  }

  if (pastDue > 0) {
    lines.push("\nPast due:")
    for (const s of list.filter((x) => x.status === "past_due").slice(0, 10)) {
      const u = s.users as unknown as { first_name: string; last_name: string; email: string } | null
      const prog = s.programs as unknown as { name: string } | null
      lines.push(`  ${u ? `${u.first_name} ${u.last_name}` : "?"} (${u?.email ?? "?"}) | ${prog?.name ?? "?"}`)
    }
  }

  return lines.join("\n")
}

// ─── Google Ads performance ─────────────────────────────────────────────────

async function getAdsPerformance(days?: number): Promise<string> {
  const supabase = getSupabase()
  const lookback = Math.min(Math.max(days ?? 30, 1), 90)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)
  const sinceDate = since.toISOString().slice(0, 10)

  const { data: metrics } = await supabase
    .from("google_ads_daily_metrics")
    .select("campaign_id, date, impressions, clicks, cost_micros, conversions, conversion_value")
    .gte("date", sinceDate)
    .is("ad_group_id", null)
    .limit(5000)

  const rows = metrics ?? []
  if (rows.length === 0) {
    return `No Google Ads data in last ${lookback} days. (Sync may not be running, or no campaigns active.)`
  }

  let totalImpr = 0
  let totalClicks = 0
  let totalCostMicros = 0
  let totalConversions = 0
  let totalConvValue = 0
  const byCampaign = new Map<
    string,
    { impr: number; clicks: number; cost: number; conv: number; convVal: number }
  >()

  for (const r of rows) {
    const impr = Number(r.impressions ?? 0)
    const clicks = Number(r.clicks ?? 0)
    const cost = Number(r.cost_micros ?? 0)
    const conv = Number(r.conversions ?? 0)
    const convVal = Number(r.conversion_value ?? 0)
    totalImpr += impr
    totalClicks += clicks
    totalCostMicros += cost
    totalConversions += conv
    totalConvValue += convVal

    const cid = r.campaign_id ?? "unknown"
    const e = byCampaign.get(cid) ?? { impr: 0, clicks: 0, cost: 0, conv: 0, convVal: 0 }
    e.impr += impr
    e.clicks += clicks
    e.cost += cost
    e.conv += conv
    e.convVal += convVal
    byCampaign.set(cid, e)
  }

  const totalCost = totalCostMicros / 1_000_000
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0
  const cpc = totalClicks > 0 ? totalCost / totalClicks : 0
  const cpa = totalConversions > 0 ? totalCost / totalConversions : 0
  const roas = totalCost > 0 ? totalConvValue / totalCost : 0

  const campaignIds = Array.from(byCampaign.keys()).filter((c) => c !== "unknown")
  const { data: camps } =
    campaignIds.length > 0
      ? await supabase
          .from("google_ads_campaigns")
          .select("campaign_id, name, status")
          .in("campaign_id", campaignIds)
      : { data: [] as { campaign_id: string; name: string; status: string }[] }

  const nameMap = new Map<string, { name: string; status: string }>()
  for (const c of camps ?? []) nameMap.set(c.campaign_id, { name: c.name, status: c.status })

  const lines = [
    `Google Ads Performance (last ${lookback} days):`,
    `Spend: $${totalCost.toFixed(2)} | Clicks: ${totalClicks} | Impressions: ${totalImpr}`,
    `CTR: ${ctr.toFixed(2)}% | Avg CPC: $${cpc.toFixed(2)}`,
    `Conversions: ${totalConversions.toFixed(1)} | CPA: $${cpa.toFixed(2)}`,
    `Conv value: $${totalConvValue.toFixed(2)} | ROAS: ${roas.toFixed(2)}`,
  ]

  const sorted = Array.from(byCampaign.entries()).sort((a, b) => b[1].cost - a[1].cost)
  if (sorted.length > 0) {
    lines.push("\nBy campaign (top 10 by spend):")
    for (const [cid, e] of sorted.slice(0, 10)) {
      const meta = nameMap.get(cid)
      const cost = (e.cost / 1_000_000).toFixed(2)
      const cp = e.conv > 0 ? `$${(e.cost / 1_000_000 / e.conv).toFixed(2)}` : "—"
      lines.push(
        `  ${meta?.name ?? cid} (${meta?.status ?? "?"}) | $${cost} | ${e.clicks} clk | ${e.conv.toFixed(1)} conv | CPA ${cp}`,
      )
    }
  }

  return lines.join("\n")
}

// ─── Marketing attribution ──────────────────────────────────────────────────

async function getMarketingAttribution(days?: number): Promise<string> {
  const supabase = getSupabase()
  const lookback = Math.min(Math.max(days ?? 30, 1), 90)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)

  const { data: rows } = await supabase
    .from("marketing_attribution")
    .select(
      "user_id, gclid, gbraid, wbraid, fbclid, utm_source, utm_medium, utm_campaign, claimed_at, created_at",
    )
    .gte("created_at", since.toISOString())
    .limit(2000)

  const list = rows ?? []
  if (list.length === 0) return `No attribution rows in the last ${lookback} days.`

  const claimed = list.filter((r) => r.claimed_at).length
  const fromGoogleAds = list.filter((r) => r.gclid || r.gbraid || r.wbraid).length
  const fromFacebook = list.filter((r) => r.fbclid).length
  const organic = list.filter((r) => !r.gclid && !r.gbraid && !r.wbraid && !r.fbclid).length

  const bySource = new Map<string, number>()
  const byMedium = new Map<string, number>()
  const byCampaign = new Map<string, number>()
  for (const r of list) {
    if (r.utm_source) bySource.set(r.utm_source, (bySource.get(r.utm_source) ?? 0) + 1)
    if (r.utm_medium) byMedium.set(r.utm_medium, (byMedium.get(r.utm_medium) ?? 0) + 1)
    if (r.utm_campaign) byCampaign.set(r.utm_campaign, (byCampaign.get(r.utm_campaign) ?? 0) + 1)
  }

  const top = (m: Map<string, number>, n: number) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k} (${v})`)
      .join(", ") || "none"

  return [
    `Marketing Attribution (last ${lookback} days):`,
    `Total visits: ${list.length} | Claimed (linked to user): ${claimed}`,
    `From Google Ads (gclid/gbraid/wbraid): ${fromGoogleAds}`,
    `From Facebook/Meta (fbclid): ${fromFacebook}`,
    `Organic / direct (no click ID): ${organic}`,
    `Top utm_source: ${top(bySource, 5)}`,
    `Top utm_medium: ${top(byMedium, 5)}`,
    `Top utm_campaign: ${top(byCampaign, 5)}`,
  ].join("\n")
}

// ─── AI usage ───────────────────────────────────────────────────────────────

async function getAiUsage(days?: number): Promise<string> {
  const supabase = getSupabase()
  const lookback = Math.min(Math.max(days ?? 30, 1), 90)
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)

  const { data: logs } = await supabase
    .from("ai_generation_log")
    .select("status, model_used, tokens_used, duration_ms, error_message, input_params, created_at")
    .gte("created_at", since.toISOString())
    .limit(5000)

  const list = logs ?? []
  if (list.length === 0) return `No AI generations in the last ${lookback} days.`

  const completed = list.filter((l) => l.status === "completed").length
  const failed = list.filter((l) => l.status === "failed").length
  const totalTokens = list.reduce((s, l) => s + (l.tokens_used ?? 0), 0)
  const avgDuration = list.length > 0 ? list.reduce((s, l) => s + (l.duration_ms ?? 0), 0) / list.length : 0

  const byModel = new Map<string, { count: number; tokens: number }>()
  const byFeature = new Map<string, number>()
  for (const l of list) {
    const m = l.model_used ?? "unknown"
    const e = byModel.get(m) ?? { count: 0, tokens: 0 }
    e.count++
    e.tokens += l.tokens_used ?? 0
    byModel.set(m, e)

    const params = l.input_params as Record<string, unknown> | null
    const feature = (params?.feature as string) ?? "unknown"
    byFeature.set(feature, (byFeature.get(feature) ?? 0) + 1)
  }

  const lines = [
    `AI Generations (last ${lookback} days):`,
    `Total: ${list.length} | Completed: ${completed} | Failed: ${failed}`,
    `Total tokens used: ${totalTokens.toLocaleString()}`,
    `Avg duration: ${Math.round(avgDuration)}ms`,
    `By model: ${
      Array.from(byModel.entries())
        .map(([k, v]) => `${k} (${v.count} runs, ${v.tokens.toLocaleString()} tok)`)
        .join(", ") || "none"
    }`,
    `By feature: ${
      Array.from(byFeature.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "none"
    }`,
  ]

  if (failed > 0) {
    lines.push("\nRecent failures:")
    const fails = list.filter((l) => l.status === "failed").slice(0, 5)
    for (const f of fails) {
      lines.push(
        `  ${f.model_used ?? "?"} | ${(f.error_message ?? "").slice(0, 100)} | ${new Date(f.created_at).toLocaleDateString()}`,
      )
    }
  }

  return lines.join("\n")
}

// ─── Content overview (blog / video / social / newsletter) ──────────────────

async function getContentOverview(): Promise<string> {
  const supabase = getSupabase()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  const [blogRes, videoRes, socialRes, newsRes, subsRes] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("id, title, status, published_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("video_uploads")
      .select("id, title, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("social_posts")
      .select("id, platform, approval_status, scheduled_at, published_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("newsletters")
      .select("id, subject, status, sent_at, sent_count")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("newsletter_subscribers").select("id, unsubscribed_at"),
  ])

  const blogs = blogRes.data ?? []
  const videos = videoRes.data ?? []
  const socials = socialRes.data ?? []
  const newsletters = newsRes.data ?? []
  const subscribers = subsRes.data ?? []

  const blogPublished = blogs.filter((b) => b.status === "published").length
  const blogDrafts = blogs.filter((b) => b.status === "draft").length
  const blogThisMonth = blogs.filter((b) => b.published_at && new Date(b.published_at) >= monthStart).length

  const videoByStatus = new Map<string, number>()
  for (const v of videos) videoByStatus.set(v.status, (videoByStatus.get(v.status) ?? 0) + 1)

  const now = new Date()
  const socialScheduled = socials.filter(
    (s) => !s.published_at && s.scheduled_at && new Date(s.scheduled_at) > now,
  ).length
  const socialPublished = socials.filter((s) => s.published_at).length
  const socialPendingApproval = socials.filter((s) => s.approval_status === "pending").length
  const socialByPlatform = new Map<string, number>()
  for (const s of socials.filter((x) => x.published_at))
    socialByPlatform.set(s.platform, (socialByPlatform.get(s.platform) ?? 0) + 1)

  const newslettersSent = newsletters.filter((n) => n.status === "sent").length
  const totalEmailsDelivered = newsletters.reduce((s, n) => s + (n.sent_count ?? 0), 0)

  const subsActive = subscribers.filter((s) => !s.unsubscribed_at).length
  const subsUnsubbed = subscribers.length - subsActive

  const lines = [
    "Content Overview:",
    "",
    "── Blog ──",
    `Total: ${blogs.length} | Published: ${blogPublished} | Drafts: ${blogDrafts}`,
    `Published this month: ${blogThisMonth}`,
    "",
    "── Videos ──",
    `Total uploads: ${videos.length} | By status: ${
      Array.from(videoByStatus.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "none"
    }`,
    "",
    "── Social Posts ──",
    `Total: ${socials.length} | Published: ${socialPublished} | Scheduled: ${socialScheduled} | Pending approval: ${socialPendingApproval}`,
    `Published by platform: ${
      Array.from(socialByPlatform.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "none"
    }`,
    "",
    "── Newsletters ──",
    `Total: ${newsletters.length} | Sent: ${newslettersSent} | Total emails delivered: ${totalEmailsDelivered}`,
    `Subscribers — Active: ${subsActive} | Unsubscribed: ${subsUnsubbed}`,
  ]

  const recentBlogs = blogs.filter((b) => b.status === "published").slice(0, 5)
  if (recentBlogs.length > 0) {
    lines.push("", "Recent published blogs:")
    for (const b of recentBlogs) {
      const d = b.published_at ? new Date(b.published_at).toLocaleDateString() : "?"
      lines.push(`  ${b.title} (${d})`)
    }
  }

  return lines.join("\n")
}

// ─── Bookings (consultation / coaching calls) ───────────────────────────────

async function getBookings(filter?: string): Promise<string> {
  const supabase = getSupabase()
  const now = new Date()

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "contact_name, contact_email, booking_date, duration_minutes, status, source, gclid, fbclid, created_at",
    )
    .order("booking_date", { ascending: true })
    .limit(300)

  const list = bookings ?? []
  if (list.length === 0) return "No bookings on file."

  const f = filter ?? "all"
  const filtered = list.filter((b) => {
    const d = b.booking_date ? new Date(b.booking_date) : null
    if (f === "upcoming") return d && d >= now
    if (f === "past") return d && d < now
    return true
  })

  const byStatus = new Map<string, number>()
  for (const b of filtered) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1)

  const fromAds = filtered.filter((b) => b.gclid || b.fbclid).length
  const fromOrganic = filtered.filter((b) => !b.gclid && !b.fbclid).length

  const lines = [
    `Bookings (${f}, ${filtered.length}):`,
    `By status: ${Array.from(byStatus.entries()).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `From paid ads (gclid/fbclid): ${fromAds} | Organic / direct: ${fromOrganic}`,
  ]

  if (filtered.length > 0) {
    lines.push("\nList:")
    for (const b of filtered.slice(0, 15)) {
      const date = b.booking_date ? new Date(b.booking_date).toLocaleString() : "?"
      lines.push(
        `  ${b.contact_name ?? "?"} (${b.contact_email ?? "?"}) | ${b.status} | ${date} | source: ${b.source ?? "—"}`,
      )
    }
  }

  return lines.join("\n")
}

// ─── Reviews summary (internal + Google + testimonials) ─────────────────────

async function getReviewsSummary(): Promise<string> {
  const supabase = getSupabase()

  const [internalRes, googleRes, testimonialsRes] = await Promise.all([
    supabase
      .from("reviews")
      .select("rating, comment, is_published, created_at, users(first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("google_reviews")
      .select("reviewer_name, rating, comment, review_date")
      .order("review_date", { ascending: false })
      .limit(200),
    supabase.from("testimonials").select("name, rating, is_active, is_featured").limit(200),
  ])

  const intList = internalRes.data ?? []
  const ggList = googleRes.data ?? []
  const tmList = testimonialsRes.data ?? []

  const intAvg = intList.length > 0 ? (intList.reduce((s, r) => s + r.rating, 0) / intList.length).toFixed(2) : "—"
  const intUnpublished = intList.filter((r) => !r.is_published).length
  const intDist = new Map<number, number>()
  for (const r of intList) intDist.set(r.rating, (intDist.get(r.rating) ?? 0) + 1)

  const ggAvg = ggList.length > 0 ? (ggList.reduce((s, r) => s + r.rating, 0) / ggList.length).toFixed(2) : "—"

  const tmActive = tmList.filter((t) => t.is_active).length
  const tmFeatured = tmList.filter((t) => t.is_featured).length

  const lines = [
    "Reviews Summary:",
    "",
    "── Internal Reviews ──",
    `Total: ${intList.length} | Avg rating: ${intAvg} | Unpublished: ${intUnpublished}`,
    `Distribution: ${[5, 4, 3, 2, 1].map((n) => `${n}★=${intDist.get(n) ?? 0}`).join(", ")}`,
    "",
    "── Google Reviews ──",
    `Total: ${ggList.length} | Avg rating: ${ggAvg}`,
    "",
    "── Testimonials ──",
    `Total: ${tmList.length} | Active: ${tmActive} | Featured: ${tmFeatured}`,
  ]

  if (intUnpublished > 0) {
    lines.push("\nUnpublished internal reviews (need moderation):")
    const unpub = intList.filter((r) => !r.is_published).slice(0, 10)
    for (const r of unpub) {
      const u = r.users as unknown as { first_name: string; last_name: string } | null
      const excerpt = r.comment
        ? r.comment.length > 80
          ? r.comment.slice(0, 80) + "..."
          : r.comment
        : "(no comment)"
      lines.push(`  ${u ? `${u.first_name} ${u.last_name}` : "?"} | ${r.rating}★ | "${excerpt}"`)
    }
  }

  return lines.join("\n")
}

// ─── Form review queue (video form-checks awaiting coach review) ────────────

async function getFormReviewsQueue(): Promise<string> {
  const supabase = getSupabase()

  const { data: reviews } = await supabase
    .from("form_reviews")
    .select("id, title, status, created_at, updated_at, client_user_id")
    .order("created_at", { ascending: false })
    .limit(100)

  const list = reviews ?? []
  if (list.length === 0) return "No form reviews submitted."

  const byStatus = new Map<string, number>()
  for (const r of list) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)

  const pending = list.filter((r) => r.status === "pending" || r.status === "submitted")
  const inProgress = list.filter((r) => r.status === "in_progress")

  const userIds = Array.from(new Set(list.map((r) => r.client_user_id).filter((x): x is string => Boolean(x))))
  const { data: users } =
    userIds.length > 0
      ? await supabase.from("users").select("id, first_name, last_name").in("id", userIds)
      : { data: [] as { id: string; first_name: string; last_name: string }[] }
  const nameMap = new Map<string, string>()
  for (const u of users ?? []) nameMap.set(u.id, `${u.first_name} ${u.last_name}`)

  const lines = [
    "Form Reviews Queue:",
    `Total: ${list.length}`,
    `By status: ${Array.from(byStatus.entries()).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
  ]

  if (pending.length > 0) {
    lines.push("\nAwaiting your review:")
    for (const r of pending.slice(0, 15)) {
      lines.push(
        `  ${r.title ?? "(untitled)"} | ${nameMap.get(r.client_user_id) ?? "?"} | submitted ${new Date(r.created_at).toLocaleDateString()}`,
      )
    }
  }

  if (inProgress.length > 0) {
    lines.push("\nIn progress:")
    for (const r of inProgress.slice(0, 10)) {
      lines.push(
        `  ${r.title ?? "(untitled)"} | ${nameMap.get(r.client_user_id) ?? "?"} | last update ${new Date(r.updated_at).toLocaleDateString()}`,
      )
    }
  }

  return lines.join("\n")
}
