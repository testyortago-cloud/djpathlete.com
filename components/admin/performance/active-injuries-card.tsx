import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import type { Injury } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export function ActiveInjuriesCard({ injuries, clientUserId }: { injuries: Injury[]; clientUserId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active injuries ({injuries.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {injuries.length === 0 ? (
          <p className="text-muted-foreground">No active injuries.</p>
        ) : (
          <ul className="space-y-2">
            {injuries.map((i) => (
              <li key={i.id} className="flex items-center justify-between">
                <Link href={`/admin/clients/${clientUserId}/injuries/${i.id}`} className="hover:underline">
                  {BODY_REGION_LABELS[i.body_region]} — {i.injury_type}
                  <span className="text-muted-foreground ml-2 text-xs">{i.days_lost}d</span>
                </Link>
                <StatusPill status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
