"use client"

import Link from "next/link"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { PerformanceTest } from "@/types/database"

export function PerformanceTestCard({
  latest,
  history,
  clientUserId,
}: {
  latest: PerformanceTest
  history: PerformanceTest[]
  clientUserId: string
}) {
  const label =
    latest.test_type === "custom"
      ? (latest.custom_name ?? "Custom")
      : TEST_TYPE_LABELS[latest.test_type]
  const trendData = [...history].reverse().map((t) => ({ value: t.result_value }))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <Link
            href={`/admin/clients/${clientUserId}/performance/tests/${latest.test_type}`}
            className="hover:underline"
          >
            {label}
          </Link>
          {latest.is_pr && <Badge className="bg-accent">PR</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-bold">
          {latest.result_value}{" "}
          <span className="text-muted-foreground text-sm font-normal">{latest.result_unit}</span>
        </p>
        {latest.pct_change_from_prev !== null && (
          <p
            className={`text-xs ${latest.pct_change_from_prev > 0 ? "text-success" : "text-error"}`}
          >
            {latest.pct_change_from_prev > 0 ? "+" : ""}
            {latest.pct_change_from_prev.toFixed(1)}% vs prev
          </p>
        )}
        <p className="text-muted-foreground text-xs">{latest.test_date}</p>
        {trendData.length > 1 && (
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
