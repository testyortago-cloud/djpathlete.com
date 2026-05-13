"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import { GOAL_METRIC_KIND_LABELS } from "@/lib/validators/athlete-goal"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { AthleteGoal, TestType } from "@/types/database"

function progressPct(g: AthleteGoal): number {
  if (g.status === "achieved") return 100
  if (g.start_value === null) return 0
  const span = g.target_value - g.start_value
  if (span === 0) return 100
  return Math.max(0, Math.min(100, ((g.start_value - g.target_value) / -span) * 100))
}

function label(g: AthleteGoal): string {
  if (g.metric_kind === "test" && g.test_type) {
    return TEST_TYPE_LABELS[g.test_type as TestType]
  }
  return GOAL_METRIC_KIND_LABELS[g.metric_kind]
}

export function GoalsList({ goals }: { goals: AthleteGoal[] }) {
  const router = useRouter()
  async function archive(id: string) {
    const res = await fetch(`/api/athlete-goals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    })
    if (res.ok) {
      toast.success("Goal archived")
      router.refresh()
    } else {
      toast.error("Failed")
    }
  }
  if (goals.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">No goals yet.</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y">
          {goals.map((g) => (
            <li key={g.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-medium">{label(g)}</p>
                  <p className="text-muted-foreground text-sm">
                    Target: {g.target_value} {g.target_unit}
                    {g.direction === "lower" ? " (faster)" : " (more)"}
                    {g.deadline ? ` by ${g.deadline}` : ""}
                  </p>
                </div>
                <StatusPill
                  status={g.status === "achieved" ? "resolved" : g.status === "active" ? "active" : "neutral"}
                  label={g.status}
                />
              </div>
              <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
                <div className="bg-primary h-full transition-all" style={{ width: `${progressPct(g)}%` }} />
              </div>
              {g.status === "active" && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => archive(g.id)}>
                  Archive
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
