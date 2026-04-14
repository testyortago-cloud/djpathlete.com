"use client"

import { useState, useEffect, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

interface ToggleItem {
  id: string
  key: string
  label: string
  description: string
}

const NOTIFICATION_OPTIONS: ToggleItem[] = [
  {
    id: "new-client",
    key: "notify_new_client",
    label: "New client registrations",
    description: "Get notified when a new client signs up on the platform.",
  },
  {
    id: "payment-received",
    key: "notify_payment_received",
    label: "Payment received",
    description: "Get notified when a client completes a payment.",
  },
  {
    id: "program-completed",
    key: "notify_program_completed",
    label: "Program completed",
    description: "Get notified when a client completes an assigned program.",
  },
]

export function SettingsNotificationToggles() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    notify_new_client: true,
    notify_payment_received: true,
    notify_program_completed: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/notification-preferences")
      if (res.ok) {
        const data = await res.json()
        setPrefs({
          notify_new_client: data.notify_new_client ?? true,
          notify_payment_received: data.notify_payment_received ?? true,
          notify_program_completed: data.notify_program_completed ?? true,
        })
      }
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrefs()
  }, [fetchPrefs])

  async function handleToggle(key: string) {
    const newValue = !prefs[key]
    setPrefs((prev) => ({ ...prev, [key]: newValue }))
    setSaving(key)

    try {
      const res = await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: newValue }),
      })
      if (!res.ok) throw new Error()
      toast.success("Preference updated")
    } catch {
      // Revert on error
      setPrefs((prev) => ({ ...prev, [key]: !newValue }))
      toast.error("Failed to update preference")
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading preferences...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {NOTIFICATION_OPTIONS.map((option) => (
        <div key={option.id} className="flex items-center justify-between gap-4 py-2">
          <div className="space-y-0.5">
            <Label htmlFor={option.id} className="text-sm font-medium">
              {option.label}
            </Label>
            <p className="text-xs text-muted-foreground">{option.description}</p>
          </div>
          <button
            id={option.id}
            type="button"
            role="switch"
            aria-checked={prefs[option.key]}
            disabled={saving === option.key}
            onClick={() => handleToggle(option.key)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${
              prefs[option.key] ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none block size-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                prefs[option.key] ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  )
}
