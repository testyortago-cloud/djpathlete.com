import Link from "next/link"
import { HeartPulse } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import type { Injury } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export function InjuryTimelineList({ injuries, clientUserId }: { injuries: Injury[]; clientUserId: string }) {
  if (injuries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="bg-success/10 flex size-12 items-center justify-center rounded-full">
            <HeartPulse className="text-success size-6" strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <p className="font-heading text-primary text-sm font-semibold">All clear</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              No injuries on file. Use{" "}
              <span className="text-foreground font-medium">+ Report injury</span> above to log a new
              issue.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <h3 className="font-heading text-primary text-base font-semibold">Injury history</h3>
          <p className="text-muted-foreground text-xs">{injuries.length} total · click a row to open</p>
        </div>
        <ol className="divide-y">
          {injuries.map((i) => (
            <li key={i.id}>
              <Link
                href={`/admin/clients/${clientUserId}/injuries/${i.id}`}
                className="hover:bg-surface/40 flex items-center justify-between gap-4 p-4 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-foreground truncate font-medium">
                    {BODY_REGION_LABELS[i.body_region]} — {i.injury_type}
                    <span className="text-muted-foreground ml-1 text-xs font-normal">({i.side})</span>
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {i.date_occurred} → {i.date_resolved ?? "ongoing"} · {i.days_lost} days lost · {i.severity}
                  </p>
                </div>
                <StatusPill status={i.status} />
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
