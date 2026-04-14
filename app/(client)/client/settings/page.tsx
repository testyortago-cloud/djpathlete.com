import { PageHeader } from "@/components/shared/PageHeader"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getUserById } from "@/lib/db/users"
import { Button } from "@/components/ui/button"
import { Lock, Trash2, Scale } from "lucide-react"
import { ChangePasswordButton } from "@/components/shared/ChangePasswordButton"
import { AccountInfoForm } from "@/components/shared/AccountInfoForm"
import { WeightUnitToggle } from "@/components/client/WeightUnitToggle"
import { NotificationToggles } from "@/components/client/NotificationToggles"
import { AvatarUpload } from "@/components/shared/AvatarUpload"

export const metadata = { title: "Settings | DJP Athlete" }

export default async function ClientSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id
  const dbUser = await getUserById(userId)
  const name = `${dbUser.first_name} ${dbUser.last_name}`.trim()
  const initials =
    name
      .split(" ")
      .map((n) => n.charAt(0))
      .join("")
      .toUpperCase() || "U"
  const avatarUrl = dbUser.avatar_url ?? null

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage your account, preferences, notifications, and security options."
      />

      {/* Account Section */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Account</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <AvatarUpload currentUrl={avatarUrl} userId={userId} initials={initials} />
              <div>
                <p className="text-sm font-medium text-foreground">Profile Photo</p>
                <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, or GIF. Max 2 MB.</p>
              </div>
            </div>
          </div>

          <AccountInfoForm
            initialFirstName={dbUser.first_name}
            initialLastName={dbUser.last_name}
            initialEmail={dbUser.email}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-full bg-primary/10">
                <Lock className="size-4 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Password</p>
                <p className="text-xs text-muted-foreground">A password reset link will be sent to your email.</p>
              </div>
            </div>
            <ChangePasswordButton email={dbUser.email} />
          </div>
        </div>
      </div>

      {/* Preferences Section */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Preferences</h2>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-full bg-primary/10">
              <Scale className="size-4 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Weight Unit</p>
              <p className="text-xs text-muted-foreground">Display weights in kilograms or pounds</p>
            </div>
          </div>
          <WeightUnitToggle />
        </div>
      </div>

      {/* Notifications Section */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Notifications</h2>
        <NotificationToggles />
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-destructive/30 p-6">
        <h2 className="text-sm font-semibold text-destructive uppercase tracking-wider mb-4">Danger Zone</h2>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-full bg-destructive/10">
              <Trash2 className="size-4 text-destructive" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Delete Account</p>
              <p className="text-xs text-muted-foreground">Permanently delete your account and all associated data</p>
            </div>
          </div>
          <Button variant="destructive" size="sm" disabled>
            Delete Account
          </Button>
        </div>
      </div>
    </div>
  )
}
