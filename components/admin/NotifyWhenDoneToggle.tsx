"use client"

import { useSession } from "next-auth/react"
import { Mail } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface NotifyWhenDoneToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * Shared "Email me when done" toggle for AI generation dialogs.
 * Reads the recipient address from the admin's NextAuth session and shows
 * it inline so they know exactly where the notification will land.
 *
 * The actual email is opt-IN (default on, can be disabled per generation).
 * Consumers pass `session.user.email` as the body field `notify_email`
 * when checked is true; pass null/omit when false.
 */
export function NotifyWhenDoneToggle({
  checked,
  onChange,
  disabled = false,
}: NotifyWhenDoneToggleProps) {
  const { data: session } = useSession()
  const email = session?.user?.email ?? null

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface/40 px-3 py-2.5">
      <Switch
        id="notify-when-done"
        checked={checked && Boolean(email)}
        onCheckedChange={onChange}
        disabled={disabled || !email}
      />
      <div className="flex-1 min-w-0">
        <Label
          htmlFor="notify-when-done"
          className="flex items-center gap-1.5 text-sm font-medium text-primary cursor-pointer"
        >
          <Mail className="size-3.5" />
          Email me when done
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground truncate">
          {email
            ? `Sends to ${email} — safe to close this dialog after starting.`
            : "Sign in with an email to enable notifications."}
        </p>
      </div>
    </div>
  )
}
