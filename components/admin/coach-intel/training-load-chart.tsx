"use client"

import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function TrainingLoadChart({
  daily,
  acute,
  chronic,
}: {
  daily: { date: string; load: number }[]
  acute: { date: string; value: number }[]
  chronic: { date: string; value: number }[]
}) {
  const merged = daily.map((d) => ({
    date: d.date,
    load: d.load,
    acute: acute.find((a) => a.date === d.date)?.value ?? null,
    chronic: chronic.find((c) => c.date === d.date)?.value ?? null,
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Training load — daily + 7d/28d rolling</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={merged}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="load" name="Daily load" fill="var(--primary)" />
              <Line
                type="monotone"
                dataKey="acute"
                name="Acute (7d)"
                stroke="var(--warning)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="chronic"
                name="Chronic (28d)"
                stroke="var(--success)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
