import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import * as Icons from "lucide-react"
import type { Badge } from "@/types/database"

const TIER_RING: Record<Badge["tier"], string> = {
  bronze: "ring-2 ring-orange-700/40",
  silver: "ring-2 ring-zinc-400/60",
  gold: "ring-2 ring-yellow-500/70",
}

const TIER_BG: Record<Badge["tier"], string> = {
  bronze: "bg-orange-700/10",
  silver: "bg-zinc-400/10",
  gold: "bg-yellow-500/15",
}

export function BadgeShelfCard({ badges }: { badges: Badge[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Badges ({badges.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {badges.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">
            Earn your first badge by logging readiness for 14 days.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {badges.map((b) => {
              const Icon =
                (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[b.icon] ?? Icons.Award
              return (
                <li
                  key={b.id}
                  className={cn(
                    "flex flex-col items-center rounded-lg p-3 text-center",
                    TIER_BG[b.tier],
                    TIER_RING[b.tier],
                  )}
                >
                  <Icon className="mb-1 h-6 w-6" />
                  <p className="text-sm font-semibold">{b.name}</p>
                  <p className="text-muted-foreground text-xs">{b.description}</p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
