"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PerformanceTest } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export function PerformanceTestHistoryChart({ tests }: { tests: PerformanceTest[] }) {
  if (tests.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">
          No tests yet.
        </CardContent>
      </Card>
    )
  }
  const label =
    tests[0].test_type === "custom"
      ? (tests[0].custom_name ?? "Custom")
      : TEST_TYPE_LABELS[tests[0].test_type]
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {label} — history ({tests[0].result_unit})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tests}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="test_date" tickFormatter={(d) => d.slice(5)} />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="result_value"
                stroke="var(--primary)"
                strokeWidth={2}
                dot
              />
              {tests
                .filter((t) => t.is_pr)
                .map((t) => (
                  <ReferenceDot
                    key={t.id}
                    x={t.test_date}
                    y={t.result_value}
                    r={6}
                    fill="var(--accent)"
                    stroke="none"
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
