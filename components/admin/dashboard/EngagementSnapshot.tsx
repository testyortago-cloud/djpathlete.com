import { Dumbbell, Flame, Trophy, Gauge } from "lucide-react"

interface EngagementSnapshotProps {
  workoutsThisWeek: number
  activeStreaks: number
  prsThisMonth: number
  avgRPE: number | null
}

export function EngagementSnapshot({ workoutsThisWeek, activeStreaks, prsThisMonth, avgRPE }: EngagementSnapshotProps) {
  const items = [
    {
      icon: <Dumbbell className="size-4 text-primary" />,
      iconBg: "bg-primary/10",
      label: "Workouts This Week",
      value: workoutsThisWeek,
    },
    {
      icon: <Flame className="size-4 text-destructive" />,
      iconBg: "bg-destructive/10",
      label: "Active Streaks",
      value: activeStreaks,
    },
    {
      icon: <Trophy className="size-4 text-warning" />,
      iconBg: "bg-warning/10",
      label: "PRs This Month",
      value: prsThisMonth,
    },
    {
      icon: <Gauge className="size-4 text-primary" />,
      iconBg: "bg-primary/10",
      label: "Avg RPE",
      value: avgRPE != null ? avgRPE.toFixed(1) : "—",
    },
  ]

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm h-full">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Dumbbell className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-primary">Engagement Snapshot</h2>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border">
        {items.map((item) => (
          <div key={item.label} className="bg-white p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`flex size-7 items-center justify-center rounded-md ${item.iconBg}`}>{item.icon}</div>
            </div>
            <p className="text-xl sm:text-2xl font-semibold text-primary">{item.value}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
