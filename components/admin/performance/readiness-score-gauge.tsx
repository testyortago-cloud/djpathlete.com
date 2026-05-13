"use client"

import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DailyReadiness } from "@/types/database"

function scoreColor(score: number) {
  if (score >= 71) return "var(--success)"
  if (score >= 41) return "var(--warning)"
  return "var(--error)"
}

export function ReadinessScoreGauge({ readiness }: { readiness: DailyReadiness | null }) {
  if (!readiness) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Readiness</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground py-12 text-center">No check-in today</CardContent>
      </Card>
    )
  }
  const score = Number(readiness.readiness_score)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness ({readiness.date})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-48">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="70%"
              outerRadius="100%"
              data={[{ value: score, fill: scoreColor(score) }]}
              startAngle={210}
              endAngle={-30}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={6} background />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-heading text-4xl font-bold">{Math.round(score)}</p>
            <p className="text-muted-foreground text-xs">/ 100</p>
          </div>
        </div>
        <p className="text-muted-foreground mt-4 text-center text-xs">
          Sleep {readiness.sleep_quality}/5 · Sore {readiness.soreness_overall}/5 · Fatigue {readiness.fatigue}/5
        </p>
      </CardContent>
    </Card>
  )
}
