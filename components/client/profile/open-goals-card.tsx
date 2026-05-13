import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GOAL_METRIC_KIND_LABELS } from "@/lib/validators/athlete-goal"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { AthleteGoal, TestType } from "@/types/database"

export function OpenGoalsCard({ goals, goalsHref }: { goals: AthleteGoal[]; goalsHref: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open goals ({goals.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {goals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Link href={goalsHref} className="underline">
              Set your first goal
            </Link>{" "}
            to track progress.
          </p>
        ) : (
          <ul className="space-y-2">
            {goals.slice(0, 3).map((g) => {
              const label =
                g.metric_kind === "test" && g.test_type
                  ? TEST_TYPE_LABELS[g.test_type as TestType]
                  : GOAL_METRIC_KIND_LABELS[g.metric_kind]
              return (
                <li key={g.id} className="text-sm">
                  <Link href={goalsHref} className="hover:underline">
                    {label}: <span className="font-semibold">{g.target_value}</span> {g.target_unit}
                    {g.deadline ? <span className="text-muted-foreground"> · by {g.deadline}</span> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
