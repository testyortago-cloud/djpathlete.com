export interface DateRange {
  from: Date
  to: Date
}

export interface RevenueMetrics {
  totalRevenue: number
  previousPeriodRevenue: number
  thisMonthRevenue: number
  avgTransaction: number
  transactionCount: number
  revenueByMonth: { key: string; label: string; total: number; count: number }[]
  revenueByStatus: { status: string; count: number; total: number }[]
  topPayingClients: {
    name: string
    email: string
    total: number
    count: number
  }[]
}

export interface ClientMetrics {
  totalClients: number
  activeClients: number
  newClientsInRange: number
  clientsByMonth: {
    key: string
    label: string
    count: number
    cumulative: number
  }[]
  retentionRate: number
  clientsByGoal: { label: string; count: number }[]
  clientsBySport: { label: string; count: number }[]
  clientsByExperience: { label: string; count: number }[]
  profileCompletionRate: number
}

export interface ProgramMetrics {
  totalPrograms: number
  aiGeneratedCount: number
  activeAssignments: number
  completionRate: number
  programPopularity: {
    name: string
    count: number
    category: string
    difficulty: string
  }[]
  assignmentsByStatus: { status: string; count: number }[]
  programsByCategory: { label: string; count: number }[]
  programsByDifficulty: { label: string; count: number }[]
}

export interface EngagementMetrics {
  totalWorkoutsLogged: number
  prsInRange: number
  activeUsersThisWeek: number
  avgRPE: number | null
  workoutsByMonth: { key: string; label: string; count: number }[]
  topExercises: { label: string; count: number }[]
  mostActiveClients: { name: string; count: number }[]
  achievementsByType: { type: string; count: number }[]
  streakLeaders: { name: string; streak: number }[]
}

export interface ShopMetrics {
  // Revenue (in cents)
  totalRevenueCents: number
  previousPeriodRevenueCents: number
  thisMonthRevenueCents: number

  // Order counts
  totalOrders: number
  podOrders: number
  digitalOrders: number

  // Profit
  grossProfitCents: number
  grossMarginBps: number

  // Per-type breakdown
  podRevenueCents: number
  podCogsCents: number
  podProfitCents: number
  podMarginBps: number
  digitalRevenueCents: number
  digitalProfitCents: number
  digitalMarginBps: number

  // Time series — stacked by product type
  revenueByMonth: {
    key: string
    label: string
    total: number
    pod: number
    digital: number
    count: number
  }[]

  // Top products by revenue
  topProducts: {
    product_id: string
    product_name: string
    product_type: "pod" | "digital"
    revenueCents: number
    unitsSold: number
  }[]
}
