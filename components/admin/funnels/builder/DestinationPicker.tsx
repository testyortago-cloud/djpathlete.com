"use client"

// components/admin/funnels/builder/DestinationPicker.tsx — where a button goes.
//
// ---------------------------------------------------------------------------
// THIS REPLACES A DELIBERATE REFUSAL, SO IT HAS TO ANSWER IT
// ---------------------------------------------------------------------------
// The inspector said, in capitals: "THE LABEL IS EDITABLE, THE TARGET IS
// DESCRIBED", and gave a real reason — a `program` / `event` ref is only
// meaningful once `resolve.ts` has matched it against live rows, so a picker
// over those would be "a second, weaker resolver".
//
// That reasoning is CORRECT and is kept. It just does not cover the case the
// owner was actually stuck on. A page slug is not a row id — it is authored
// text this funnel owns, and the funnel's own page list is right here — so a
// picker over pages is not a resolver at all.
//
// So: pages and in-page sections are pickable, a URL is typeable, and an offer
// or booking target still says "ask in the chat". That last one is not
// laziness — the client has no offer catalogue, and inventing a free-text
// `ref` box would let an owner type a program name that passes every schema
// and renders as a dead button.

import { useConnections } from "@/components/admin/funnels/connections-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** The target shapes this picker can produce. Everything else is read-only. */
type PickableTarget =
  | { kind: "step"; stepSlug: string }
  | { kind: "anchor"; sectionId: string }
  | { kind: "url"; href: string }

export interface DestinationPickerProps {
  id: string
  /** The stored target, in whatever shape it is — including one this build does not know. */
  target: Record<string, unknown> | undefined
  /** Section ids on THIS page, for an in-page anchor. */
  sectionIds: string[]
  disabled: boolean
  onChange: (target: PickableTarget) => void
}

/** An offer or booking target — real, and not something this control may set. */
function isOfferTarget(kind: string): boolean {
  return kind === "program" || kind === "session_pack" || kind === "event" || kind === "booking"
}

const URL_OPTION = "url"

export function DestinationPicker({
  id,
  target,
  sectionIds,
  disabled,
  onChange,
}: DestinationPickerProps) {
  const context = useConnections()
  const pages = context?.pages ?? []
  const kind = typeof target?.kind === "string" ? target.kind : ""

  // An offer is a real destination that this control cannot express. Saying so
  // and pointing at the one place that CAN change it is the same move the
  // repeater makes for adding a form field.
  if (isOfferTarget(kind)) {
    return (
      <p className="text-xs text-muted-foreground">
        Ask in the chat to send this button somewhere else.
      </p>
    )
  }

  const currentHref = kind === "url" && typeof target?.href === "string" ? target.href : ""
  const selected =
    kind === "step" && typeof target?.stepSlug === "string"
      ? `step:${target.stepSlug}`
      : kind === "anchor" && typeof target?.sectionId === "string"
        ? `anchor:${target.sectionId}`
        : URL_OPTION

  const ordered = [...pages].sort((a, b) => a.position - b.position)

  function handleSelect(value: string) {
    if (value.startsWith("step:")) {
      onChange({ kind: "step", stepSlug: value.slice("step:".length) })
      return
    }
    if (value.startsWith("anchor:")) {
      onChange({ kind: "anchor", sectionId: value.slice("anchor:".length) })
      return
    }
    // Switching TO a web address keeps whatever href was there, falling back to
    // the placeholder rather than to "". `blankValueFor` defines `/` as "nobody
    // has chosen", and the rail and the repair tool both read it that way — an
    // empty href would be a shape no schema accepts.
    onChange({ kind: "url", href: currentHref || "/" })
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
        Goes to
      </Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
        value={selected}
        disabled={disabled}
        onChange={(event) => handleSelect(event.target.value)}
      >
        {ordered.length > 0 ? (
          <optgroup label="A page in this funnel">
            {ordered.map((page) => (
              <option key={page.id} value={`step:${page.slug}`}>
                {page.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {sectionIds.length > 0 ? (
          <optgroup label="A section on this page">
            {sectionIds.map((sectionId) => (
              <option key={sectionId} value={`anchor:${sectionId}`}>
                {sectionId}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value={URL_OPTION}>A web address…</option>
      </select>

      {selected === URL_OPTION ? (
        <Input
          aria-label="Web address"
          disabled={disabled}
          defaultValue={currentHref}
          placeholder="/contact"
          // NO `maxLength` and no pattern. `ctaTargetSchema` owns both, and
          // copying either into this file is the restated-validator mistake
          // this repo has paid for three times — the server refuses a bad one
          // and the publish gate refuses to ship it.
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next === "" || next === currentHref) return
            onChange({ kind: "url", href: next })
          }}
        />
      ) : null}
    </div>
  )
}
