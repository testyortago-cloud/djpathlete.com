import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RiskFlag } from "@/types/database"

const SEVERITY_CLASS: Record<RiskFlag["severity"], string> = {
  high: "text-error",
  medium: "text-warning",
  low: "text-muted-foreground",
}

export function RiskFlagsCard({ flags }: { flags: RiskFlag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open risk flags ({flags.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {flags.length === 0 ? (
          <p className="text-muted-foreground">No open flags.</p>
        ) : (
          <ul className="space-y-2">
            {flags.slice(0, 3).map((f) => (
              <li key={f.id} className="text-sm">
                <span className={SEVERITY_CLASS[f.severity]}>● </span>
                {f.message}
                <span className="text-muted-foreground ml-2 text-xs">{f.triggered_at}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
