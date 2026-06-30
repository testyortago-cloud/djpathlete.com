import type { PackWithCheckins } from "@/lib/services/client-packs-view"
import { remainingCredits } from "@/lib/services/session-credits"

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  depleted: "Used up",
  expired: "Expired",
  refunded: "Refunded",
  cancelled: "Cancelled",
}

function methodLabel(method: string): string {
  if (method === "qr_self") return "Self check-in"
  if (method === "coach_tap") return "Coach"
  return "Manual"
}

export function MySessionsList({ packs }: { packs: PackWithCheckins[] }) {
  if (packs.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          You have no sessions yet. Contact your coach to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {packs.map((p) => {
        const remaining = remainingCredits(p)
        const visibleCheckins = p.checkins.filter((c) => !c.voided)
        return (
          <div key={p.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">{p.session_type}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[p.status] ?? p.status}
                  {p.expires_at ? ` · expires ${new Date(p.expires_at).toLocaleDateString()}` : ""}
                  {p.program_name ? ` · ${p.program_name}` : ""}
                </p>
              </div>
              <span className="text-lg font-semibold text-primary">
                {remaining}
                <span className="text-sm font-normal text-muted-foreground"> / {p.credits_total}</span>
              </span>
            </div>

            {visibleCheckins.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                {visibleCheckins.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{new Date(c.checked_in_at).toLocaleDateString()}</span>
                    <span>{methodLabel(c.method)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
