"use client"

// components/admin/GrantProgramDialog.tsx — "which program did they buy?",
// asked once, right after a card lands on Won.
//
// WHY THIS IS A QUESTION AND NOT AN AUTOMATIC CONSEQUENCE. Winning a deal is
// not the same as knowing what was sold: a card can be a cash deal, a camp, or
// a plan nobody has priced yet. Granting from the card's value would mean one
// mis-dragged card creates a real account and sends a real stranger a real
// "set your password" email. Dismissing this dialog is a normal outcome — the
// deal stays won and nothing is created.
//
// The programs offered are priced products only. Sixty-eight programs are
// active in production and fifty of those are individual athletes' personal
// plans, named after them; offering those here would make granting somebody
// else's private plan a plausible mis-click. See `listGrantablePrograms`.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface GrantableProgram {
  id: string
  name: string
  price_cents: number | null
}

function priceLabel(cents: number | null): string {
  if (cents == null) return ""
  return ` — $${(cents / 100).toFixed(0)}`
}

export function GrantProgramDialog({
  target,
  programs,
  onClose,
  onGranted,
}: {
  target: { id: string; label: string } | null
  programs: GrantableProgram[]
  onClose: () => void
  onGranted: () => void
}) {
  const [programId, setProgramId] = useState("")
  const [busy, setBusy] = useState(false)

  // A fresh card gets a fresh choice. Without this, the previous deal's
  // selection is pre-filled for the next one, which is the wrong default in
  // the one place where accepting the default sends somebody an email.
  useEffect(() => {
    setProgramId("")
  }, [target?.id])

  async function grant() {
    if (!target || !programId) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/pipeline/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: target.id, programId }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        alreadyGranted?: boolean
        accountCreated?: boolean
        emailFailed?: boolean
      }
      if (!res.ok) throw new Error(body.error || "Could not set up the account")

      if (body.alreadyGranted) {
        toast.success("Already set up — nothing sent twice.")
      } else if (body.emailFailed) {
        // Deliberately not a success toast. The account exists and the program
        // is granted, but nobody has been told, and a coach who reads "done"
        // here will not follow up.
        toast.warning("Account created, but the invite email did not send. Send it from their profile.")
      } else if (body.accountCreated) {
        toast.success(`${target.label} has an account and an email to set their password.`)
      } else {
        toast.success(`${target.label} now has access.`)
      }
      onGranted()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set up the account")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set {target?.label} up with their program?</DialogTitle>
          <DialogDescription>
            {programs.length === 0
              ? "There are no priced programs to give out yet. Add a price to a program first, then come back to this deal."
              : "Pick what they bought. They will get an email to set their password. Nothing is sent until you choose."}
          </DialogDescription>
        </DialogHeader>

        {programs.length > 0 && (
          <div className="space-y-2">
            {programs.map((program) => (
              <label
                key={program.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface/40"
              >
                <input
                  type="radio"
                  name="grant-program"
                  value={program.id}
                  checked={programId === program.id}
                  onChange={() => setProgramId(program.id)}
                  className="accent-primary"
                />
                <span className="text-foreground">
                  {program.name}
                  <span className="text-muted-foreground">{priceLabel(program.price_cents)}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          {/* "Not now" first and unstyled: leaving without granting is a normal
              outcome here, not a cancellation of something that went wrong. */}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button onClick={grant} disabled={busy || !programId || programs.length === 0}>
            {busy ? "Setting up…" : "Give them access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
