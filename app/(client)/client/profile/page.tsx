import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { ProfileForm } from "@/components/client/ProfileForm"

export const metadata = { title: "Profile | DJP Athlete" }

export default async function ClientProfilePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id
  const profile = await getProfileByUserId(userId)

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Profile</h1>

      {/* Read-only account info */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Account Information
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Name</p>
            <p className="text-sm font-medium text-foreground">
              {session.user.name ?? "Not set"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Email</p>
            <p className="text-sm font-medium text-foreground">
              {session.user.email ?? "Not set"}
            </p>
          </div>
        </div>
      </div>

      {/* Editable profile form */}
      <ProfileForm profile={profile} />
    </div>
  )
}
