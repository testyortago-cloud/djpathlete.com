"use client"

// components/admin/sequences/SequenceSwitch.tsx — the on/off control for one
// sequence, shared by the list (`/admin/sequences`) and the detail screen
// (`/admin/sequences/[key]`).
//
// ONE DIRECTION ASKS FIRST, THE OTHER DOESN'T — deliberately, not an oversight.
// Turning a sequence ON starts sending real email and texts to real people the
// moment they fill in a form, and it also lets anyone who was partway through
// when it was switched off pick back up — possibly within minutes. Turning one
// OFF only ever stops sending, which is the safe direction, so by default it
// goes straight to the server with no dialog in the way.
//
// EXCEPT WHEN THE STEP EDITOR HAS UNSAVED CHANGES (whole-branch review,
// Important 2). `applyToggle`'s `router.refresh()` re-renders the server
// component this and StepEditor both live under, handing StepEditor a fresh
// `initialSteps` — and its own effect resets all local state from that,
// discarding whatever a coach had typed, in EITHER direction, with no prompt
// and no toast. `useStepEditorDirty()` (StepEditorDirtyContext.tsx) is how
// this control learns that BEFORE acting, so it can ask instead. Turning off
// therefore ALSO confirms, but only in that one circumstance — see
// `requestToggle` below. Silently keeping the stale local edits instead would
// be a different bug: the server's status genuinely changed underneath them.
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
import { useStepEditorDirty } from "@/components/admin/sequences/StepEditorDirtyContext"

interface SequenceSwitchProps {
  sequenceKey: string
  sequenceName: string
  /** The sequence's current status. See this file's header for how it maps to on/off. */
  status: string
}

export function SequenceSwitch({ sequenceKey, sequenceName, status }: SequenceSwitchProps) {
  const router = useRouter()
  // `null` = closed. `true`/`false` = confirming that direction. Generalised
  // from a plain boolean because turning OFF can now also need confirmation
  // — see this file's header.
  const [pendingDirection, setPendingDirection] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // Falls back to `{ dirty: false, ... }` outside a StepEditorDirtyProvider —
  // i.e. on /admin/sequences, which has no step editor. See that file's
  // header for why this must never throw there.
  const { dirty: hasUnsavedStepChanges } = useStepEditorDirty()

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
    // Turning ON always confirms first — see this file's header. Turning OFF
    // confirms too, but ONLY when the step editor has something unsaved that
    // the resulting refresh would otherwise throw away with no warning;
    // otherwise it goes straight to `applyToggle`, unchanged from before.
    if (next || hasUnsavedStepChanges) {
      setPendingDirection(next)
      return
    }
    void applyToggle(false)
  }

  const dialogOpen = pendingDirection !== null
  const confirmingOn = pendingDirection === true

  return (
    <>
      <Switch
        checked={isOn}
        onCheckedChange={requestToggle}
        disabled={busy}
        aria-label={isOn ? `Turn off "${sequenceName}"` : `Turn on "${sequenceName}"`}
      />

      <AlertDialog open={dialogOpen} onOpenChange={(open) => !open && setPendingDirection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmingOn ? (
                <>Switch on &ldquo;{sequenceName}&rdquo;?</>
              ) : (
                <>Turn off &ldquo;{sequenceName}&rdquo;?</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingOn ? (
                <>
                  People who fill in a form will start getting these emails and texts straight away.
                  <br />
                  <br />
                  Anyone who was partway through when you switched it off will pick up where they left off — which may
                  mean a message goes out within a few minutes.
                  <br />
                  <br />
                  Quiet hours and your one-message-a-day limit still apply.
                  {hasUnsavedStepChanges ? (
                    <>
                      <br />
                      <br />
                      You also have changes to the steps that have not been saved yet. Turning this on will discard
                      them.
                    </>
                  ) : null}
                </>
              ) : (
                // Only reachable when hasUnsavedStepChanges is true — see
                // requestToggle above.
                <>You have changes to the steps that have not been saved yet. Turning this off will discard them.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                const direction = confirmingOn
                setPendingDirection(null)
                void applyToggle(direction)
              }}
            >
              {confirmingOn ? "Switch on" : "Turn off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
