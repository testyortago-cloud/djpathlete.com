"use client"

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts"
import { RADAR_CATEGORIES, normalize } from "@/lib/coach-intel/test-normalization"
import type { TestType } from "@/types/database"
import type { RadarTestPoint } from "@/lib/profile-share/data"

/**
 * Ability radar from performance tests (same normalization as the client
 * dashboard's athlete-radar-card). Self-hides when no category has a score.
 */
export function AthleteRadarSection({ tests }: { tests: RadarTestPoint[] }) {
  const data = Object.entries(RADAR_CATEGORIES).map(([category, types]) => {
    let best: number | null = null
    for (const t of types as TestType[]) {
      const candidates = tests
        .filter((x) => x.testType === t)
        .sort((a, b) => b.testDate.localeCompare(a.testDate))
      if (candidates.length === 0) continue
      const score = normalize(t, candidates[0].resultValue, candidates[0].bodyWeightKg)
      if (score !== null && (best === null || score > best)) best = score
    }
    return { category, score: best ?? 0 }
  })

  if (data.every((d) => d.score === 0)) return null

  return (
    <section aria-label="Athlete radar" className="mt-12">
      <p className="djp-eyebrow">Athlete Radar</p>
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="h-64 w-full md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.3} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Normalized 0–100 from logged performance tests
        </p>
      </div>
    </section>
  )
}
