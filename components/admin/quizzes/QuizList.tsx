// The quizzes screen, as the same preview card the funnels board uses.
//
// WHY THIS IS NOT THE HOUSE TABLE. CLAUDE.md's rule is that every admin list
// uses `components/ui/data-table.tsx`, and that rule exists so lists do not each
// invent their own TABLE chrome — the /admin/team regression. `PreviewCard`'s
// own header records the exception the owner asked for: a page is a visual
// artifact, and a row of slugs tells you nothing about which one you are
// looking for. This screen now sits inside that exception, on the owner's
// report that a quiz had a row where a funnel had a card — so the one screen
// that is about a quiz was the one screen that could not show it.
//
// A QUIZ HAS NO PAGE OF ITS OWN. Its block holds a POINTER, which is what lets
// one weight edit take effect everywhere with no re-publish, and the cost is
// that there is nothing here to screenshot. So the card previews the funnel
// page RUNNING the quiz, and a quiz no page shows keeps `PreviewCard`'s "No
// preview yet" rather than inventing a page for it.
//
// The chrome itself is not duplicated: `PreviewCard` renders it, and everything
// this screen adds — the key, the counts, the seed warning — arrives through
// its `extra` slot. The scaled same-origin thumbnail alone is sixty lines of
// ResizeObserver work that has already been got wrong once by hard-coding its
// scale.

import Link from "next/link"
import { Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTableBadge, type DataTableBadgeTone } from "@/components/ui/data-table"
import { PreviewCard } from "@/components/admin/funnels/PreviewCard"
import { adminStepHref } from "@/lib/funnels/admin-path"
import { previewBasePath } from "@/lib/funnels/preview-path"

/**
 * The page showing a quiz, flattened from `quizPlacements` plus the funnel row
 * it names. `null` on a `QuizListItem` means no page shows this quiz at all.
 *
 * PRIMITIVE FACTS, NOT A FINISHED URL. The card derives the paths below, so the
 * rule lives in one place next to the rule it must match — the board's — rather
 * than in a server component where a test cannot see it.
 */
export interface QuizPlacementView {
  funnelId: string
  funnelName: string
  funnelSlug: string
  funnelKind: string
  funnelStatus: string
  stepId: string
  stepName: string
  stepSlug: string
  /** The entry step IS `/go/<slug>`; a later step appends its own slug. */
  isEntry: boolean
  /** The step carries a compiled version, so the live route can serve it. */
  published: boolean
}

export interface QuizListItem {
  id: string
  key: string
  name: string
  status: string
  seedMarker: string | null
  updatedAt: string | null
  attempts: { total: number; completed: number }
  placement: QuizPlacementView | null
}

const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
}

/**
 * THE NOUN, IN ONE PLACE. "Quiz" is this business's word for it; another would
 * call the same thing an assessment or a scorecard. Every user-visible use of
 * it on this screen reads from here, so changing the word is one edit rather
 * than a hunt through the file. The route, the section kind and the table names
 * are deliberately NOT derived from it — those are identifiers, and renaming
 * them is a migration, not a relabel.
 */
const NOUN = { one: "quiz", many: "quizzes" } as const

export interface QuizListProps {
  quizzes: QuizListItem[]
  /**
   * The pages were read successfully, so a `null` placement means "no page
   * shows this quiz".
   *
   * FALSE IS NOT THE SAME ANSWER AS AN EMPTY PLACEMENT. A failed read leaves
   * every quiz with no placement, which renders identically to "nothing shows
   * it" — turning a database error into a false statement about the owner's own
   * work, on the screen they would go to in order to check. The screen says it
   * does not know instead. Same reason the counts degrade to a visible zero
   * rather than to a blank page.
   */
  placementsKnown?: boolean
}

export function QuizList({ quizzes, placementsKnown = true }: QuizListProps) {
  const seeded = quizzes.filter((quiz) => quiz.seedMarker !== null)

  if (quizzes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center">
        <p className="font-medium text-primary">No {NOUN.many} yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          A {NOUN.one} arrives with the funnel that runs it — pick <strong>Run a {NOUN.one}</strong> in{" "}
          <Link href="/admin/funnels" className="underline underline-offset-2 hover:text-primary">
            New funnel
          </Link>
          , and it lands here with its page already written.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* THE UNVERIFIED BANNER. A seeded quiz carries numbers reconstructed
          from GHL field metadata, not recovered from the original workflows —
          the weights and cutoffs did not survive the export. Saying so on
          screen is the difference between a plausible default and a decision
          somebody made. */}
      {seeded.length > 0 ? (
        <div className="rounded-xl border border-border bg-warning/10 px-4 py-3 text-sm text-foreground">
          <strong className="font-semibold">
            {seeded.length === 1 ? `One ${NOUN.one} still carries` : `${seeded.length} ${NOUN.many} still carry`}{" "}
            reconstructed scoring.
          </strong>{" "}
          The weights and tier cutoffs were rebuilt from field metadata, not recovered — the original GoHighLevel
          workflows exported without them. Review them before trusting a result.
        </div>
      ) : null}

      {placementsKnown ? null : (
        <div className="rounded-xl border border-border bg-warning/10 px-4 py-3 text-sm text-foreground">
          <strong className="font-semibold">Which page runs each {NOUN.one} could not be checked.</strong> The pages
          could not be read, so no preview is shown below and no {NOUN.one} here is being called unused. Reload to try
          again.
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {quizzes.map((quiz) => (
          <QuizCard key={quiz.id} quiz={quiz} placementsKnown={placementsKnown} />
        ))}
      </div>
    </div>
  )
}

function QuizCard({ quiz, placementsKnown }: { quiz: QuizListItem; placementsKnown: boolean }) {
  const { placement } = quiz

  // THE IDENTICAL RULE `FunnelBoard` FOLLOWS. The live route once the step has a
  // compiled version, the draft route until then — and the step's own slug
  // appended unless it is the entry, because `/go/<slug>` IS the entry page and
  // previewing it for a quiz on a later step would show a page with no quiz on
  // it. A preview disagreeing with the page it previews is this subsystem's
  // worst failure mode, so the two rules are written to match on purpose.
  const stepSuffix = placement && !placement.isEntry ? `/${placement.stepSlug}` : ""
  const path = placement ? `/go/${placement.funnelSlug}${stepSuffix}` : null
  const previewUrl = placement
    ? placement.published
      ? `${path}?preview=1`
      : `${previewBasePath(placement.funnelSlug)}${stepSuffix}`
    : null

  // Live means BOTH: a compiled version to serve, and a funnel whose status
  // lets `/go` serve it. Either alone is true about the database and false
  // about the world — the same rule `FunnelCard` states.
  const live = Boolean(placement?.published && placement.funnelStatus === "published")

  return (
    <div data-testid="quiz-card">
      <PreviewCard
        title={quiz.name}
        subtitle={
          placement
            ? `${placement.funnelName} · ${path}`
            : placementsKnown
              ? `Not on any page yet · ${quiz.key}`
              : `Which page runs it could not be checked · ${quiz.key}`
        }
        previewUrl={previewUrl}
        previewIsDraft={Boolean(placement && !placement.published)}
        href={`/admin/funnels/quizzes/${quiz.id}`}
        primaryLabel="Open"
        publicUrl={live ? path : null}
        // THE QUIZ'S OWN STATUS, never the funnel's. This screen is about the
        // quiz, and its status is the one fact deciding whether it can take an
        // answer at all — a card reading the funnel's "draft" would hide that.
        badgeLabel={quiz.status}
        badgeTone={STATUS_TONE[quiz.status] ?? "neutral"}
        extra={
          <div className="space-y-1.5">
            <p className="font-mono text-xs text-muted-foreground">{quiz.key}</p>
            {/* Completed AND started: the gap between the two IS the drop-off,
                and showing only completions makes an abandoned quiz look like
                an unused one. */}
            <p className="text-xs text-muted-foreground">
              {quiz.attempts.completed} completed · {quiz.attempts.total} started
              {quiz.updatedAt ? ` · edited ${new Date(quiz.updatedAt).toLocaleDateString("en-GB")}` : ""}
            </p>
            {quiz.seedMarker ? <DataTableBadge tone="warning">Unverified scoring</DataTableBadge> : null}
          </div>
        }
        secondaryAction={
          placement ? (
            // THE PAGE THAT RUNS IT, straight to the canvas — the same
            // destination the boards' Open goes to. `adminStepHref` picks the
            // base from the funnel's KIND because `/admin/pages/<id>` redirects
            // to the list, so a funnel-detail link would bounce a landing
            // page's owner back to where they started.
            // `min-w-0` PLUS `truncate`, AND BOTH ARE LOAD-BEARING. A funnel
            // name is free text, the button row does not wrap, and a flex item
            // defaults to `min-width: auto` — so without these a long name
            // pushes the row straight out through the side of the card. Seen,
            // not theorised: "Quiz Card Check 312500" did exactly that.
            <Button
              asChild
              variant="outline"
              size="sm"
              className="min-w-0 shrink"
              title={`Open ${placement.funnelName}`}
            >
              <Link href={adminStepHref(placement.funnelKind, placement.funnelId, placement.stepId)}>
                <Workflow className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{placement.funnelName}</span>
              </Link>
            </Button>
          ) : null
        }
      />
    </div>
  )
}
