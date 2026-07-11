import * as Icons from "lucide-react"
import { CheckCircle2, Flame, Star, Trophy } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import type { Badge } from "@/lib/badges"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

// Tier treatments mirror the client dashboard's badge shelf.
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
const TIER_TEXT: Record<Badge["tier"], string> = {
  bronze: "text-orange-700/80",
  silver: "text-zinc-500",
  gold: "text-yellow-600",
}

// Milestone iconography mirrors AchievementCard's type map.
function milestoneIcon(type: string) {
  switch (type) {
    case "streak":
      return { Icon: Flame, color: "text-orange-500" }
    case "completion":
      return { Icon: CheckCircle2, color: "text-primary" }
    case "milestone":
      return { Icon: Star, color: "text-emerald-500" }
    default:
      return { Icon: Trophy, color: "text-amber-500" }
  }
}

/** Tiered badge shelf + dated milestone list. */
export function BadgesSection({
  badges,
  milestones,
}: {
  badges: Badge[]
  milestones: AthleteProfileData["milestones"]
}) {
  return (
    <FadeIn>
      <section aria-label="Achievements" className="mt-12">
        <p className="djp-eyebrow">Achievements</p>

        {badges.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-6">
            {badges.map((b) => {
              const Icon =
                (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[
                  b.icon
                ] ?? Icons.Award
              return (
                <div key={b.id} className="w-20 text-center" title={b.description}>
                  <div
                    className={`mx-auto flex size-16 items-center justify-center rounded-full ${TIER_BG[b.tier]} ${TIER_RING[b.tier]}`}
                  >
                    <Icon className="size-7 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="mt-2 text-xs font-semibold leading-tight">{b.name}</div>
                  <div className={`mt-0.5 font-mono text-[9px] uppercase tracking-widest ${TIER_TEXT[b.tier]}`}>
                    {b.tier}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {milestones.length > 0 && (
          <ul className={badges.length > 0 ? "mt-6" : "mt-4"}>
            {milestones.map((m) => {
              const { Icon, color } = milestoneIcon(m.type)
              return (
                <li
                  key={`${m.title}-${m.earnedAt}`}
                  className="flex items-center gap-3 border-b border-border/70 py-2.5 text-sm last:border-b-0"
                >
                  <Icon className={`size-4 shrink-0 ${color}`} strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate">{m.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {MONTH_YEAR.format(new Date(m.earnedAt))}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </FadeIn>
  )
}
