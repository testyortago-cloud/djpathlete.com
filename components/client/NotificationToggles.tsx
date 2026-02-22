"use client"

import { useState, useEffect, useCallback } from "react"
import { Bell, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface ToggleItem {
  key: string
  label: string
  description: string
}

const CLIENT_NOTIFICATIONS: ToggleItem[] = [
  {
    key: "email_notifications",
    label: "Email Notifications",
    description: "Receive updates about your programs and progress",
  },
  {
    key: "workout_reminders",
    label: "Workout Reminders",
    description: "Get reminded about upcoming training sessions",
  },
]

export function NotificationToggles() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    email_notifications: true,
    workout_reminders: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/notification-preferences")
      if (res.ok) {
        const data = await res.json()
        setPrefs({
          email_notifications: data.email_notifications ?? true,
          workout_reminders: data.workout_reminders ?? false,
        })
      }
    } catch {
      // Use defaults
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
      {CLIENT_NOTIFICATIONS.map((option) => (
        <div
          key={option.key}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-full bg-success/10">
              <Bell className="size-4 text-success" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {option.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {option.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[option.key]}
            aria-label={`Toggle ${option.label.toLowerCase()}`}
            disabled={saving === option.key}
            onClick={() => handleToggle(option.key)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${
              prefs[option.key] ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                prefs[option.key] ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  )
}
