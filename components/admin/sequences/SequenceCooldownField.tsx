"use client"

// components/admin/sequences/SequenceCooldownField.tsx — how many days a
// person must be out of this sequence before a trigger may put them back in
// (`sequences.reenrol_cooldown_days`, migration 00263). Lives on the detail
// screen next to the on/off switch, admin-only like the switch.
//
// WHY IT EXISTS. The engine only ever refused a second ACTIVE run; once a run
// finished, the next trigger started it again at once. One account holder
// went through the abandoned-checkout nurture twice in four days that way.
// The default is 30; the four quiz sequences carry 0 because their first
// email is the result the person just asked for.
//
// NO OPTIMISTIC STATE beyond the input's own draft. The stored value is the
// `value` prop; a successful save calls `router.refresh()` and the server
// component hands the new value back. A refused save leaves the prop — and
// therefore the explanation line — exactly where it was.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface SequenceCooldownFieldProps {
  sequenceKey: string
  sequenceName: string
  /** The stored value, in days. 0 means straight away. */
  value: number
}

const BAD_VALUE = "Enter a whole number of days between 0 and 365."

function describe(days: number): string {
  if (days === 0) return "Right now: anyone who finishes this sequence can enter again straight away."
  return `Right now: someone who finishes this sequence stays out of it for ${days === 1 ? "1 day" : `${days} days`} when a trigger fires. Enrolling them by hand is not held back.`
}

export function SequenceCooldownField({ sequenceKey, sequenceName, value }: SequenceCooldownFieldProps) {
  const router = useRouter()
  const [draft, setDraft] = useState(String(value))
  const [saving, setSaving] = useState(false)
  const inputId = `sequence-cooldown-${sequenceKey}`

  const parsed = Number(draft)
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 365

  async function save() {
    if (!valid) {
      toast.error(BAD_VALUE)
      return
    }
    if (parsed === value) return

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/sequences/${sequenceKey}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reenrolCooldownDays: parsed }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(body.error ?? `Could not update "${sequenceName}".`)
        return
      }
      toast.success(
        parsed === 0
          ? `"${sequenceName}": people can enter again straight away.`
          : `"${sequenceName}": people can enter again after ${parsed === 1 ? "1 day" : `${parsed} days`}.`,
      )
      router.refresh()
    } catch {
      toast.error(`Could not update "${sequenceName}". Check your connection and try again.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-1.5">
      <Label htmlFor={inputId} className="text-sm">
        Days before someone can enter again
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-24"
        />
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={saving}>
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{describe(value)}</p>
    </div>
  )
}
