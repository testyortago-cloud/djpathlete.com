import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PerformanceTestPR } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export function PRsShelfCard({ prs }: { prs: PerformanceTestPR[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal records</CardTitle>
      </CardHeader>
      <CardContent>
        {prs.length === 0 ? (
          <p className="text-muted-foreground">No PRs yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {prs.map((p) => (
              <li key={`${p.test_type}-${p.test_id}`} className="rounded border p-2">
                <p className="text-muted-foreground text-xs">
                  {p.test_type === "custom" ? p.custom_name : TEST_TYPE_LABELS[p.test_type]}
                </p>
                <p className="font-heading text-lg font-bold">
                  {p.result_value}{" "}
                  <span className="text-muted-foreground text-xs font-normal">
                    {p.result_unit}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">{p.test_date}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
