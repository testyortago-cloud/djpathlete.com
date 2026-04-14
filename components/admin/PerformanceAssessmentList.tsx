"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Plus, Clock, MessageSquare, CheckCircle2, FileEdit, X } from "lucide-react"
import type { PerformanceAssessmentStatus } from "@/types/database"

interface Assessment {
  id: string
  title: string
  status: string
  created_at: string
  users?: { first_name: string; last_name: string; email: string } | null
}

interface PerformanceAssessmentListProps {
  assessments: Assessment[]
  counts: { draft: number; in_progress: number; completed: number; total: number }
}

const statusConfig: Record<PerformanceAssessmentStatus, { label: string; icon: typeof Clock; className: string }> = {
  draft: { label: "Draft", icon: FileEdit, className: "bg-gray-100 text-gray-700" },
  in_progress: { label: "In Progress", icon: MessageSquare, className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", icon: CheckCircle2, className: "bg-green-100 text-green-700" },
}

const tabs: { label: string; value: PerformanceAssessmentStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
]

export function PerformanceAssessmentList({ assessments, counts }: PerformanceAssessmentListProps) {
  const [filter, setFilter] = useState<PerformanceAssessmentStatus | "all">("all")
  const [clientFilter, setClientFilter] = useState<string>("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const clients = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of assessments) {
      if (a.users) {
        const name = `${a.users.first_name} ${a.users.last_name}`
        if (!map.has(name)) map.set(name, name)
      }
    }
    return Array.from(map.keys()).sort()
  }, [assessments])

  const hasFilters = clientFilter !== "all" || dateFrom || dateTo

  const filtered = useMemo(() => {
    let result = filter === "all" ? assessments : assessments.filter((a) => a.status === filter)

    if (clientFilter !== "all") {
      result = result.filter((a) => {
        if (!a.users) return false
        return `${a.users.first_name} ${a.users.last_name}` === clientFilter
      })
    }

    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter((a) => new Date(a.created_at) >= from)
    }

    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter((a) => new Date(a.created_at) <= to)
    }

    return result
  }, [assessments, filter, clientFilter, dateFrom, dateTo])

  function clearFilters() {
    setClientFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const count = tab.value === "all" ? counts.total : counts[tab.value as PerformanceAssessmentStatus]
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                  filter === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {tab.label} ({count})
              </button>
            )
          })}
        </div>
        <Link href="/admin/performance-assessments/new">
          <Button size="sm">
            <Plus className="size-4 mr-1.5" />
            New Assessment
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Client</label>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="block h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="all">All Clients</option>
            {clients.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="block h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="block h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 h-9 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No assessments found.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((assessment) => {
            const config = statusConfig[assessment.status as PerformanceAssessmentStatus]
            const StatusIcon = config.icon
            const clientName = assessment.users
              ? `${assessment.users.first_name} ${assessment.users.last_name}`
              : "Unknown"

            return (
              <Link
                key={assessment.id}
                href={`/admin/performance-assessments/${assessment.id}`}
                className="flex items-center justify-between p-4 bg-white rounded-xl border border-border hover:border-primary/20 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{assessment.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {clientName} &middot;{" "}
                    {new Date(assessment.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ml-3",
                    config.className,
                  )}
                >
                  <StatusIcon className="size-3.5" />
                  {config.label}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
