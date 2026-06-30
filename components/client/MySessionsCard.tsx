import Link from "next/link"
import { Ticket } from "lucide-react"

/** Compact client-dashboard card showing remaining in-person session credits. */
export function MySessionsCard({
  activeRemaining,
  nearestExpiry,
}: {
  activeRemaining: number
  nearestExpiry: string | null
}) {
  if (activeRemaining <= 0) return null
  const expiry = nearestExpiry
    ? new Date(nearestExpiry).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null
  return (
    <Link
      href="/client/sessions"
      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm transition-colors hover:bg-surface"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Ticket className="size-5" strokeWidth={1.5} />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">In-person sessions</p>
          <p className="text-xs text-muted-foreground">{expiry ? `Soonest expiry ${expiry}` : "No expiry"}</p>
        </div>
      </div>
      <span className="text-2xl font-semibold text-primary">{activeRemaining}</span>
    </Link>
  )
}
