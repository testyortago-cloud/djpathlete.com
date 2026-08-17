// components/admin/funnels/builder/PolishProposalBanner.tsx — the two answers.
//
// Its own file rather than another hundred lines inside `FunnelBuilder`, which
// is past 2200 lines and is the file every funnel change has to be read
// against.
//
// ---------------------------------------------------------------------------
// WHAT THIS SHOWS, AND WHAT IT DELIBERATELY DOES NOT.
// ---------------------------------------------------------------------------
// It shows WHICH SECTIONS would change and WHY, from `formatReceipt` — the same
// per-section summary the chat prints under every accepted turn, so the two
// cannot describe the same edit differently.
//
// It does NOT render the proposed page. `PreviewPane` is an iframe of
// `/funnel-preview/[stepId]`, which reads the document back out of the
// DATABASE — and a proposal is never in the database, which is the whole point
// of it. Rendering it a second way on the client (raw `reassemble` output,
// unsanitised, without the node compiler publish actually ships) would be a
// second, disagreeing answer to "what will this look like", offered at exactly
// the moment the owner is deciding whether to trust it.
//
// So the preview behind this banner keeps showing the page AS IT STANDS, the
// banner says what would change, and the safety net is that Apply is now one
// keystroke away from being undone. A true side-by-side needs a preview route
// that can render an unsaved document; that is a real feature and it is not
// this one.

"use client"

import { Button } from "@/components/ui/button"
import { Check, Loader2, Sparkles, X } from "lucide-react"
import { formatReceipt } from "./format"
import type { DiffReceipt } from "./types"

export function PolishProposalBanner({
  summary,
  receipt,
  applying,
  onApply,
  onDiscard,
}: {
  summary: string
  receipt: DiffReceipt | null
  applying: boolean
  onApply: () => void
  onDiscard: () => void
}) {
  return (
    <div
      // `region` with a name, because this is a decision point the owner can
      // tab to, and because it changes what every other control on the screen
      // will do until it is answered.
      role="region"
      aria-label="Suggested polish"
      className="shrink-0 border-b border-accent/40 bg-accent/10 px-4 py-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">This is a suggestion — nothing has been saved yet</p>
          {summary.trim() === "" ? null : <p className="mt-0.5 text-sm text-muted-foreground">{summary}</p>}
          {/* The per-section diff. `receipt` is null only when the reviewer
              reported a change it could not itemise, which should not happen —
              saying nothing beats inventing "0 sections" over a real edit. */}
          {receipt ? <p className="mt-1 text-xs text-muted-foreground">{formatReceipt(receipt)}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onApply} disabled={applying}>
            {applying ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            Apply
          </Button>
          <Button size="sm" variant="outline" onClick={onDiscard} disabled={applying}>
            <X className="size-4" aria-hidden />
            Discard
          </Button>
        </div>
      </div>
    </div>
  )
}
