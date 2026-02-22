import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Mail, Lock, Trash2, Scale } from "lucide-react"
import { WeightUnitToggle } from "@/components/client/WeightUnitToggle"
import { NotificationToggles } from "@/components/client/NotificationToggles"

export const metadata = { title: "Settings | DJP Athlete" }

export default async function ClientSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Settings</h1>

      {/* Account Section */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Account
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-full bg-primary/10">
                <Mail className="size-4 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Email Address
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.user.email}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-full bg-primary/10">
                <Lock className="size-4 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Password</p>
                <p className="text-xs text-muted-foreground">
                  Change your account password
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled>
              Change Password
            </Button>
          </div>
        </div>
      </div>

      {/* Preferences Section */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Preferences
        </h2>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-full bg-primary/10">
              <Scale className="size-4 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Weight Unit
              </p>
              <p className="text-xs text-muted-foreground">
                Display weights in kilograms or pounds
              </p>
            </div>
          </div>
          <WeightUnitToggle />
        </div>
      </div>

      {/* Notifications Section */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Notifications
        </h2>
        <NotificationToggles />
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-destructive/30 p-6">
        <h2 className="text-sm font-semibold text-destructive uppercase tracking-wider mb-4">
          Danger Zone
        </h2>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-full bg-destructive/10">
              <Trash2
                className="size-4 text-destructive"
                strokeWidth={1.5}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Delete Account
              </p>
              <p className="text-xs text-muted-foreground">
                Permanently delete your account and all associated data
              </p>
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
