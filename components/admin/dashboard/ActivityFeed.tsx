import Link from "next/link"
import { DollarSign, ClipboardCheck, Trophy, ArrowRight } from "lucide-react"

export interface ActivityItem {
  id: string
  type: "payment" | "assignment" | "achievement"
  description: string
  time: string
  date: Date
}

interface ActivityFeedProps {
  items: ActivityItem[]
}

const TYPE_CONFIG: Record<ActivityItem["type"], { icon: React.ReactNode; color: string }> = {
  payment: {
    icon: <DollarSign className="size-3.5" />,
    color: "bg-success/10 text-success",
  },
  assignment: {
    icon: <ClipboardCheck className="size-3.5" />,
    color: "bg-primary/10 text-primary",
  },
  achievement: {
    icon: <Trophy className="size-3.5" />,
    color: "bg-warning/10 text-warning",
  },
}

function relativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-primary">Recent Activity</h2>
        <Link
          href="/admin/analytics"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          Analytics
          <ArrowRight className="size-3" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No recent activity.</div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            const config = TYPE_CONFIG[item.type]
            return (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-surface/30 transition-colors">
                <div className={`flex size-7 shrink-0 items-center justify-center rounded-full mt-0.5 ${config.color}`}>
                  {config.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{item.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{relativeTime(item.date)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
