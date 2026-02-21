import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { ProfileForm } from "@/components/client/ProfileForm"

export const metadata = { title: "Profile | DJP Athlete" }

export default async function ClientProfilePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let profile = null
  try {
    profile = await getProfileByUserId(userId)
  } catch {
    // DB tables may not exist yet — render gracefully with null profile
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Profile</h1>

      {/* Read-only account info */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 mb-5">
        <h2 className="text-[10px] sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4">
          Account Information
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mb-0.5">Name</p>
            <p className="text-xs sm:text-sm font-medium text-foreground truncate">
              {session.user.name ?? "Not set"}
            </p>
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mb-0.5">Email</p>
            <p className="text-xs sm:text-sm font-medium text-foreground truncate">
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
