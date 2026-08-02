import * as Icons from "lucide-react"
import { CheckCircle2, Flame, Star, Trophy } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import { SectionHeading } from "./SectionHeading"
import type { Badge } from "@/lib/badges"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

// Metallic medallion rings — gradient border via a p-[2px] wrapper.
const TIER_GRADIENT: Record<Badge["tier"], string> = {
  bronze: "bg-gradient-to-br from-orange-300 via-orange-700 to-amber-950",
  silver: "bg-gradient-to-br from-zinc-100 via-zinc-400 to-zinc-700",
  gold: "bg-gradient-to-br from-yellow-200 via-yellow-500 to-amber-700",
}
const TIER_GLOW: Record<Badge["tier"], string> = {
  bronze: "shadow-[0_0_24px_-6px_oklch(0.55_0.12_50/0.5)]",
  silver: "shadow-[0_0_24px_-6px_oklch(0.8_0.01_250/0.4)]",
  gold: "shadow-[0_0_28px_-6px_oklch(0.8_0.14_85/0.55)]",
}
const TIER_TEXT: Record<Badge["tier"], string> = {
  bronze: "text-orange-400/90",
  silver: "text-zinc-400",
  gold: "text-yellow-500",
}

// Milestone iconography mirrors AchievementCard's type map.
function milestoneIcon(type: string) {
  switch (type) {
    case "streak":
      return { Icon: Flame, color: "text-orange-400" }
    case "completion":
      return { Icon: CheckCircle2, color: "text-primary" }
    case "milestone":
      return { Icon: Star, color: "text-emerald-400" }
    default:
      return { Icon: Trophy, color: "text-amber-400" }
  }
}

/** Medallion badge shelf + dated milestone list. */
export function BadgesSection({
  badges,
  milestones,
}: {
  badges: Badge[]
  milestones: AthleteProfileData["milestones"]
}) {
  return (
    <FadeIn>
      <section aria-label="Achievements" className="mt-14">
        <SectionHeading>Achievements</SectionHeading>

        {badges.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-8">
            {badges.map((b) => {
              const Icon =
                (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[
                  b.icon
                ] ?? Icons.Award
              return (
                <div key={b.id} className="w-24 text-center" title={b.description}>
                  <div
                    className={`mx-auto size-[4.5rem] rounded-full p-[2px] ${TIER_GRADIENT[b.tier]} ${TIER_GLOW[b.tier]}`}
                  >
                    <div className="flex size-full items-center justify-center rounded-full bg-card">
                      <Icon className="size-7 text-primary" strokeWidth={1.5} />
                    </div>
                  </div>
                  <div className="mt-2.5 text-xs font-semibold leading-tight text-foreground/90">{b.name}</div>
                  <div className={`mt-0.5 font-mono text-[9px] uppercase tracking-widest ${TIER_TEXT[b.tier]}`}>
                    {b.tier}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {milestones.length > 0 && (
          <ul className={badges.length > 0 ? "mt-8" : "mt-5"}>
            {milestones.map((m) => {
              const { Icon, color } = milestoneIcon(m.type)
              return (
                <li
                  key={`${m.title}-${m.earnedAt}`}
                  className="flex items-center gap-3 border-b border-border/60 py-2.5 text-sm last:border-b-0"
                >
                  <Icon className={`size-4 shrink-0 ${color}`} strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate text-foreground/90">{m.title}</span>
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
