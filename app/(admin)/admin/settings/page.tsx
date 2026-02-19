import {
  Settings,
  Shield,
  CreditCard,
  Bell,
  AlertTriangle,
  ExternalLink,
  Lock,
  User,
} from "lucide-react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SettingsNotificationToggles } from "@/components/admin/SettingsNotificationToggles"

export const metadata = { title: "Settings" }

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user = session.user
  const stripeSecretConfigured = !!process.env.STRIPE_SECRET_KEY
  const stripeWebhookConfigured = !!process.env.STRIPE_WEBHOOK_SECRET

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Settings</h1>

      {/* 1. Account Information */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <User className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Account Information
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              value={user.name ?? ""}
              disabled
              className="opacity-60"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-email">Email</Label>
            <Input
              id="account-email"
              value={user.email ?? ""}
              disabled
              className="opacity-60"
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <div>
              <Badge variant="default" className="capitalize">
                <Shield className="size-3" />
                {user.role}
              </Badge>
            </div>
          </div>
        </div>

        <Separator className="my-5" />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Lock className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Change Password</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Password changes are handled through the authentication flow.
            </p>
          </div>
          <Button variant="outline" size="sm" disabled className="opacity-60">
            Change Password
          </Button>
        </div>
      </div>

      {/* 2. Platform Settings */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Platform Settings
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="business-name">Business Name</Label>
            <Input
              id="business-name"
              value="DJP Athlete"
              disabled
              className="opacity-60"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-email">Support Email</Label>
            <Input
              id="support-email"
              type="email"
              placeholder="support@djpathlete.com"
              disabled
              className="opacity-60"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              value="USD"
              disabled
              className="opacity-60"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Platform settings will be configurable in a future update.
        </p>
      </div>

      {/* 3. Stripe Integration */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Stripe Integration
          </h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block size-2.5 rounded-full ${
                  stripeSecretConfigured ? "bg-success" : "bg-muted-foreground"
                }`}
              />
              <span className="text-sm font-medium">STRIPE_SECRET_KEY</span>
            </div>
            <span
              className={`text-xs font-medium ${
                stripeSecretConfigured
                  ? "text-success"
                  : "text-muted-foreground"
              }`}
            >
              {stripeSecretConfigured ? "Configured" : "Not configured"}
            </span>
          </div>

          <Separator />

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block size-2.5 rounded-full ${
                  stripeWebhookConfigured
                    ? "bg-success"
                    : "bg-muted-foreground"
                }`}
              />
              <span className="text-sm font-medium">
                STRIPE_WEBHOOK_SECRET
              </span>
            </div>
            <span
              className={`text-xs font-medium ${
                stripeWebhookConfigured
                  ? "text-success"
                  : "text-muted-foreground"
              }`}
            >
              {stripeWebhookConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        <a
          href="https://dashboard.stripe.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm">
            <ExternalLink className="size-3.5" />
            Manage in Stripe Dashboard
          </Button>
        </a>
      </div>

      {/* 4. Notification Preferences */}
      <div className="bg-white rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Notification Preferences
          </h2>
        </div>

        <SettingsNotificationToggles />
      </div>

      {/* 5. Danger Zone */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="size-5 text-destructive" />
          <h2 className="text-lg font-semibold text-destructive">
            Danger Zone
          </h2>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Destructive actions that cannot be undone. Proceed with extreme
          caution.
        </p>

        <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-white p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Reset Platform Data</p>
            <p className="text-xs text-muted-foreground">
              This action is irreversible. Contact support for data management.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled
            className="opacity-60"
          >
            Reset Data
          </Button>
        </div>
      </div>
    </div>
  )
}
