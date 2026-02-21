import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { QuestionnaireForm } from "@/components/client/QuestionnaireForm"
import type { ClientProfile } from "@/types/database"

export const metadata = { title: "Questionnaire | DJP Athlete" }

export default async function QuestionnairePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  let initialProfile: ClientProfile | null = null
  try {
    initialProfile = await getProfileByUserId(session.user.id)
  } catch {
    // No profile yet — that's fine, we'll start fresh
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold text-primary font-heading">
          Athlete Questionnaire
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1.5">
          Help us understand your goals and preferences to create your personalized program. About 5 minutes.
        </p>
      </div>
      <QuestionnaireForm initialProfile={initialProfile} />
    </div>
  )
}
