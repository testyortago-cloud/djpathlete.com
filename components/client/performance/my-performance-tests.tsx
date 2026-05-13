"use client"

import Link from "next/link"
import type { PerformanceTest } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function MyPerformanceTests({ tests }: { tests: PerformanceTest[] }) {
  if (tests.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">No tests logged yet.</CardContent>
      </Card>
    )
  }
  const byType = tests.reduce<Record<string, PerformanceTest[]>>((acc, t) => {
    const key = t.test_type === "custom" ? `custom:${t.custom_name}` : t.test_type
    acc[key] = acc[key] ?? []
    acc[key].push(t)
    return acc
  }, {})
  return (
    <div className="grid gap-4">
      {Object.entries(byType).map(([key, list]) => {
        const sample = list[0]
        const label =
          sample.test_type === "custom" ? (sample.custom_name ?? "Custom") : TEST_TYPE_LABELS[sample.test_type]
        return (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                <Link href={`/client/performance/${sample.test_type}`} className="hover:underline">
                  {label}
                </Link>
              </CardTitle>
              <span className="text-muted-foreground text-sm">{list.length} sessions</span>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-2xl font-bold">
                {sample.result_value}{" "}
                <span className="text-muted-foreground text-sm font-normal">{sample.result_unit}</span>{" "}
                {sample.is_pr && <Badge className="bg-accent ml-2">PR</Badge>}
              </p>
              <p className="text-muted-foreground text-xs">latest: {sample.test_date}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
