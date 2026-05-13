import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getByUserAndDate } from "@/lib/db/daily-readiness"
import { LogReadinessForm } from "@/components/client/performance/log-readiness-form"

export default async function ReadinessPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/readiness")

  const today = new Date().toISOString().slice(0, 10)
  const existing = await getByUserAndDate(session.user.id, today)

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-2 text-3xl font-bold">Today's readiness</h1>
      <p className="text-muted-foreground mb-8">How are you feeling today?</p>
      <LogReadinessForm
        initial={
          existing
            ? {
                date: existing.date,
                sleep_hours: existing.sleep_hours,
                sleep_quality: existing.sleep_quality,
                soreness_overall: existing.soreness_overall,
                soreness_by_region: existing.soreness_by_region,
                fatigue: existing.fatigue,
                mood: existing.mood,
                stress: existing.stress,
                hydration: existing.hydration,
                resting_hr: existing.resting_hr,
                hrv_ms: existing.hrv_ms,
                notes: existing.notes,
              }
            : undefined
        }
      />
    </div>
  )
}
