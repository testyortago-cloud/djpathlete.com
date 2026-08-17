// app/(admin)/admin/funnels/[id]/edit/layout.tsx — the funnel builder's shell.
//
// ---------------------------------------------------------------------------
// WHY A LAYOUT AND NOT A REWRITE INTO ONE ROUTE
// ---------------------------------------------------------------------------
// The owner asked for "a single page where i can navigate to each pages". The
// obvious reading is one route holding every page in client state — and that
// would throw away every URL: the `?start=1` creation nudge, the `base`
// mismatch redirect, bookmarks, and the per-page server-side
// resolve-and-compile that `[stepId]/page.tsx` exists to do.
//
// A layout gives the same thing for free. Next.js keeps a layout MOUNTED while
// navigating between its `[stepId]` children, so clicking another page in the
// rail re-renders only the canvas: the rail, the header and the publish state
// stay put, and every existing address still works.
//
// ---------------------------------------------------------------------------
// IT COSTS NO EXTRA QUERY
// ---------------------------------------------------------------------------
// `listSteps` already does `select("*")`, so every sibling's `project_data`
// arrives in a read this screen's siblings were making anyway.
//
// Nothing here may take the editor down. A funnel that cannot be read renders
// the children alone — the owner came to edit a page, and losing the rail is a
// navigation aid, not their work.

import { notFound } from "next/navigation"
import { getFunnelById, listSteps } from "@/lib/db/funnels"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { StepWithDoc } from "@/lib/funnels/connections"
import {
  ConnectionsProvider,
  type DraftJob,
  type RailPage,
} from "@/components/admin/funnels/connections-context"
import { StepRail } from "@/components/admin/funnels/StepRail"
import { creationPrompt } from "@/lib/funnels/creation-prompt"

/**
 * The shell, shared by `/admin/funnels` and `/admin/pages`.
 *
 * `base` is not taken here and no redirect happens here: the child page
 * already redirects on a kind/URL mismatch, and a layout that redirected too
 * would race it. This only ever DECORATES.
 */
export async function FunnelBuilderShell({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const funnel = await getFunnelById(id).catch(() => null)
  if (!funnel) {
    // Not `notFound()` — the child decides that, and it has more information
    // (it checks the step belongs to the funnel). Render bare rather than
    // pre-empting a 404 the child might not agree with.
    return <BareShell>{children}</BareShell>
  }

  const steps = await listSteps(id).catch((error) => {
    console.error("[funnels/edit] could not read the page list — opening without the rail:", error)
    return []
  })

  const ordered = [...steps].sort((a, b) => a.position - b.position)

  const pages: RailPage[] = ordered.map((step) => ({
    id: step.id,
    name: step.name,
    slug: step.slug,
    position: step.position,
    isEntry: step.is_entry,
    published: Boolean(step.published_version_id),
    // THE SAME RULE `StepList` USES. A version row alone is not live: if the
    // funnel is a draft the page is unreachable, and the badge would say the
    // true thing about the database and the false thing about the world.
    live: Boolean(step.published_version_id) && funnel.status === "published",
  }))

  // PARSED, NOT CAST. `project_data` is jsonb typed `unknown`, and a legacy
  // GrapesJS blob is indistinguishable from a document by shape alone. A page
  // whose draft no longer parses contributes `null` — it loses its arrows, not
  // the whole funnel its navigation.
  const docs: StepWithDoc[] = ordered.map((step) => ({
    id: step.id,
    name: step.name,
    slug: step.slug,
    position: step.position,
    isEntry: step.is_entry,
    doc: sectionDocSchema.safeParse(step.project_data).success
      ? (step.project_data as SectionDoc)
      : null,
  }))

  // WHICH STEPS THE QUEUE MAY DRAFT: the ones that have never been touched.
  //
  // The same condition `[stepId]/page.tsx` uses to fire its own creation
  // prompt — no stored document — minus the turn check, which needs a per-step
  // query this layout deliberately does not make. The builder's own guard
  // (`draftPhase !== "idle"`) covers the overlap, and a step with turns but no
  // document is a step whose build failed, which is exactly a step worth
  // retrying.
  //
  // ONLY FOR A FUNNEL. A landing page has one step and it is drafted by the
  // create dialog's `?start=1`.
  // `docs` ALREADY ANSWERS THIS. It is `ordered.map(...)`, so it is the same
  // length and the same order, and its `doc` is null on exactly the steps a
  // second `safeParse` would have re-derived — at the cost of parsing every
  // page's document twice on every navigation between steps.
  //
  // ---------------------------------------------------------------------
  // "UNBUILT" IS DEFINED IN TWO PLACES AND THEY HAVE TO AGREE.
  // ---------------------------------------------------------------------
  // THE OTHER HALF OF THIS RULE IS `lib/funnels/publish-plan.ts:82-94`, and
  // it must be read alongside this line: the planner treats a doc-less step
  // that ALREADY CARRIES A PUBLISHED VERSION as "left alone — neither
  // published nor a problem", because that is a legacy GrapesJS page serving
  // real content that no `SectionDoc` can improve on.
  //
  // Without `!published_version_id` here the two layers disagree, and the
  // disagreement is destructive rather than cosmetic. A legacy step fails
  // `sectionDocSchema`, so its `doc` is null and it would be queued — the
  // background model then writes a first draft over its `project_data`. The
  // live page does not change that instant (the version row still points at
  // the old compiled snapshot), but the step now HAS a `SectionDoc`, so the
  // very next funnel publish renders that AI draft over a page the owner
  // never asked to have rewritten. It also puts `writing…` in the rail over a
  // row the rail is simultaneously badging `live`.
  //
  // Neither layer may be changed alone.
  const draftJobs: DraftJob[] =
    funnel.kind !== "funnel"
      ? []
      : ordered
          .filter((_step, index) => docs[index].doc === null && !ordered[index].published_version_id)
          .map((step) => ({
            stepId: step.id,
            prompt: creationPrompt(funnel, step, ordered) ?? "",
            revision: step.doc_revision ?? 0,
          }))
          // A step with no goal and no template composes no prompt. Sending an
          // empty message would be a 400 from the build route's own validator.
          .filter((job) => job.prompt !== "")

  return (
    <ConnectionsProvider
      funnelId={funnel.id}
      funnelSlug={funnel.slug}
      funnelKind={funnel.kind}
      pages={pages}
      initialDocs={docs}
      draftJobs={draftJobs}
    >
      <div className="-m-6 flex h-[calc(100dvh-4rem)]">
        <StepRail />
        {/* `min-w-0` or the preview iframe's intrinsic width stops the rail
            from ever shrinking the canvas, and the whole row overflows. */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ConnectionsProvider>
  )
}

/** The editor with no rail — same box, so the builder's sizing is unchanged. */
function BareShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-6 flex h-[calc(100dvh-4rem)]">
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default async function FunnelEditLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = await params
  if (!id) notFound()
  return <FunnelBuilderShell id={id}>{children}</FunnelBuilderShell>
}
