"use client"

import { useState } from "react"
import { Label } from "@/components/ui/label"

interface ToggleItem {
  id: string
  label: string
  description: string
}

const NOTIFICATION_OPTIONS: ToggleItem[] = [
  {
    id: "new-client",
    label: "New client registrations",
    description: "Get notified when a new client signs up on the platform.",
  },
  {
    id: "payment-received",
    label: "Payment received",
    description: "Get notified when a client completes a payment.",
  },
  {
    id: "program-completed",
    label: "Program completed",
    description: "Get notified when a client completes an assigned program.",
  },
]

export function SettingsNotificationToggles() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    "new-client": true,
    "payment-received": true,
    "program-completed": true,
  })

  function handleToggle(id: string) {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-4">
      {NOTIFICATION_OPTIONS.map((option) => (
        <div
          key={option.id}
          className="flex items-center justify-between gap-4 py-2"
        >
          <div className="space-y-0.5">
            <Label htmlFor={option.id} className="text-sm font-medium">
              {option.label}
            </Label>
            <p className="text-xs text-muted-foreground">
              {option.description}
            </p>
          </div>
          <button
            id={option.id}
            type="button"
            role="switch"
            aria-checked={enabled[option.id]}
            onClick={() => handleToggle(option.id)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              enabled[option.id] ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none block size-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                enabled[option.id] ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground pt-2">
        Notification preferences are visual placeholders. Backend delivery will
        be configured in a future update.
      </p>
    </div>
  )
}
