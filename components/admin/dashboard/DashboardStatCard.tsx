import Link from "next/link"
import { ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react"

interface DashboardStatCardProps {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: string | number
  href: string
  trend?: { current: number; previous: number }
}

export function DashboardStatCard({ icon, iconBg, label, value, href, trend }: DashboardStatCardProps) {
  const hasTrend = trend && trend.previous > 0
  const pct = hasTrend ? Math.round(((trend.current - trend.previous) / trend.previous) * 100) : 0

  return (
    <Link
      href={href}
      className="group bg-white rounded-xl border border-border p-3 sm:p-4 transition-all hover:shadow-md hover:border-primary/30"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`flex size-8 sm:size-9 items-center justify-center rounded-lg ${iconBg}`}>{icon}</div>
          <p className="text-xs sm:text-sm text-muted-foreground">{label}</p>
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl sm:text-2xl font-semibold text-primary">{value}</p>
        {hasTrend && pct !== 0 && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              pct > 0 ? "text-success" : "text-destructive"
            }`}
          >
            {pct > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {pct > 0 ? "+" : ""}
            {pct}%
          </span>
        )}
      </div>
    </Link>
  )
}
