"use client"

import { Share2, Eye, Heart, Send, Award, LayoutGrid } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import type { SocialMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"
import { HorizontalBar } from "./HorizontalBar"
import { HelpTooltip } from "@/components/ui/HelpTooltip"
import { HELP_COPY } from "@/lib/help-copy"

const CHART = {
  created: "#0e3f50", // primary (green-azure)
  published: "#c49b7a", // accent (gray-orange)
  grid: "#e5e7eb",
  tick: "#6b7280",
  border: "#e5e7eb",
} as const

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface SocialTabProps {
  data: SocialMetrics
}

export function SocialTab({ data }: SocialTabProps) {
  const chartData = data.postsByMonth.map((m) => ({
    name: m.label,
    created: m.total,
    published: m.published,
  }))
  const hasChartData = chartData.some((d) => d.created + d.published > 0)

  return (
    <div>
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Share2 className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label={<HelpTooltip label="Posts generated">{HELP_COPY.postsCreated}</HelpTooltip>}
          value={data.totalPosts}
          trend={{ current: data.totalPosts, previous: data.previousTotalPosts }}
        />
        <StatCard
          icon={<Send className="size-4 text-accent" />}
          iconBg="bg-accent/10"
          label={<HelpTooltip label="Posts published">{HELP_COPY.postsPublished}</HelpTooltip>}
          value={data.publishedPosts}
          trend={{ current: data.publishedPosts, previous: data.previousPublishedPosts }}
        />
        <StatCard
          icon={<Eye className="size-4 text-success" />}
          iconBg="bg-success/10"
          label={<HelpTooltip label="Impressions">{HELP_COPY.impressions}</HelpTooltip>}
          value={compactNumber(data.totalImpressions)}
        />
        <StatCard
          icon={<Heart className="size-4 text-error" />}
          iconBg="bg-error/10"
          label={<HelpTooltip label="Engagement">{HELP_COPY.engagement}</HelpTooltip>}
          value={compactNumber(data.totalEngagement)}
        />
      </div>

      {/* Monthly chart */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Share2 className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Monthly posts</h2>
        </div>
        <div className="p-4">
          {hasChartData ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: CHART.tick }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: CHART.tick }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: `1px solid ${CHART.border}`,
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  cursor={{ fill: CHART.created, opacity: 0.04 }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Bar dataKey="created" fill={CHART.created} radius={[4, 4, 0, 0]} />
                <Bar dataKey="published" fill={CHART.published} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
              No posts in this period.
            </div>
          )}
        </div>
      </div>

      {/* Breakdown cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <LayoutGrid className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Posts by platform</h2>
          </div>
          <HorizontalBar
            items={data.postsByPlatform}
            colorClass="bg-primary"
            emptyMessage="No published posts in this period."
          />
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <Award className="size-4 text-accent" />
            <h2 className="text-lg font-semibold text-primary">Posts by status</h2>
          </div>
          <HorizontalBar items={data.postsByStatus} colorClass="bg-accent" emptyMessage="No posts in this period." />
        </div>
      </div>

      {/* Top posts by engagement */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Heart className="size-4 text-error" />
          <h2 className="text-lg font-semibold text-primary">Top posts by engagement</h2>
        </div>
        {data.topPostsByEngagement.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No engagement data yet — posts need to be published and the nightly analytics sync has to run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Platform</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Content</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Engagement</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Impressions</th>
                </tr>
              </thead>
              <tbody>
                {data.topPostsByEngagement.map((row) => (
                  <tr key={row.social_post_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground capitalize">{row.platform}</td>
                    <td className="px-4 py-3 text-foreground truncate max-w-md">{row.content_preview}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">
                      {compactNumber(row.engagement)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {compactNumber(row.impressions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
