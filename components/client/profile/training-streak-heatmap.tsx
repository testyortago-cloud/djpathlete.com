"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { dailyLoads } from "@/lib/coach-intel/load"
import { currentStreak, longestStreak } from "@/lib/coach-intel/streak"
import type { TrainingSession } from "@/types/database"

const BUCKETS = [
  { max: 0, fill: "var(--muted)" },
  { max: 199, fill: "color-mix(in oklch, var(--primary) 20%, transparent)" },
  { max: 399, fill: "color-mix(in oklch, var(--primary) 45%, transparent)" },
  { max: 599, fill: "color-mix(in oklch, var(--primary) 70%, transparent)" },
  { max: Infinity, fill: "var(--primary)" },
]

function bucketFor(load: number) {
  return BUCKETS.find((b) => load <= b.max)!.fill
}

export function TrainingStreakHeatmap({ sessions }: { sessions: TrainingSession[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - 7 * 12 + 1)
  const startIso = start.toISOString().slice(0, 10)
  const daily = dailyLoads(
    sessions.map((s) => ({ date: s.date, session_load: s.session_load })),
    startIso,
    today,
  )
  const cs = currentStreak(daily, today)
  const ls = longestStreak(daily)

  const cellSize = 14
  const gap = 2
  const cols = 12
  const rows = 7

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Training streak{" "}
          <span className="text-muted-foreground text-sm font-normal">
            (current {cs}d · best {ls}d)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${cols * (cellSize + gap)} ${rows * (cellSize + gap)}`} className="w-full max-w-md">
          {daily.map((d, i) => {
            const col = Math.floor(i / 7)
            const row = i % 7
            return (
              <rect
                key={d.date}
                x={col * (cellSize + gap)}
                y={row * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={bucketFor(d.load)}
              >
                <title>
                  {d.date} · load {d.load}
                </title>
              </rect>
            )
          })}
        </svg>
      </CardContent>
    </Card>
  )
}
