"use client"

// The control that moves one row between the Landing pages board and the
// Funnels board.
//
// ---------------------------------------------------------------------------
// ONE COMPONENT, BOTH DIRECTIONS — deliberately, not for brevity.
// ---------------------------------------------------------------------------
// The predecessor was `ConvertToFunnelDialog`, page -> funnel only. When the
// other direction was asked for, a second near-identical file would have been
// the obvious move, and the two would have drifted: the same "which board am I
// on now" redirect, the same toast, the same error handling, maintained twice.
// `to` is the only thing that actually differs, so it is the only thing
// parameterised.
//
// ---------------------------------------------------------------------------
// THE DISABLED STATE IS A COURTESY. THE GUARD IS THE ROUTE'S.
// ---------------------------------------------------------------------------
// A funnel with two or more pages cannot become a landing page — a landing page
// is one page, and `/admin/pages` has no detail screen to show the others on.
// This renders that as a disabled button WITH THE REASON rather than hiding the
// control, because a control that silently is not there is how the owner ended
// up asking "wheres the button" about the conversion that had been deleted.
//
// It is not the guard. `POST .../convert` counts the steps itself and refuses,
// and its tests are what pin that. A check that lives only on the path the
// button takes is not a guard — the button is the symptom, the route is the
// rule.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { GitBranch, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { FunnelKind } from "@/types/database"

export interface ConvertKindDialogProps {
  funnelId: string
  funnelName: string
  /** Where it is going. The row's CURRENT kind is the other one. */
  to: FunnelKind
  /**
   * How many pages the funnel has. Read only when `to === "page"`; a promotion
   * has nothing to count, because one page is a legal funnel.
   */
  stepCount: number
  /**
   * Whether the row is NOT yet published. Drives one extra sentence in the
   * funnel -> page dialog: a landing page goes live on its next page-publish,
   * so converting a draft changes what the builder's Publish button does.
   */
  isDraft: boolean
}

export function ConvertKindDialog({ funnelId, funnelName, to, stepCount, isDraft }: ConvertKindDialogProps) {
  const router = useRouter()
  const [converting, setConverting] = useState(false)

  const toPage = to === "page"
  const label = toPage ? "Convert to landing page" : "Convert to funnel"

  // ONLY ON THE WAY DOWN. Mirrors the route's own `to === "page"` branch so the
  // two cannot disagree about when the rule applies.
  const blocked = toPage && stepCount !== 1
  const blockedReason = blocked
    ? // ZERO IS NOT "NO PAGES", and saying so would be a sentence the owner
      // acts on that may be false. Both boards load their cards with
      // `listSteps(...).catch(() => [])`, so a failed read is indistinguishable
      // here from an empty funnel — and telling someone to "build its page
      // first" on a funnel that has five is worse than telling them nothing.
      // Above one the count IS trustworthy: a failed read cannot produce it.
      stepCount === 0
      ? "This funnel does not have exactly one page. Open it to see its pages."
      : `This funnel has ${stepCount} pages. A landing page is just one page, so remove the extra pages first.`
    : null

  async function handleConvert() {
    // RE-ENTRANCY GUARD, and that is all it is — see the footer comment for why
    // there is no busy caption to go with it.
    if (converting) return
    setConverting(true)
    try {
      const response = await fetch(`/api/admin/funnels/${funnelId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      })
      if (!response.ok) {
        // The ROUTE'S sentence, not a generic one. It is the layer that counted
        // the pages, so it is the layer that can say how many.
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? `Could not convert "${funnelName}".`)
        return
      }
      toast.success(toPage ? `"${funnelName}" is now a landing page.` : `"${funnelName}" is now a funnel.`)
      // IT HAS LEFT THIS SCREEN. `router.refresh()` in place would redraw the
      // board without this card, which reads as a deletion — the owner asked
      // where his page went once already.
      router.push(toPage ? "/admin/pages" : "/admin/funnels")
    } catch {
      toast.error(`Could not convert "${funnelName}".`)
    } finally {
      setConverting(false)
    }
  }

  // DISABLED, NOT ABSENT, and rendered outside AlertDialog so it cannot open a
  // confirmation for something that would be refused.
  if (blocked) {
    return (
      <Button variant="outline" size="sm" disabled title={blockedReason ?? undefined} aria-label={label}>
        {toPage ? (
          <FileText className="size-4 shrink-0" aria-hidden />
        ) : (
          <GitBranch className="size-4 shrink-0" aria-hidden />
        )}
        {label}
      </Button>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" title={label} aria-label={label}>
          {toPage ? (
            <FileText className="size-4 shrink-0" aria-hidden />
          ) : (
            <GitBranch className="size-4 shrink-0" aria-hidden />
          )}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{toPage ? "Make this a landing page?" : "Make this a funnel?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {toPage ? (
              <>
                &ldquo;{funnelName}&rdquo; moves to your Landing pages. Its page, its content and its web address all
                stay exactly as they are.
                {/* NOT just "only where you find it changes" — that sentence was
                    false in the way that costs money. A landing page goes LIVE
                    the moment one of its pages is published
                    (`steps/[stepId]/publish` flips the row), while a funnel
                    waits for a separate Go live. So converting a DRAFT funnel
                    quietly rearms the builder's Publish button, and the next
                    routine save-and-publish puts it on the public internet. It
                    is the owner's own case: Return to Sport is a draft. */}
                {isDraft ? (
                  <>
                    {" "}
                    One thing does change: after this, pressing <strong>Publish</strong> in the builder puts the page
                    straight onto your website. Right now it would only save a version.
                  </>
                ) : null}
              </>
            ) : (
              <>
                &ldquo;{funnelName}&rdquo; moves to your Funnels, where you can add more pages after it — a thank-you
                page, or an offer. The page you have now becomes the first one, and its web address does not change.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* NO BUSY LABEL HERE, because it could never be seen. Radix's
              AlertDialogAction closes the dialog on click, so this subtree
              unmounts before `converting` is ever true — a `disabled={converting}`
              and a "Moving…" caption would be dead code that LOOKS like a
              double-submit defence. The real defence is `converting` guarding
              the handler below, plus the route's own no-op: a second POST finds
              `funnel.kind === to` and writes nothing. Feedback is the toast and
              the redirect, both of which survive the unmount. */}
          <AlertDialogAction onClick={handleConvert}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
