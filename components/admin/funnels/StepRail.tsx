"use client"

// components/admin/funnels/StepRail.tsx — the funnel, as a funnel.
//
// THE COMPLAINT THIS ANSWERS, verbatim: "all of the CTAs step are not
// connected and it is reusing the landing page builder that is only good for 1
// page ... i want it to be a single page where i can navigate to each pages so
// i know its connected."
//
// Both halves are here. The rail lives in a LAYOUT, so clicking another page
// swaps only the canvas beneath it and the rail, the header and the publish
// state stay mounted. And between the rows it draws what actually leads where,
// so "is it connected?" is answered by looking rather than by clicking
// through every page and trying the buttons.
//
// It renders only when there is more than one page. A landing page is
// single-page by definition and a one-row rail would cost 220px to say
// nothing.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlertTriangle, ArrowDown, CircleDot } from "lucide-react"
import { useConnections, type RailPage } from "./connections-context"
import { adminStepHref } from "@/lib/funnels/admin-path"
import { autoConnectOps, type Connection } from "@/lib/funnels/connections"

/** The rows leaving one page that go to another page of this funnel. */
function exitsFrom(connections: Connection[], stepId: string): Connection[] {
  return connections.filter((entry) => entry.fromStepId === stepId && entry.to.kind === "step")
}

function StatusPill({ page }: { page: RailPage }) {
  // THE SAME RULE `StepList` USES, not a second opinion about the word
  // "published". A version row is not enough — the funnel itself has to be
  // published, or the page is unreachable and calling it live is a lie the
  // owner only finds out about from a customer.
  const label = page.live ? "live" : page.published ? "draft" : "never published"
  const tone = page.live
    ? "bg-[var(--success)]/10 text-[var(--success)]"
    : "bg-surface text-muted-foreground"
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tone}`}>{label}</span>
}

/**
 * What leaves this page, drawn between its row and the next.
 *
 * ONE ARROW PER EXIT, not one per page. A funnel page legitimately has more
 * than one way out — a hero button and a pricing card can lead to different
 * places — and collapsing them to a single arrow would be the same lie the
 * old screen told by drawing none.
 */
function Exits({
  exits,
  isLast,
  pagesBySlug,
  repair,
}: {
  exits: Connection[]
  isLast: boolean
  pagesBySlug: Map<string, RailPage>
  /** The "connect this page" control, on the page being edited. */
  repair?: React.ReactNode
}) {
  if (exits.length === 0) {
    // The last page is SUPPOSED to end. Saying so is the difference between a
    // rail that reports a problem and one that nags about a thank-you page.
    if (isLast) {
      return (
        <div className="flex items-center gap-1.5 py-1 pl-3 text-[11px] text-muted-foreground">
          <CircleDot className="size-3 shrink-0" aria-hidden />
          <span>ends here</span>
        </div>
      )
    }
    return (
      <div className="space-y-1 py-1 pl-3">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--warning)]">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          <span>leads nowhere</span>
        </div>
        {repair}
      </div>
    )
  }

  return (
    <div className="space-y-0.5 py-1 pl-3">
      {exits.map((exit) => {
        const slug = exit.to.kind === "step" ? exit.to.slug : ""
        const exists = exit.to.kind === "step" && exit.to.exists
        const destination = pagesBySlug.get(slug)
        return (
          <div
            key={`${exit.sectionId}-${exit.field}`}
            className={`flex items-start gap-1.5 text-[11px] ${
              exists ? "text-muted-foreground" : "text-[var(--error)]"
            }`}
          >
            {exists ? (
              <ArrowDown className="mt-0.5 size-3 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
            )}
            <span className="min-w-0">
              {/* The button's own words, so the owner can find it on the page.
                  A form says "Form submit" for the same reason. */}
              <span className="font-medium">{exit.label || "Button"}</span>
              {exists ? (
                <> → {destination?.name ?? slug}</>
              ) : (
                <> → no page called &ldquo;{slug}&rdquo;</>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * "Connect this page" — the repair tool, offered where the problem is named.
 *
 * Renders NOTHING unless all three are true: this is the page the builder is
 * holding (so there is a revision to write against), there is a page after it,
 * and `autoConnectOps` actually found something it is allowed to change. That
 * last one matters — a button that can be pressed and does nothing teaches the
 * owner it is broken, and a page whose buttons are all deliberate choices is
 * exactly the case the repair tool refuses.
 *
 * It CONFIRMS FIRST, listing every change in the owner's own button text. The
 * ops go through the builder's normal writer, so the whole repair lands as one
 * transcript turn and "go back to here" undoes it.
 */
function ConnectThisPage({ page, next }: { page: RailPage; next: RailPage | null }) {
  const context = useConnections()
  const repair = context?.repair
  if (!context || !repair || repair.stepId !== page.id || !next) return null

  const doc = context.docFor(page.id)
  if (!doc) return null

  const plan = autoConnectOps(doc, { funnelSlug: context.funnelSlug, nextStepSlug: next.slug })
  if (plan.ops.length === 0) return null

  return (
    <button
      type="button"
      className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-surface"
      onClick={() => {
        const lines = plan.changes.map((change) => `• ${change.label} → ${next.name}`)
        const ok = window.confirm(
          `Connect "${page.name}" to "${next.name}"?\n\n${lines.join("\n")}\n\n` +
            `You can undo this from the chat.`,
        )
        if (!ok) return
        void repair.apply(plan.ops)
      }}
    >
      Connect to {next.name}
    </button>
  )
}

export function StepRail() {
  const context = useConnections()
  const pathname = usePathname()

  // Outside a provider, or a funnel with one page: nothing worth showing. A
  // landing page always lands here, which is why it keeps exactly the editor
  // it had before this feature.
  if (!context || context.pages.length < 2) return null

  const { pages, connections, funnelKind, funnelId } = context
  const ordered = [...pages].sort((a, b) => a.position - b.position)
  const lastId = ordered[ordered.length - 1]?.id
  const pagesBySlug = new Map(ordered.map((page) => [page.slug, page]))

  return (
    <nav
      aria-label="Pages in this funnel"
      className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-white lg:block"
    >
      <p className="border-b border-border bg-surface/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Pages
      </p>
      <ol className="p-2">
        {ordered.map((page, index) => {
          const href = adminStepHref(funnelKind, funnelId, page.id)
          const current = pathname === href
          return (
            <li key={page.id}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`block rounded-lg px-2.5 py-2 transition-colors ${
                  current ? "bg-surface" : "hover:bg-surface/30"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-primary">{page.name}</span>
                  <StatusPill page={page} />
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">/{page.slug}</span>
              </Link>
              <Exits
                exits={exitsFrom(connections.connections, page.id)}
                isLast={page.id === lastId}
                pagesBySlug={pagesBySlug}
                repair={
                  // Only on the page being edited — see `Repair` in the
                  // context for why the rail cannot write to the others.
                  <ConnectThisPage page={page} next={ordered[index + 1] ?? null} />
                }
              />
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
