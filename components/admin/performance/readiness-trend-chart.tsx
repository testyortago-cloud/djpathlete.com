"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ReadinessTrendChart({ data }: { data: { date: string; readiness_score: number }[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">No readiness data in this range.</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness — 30 day trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <ReferenceLine y={70} stroke="var(--success)" strokeDasharray="3 3" />
              <ReferenceLine y={40} stroke="var(--error)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="readiness_score" stroke="var(--primary)" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
