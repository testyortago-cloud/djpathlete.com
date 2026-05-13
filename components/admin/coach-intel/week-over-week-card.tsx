import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function WeekOverWeekCard({
  current,
  previous,
  deltaPct,
}: {
  current: { totalLoad: number }
  previous: { totalLoad: number }
  deltaPct: number | null
}) {
  const colorClass =
    deltaPct === null
      ? "text-muted-foreground"
      : deltaPct > 0
        ? "text-success"
        : "text-error"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Week over week</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-muted-foreground text-xs">This week</p>
          <p className="font-heading text-3xl font-bold">{current.totalLoad}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Prior week</p>
          <p className="font-heading text-3xl font-bold">{previous.totalLoad}</p>
        </div>
        <div className="col-span-2">
          <p className="text-muted-foreground text-xs">Δ</p>
          <p className={`font-heading text-2xl font-bold ${colorClass}`}>
            {deltaPct !== null
              ? `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`
              : "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
