"use client"

import { BarChart3, Brain, CheckCircle, Activity } from "lucide-react"
import type { ProgramMetrics } from "@/types/analytics"
import { StatCard } from "./StatCard"
import { HorizontalBar } from "./HorizontalBar"

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success/10 text-success",
  completed: "bg-primary/10 text-primary",
  paused: "bg-warning/10 text-warning",
  cancelled: "bg-destructive/10 text-destructive",
}

interface ProgramsTabProps {
  data: ProgramMetrics
}

export function ProgramsTab({ data }: ProgramsTabProps) {
  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<BarChart3 className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Total Programs"
          value={data.totalPrograms}
        />
        <StatCard
          icon={<Brain className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="AI-Generated"
          value={data.aiGeneratedCount}
        />
        <StatCard
          icon={<Activity className="size-4 text-success" />}
          iconBg="bg-success/10"
          label="Active Assignments"
          value={data.activeAssignments}
        />
        <StatCard
          icon={<CheckCircle className="size-4 text-primary" />}
          iconBg="bg-primary/10"
          label="Completion Rate"
          value={`${data.completionRate}%`}
        />
      </div>

      {/* Program Popularity */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-8">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <BarChart3 className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Program Popularity</h2>
        </div>
        <HorizontalBar
          items={data.programPopularity.map((p) => ({
            label: p.name,
            count: p.count,
            badge: p.category.replace(/_/g, " "),
            secondBadge: p.difficulty,
          }))}
          formatValue={(v) => `${v} ${v === 1 ? "assignment" : "assignments"}`}
          emptyMessage="No program assignments yet."
        />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-primary">By Category</h2>
          </div>
          <HorizontalBar items={data.programsByCategory} emptyMessage="No programs yet." />
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-primary">By Difficulty</h2>
          </div>
          <HorizontalBar items={data.programsByDifficulty} colorClass="bg-accent" emptyMessage="No programs yet." />
        </div>
      </div>

      {/* Assignment Status */}
      <div className="bg-white rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Activity className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Assignment Status</h2>
        </div>
        <div className="p-4">
          {data.assignmentsByStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No assignments in this period.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {data.assignmentsByStatus.map((s) => (
                <div
                  key={s.status}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 ${
                    STATUS_COLORS[s.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  <span className="text-sm font-medium capitalize">{s.status}</span>
                  <span className="text-lg font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
