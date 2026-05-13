"use client"

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { normalize, RADAR_CATEGORIES } from "@/lib/coach-intel/test-normalization"
import type { PerformanceTest, TestType } from "@/types/database"

export function AthleteRadarCard({ tests }: { tests: PerformanceTest[] }) {
  const data = Object.entries(RADAR_CATEGORIES).map(([category, types]) => {
    let best: number | null = null
    for (const t of types as TestType[]) {
      const candidates = tests
        .filter((x) => x.test_type === t)
        .sort((a, b) => b.test_date.localeCompare(a.test_date))
      if (candidates.length === 0) continue
      const score = normalize(t, candidates[0].result_value, candidates[0].body_weight_kg)
      if (score !== null && (best === null || score > best)) best = score
    }
    return { category, score: best ?? 0 }
  })

  const hasData = data.some((d) => d.score > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athlete profile</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-muted-foreground py-12 text-center">
            Log performance tests to see your sport profile.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="category" />
                <PolarRadiusAxis domain={[0, 100]} />
                <Tooltip />
                <Radar
                  dataKey="score"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.3}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
