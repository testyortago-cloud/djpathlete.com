// app/api/admin/funnels/[id]/publish/route.ts — taking a whole funnel live.
//
// ---------------------------------------------------------------------------
// THIS REPLACES AN UNGUARDED WRITE, AND THAT IS THE POINT OF IT.
// ---------------------------------------------------------------------------
// Taking a funnel live was `PATCH /api/admin/funnels/[id]` with
// `{status:"published"}` — a route that validates the body and writes. It does
// not read the steps, so it will mark a funnel published while three of its
// four pages have never been built, producing a live funnel whose own buttons
// 404. `StepList` and `StepRail` both compute `live = published_version_id &&
// funnel.status === "published"` precisely because that split state is
// reachable: the UI was taught to describe the inconsistency instead of the
// publish path being taught not to create it.
//
// So this endpoint does BOTH halves in one operation, and refuses unless every
// page can be published.
//
// ---------------------------------------------------------------------------
// ALL OR NOTHING, AND EVERY PAGE IS GATED BEFORE ANY PAGE IS WRITTEN.
// ---------------------------------------------------------------------------
// The owner chose all-or-nothing over "publish the good ones and skip the
// rest", because the latter ships a funnel with a dead end in it. Given that,
// gating and writing page by page would produce the worst outcome available:
// three pages published, the fourth refused, the funnel still a draft, and no
// single screen able to say what state anything is in. `funnelPublishPlan`
// therefore inspects everything first and empties `publish` unless `ok`.
//
// ---------------------------------------------------------------------------
// IT FAILS CLOSED, for the reason the step route states at length.
// ---------------------------------------------------------------------------
// `loadCatalogues` throws when a recognition read comes back at PostgREST's
// 1000-row cap, and `resolveDoc` throws on a document that no longer satisfies
// `sectionDocSchema`. Both land in the catch below as a 422 naming the reason.
// The trigger is PERSISTENT, not transient: fail-open would not mean "one
// publish slipped through during an outage", it would mean the gate switches
// itself off permanently on the day a table grows.
//
// THE FUNNEL ROW IS FLIPPED LAST. If a `publishStep` throws part way through,
// the funnel stays a draft — pages carrying an unreferenced version row are
// invisible and harmless, a half-live funnel is not.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { getFunnelById, listSteps, publishStep, updateFunnel } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { reassemble } from "@/lib/funnels/sections/doc"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"
import { funnelPublishPlan, type StepToPublish } from "@/lib/funnels/publish-plan"

export const maxDuration = 300

export const POST = withAudit(
  { action: "funnel.published", category: "admin_write" },
  async (_request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    try {
      const funnel = await getFunnelById(id)
      if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const steps = await listSteps(id)
      if (steps.length === 0) {
        // `funnelPublishPlan([])` is legitimately `ok` — it has no page to
        // object to. Publishing an empty funnel would serve a 404 at its own
        // public URL, so the refusal belongs here: it is a rule about FUNNELS,
        // and putting it in the planner would make `problems` (a list of bad
        // pages) mean two different things.
        return NextResponse.json({ error: "This funnel has no pages to publish." }, { status: 400 })
      }

      // READ ONCE FOR THE WHOLE FUNNEL. Both are funnel-wide facts, and
      // re-reading them per page would not only cost N times the work but
      // could gate page 1 and page 4 against different catalogues.
      const [catalogues, drafts] = await Promise.all([
        loadCatalogues(),
        Promise.all(steps.map((step) => getDraft(step.id))),
      ])
      // `[]` is correct here and `null` would be wrong: these ARE the funnel's
      // pages, freshly read. `null` means "could not be checked", and a failed
      // read has already thrown into the catch below.
      const pages = steps.map((step) => ({ slug: step.slug, name: step.name }))

      const toPublish: StepToPublish[] = steps.map((step, index) => ({
        id: step.id,
        name: step.name,
        position: step.position,
        doc: drafts[index]?.doc ?? null,
        hasPublishedVersion: Boolean(step.published_version_id),
      }))

      const plan = funnelPublishPlan(toPublish, (doc) => publishGate(resolveDoc(doc, catalogues, pages)))

      if (!plan.ok) {
        return NextResponse.json(
          { error: "This funnel could not be published.", pages: plan.problems },
          { status: 422 },
        )
      }

      const funnelBasePath = `/go/${funnel.slug}`
      const published: { stepId: string; stepName: string; version: number }[] = []
      const warnings: string[] = []

      for (const entry of plan.publish) {
        const rendered = reassemble(entry.doc, { funnelBasePath })
        if (rendered.problems.length > 0) {
          // A size cap. `compileFunnelStep` would report `ok` on this page —
          // oversized markup is still valid markup — so the check has to be
          // here, on `reassemble`'s own verdict, exactly as the builder's
          // `compile.ok` note explains.
          return NextResponse.json(
            {
              error: "This funnel could not be published.",
              pages: [
                {
                  stepId: entry.stepId,
                  stepName: entry.stepName,
                  problems: rendered.problems.map((problem) => problem.message),
                  blank: false,
                },
              ],
            },
            { status: 422 },
          )
        }

        const result = await publishStep({
          stepId: entry.stepId,
          html: rendered.html,
          css: rendered.css,
          projectData: entry.doc,
          publishedBy: session.user.id,
        })
        if (!result.ok) {
          return NextResponse.json(
            {
              error: "This funnel could not be published.",
              pages: [
                {
                  stepId: entry.stepId,
                  stepName: entry.stepName,
                  problems: result.errors.map((compileError) => compileError.message),
                  blank: false,
                },
              ],
            },
            { status: 422 },
          )
        }
        published.push({ stepId: entry.stepId, stepName: entry.stepName, version: result.version.version })
        warnings.push(...result.warnings.map((warning) => warning.message))
      }

      // LAST, and only on a clean sweep — see the header.
      await updateFunnel(funnel.id, { status: "published" })

      return NextResponse.json({ published: published.length, pages: published, warnings })
    } catch (error) {
      console.error("[POST /api/admin/funnels/:id/publish]", error)
      // FAILS CLOSED as a 422 carrying the reason, never a 500 and never a
      // publish. The message lands in the UI the owner is already looking at.
      return NextResponse.json(
        {
          error: "This funnel could not be published.",
          pages: [
            {
              stepId: "",
              stepName: "This funnel",
              problems: [`Its pages could not be checked, so nothing was published: ${(error as Error).message}`],
              blank: false,
            },
          ],
        },
        { status: 422 },
      )
    }
  },
)
