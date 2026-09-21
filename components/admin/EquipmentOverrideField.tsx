"use client"

import { useEffect, useRef, useState } from "react"
import { Dumbbell, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { EQUIPMENT_OPTIONS } from "@/lib/validators/exercise"
import { EQUIPMENT_LABELS } from "@/lib/validators/questionnaire"

interface EquipmentOverrideFieldProps {
  /** Whose stored kit to pre-tick when the coach switches this on. */
  clientId?: string
  /** null = no override (use the client's stored profile). An array = this exact kit. */
  value: string[] | null
  onChange: (value: string[] | null) => void
  disabled?: boolean
}

/**
 * Per-generation equipment override — "what can this client actually reach THIS
 * week", which a stored profile cannot express for someone who is travelling.
 *
 * Switched off it contributes nothing, and the generation uses the client's
 * profile exactly as before. Switched on it sends an explicit list, including
 * the empty list, which means "nothing at all" and is a legitimate answer for a
 * hotel room. Nothing here is ever written back to the client's profile.
 */
export function EquipmentOverrideField({ clientId, value, onChange, disabled }: EquipmentOverrideFieldProps) {
  const enabled = value !== null
  const [isLoadingKit, setIsLoadingKit] = useState(false)
  // A slow profile fetch must not overwrite ticks the coach made while waiting.
  const requestRef = useRef(0)

  useEffect(() => {
    // Switching off, or no client to read a profile from, needs no fetch.
    if (!enabled || !clientId) return
    // Only seed once, on the transition into "on" — re-seeding on every render
    // would fight the coach for control of the list.
    if (value === null || value.length > 0) return
    let cancelled = false
    const token = ++requestRef.current
    setIsLoadingKit(true)
    fetch(`/api/admin/questionnaires/${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || token !== requestRef.current) return
        // The route answers { profile }, not the profile itself — reading the
        // wrong level here fails silently as an empty kit.
        const kit = data?.profile?.available_equipment
        if (Array.isArray(kit) && kit.length > 0) onChange(kit.filter((e: string) => EQUIPMENT_LABELS[e]))
      })
      .catch(() => {
        // Starting from an empty list is the safe failure: the coach sees
        // "0 of 31" and ticks up, rather than silently getting a full gym.
      })
      .finally(() => {
        if (!cancelled) setIsLoadingKit(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientId])

  function toggle(item: string) {
    if (value === null) return
    onChange(value.includes(item) ? value.filter((e) => e !== item) : [...value, item])
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="equipment-override" className="flex items-center gap-1.5 text-sm">
            <Dumbbell className="size-3.5" />
            Limit equipment for this generation
          </Label>
          <p className="text-xs text-muted-foreground">
            For a client who is away from their usual gym. Tick only what they can actually reach.
          </p>
        </div>
        <Switch
          id="equipment-override"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(on) => onChange(on ? [] : null)}
        />
      </div>

      {enabled && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {isLoadingKit ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  Loading their usual equipment…
                </span>
              ) : value.length === 0 ? (
                <span className="text-warning">Nothing selected — bodyweight only.</span>
              ) : (
                `${value.length} of ${EQUIPMENT_OPTIONS.length} selected`
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
              >
                Clear all
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange([...EQUIPMENT_OPTIONS])}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
              >
                Select all
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {EQUIPMENT_OPTIONS.map((eq) => (
              <button
                key={eq}
                type="button"
                onClick={() => toggle(eq)}
                disabled={disabled}
                aria-pressed={value.includes(eq)}
                className={cn(
                  "rounded-full border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                  value.includes(eq)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                )}
              >
                {EQUIPMENT_LABELS[eq] ?? eq}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
