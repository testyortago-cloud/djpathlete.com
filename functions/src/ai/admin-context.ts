import { getSupabase } from "../lib/supabase.js"
import type { SupabaseClient } from "@supabase/supabase-js"

const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
let _cachedContext: string | null = null
let _cachedAt = 0

export async function buildAdminContext(): Promise<string> {
  const now = Date.now()
  if (_cachedContext && now - _cachedAt < CONTEXT_CACHE_TTL_MS) return _cachedContext
  const context = await _buildAdminContextFresh()
  _cachedContext = context
  _cachedAt = now
  return context
}

async function _buildAdminContextFresh(): Promise<string> {
  const supabase = getSupabase()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const sections: string[] = []
  const [platformOverview, revenueSection, programsSection, progressSection, recentActivity, aiGenSection] =
    await Promise.all([
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

async function buildPlatformOverview(
  supabase: SupabaseClient,
  startOfMonth: Date,
  fourteenDaysAgo: Date,
): Promise<string> {
  const { data: clients } = await supabase
    .from("users")
    .select("id, first_name, last_name, created_at")
    .eq("role", "client")
    .limit(500)
  const allClients = clients ?? []
  const totalClients = allClients.length
  const newThisMonth = allClients.filter((c) => new Date(c.created_at) >= startOfMonth).length
  const thirtyDaysAgoLocal = new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000)
  const { data: progressData } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at")
    .gte("completed_at", thirtyDaysAgoLocal.toISOString())
    .order("completed_at", { ascending: false })
    .limit(5000)
  const lastActive = new Map<string, string>()
  for (const row of progressData ?? []) {
    if (!lastActive.has(row.user_id)) lastActive.set(row.user_id, row.completed_at)
  }
  const activeClients: string[] = []
  const inactiveClients: { name: string; lastActive: string }[] = []
  for (const client of allClients) {
    const last = lastActive.get(client.id)
    if (last && new Date(last) >= fourteenDaysAgo) activeClients.push(`${client.first_name} ${client.last_name}`)
    else
      inactiveClients.push({
        name: `${client.first_name} ${client.last_name}`,
        lastActive: last ? new Date(last).toLocaleDateString() : "Never logged a workout",
      })
  }
  const lines = [
    "=== PLATFORM OVERVIEW ===",
    `Total Clients: ${totalClients} (${newThisMonth} new this month)`,
    `Active Clients (last 14 days): ${activeClients.length}`,
  ]
  if (inactiveClients.length > 0)
    lines.push(`Inactive Clients: ${inactiveClients.map((c) => `${c.name} (last: ${c.lastActive})`).join(", ")}`)
  else lines.push("Inactive Clients: None")
  return lines.join("\n")
}

async function buildRevenueSection(
  supabase: SupabaseClient,
  startOfMonth: Date,
  startOfLastMonth: Date,
  endOfLastMonth: Date,
): Promise<string> {
  const { data: payments } = await supabase
    .from("payments")
    .select("amount_cents, created_at, description, user_id")
    .eq("status", "succeeded")
    .gte("created_at", startOfLastMonth.toISOString())
  const allPayments = payments ?? []
  const totalRevenue = allPayments.reduce((sum, p) => sum + p.amount_cents, 0)
  const thisMonthRevenue = allPayments
    .filter((p) => new Date(p.created_at) >= startOfMonth)
    .reduce((sum, p) => sum + p.amount_cents, 0)
  const lastMonthRevenue = allPayments
    .filter((p) => {
      const d = new Date(p.created_at)
      return d >= startOfLastMonth && d <= endOfLastMonth
    })
    .reduce((sum, p) => sum + p.amount_cents, 0)
  let momChange = "N/A"
  if (lastMonthRevenue > 0)
    momChange = `${((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 >= 0 ? "+" : ""}${(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1)}%`
  else if (thisMonthRevenue > 0) momChange = "+100% (no revenue last month)"
  return [
    "=== REVENUE ===",
    `Total Revenue: $${(totalRevenue / 100).toFixed(2)}`,
    `This Month: $${(thisMonthRevenue / 100).toFixed(2)}`,
    `Last Month: $${(lastMonthRevenue / 100).toFixed(2)}`,
    `MoM change: ${momChange}`,
  ].join("\n")
}

async function buildProgramsSection(supabase: SupabaseClient, startOfMonth: Date): Promise<string> {
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, price_cents, is_active")
    .eq("is_active", true)
  const { data: assignments } = await supabase
    .from("program_assignments")
    .select("program_id, status, created_at")
    .limit(2000)
  const assignmentsByProgram = new Map<string, { total: number; active: number; thisMonth: number }>()
  for (const a of assignments ?? []) {
    const entry = assignmentsByProgram.get(a.program_id) ?? { total: 0, active: 0, thisMonth: 0 }
    entry.total++
    if (a.status === "active") entry.active++
    if (new Date(a.created_at) >= startOfMonth) entry.thisMonth++
    assignmentsByProgram.set(a.program_id, entry)
  }
  const lines = ["=== PROGRAMS ===", `Total Active Programs: ${(programs ?? []).length}`]
  for (const program of programs ?? []) {
    const stats = assignmentsByProgram.get(program.id) ?? { total: 0, active: 0, thisMonth: 0 }
    const price = program.price_cents ? `$${(program.price_cents / 100).toFixed(2)}` : "Free"
    lines.push(`  ${program.name}: ${price}, ${stats.total} total, ${stats.active} active`)
  }
  return lines.join("\n")
}

async function buildProgressSection(
  supabase: SupabaseClient,
  thirtyDaysAgo: Date,
  fourteenDaysAgo: Date,
): Promise<string> {
  const { data: recentProgress } = await supabase
    .from("exercise_progress")
    .select("user_id, completed_at, is_pr, pr_type, exercise_id")
    .gte("completed_at", thirtyDaysAgo.toISOString())
    .limit(5000)
  const progressRows = recentProgress ?? []
  const totalWorkouts = progressRows.length
  const totalPRs = progressRows.filter((p) => p.is_pr).length
  const { data: users } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("role", "client")
    .limit(500)
  const nameMap = new Map<string, string>()
  for (const u of users ?? []) nameMap.set(u.id, `${u.first_name} ${u.last_name}`)
  return ["=== CLIENT PROGRESS (last 30 days) ===", `Total Workouts: ${totalWorkouts}`, `Total PRs: ${totalPRs}`].join(
    "\n",
  )
}

async function buildRecentActivity(supabase: SupabaseClient, sevenDaysAgo: Date): Promise<string> {
  const { data: signups } = await supabase
    .from("users")
    .select("first_name, last_name, created_at")
    .eq("role", "client")
    .gte("created_at", sevenDaysAgo.toISOString())
  const lines = ["=== RECENT ACTIVITY (last 7 days) ==="]
  if ((signups ?? []).length > 0)
    lines.push(`New Signups: ${(signups ?? []).map((s) => `${s.first_name} ${s.last_name}`).join(", ")}`)
  else lines.push("New Signups: None")
  return lines.join("\n")
}

async function buildAiGenerationSection(supabase: SupabaseClient): Promise<string> {
  const { data: logs } = await supabase
    .from("ai_generation_log")
    .select("status, tokens_used, model_used")
    .order("created_at", { ascending: false })
    .limit(500)
  const allLogs = logs ?? []
  if (allLogs.length === 0) return "=== AI GENERATION ===\nNo AI generations recorded yet."
  const total = allLogs.length
  const successful = allLogs.filter((l) => l.status === "completed").length
  const failed = allLogs.filter((l) => l.status === "failed").length
  const totalTokens = allLogs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0)
  return [
    "=== AI GENERATION ===",
    `Total: ${total} (${successful} successful, ${failed} failed)`,
    `Total Tokens: ${totalTokens.toLocaleString()}`,
  ].join("\n")
}
