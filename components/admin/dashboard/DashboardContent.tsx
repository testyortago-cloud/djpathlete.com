"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { DashboardStatCard } from "./DashboardStatCard"
import { QuickActions } from "./QuickActions"
import { RevenueChart } from "./RevenueChart"
import { EngagementSnapshot } from "./EngagementSnapshot"
import { ActivityFeed, type ActivityItem } from "./ActivityFeed"
import { HorizontalBar } from "@/components/admin/analytics/HorizontalBar"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Users, Dumbbell, DollarSign, ClipboardCheck } from "lucide-react"

interface RecentClient {
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
  status: string
  avatarUrl: string | null
}

interface ProgramPopularity {
  label: string
  count: number
}

interface DashboardContentProps {
  adminFirstName: string
  totalClients: number
  activePrograms: number
  totalRevenue: number
  activeAssignments: number
  revenueTrend: { current: number; previous: number }
  revenueByMonth: { label: string; revenue: number }[]
  thisMonthRevenue: number
  lastMonthRevenue: number
  engagement: {
    workoutsThisWeek: number
    activeStreaks: number
    prsThisMonth: number
    avgRPE: number | null
  }
  activityFeed: ActivityItem[]
  recentClients: RecentClient[]
  programPopularity: ProgramPopularity[]
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function DashboardContent({
  adminFirstName,
  totalClients,
  activePrograms,
  totalRevenue,
  activeAssignments,
  revenueTrend,
  revenueByMonth,
  thisMonthRevenue,
  lastMonthRevenue,
  engagement,
  activityFeed,
  recentClients,
  programPopularity,
}: DashboardContentProps) {
  return (
    <div>
      {/* Row 1: Greeting + Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">
            {getGreeting()}, {adminFirstName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here&apos;s what&apos;s happening with your business.</p>
        </div>
        <QuickActions />
      </div>

      {/* Row 2: Clickable Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <DashboardStatCard
          icon={<Users className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Total Clients"
          value={totalClients}
          href="/admin/clients"
        />
        <DashboardStatCard
          icon={<Dumbbell className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Active Programs"
          value={activePrograms}
          href="/admin/programs"
        />
        <DashboardStatCard
          icon={<DollarSign className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="Total Revenue"
          value={formatCents(totalRevenue)}
          href="/admin/payments"
          trend={revenueTrend}
        />
        <DashboardStatCard
          icon={<ClipboardCheck className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Active Assignments"
          value={activeAssignments}
          href="/admin/programs"
        />
      </div>

      {/* Row 3: Revenue Chart + Engagement Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RevenueChart data={revenueByMonth} thisMonth={thisMonthRevenue} lastMonth={lastMonthRevenue} />
        <EngagementSnapshot {...engagement} />
      </div>

      {/* Row 4: Activity Feed + Recent Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ActivityFeed items={activityFeed} />

        {/* Recent Clients */}
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-primary">Recent Clients</h2>
            <Link
              href="/admin/clients"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              View All
              <ArrowRight className="size-3" />
            </Link>
          </div>

          {recentClients.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No clients have signed up yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {recentClients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface/30 transition-colors"
                >
                  <Avatar>
                    {client.avatarUrl && (
                      <AvatarImage src={client.avatarUrl} alt={`${client.firstName} ${client.lastName}`} />
                    )}
                    <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                      {getInitials(client.firstName, client.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {client.firstName} {client.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        client.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {client.status}
                    </span>
                    <p className="text-xs text-muted-foreground">{formatDate(client.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Program Popularity */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Dumbbell className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">Top Programs</h2>
          </div>
          <Link
            href="/admin/analytics?tab=programs"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            View Analytics
            <ArrowRight className="size-3" />
          </Link>
        </div>
        <HorizontalBar
          items={programPopularity}
          formatValue={(v) => `${v} ${v === 1 ? "assignment" : "assignments"}`}
          emptyMessage="No program assignments yet."
        />
      </div>
    </div>
  )
}
