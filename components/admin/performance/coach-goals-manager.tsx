"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { StatusPill } from "@/components/shared/status-pill"
import { LogGoalForm } from "@/components/client/profile/log-goal-form"
import { goalLabel } from "@/lib/goals/format"
import { goalProgressPct, currentGoalValue, type GoalMetricContext } from "@/lib/goals/progress"
import type { AthleteGoal } from "@/types/database"

const STATUS_RANK: Record<string, number> = { active: 0, achieved: 1, missed: 2, archived: 3 }

/**
 * Coach-facing goal management for a single athlete on the performance hub.
 * Adds (via the shared LogGoalForm with an admin client_user_id override),
 * marks achieved, and archives goals. Progress bars use the athlete's latest
 * measured value resolved from already-loaded hub data.
 */
export function CoachGoalsManager({
  clientUserId,
  goals,
  metricContext,
}: {
  clientUserId: string
  goals: AthleteGoal[]
  metricContext: GoalMetricContext
}) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const sorted = [...goals].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
  )

  async function act(id: string, action: "achieve" | "archive") {
    setBusyId(id)
    try {
      const res = await fetch(`/api/athlete-goals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(action === "achieve" ? "Goal marked achieved" : "Goal archived")
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Goals ({goals.length})</CardTitle>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">+ Add goal</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add a goal</DialogTitle>
            </DialogHeader>
            <LogGoalForm clientUserId={clientUserId} onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground px-6 py-10 text-center text-sm">
            No goals yet — add the first one to start tracking.
          </p>
        ) : (
          <ol className="divide-y">
            {sorted.map((g) => {
              const current = currentGoalValue(g, metricContext)
              const pct = goalProgressPct(g, current)
              return (
                <li key={g.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{goalLabel(g)}</p>
                      <p className="text-muted-foreground text-sm">
                        Target: {g.target_value} {g.target_unit}
                        {g.direction === "lower" ? " (lower is better)" : " (higher is better)"}
                        {g.deadline ? ` · by ${g.deadline}` : ""}
                      </p>
                      {current !== null && (
                        <p className="text-muted-foreground text-xs">
                          Current: {current} {g.target_unit}
                        </p>
                      )}
                    </div>
                    <StatusPill
                      status={
                        g.status === "achieved" ? "resolved" : g.status === "active" ? "active" : "neutral"
                      }
                      label={g.status}
                    />
                  </div>
                  {pct !== null && (
                    <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
                      <div className="bg-primary h-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {g.status === "active" && (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === g.id}
                        onClick={() => act(g.id, "achieve")}
                      >
                        Mark achieved
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === g.id}
                        onClick={() => act(g.id, "archive")}
                      >
                        Archive
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
