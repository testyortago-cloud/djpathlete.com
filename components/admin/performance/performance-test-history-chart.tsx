"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PerformanceTest } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { formatDate, num } from "@/lib/test-report/format"

const NoTests = () => (
  <Card>
    <CardContent className="text-muted-foreground py-12 text-center">No tests yet.</CardContent>
  </Card>
)

/** "27.8 cm" in the tooltip, dated "2 Nov 2026". */
const tooltipProps = (unit: string) => ({
  formatter: (value: unknown, name: unknown) => [`${num(Number(value))} ${unit}`, String(name)],
  labelFormatter: (date: unknown) => formatDate(String(date)),
})

/** One test over time, oldest first. */
export function PerformanceTestHistoryChart({ tests }: { tests: PerformanceTest[] }) {
  if (tests.length === 0) return <NoTests />
  const label =
    tests[0].test_type === "custom" ? (tests[0].custom_name ?? "Custom") : TEST_TYPE_LABELS[tests[0].test_type]
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
              <Tooltip {...tooltipProps(tests[0].result_unit)} />
              <Line type="monotone" dataKey="result_value" name={label} stroke="var(--primary)" strokeWidth={2} dot />
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

/** Both sides of a left/right test on one chart, each oldest first. */
export function SidesHistoryChart({
  label,
  left,
  right,
}: {
  label: string
  left: PerformanceTest[]
  right: PerformanceTest[]
}) {
  const unit = (left[0] ?? right[0])?.result_unit
  if (!unit) return <NoTests />
  const byDate = new Map<string, { test_date: string; Left?: number; Right?: number }>()
  for (const [side, list] of [
    ["Left", left],
    ["Right", right],
  ] as const) {
    for (const t of list) {
      const row = byDate.get(t.test_date) ?? { test_date: t.test_date }
      row[side] = Number(t.result_value)
      byDate.set(t.test_date, row)
    }
  }
  const data = [...byDate.values()].sort((a, b) => a.test_date.localeCompare(b.test_date))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {label} — left and right ({unit})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="test_date" tickFormatter={(d) => d.slice(5)} />
              <YAxis />
              <Tooltip {...tooltipProps(unit)} />
              <Legend />
              <Line type="monotone" dataKey="Left" stroke="var(--primary)" strokeWidth={2} dot connectNulls />
              <Line type="monotone" dataKey="Right" stroke="var(--accent)" strokeWidth={2} dot connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
