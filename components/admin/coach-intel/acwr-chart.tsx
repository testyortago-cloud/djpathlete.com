"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ACWR_SWEET_SPOT_LOW,
  ACWR_SWEET_SPOT_HIGH,
  ACWR_DANGER,
} from "@/lib/coach-intel/thresholds"

export function ACWRChart({
  acute,
  chronic,
}: {
  acute: { date: string; value: number }[]
  chronic: { date: string; value: number }[]
}) {
  const data = acute.map((a) => {
    const c = chronic.find((x) => x.date === a.date)?.value ?? 0
    return { date: a.date, acwr: c > 0 ? a.value / c : null }
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>ACWR (acute / chronic)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 2.5]} />
              <Tooltip />
              <ReferenceArea
                y1={ACWR_SWEET_SPOT_LOW}
                y2={ACWR_SWEET_SPOT_HIGH}
                fill="var(--success)"
                fillOpacity={0.08}
              />
              <ReferenceArea
                y1={ACWR_DANGER}
                y2={2.5}
                fill="var(--error)"
                fillOpacity={0.08}
              />
              <Line
                type="monotone"
                dataKey="acwr"
                stroke="var(--primary)"
                strokeWidth={2}
                dot
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
