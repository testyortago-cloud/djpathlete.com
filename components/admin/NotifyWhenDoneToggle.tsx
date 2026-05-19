"use client"

import { Mail } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { COACH_EMAIL } from "@/lib/constants"

interface NotifyWhenDoneToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * Shared "Email me when done" toggle for AI generation dialogs. Always
 * targets COACH_EMAIL (darren@darrenjpaul.com) — regardless of which admin
 * account clicked Generate, the coach is the one who reviews the result.
 *
 * Consumers pass COACH_EMAIL as `notify_email` in the request body when
 * checked is true; omit when false.
 */
export function NotifyWhenDoneToggle({
  checked,
  onChange,
  disabled = false,
}: NotifyWhenDoneToggleProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
        checked
          ? "border-primary/30 bg-primary/[0.03]"
          : "border-border bg-surface/40"
      }`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Mail className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <Label
          htmlFor="notify-when-done"
          className="block text-sm font-medium text-foreground cursor-pointer"
        >
          Email me when done
        </Label>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground break-all">
          {checked
            ? `Sends to ${COACH_EMAIL} when the job finishes.`
            : "Off — you'll need to watch this dialog."}
        </p>
      </div>
      <Switch
        id="notify-when-done"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="shrink-0"
      />
    </div>
  )
}
