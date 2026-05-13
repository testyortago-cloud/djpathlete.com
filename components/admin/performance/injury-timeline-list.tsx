import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import type { Injury } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export function InjuryTimelineList({
  injuries,
  clientUserId,
}: {
  injuries: Injury[]
  clientUserId: string
}) {
  if (injuries.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">
          No injuries recorded.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y">
          {injuries.map((i) => (
            <li key={i.id} className="flex items-center justify-between p-4">
              <div>
                <Link
                  href={`/admin/clients/${clientUserId}/injuries/${i.id}`}
                  className="font-medium hover:underline"
                >
                  {BODY_REGION_LABELS[i.body_region]} — {i.injury_type} ({i.side})
                </Link>
                <p className="text-muted-foreground text-sm">
                  {i.date_occurred} → {i.date_resolved ?? "ongoing"} · {i.days_lost} days
                  lost · {i.severity}
                </p>
              </div>
              <StatusPill status={i.status} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
