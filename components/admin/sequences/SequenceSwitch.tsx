"use client"

// components/admin/sequences/SequenceSwitch.tsx — the on/off control for one
// sequence, shared by the list (`/admin/sequences`) and the detail screen
// (`/admin/sequences/[key]`).
//
// ONE DIRECTION ASKS FIRST, THE OTHER DOESN'T — deliberately, not an oversight.
// Turning a sequence ON starts sending real email and texts to real people the
// moment they fill in a form, and it also lets anyone who was partway through
// when it was switched off pick back up — possibly within minutes. Turning one
// OFF only ever stops sending, which is the safe direction, so it goes straight
// to the server with no dialog in the way.
//
// NO LOCAL "OPTIMISTIC" STATE. `checked` is derived straight from the `status`
// prop, never copied into local state. A failed PATCH therefore "leaves the
// switch where it was" for free — there is nothing to revert, because nothing
// was changed until the server confirmed it. A successful call calls
// `router.refresh()`, which re-fetches the server component this lives inside
// and hands back the new `status` prop. Same shape as
// components/admin/packs/ClientPackagesPanel.tsx's auto-renew switch.
//
// `status` can be "active", "paused", "draft" or "archived". The switch itself
// is binary — see lib/db/sequence-admin.ts's `setSequenceStatus`, which only
// ever writes "active" or "paused" — so `draft` and `archived` both render as
// off. The list and detail screens are what tell those two apart in words
// (STATUS_LABEL in SequenceReportTable.tsx); this control does not need to.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface SequenceSwitchProps {
  sequenceKey: string
  sequenceName: string
  /** The sequence's current status. See this file's header for how it maps to on/off. */
  status: string
}

export function SequenceSwitch({ sequenceKey, sequenceName, status }: SequenceSwitchProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Ruling: the switch's own on/off reading comes ONLY from `status ===
  // "active"`, never from `status !== "draft"` — a sequence that has never
  // been turned on must read as off, the same as one somebody switched off.
  const isOn = status === "active"

  async function applyToggle(on: boolean) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/sequences/${sequenceKey}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(body.error ?? `Could not update "${sequenceName}".`)
        return
      }
      toast.success(on ? `"${sequenceName}" is switched on.` : `"${sequenceName}" is switched off.`)
      router.refresh()
    } catch {
      toast.error(`Could not update "${sequenceName}". Check your connection and try again.`)
    } finally {
      setBusy(false)
    }
  }

  function requestToggle(next: boolean) {
    // Turning ON confirms first — see this file's header. Turning off never
    // opens the dialog and goes straight to `applyToggle`.
    if (next) {
      setConfirmOpen(true)
      return
    }
    void applyToggle(false)
  }

  return (
    <>
      <Switch
        checked={isOn}
        onCheckedChange={requestToggle}
        disabled={busy}
        aria-label={isOn ? `Turn off "${sequenceName}"` : `Turn on "${sequenceName}"`}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch on &ldquo;{sequenceName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              People who fill in a form will start getting these emails and texts straight away.
              <br />
              <br />
              Anyone who was partway through when you switched it off will pick up where they left off — which may
              mean a message goes out within a few minutes.
              <br />
              <br />
              Quiet hours and your one-message-a-day limit still apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false)
                void applyToggle(true)
              }}
            >
              Switch on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
