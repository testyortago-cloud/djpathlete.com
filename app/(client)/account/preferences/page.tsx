import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { MarketingConsentToggle } from "./MarketingConsentToggle"

export const metadata = { title: "Account Preferences" }

export default async function PreferencesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const supabase = createServiceRoleClient()
  const { data: user } = await supabase
    .from("users")
    .select("marketing_consent_at")
    .eq("id", session.user.id)
    .single()

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-heading text-primary">Preferences</h1>
      <MarketingConsentToggle initialGranted={!!user?.marketing_consent_at} />
    </div>
  )
}
