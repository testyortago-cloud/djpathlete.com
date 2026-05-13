"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SESSION_TYPE_LABELS } from "@/lib/validators/training-session"
import type { TrainingSession } from "@/types/database"

export function MyTrainingHistory({ sessions }: { sessions: TrainingSession[] }) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">No training sessions logged yet.</CardContent>
      </Card>
    )
  }

  const byDate = new Map<string, number>()
  for (const s of sessions) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.session_load)
  const chartData = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, load]) => ({ date, load }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily load (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="load" fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ol className="divide-y">
            {sessions.slice(0, 20).map((s) => (
              <li key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">
                    {SESSION_TYPE_LABELS[s.session_type]}
                    <span className="text-muted-foreground ml-2 text-sm">{s.date}</span>
                  </p>
                  <p className="text-muted-foreground text-sm">
                    RPE {s.rpe}/10 · {s.duration_min}min · load {s.session_load}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
