"use client"

import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ComplianceRingCard({
  scheduledCount,
  completedCount,
  pct,
}: {
  scheduledCount: number
  completedCount: number
  pct: number
}) {
  const color =
    pct >= 80 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--error)"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-40">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="70%"
              outerRadius="100%"
              data={[{ value: pct, fill: color }]}
              startAngle={210}
              endAngle={-30}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={6} background />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-heading text-3xl font-bold">{pct}%</p>
            <p className="text-muted-foreground text-xs">
              {completedCount} / {scheduledCount}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
