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
  try {
    const profile = await getProfileByUserId(session.user.id)
    if (profile?.weight_unit) {
      weightUnit = profile.weight_unit
    }
  } catch {
    // Default to kg if profile fetch fails
  }

  return (
    <WeightUnitProvider initialUnit={weightUnit}>
      <ClientLayout>{children}</ClientLayout>
    </WeightUnitProvider>
  )
}
