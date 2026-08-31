// components/admin/funnels/BoardEmptyState.tsx — the first screen a new owner
// sees.
//
// Extracted from `FunnelBoard` when `/admin/funnels` moved to `FunnelList`.
// Leaving it behind would have quietly cost the funnels screen its whole
// getting-started panel — a heading, a sentence saying what a funnel actually
// IS, and the three steps to make one — and replaced it with a single line of
// grey text. That is the screen someone meets before they have any idea what
// this feature does, so it is the last place to lose an explanation.
//
// Presentational only: no hooks, no state, no client directive needed.

import type { FunnelKind } from "@/types/database"

export function BoardEmptyState({ kind }: { kind: FunnelKind }) {
  const copy =
    kind === "page"
      ? {
          title: "No landing pages yet",
          body: "A landing page is one focused page at /go/<url>, built to do a single job — capture a lead, sell a program, fill a camp.",
          steps: [
            "Name it and pick what it should do",
            "Describe it — the builder writes the first draft",
            "Review it, then go live",
          ],
        }
      : {
          title: "No funnels yet",
          body: "A funnel is more than one step in order — a signup page, then a booking step, then a thank-you — all sharing one address.",
          steps: [
            "Create the funnel and name its first step",
            "Describe it — the builder drafts the first page, then the rest follow on their own",
            // ONE publish, because there is now only one. This line used to
            // read "Publish each step, then take the funnel live", which
            // described the two-screen flow the owner asked to have removed.
            "Press Publish once — it takes the whole funnel live",
          ],
        }

  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/30 px-6 py-14 text-center">
      <h2 className="font-heading text-lg text-primary">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy.body}</p>
      <ol className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
        {copy.steps.map((entry, index) => (
          <li key={entry} className="flex gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">
              {index + 1}
            </span>
            {entry}
          </li>
        ))}
      </ol>
    </div>
  )
}
