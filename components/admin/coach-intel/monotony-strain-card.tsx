import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MONOTONY_HIGH } from "@/lib/coach-intel/thresholds"

export function MonotonyStrainCard({ monotony, strain }: { monotony: number | null; strain: number | null }) {
  const colorClass =
    monotony === null ? "text-muted-foreground" : monotony > MONOTONY_HIGH ? "text-error" : "text-success"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monotony &amp; strain (this week)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-muted-foreground text-xs">Monotony</p>
          <p className={`font-heading text-3xl font-bold ${colorClass}`}>
            {monotony !== null ? monotony.toFixed(2) : "—"}
          </p>
          <p className="text-muted-foreground text-xs">target ≤ {MONOTONY_HIGH}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Strain</p>
          <p className="font-heading text-3xl font-bold">{strain !== null ? Math.round(strain) : "—"}</p>
          <p className="text-muted-foreground text-xs">load × monotony</p>
        </div>
      </CardContent>
    </Card>
  )
}
