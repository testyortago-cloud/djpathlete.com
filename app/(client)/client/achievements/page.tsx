import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getAchievements, getAchievementsByType } from "@/lib/db/achievements"
import { getWorkoutStreak } from "@/lib/db/progress"
import { AchievementFilterTabs } from "@/components/client/AchievementFilterTabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Trophy, Flame, Star, ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Achievements | DJP Athlete" }

export default async function AchievementsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let achievements: Awaited<ReturnType<typeof getAchievements>> = []
  let prCount = 0
  let streakCount = 0
  let longestStreak = 0

  try {
    const [allAchievements, prAchievements, streakAchievements, currentStreak] =
      await Promise.all([
        getAchievements(userId),
        getAchievementsByType(userId, "pr"),
        getAchievementsByType(userId, "streak"),
        getWorkoutStreak(userId),
      ])

    achievements = allAchievements
    prCount = prAchievements.length
    streakCount = streakAchievements.length
    longestStreak = currentStreak
  } catch {
    // DB tables may not exist yet -- render gracefully
  }

  return (
    <div>
      {/* Back link */}
      <Link
        href="/client/progress"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="size-3.5" />
        Back to Progress
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Achievements</h1>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-amber-500/10 shrink-0">
            <Trophy className="size-4 sm:size-5 text-amber-500" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-semibold text-foreground leading-none">
              {achievements.length}
            </p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight mt-0.5">Total</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-primary/10 shrink-0">
            <Star className="size-4 sm:size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-semibold text-foreground leading-none">{prCount}</p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight mt-0.5">PRs</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-orange-500/10 shrink-0">
            <Flame className="size-4 sm:size-5 text-orange-500" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-semibold text-foreground leading-none">
              {longestStreak}
            </p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight mt-0.5">Streak</p>
          </div>
        </div>
      </div>

      {/* Achievements list */}
      {achievements.length === 0 ? (
        <EmptyState
          icon={Trophy}
          heading="No achievements yet"
          description="Complete workouts, set personal records, and build streaks to earn achievements. Your trophies will appear here!"
        />
      ) : (
        <AchievementFilterTabs achievements={achievements} />
      )}
    </div>
  )
}
