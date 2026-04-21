"use client"

import { BookOpen, FileText, Mail, Users, ShieldCheck, LayoutGrid } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import type { ContentMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"
import { HorizontalBar } from "./HorizontalBar"
import { HelpTooltip } from "@/components/ui/HelpTooltip"
import { HELP_COPY } from "@/lib/help-copy"

const CHART = {
  drafts: "#0e3f50",
  published: "#c49b7a",
  grid: "#e5e7eb",
  tick: "#6b7280",
  border: "#e5e7eb",
} as const

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

interface ContentTabProps {
  data: ContentMetrics
}

export function ContentTab({ data }: ContentTabProps) {
  const chartData = data.blogsByMonth.map((m) => ({
    name: m.label,
    drafts: m.drafts,
    published: m.published,
  }))
  const hasChartData = chartData.some((d) => d.drafts + d.published > 0)

  return (
    <div>
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<BookOpen className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label={<HelpTooltip label="Blogs created">{HELP_COPY.blogsCreated}</HelpTooltip>}
          value={data.blogsCreated}
          trend={{ current: data.blogsCreated, previous: data.previousBlogsCreated }}
        />
        <StatCard
          icon={<FileText className="size-4 text-accent" />}
          iconBg="bg-accent/10"
          label={<HelpTooltip label="Blogs published">{HELP_COPY.blogsPublished}</HelpTooltip>}
          value={data.blogsPublished}
          trend={{ current: data.blogsPublished, previous: data.previousBlogsPublished }}
        />
        <StatCard
          icon={<Mail className="size-4 text-success" />}
          iconBg="bg-success/10"
          label={<HelpTooltip label="Newsletters sent">{HELP_COPY.newslettersSent}</HelpTooltip>}
          value={data.newslettersSent}
        />
        <StatCard
          icon={<Users className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label={<HelpTooltip label="Active subscribers">{HELP_COPY.activeSubscribers}</HelpTooltip>}
          value={compactNumber(data.activeSubscribers)}
        />
      </div>

      {/* Monthly publish cadence */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <BookOpen className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Blog publish cadence</h2>
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
                  cursor={{ fill: CHART.drafts, opacity: 0.04 }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Bar dataKey="drafts" fill={CHART.drafts} radius={[4, 4, 0, 0]} />
                <Bar dataKey="published" fill={CHART.published} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
              No blog activity in this period.
            </div>
          )}
        </div>
      </div>

      {/* Breakdown cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <LayoutGrid className="size-4 text-primary" />
            <h2 className="text-lg font-semibold text-primary">Published by category</h2>
          </div>
          <HorizontalBar
            items={data.blogsByCategory}
            colorClass="bg-primary"
            emptyMessage="No published blogs in this period."
          />
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <ShieldCheck className="size-4 text-success" />
            <h2 className="text-lg font-semibold text-primary">Fact-check results</h2>
          </div>
          <HorizontalBar
            items={data.blogsByFactCheckStatus}
            colorClass="bg-success"
            emptyMessage="No fact-check results yet."
          />
        </div>
      </div>

      {/* Recent publishes */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <FileText className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Recent publishes</h2>
        </div>
        {data.recentPublishes.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No blog posts published in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Published</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPublishes.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground truncate max-w-md">{row.title}</td>
                    <td className="px-4 py-3 text-foreground">{row.category}</td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{row.status}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {formatDate(row.published_at)}
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
