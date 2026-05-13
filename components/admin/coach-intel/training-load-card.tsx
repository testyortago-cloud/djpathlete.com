"use client"

import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function TrainingLoadCard({
  weeklyTotal,
  sparkline,
}: {
  weeklyTotal: number
  sparkline: { date: string; load: number }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly load</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-3xl font-bold">{weeklyTotal}</p>
        <p className="text-muted-foreground text-xs">last 7 days</p>
        {sparkline.length > 1 && (
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <Line type="monotone" dataKey="load" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
