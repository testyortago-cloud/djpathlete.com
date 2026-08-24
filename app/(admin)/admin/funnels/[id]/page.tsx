import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { getFunnelById, listSteps } from "@/lib/db/funnels"
import { getQuizAttemptCounts, getQuizzesByIds } from "@/lib/db/quizzes"
import { quizUsesInSteps } from "@/lib/funnels/quiz-refs"
import { getSetting } from "@/lib/db/system-settings"
import { formatRunWindow } from "@/lib/funnels/run-window"
import { FunnelStatusControl } from "@/components/admin/funnels/FunnelStatusControl"
import { StepList } from "@/components/admin/funnels/StepList"
import { AddStepDialog } from "@/components/admin/funnels/AddStepDialog"
import { FunnelQuizPanel, type FunnelQuizPanelItem } from "@/components/admin/funnels/FunnelQuizPanel"

interface PageProps {
  params: Promise<{ id: string }>
}

// Both kinds reach this page — it is the ⚙ settings destination for a landing
// page as well as the step list for a funnel — so a static "Funnel" title would
// be wrong half the time, in the one place the owner cannot see it is wrong:
// the browser tab.
export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const funnel = await getFunnelById(id)
  if (!funnel) return { title: "Not found" }
  return { title: funnel.kind === "page" ? `${funnel.name} · Landing page` : `${funnel.name} · Funnel` }
}

/**
 * The settings screen for one funnel OR one landing page.
 *
 * `base` is WHICH URL IT IS BEING SERVED FROM, and it is what makes the split
 * safe. The two kinds share this screen but not their address: the admin
 * sidebar highlights by path prefix, so a landing page served from
 * `/admin/funnels` lights up "Funnels" — exactly what the owner reported
 * ("IM CREATING A LANDING PAGE WHEN I GO BACK IM IN THE FUNNEL TAB").
 *
 * A mismatch redirects to the right base. That is the safety net for every
 * stale link, bookmark and open tab — and it is why this takes `base` rather
 * than redirecting on `kind` alone, which would have sent the page route
 * straight back to itself, forever.
 */
export async function FunnelDetailScreen({ id, base }: { id: string; base: "pages" | "funnels" }) {
  const funnel = await getFunnelById(id)
  if (!funnel) notFound()

  const correctBase = funnel.kind === "page" ? "pages" : "funnels"
  if (correctBase !== base) redirect(`/admin/${correctBase}/${funnel.id}`)

  const steps = await listSteps(id)

  // THE QUIZ THIS FUNNEL USES, read out of the pages it has already loaded.
  //
  // A quiz block holds a POINTER, not a copy, which is what lets one weight
  // edit reach every page showing it with no re-publish -- and it is also why
  // nothing on this screen used to say the quiz existed. The panel is the way
  // back from the funnel to the quiz it asks.
  //
  // BOTH READS FAIL SOFT. The step list is the reason this screen exists, and
  // losing it because the quizzes table was unreachable would trade the whole
  // screen for a panel.
  const quizUses = quizUsesInSteps(steps)
  const [quizRows, attemptCounts] = await Promise.all([
    quizUses.length > 0 ? getQuizzesByIds(quizUses.map((use) => use.quizId)).catch(() => []) : [],
    quizUses.length > 0
      ? getQuizAttemptCounts().catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>)
      : ({} as Awaited<ReturnType<typeof getQuizAttemptCounts>>),
  ])
  const quizItems: FunnelQuizPanelItem[] = quizUses.map((use) => ({
    quizId: use.quizId,
    stepName: use.stepName,
    quiz: quizRows.find((row) => row.id === use.quizId) ?? null,
    attempts: attemptCounts[use.quizId] ?? { total: 0, completed: 0 },
  }))

  const runWindow = formatRunWindow(funnel.starts_at, funnel.ends_at)
  const offerLabel =
    funnel.offer_kind && funnel.offer_ref
      ? `${funnel.offer_ref} (${funnel.offer_kind.replace("_", " ")})`
      : null

  // Read only when it can change what the screen says. A funnel with no
  // auto-offline intent needs no answer about the job that honours it.
  const windowCloserEnabled = funnel.auto_offline_at_end
    ? await getSetting<boolean>("cron_funnel_window_enabled", false)
        // Fails CLOSED. If the flag cannot be read, the screen must not claim
        // the job is running — the whole point of the sentence is that the
        // owner can trust it.
        .catch(() => false)
    : false

  return (
    <div>
      {/* Back to the screen this funnel actually lives on. Both kinds reach
          this page, so one hard-coded destination is wrong half the time. */}
      <Link
        href={funnel.kind === "page" ? "/admin/pages" : "/admin/funnels"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {funnel.kind === "page" ? "All landing pages" : "All funnels"}
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{funnel.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public URL:{" "}
            <a
              href={`/go/${funnel.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              /go/{funnel.slug}
            </a>
          </p>
          {runWindow ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {runWindow}
              {funnel.auto_offline_at_end ? (
                <>
                  {" · "}
                  {/* THE HONEST SENTENCE. The create dialog's checkbox records
                      an intent; the cron that acts on it is gated by
                      `cron_funnel_window_enabled` and ships OFF. Saying "goes
                      offline automatically" on a deployment where the flag is
                      false would be a promise the app cannot keep, and the
                      owner would find out by discovering a dead camp page
                      still taking registrations. */}
                  {windowCloserEnabled ? (
                    <span>goes offline when the run ends</span>
                  ) : (
                    <span className="text-[var(--warning)]">
                      set to go offline when the run ends, but the job that does
                      it is switched off
                    </span>
                  )}
                </>
              ) : null}
            </p>
          ) : null}
          {offerLabel ? (
            <p className="mt-1 text-sm text-muted-foreground">Selling: {offerLabel}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* Funnels only. A landing page is single-page by definition — the
              way to give it a second step is Convert to funnel, which says so
              explicitly rather than letting the page drift into being one. */}
          {funnel.kind === "funnel" ? (
            <AddStepDialog
              funnelId={funnel.id}
              funnelSlug={funnel.slug}
              takenSlugs={steps.map((step) => step.slug)}
            />
          ) : null}
          <FunnelStatusControl funnelId={funnel.id} status={funnel.status} kind={funnel.kind} />
        </div>
      </div>

      <FunnelQuizPanel items={quizItems} />

      <StepList funnel={funnel} initialSteps={steps} />
    </div>
  )
}

export default async function FunnelDetailPage({ params }: PageProps) {
  const { id } = await params
  return <FunnelDetailScreen id={id} base="funnels" />
}
