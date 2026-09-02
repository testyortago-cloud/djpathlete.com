"use client"

// components/admin/contacts/ContactEnrol.tsx — put THIS ONE person into a sequence.
//
// The header action the design sketch shows:
//
//   ┌─ Jane Smith ─────────────────────── [ Add to a sequence ] ─┐
//
// NO NEW ROUTE, AND NO SECOND DEFINITION OF ENROLMENT. This posts the same
// `{ contactIds, sequenceKey, onePerContact }` body to the same
// /api/admin/sequences/enrol the contact LIST already uses, with an array of
// one, and renders the answer through the same `describeEnrolResult`. The
// wording a coach sees for "that sequence is still a draft" is therefore
// identical on both screens, which matters because that refusal is the first
// thing a real user hits here — every sequence in this database is seeded as a
// draft on purpose.
//
// SAYING SO BEFORE THE CLICK, not only after. If the chosen sequence is not
// active, the warning appears as soon as it is chosen, mirroring the list's
// behaviour: without it the first thing the coach learns about a draft is a red
// box telling them nothing happened.
//
// Light-only, like the rest of the admin.

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SequenceSummary } from "@/lib/db/sequences"
import {
  describeEnrolResult,
  emptyTally,
  type EnrolResultMessage,
  type EnrolTally,
} from "@/lib/lead-engine/manual-enrol"

const MESSAGE_CLASS: Record<EnrolResultMessage["tone"], string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-accent/30 bg-accent/10 text-accent",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
}

export function ContactEnrol({
  contactId,
  contactLabel,
  sequences,
}: {
  contactId: string
  contactLabel: string
  sequences: SequenceSummary[]
}) {
  const [open, setOpen] = useState(false)
  const [sequenceKey, setSequenceKey] = useState("")
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<EnrolResultMessage | null>(null)

  const chosen = sequences.find((sequence) => sequence.key === sequenceKey) ?? null

  function enrol() {
    if (!chosen) return
    setResult(null)

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/sequences/enrol", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // An array of ONE. The route's own validation requires a non-empty
          // array, so a single contact needs no special case at either end.
          body: JSON.stringify({ contactIds: [contactId], sequenceKey: chosen.key, onePerContact: false }),
        })
        const body = (await res.json().catch(() => null)) as {
          tally?: EnrolTally
          sequenceStatus?: string | null
          error?: string
        } | null

        if (!res.ok) {
          setResult({
            tone: "error",
            headline: body?.error ?? "That did not work. Please try again.",
          })
          return
        }

        const message = describeEnrolResult({
          tally: body?.tally ?? emptyTally(),
          sequenceName: chosen.name,
          sequenceStatus: body?.sequenceStatus ?? null,
        })
        setResult(message)
        if (message.tone === "success") {
          toast.success(message.headline)
          setOpen(false)
          // The Sequences panel is rendered by the server component above this
          // island, so a full reload is what shows the new run. Deliberately a
          // reload and not router.refresh(): this page records a
          // `contact.viewed` admin_read_sensitive audit row on every render,
          // and a soft refresh would file a sensitive-READ entry for a WRITE —
          // the same reason ContactTags does not refresh. A reload is an
          // honest, operator-initiated view of the record.
          window.location.reload()
        }
      } catch {
        setResult({ tone: "error", headline: "That did not work. Please try again." })
      }
    })
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Send className="size-4" aria-hidden />
        Add to a sequence
      </Button>
    )
  }

  return (
    <div className="w-full max-w-md sm:w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="contact-sequence-picker">
          Sequence to add them to
        </label>
        <select
          id="contact-sequence-picker"
          value={sequenceKey}
          onChange={(event) => {
            setSequenceKey(event.target.value)
            setResult(null)
          }}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="">Choose a sequence…</option>
          {sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.key}>
              {sequence.name}
              {sequence.status === "active" ? "" : ` (${sequence.status})`}
            </option>
          ))}
        </select>

        <Button type="button" size="sm" onClick={enrol} disabled={!chosen || pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            setSequenceKey("")
            setResult(null)
          }}
        >
          Cancel
        </Button>
      </div>

      {/* Said BEFORE the click. Every sequence in this database is seeded as a
          draft, so without this the first thing a coach learns about that is a
          red box after the fact. */}
      {chosen && chosen.status !== "active" ? (
        <p className="mt-2 text-xs text-accent">
          &ldquo;{chosen.name}&rdquo; is {chosen.status === "draft" ? "still a draft" : chosen.status}. Nothing will be
          sent until someone switches it on, and adding {contactLabel} now will do nothing.
        </p>
      ) : null}

      {chosen && chosen.status === "active" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This starts sending &ldquo;{chosen.name}&rdquo; to {contactLabel}. This is real email to a real person.
        </p>
      ) : null}

      {result ? (
        <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${MESSAGE_CLASS[result.tone]}`}>
          <p className="font-medium">{result.headline}</p>
          {result.detail ? <p className="mt-0.5 opacity-90">{result.detail}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
