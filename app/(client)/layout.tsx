import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ClientLayout } from "@/components/client/ClientLayout"
import { WeightUnitProvider } from "@/hooks/use-weight-unit"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import type { WeightUnit } from "@/types/database"

export default async function ClientRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  let weightUnit: WeightUnit = "lbs"
  let hasCompletedQuestionnaire = false
  try {
    const profile = await getProfileByUserId(session.user.id)
    if (profile?.weight_unit) {
      weightUnit = profile.weight_unit
    }
    hasCompletedQuestionnaire = !!(profile?.goals && profile.goals.trim().length > 0)
  } catch {
    // Default to lbs if profile fetch fails
  }

  // Force clients to complete assessment before accessing other pages
  if (!hasCompletedQuestionnaire) {
    const headersList = await headers()
    const pathname = headersList.get("x-next-pathname") ?? headersList.get("x-invoke-path") ?? ""
    if (!pathname.startsWith("/client/questionnaire")) {
      redirect("/client/questionnaire")
    }
  }

  return (
    <WeightUnitProvider initialUnit={weightUnit}>
      <ClientLayout>{children}</ClientLayout>
    </WeightUnitProvider>
  )
}
