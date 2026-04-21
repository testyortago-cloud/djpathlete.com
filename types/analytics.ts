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

export interface SocialMetrics {
  totalPosts: number
  previousTotalPosts: number
  publishedPosts: number
  previousPublishedPosts: number
  totalImpressions: number
  totalEngagement: number
  postsByMonth: {
    key: string
    label: string
    total: number
    published: number
  }[]
  postsByPlatform: { label: string; count: number }[]
  postsByStatus: { label: string; count: number }[]
  topPostsByEngagement: {
    social_post_id: string
    platform: string
    content_preview: string
    engagement: number
    impressions: number
  }[]
}

export interface ContentMetrics {
  blogsCreated: number
  previousBlogsCreated: number
  blogsPublished: number
  previousBlogsPublished: number
  newslettersSent: number
  activeSubscribers: number
  blogsByMonth: {
    key: string
    label: string
    drafts: number
    published: number
  }[]
  blogsByCategory: { label: string; count: number }[]
  blogsByFactCheckStatus: { label: string; count: number }[]
  recentPublishes: {
    id: string
    title: string
    status: string
    category: string
    published_at: string | null
    created_at: string
  }[]
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
