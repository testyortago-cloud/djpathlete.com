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
// THERE ARE THREE GATES, NOT ONE, and all three run before the write loop:
//   1. `publishGate(resolveDoc(...))` — dead CTAs, missing pages. (the planner)
//   2. `reassemble().problems`        — the publish SIZE CAPS, which are
//      measured on RENDERED output and so cannot be known from the document.
//   3. `compileFunnelStep()`          — fatal compile errors, e.g. CSS that
//      does not parse. `publishStep` runs this itself before it writes, so
//      calling it here is what turns a per-page WRITE refusal into a
//      funnel-wide REFUSAL.
// 2 and 3 used to live inside the write loop, which meant page 1 got a version
// row and a repointed `published_version_id` and then page 2 refused — a
// partial write, reported by a 422 that never mentioned it. `reassemble` and
// `compileFunnelStep` are both pure, so they are hoisted here and their results
// carried into the loop. NO GATE MAY BE ADDED BACK INSIDE THAT LOOP.
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
// THE FUNNEL ROW IS FLIPPED LAST, which is a guarantee about a FIRST publish
// and nothing more. On a draft funnel, a `publishStep` that throws part way
// through leaves the row a draft — pages carrying an unreferenced version row
// are invisible and harmless, a half-live funnel is not.
//
// ON A REPUBLISH IT GUARANTEES NOTHING, because the row is ALREADY
// `published`. This route republishes every doc-bearing step, so a second
// Publish that throws on page 2 leaves a live funnel serving page 1's new
// version and page 2's previous one. That is not a dead end — every page still
// resolves to a valid version — but it is public, and the catch below must not
// tell the owner otherwise. Hence `funnelWasLive`.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { getFunnelById, listSteps, publishStep, updateFunnel } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { ensureEventPriced } from "@/lib/events/ensure-priced"
import { reassemble } from "@/lib/funnels/sections/doc"
import { compileFunnelStep } from "@/lib/funnels/compile"
import { loadCatalogues, publishGate, resolveDoc, type PublishGate } from "@/lib/funnels/sections/resolve"
import { funnelPublishPlan, type PagePublishProblem, type StepToPublish } from "@/lib/funnels/publish-plan"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

export const maxDuration = 300

export const POST = withAudit(
  {
    action: "funnel.published",
    category: "admin_write",
    // The slug is deliberately SHARED with the step publish route:
    // `request_path` already tells the two apart, and splitting it would
    // silently halve anything already filtering on `funnel.published`.
    // `target` is what makes a funnel publish findable by the admin target
    // filter instead of only by free text.
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "funnel", id }
    },
  },
  async (_request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    // DECLARED OUTSIDE THE TRY so the catch can tell the two reachable
    // failures apart. `publishStep` throws on any Supabase error, and the try
    // spans the write loop, so a blip on page 3 of 4 lands in the catch with
    // pages 1-2 already carrying version rows. No invariant breaks — the
    // funnel row is still a draft, so none of it is public — but the message
    // must not say "nothing was published" when something was.
    const published: { stepId: string; stepName: string; version: number }[] = []
    // ALSO OUTSIDE THE TRY, and for the same reason: the catch cannot tell the
    // owner what is public without knowing whether the funnel was already live
    // when this request arrived. Read once, before anything is written, so a
    // successful `updateFunnel` cannot change the answer under it.
    let funnelWasLive = false

    try {
      const funnel = await getFunnelById(id)
      if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })
      funnelWasLive = funnel.status === "published"

      const steps = await listSteps(id)
      if (steps.length === 0) {
        // `funnelPublishPlan([])` is legitimately `ok` — it has no page to
        // object to. Publishing an empty funnel would serve a 404 at its own
        // public URL, so the refusal belongs here: it is a rule about FUNNELS,
        // and putting it in the planner would make `problems` (a list of bad
        // pages) mean two different things.
        return NextResponse.json({ error: "This funnel has no pages to publish." }, { status: 400 })
      }

      // The drafts are read FIRST and the catalogue after, because a camp this
      // funnel sells may need its Stripe price created before the catalogue is
      // asked whether it has one. See `ensureCheckoutCampsPriced` below.
      const drafts = await Promise.all(steps.map((step) => getDraft(step.id)))

      // GIVE A CAMP ITS STRIPE PRICE RATHER THAN REFUSING IT.
      //
      // `publishGate` blocks a checkout form whose camp has no `stripe_price_id`,
      // and that is right — nobody could pay. But when the camp already carries a
      // `price_cents`, the server can create the Stripe product itself, and being
      // told to go and do that by hand is worse than it just happening. The most
      // common way a camp ends up in that state is being DUPLICATED: the duplicate
      // route copies the price and deliberately drops the Stripe ids.
      //
      // Runs BEFORE `loadCatalogues`, because the catalogue is where `priced`
      // comes from and a repair after the read would be invisible until the next
      // publish. Never throws; a camp it cannot fix is still reported by the gate.
      await ensureCheckoutCampsPriced(drafts)

      // READ ONCE FOR THE WHOLE FUNNEL. A funnel-wide fact, and re-reading it per
      // page would not only cost N times the work but could gate page 1 and page 4
      // against different catalogues.
      const catalogues = await loadCatalogues()
      // `[]` is correct here and `null` would be wrong: these ARE the funnel's
      // pages, freshly read. `null` means "could not be checked", and a failed
      // read has already thrown into the catch below.
      const pages = steps.map((step) => ({ slug: step.slug, name: step.name }))

      // ---------------------------------------------------------------------
      // RESOLVE ONCE, AND PUBLISH THE DOCUMENT THAT RESOLVING RETURNED.
      // ---------------------------------------------------------------------
      // `resolveDoc` matches a CTA `ref` BY NAME and substitutes the real row
      // id into the doc it RETURNS. Gating the resolved doc while storing the
      // raw one looks harmless and is not: a hero CTA left as
      // `{kind:"program", ref:"Comeback Code"}` passes the gate, and then
      // `renderCtaTarget` hands that NAME to the checkout island as
      // `productId`. The island schema requires a uuid, so
      // `renderIslandIfValid` silently emits `disabledCta` — an
      // `aria-disabled` span. `compileFunnelStep` reports `ok: true` with no
      // warnings, so a DEAD BUTTON ships on a live page with nothing anywhere
      // saying so. That is the exact failure class this endpoint exists to
      // stop, so do not "simplify" this back into the gate lambda.
      //
      // Reachable, not theoretical: the build route deliberately degrades and
      // persists the UNRESOLVED doc when its own catalogue read throws. And
      // every other renderer already does this — the draft preview and the
      // admin editor both reassemble `resolution.doc`.
      const verdicts = new Map<SectionDoc, PublishGate>()
      const toPublish: StepToPublish[] = steps.map((step, index) => {
        const base = {
          id: step.id,
          name: step.name,
          position: step.position,
          hasPublishedVersion: Boolean(step.published_version_id),
        }
        const draftDoc = drafts[index]?.doc ?? null
        // No document: legacy GrapesJS state or a page never built. Nothing to
        // resolve — the planner decides which of those two it is.
        if (!draftDoc) return { ...base, doc: null }

        // Throws stay uncaught here on purpose: a `resolveDoc` failure is the
        // 422 fail-closed path below, never a page published unchecked.
        const resolution = resolveDoc(draftDoc, catalogues, pages)
        verdicts.set(resolution.doc, publishGate(resolution))
        return { ...base, doc: resolution.doc }
      })

      // A LOOKUP, not a second `resolveDoc`. `plan.publish[].doc` is the very
      // object put in above, so identity holds. A miss would mean the planner
      // gated a document this route never resolved: throw rather than invent a
      // verdict, which lands in the catch as a refusal.
      const plan = funnelPublishPlan(toPublish, (doc) => {
        const verdict = verdicts.get(doc)
        if (!verdict) throw new Error("publish gate asked about a document this route did not resolve")
        return verdict
      })

      if (!plan.ok) {
        return NextResponse.json(
          { error: "This funnel could not be published.", pages: plan.problems },
          { status: 422 },
        )
      }

      const funnelBasePath = `/go/${funnel.slug}`
      const warnings: string[] = []

      // ---------------------------------------------------------------------
      // GATE TWO AND THREE, FOR EVERY PAGE, BEFORE THE WRITE LOOP.
      // ---------------------------------------------------------------------
      // `reassemble` reports the publish SIZE CAPS, which are measured on
      // rendered output — `compileFunnelStep` would report `ok` on an
      // over-cap page, because oversized markup is still valid markup, so the
      // two are separate verdicts and both are needed.
      //
      // `compileFunnelStep` is exactly what `publishStep` runs before it
      // writes. Running it HERE is what converts its per-page "this one will
      // not be written" into the funnel-wide refusal the spec requires; left
      // where it was, page 1 was already written by the time page 2 said no.
      //
      // Problems ACCUMULATE rather than returning on the first one, so the
      // refusal names every bad page at once — the same contract
      // `funnelPublishPlan` provides, and the reason it inspects everything
      // before deciding.
      const renderProblems: PagePublishProblem[] = []
      const prepared: { stepId: string; stepName: string; doc: SectionDoc; html: string; css: string }[] = []

      for (const entry of plan.publish) {
        const rendered = reassemble(entry.doc, { funnelBasePath })
        if (rendered.problems.length > 0) {
          renderProblems.push({
            stepId: entry.stepId,
            stepName: entry.stepName,
            problems: rendered.problems.map((problem) => problem.message),
            blank: false,
          })
          continue
        }
        const compiled = compileFunnelStep({ html: rendered.html, css: rendered.css })
        if (!compiled.ok) {
          renderProblems.push({
            stepId: entry.stepId,
            stepName: entry.stepName,
            problems: compiled.errors.map((compileError) => compileError.message),
            blank: false,
          })
          continue
        }
        prepared.push({ ...entry, html: rendered.html, css: rendered.css })
      }

      if (renderProblems.length > 0) {
        return NextResponse.json(
          { error: "This funnel could not be published.", pages: renderProblems },
          { status: 422 },
        )
      }

      // ---------------------------------------------------------------------
      // THE WRITE LOOP. NOTHING BELOW THIS LINE MAY REFUSE A PAGE.
      // ---------------------------------------------------------------------
      for (const entry of prepared) {
        const result = await publishStep({
          stepId: entry.stepId,
          html: entry.html,
          css: entry.css,
          projectData: entry.doc,
          publishedBy: session.user.id,
        })
        if (!result.ok) {
          // UNREACHABLE, and a throw rather than a 422 because of it.
          // `publishStep`'s only `ok: false` is its own `compileFunnelStep`
          // call — same pure function, same `{html, css}` — which the gate
          // above has already run and passed. Returning a 422 from here would
          // reinstate the mid-loop refusal this restructure removed, and would
          // do it silently, since a 422 says nothing about the pages already
          // written. Throwing lands in the catch, which counts `published` and
          // reports the partial write honestly.
          throw new Error(
            `${entry.stepName} failed to compile during the write, after passing the pre-write gate: ` +
              result.errors.map((compileError) => compileError.message).join(" "),
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
      //
      // THREE CASES, because any two of them collapsed into one would lie.
      //
      // (a) Nothing written. The gate threw, so no page has a version row.
      //
      // (b) Partial write, funnel was a DRAFT. Pages 1..n carry version rows
      //     nothing references, and the funnel row was never flipped. None of
      //     it is public, and publishing again is genuinely safe.
      //
      // (c) Partial write, funnel was ALREADY LIVE. This is the case the
      //     single "it is still a draft" message got wrong: on a republish the
      //     row is `published` on the way IN, so the pages that were written
      //     are serving to the public right now, next to pages still on their
      //     previous version. Telling the owner "none of it is public yet"
      //     here is precisely the status-that-lies this branch exists to
      //     remove, and it would be told at the one moment the owner most
      //     needs to know the site changed under them.
      const reason = (error as Error).message
      const problem =
        published.length === 0
          ? `Its pages could not be checked, so nothing was published: ${reason}`
          : funnelWasLive
            ? `${published.length} of its pages were published, but the rest were not: ${reason}. ` +
              `This funnel is already live, so those changes are public now while the remaining pages ` +
              `still serve their previous version — publish again to finish.`
            : `${published.length} of its pages were published, but the funnel was not taken live: ${reason}. ` +
              `It is still a draft, so none of it is public yet — publishing again is safe.`
      return NextResponse.json(
        {
          error: "This funnel could not be published.",
          pages: [{ stepId: "", stepName: "This funnel", problems: [problem], blank: false }],
        },
        { status: 422 },
      )
    }
  },
)

/**
 * Every camp sold by a checkout form on any of this funnel's pages, given its
 * Stripe product and price if that is all it lacks.
 *
 * Sequential rather than parallel, and deliberately: this touches Stripe, the
 * list is one or two camps on a real funnel, and a burst of concurrent product
 * creations against one account buys nothing worth the risk of rate limiting.
 */
async function ensureCheckoutCampsPriced(drafts: (Awaited<ReturnType<typeof getDraft>> | null)[]): Promise<void> {
  const eventIds = new Set<string>()
  for (const draft of drafts) {
    for (const section of draft?.doc?.sections ?? []) {
      if (section.kind !== "form") continue
      const props = section.props as { successMode?: unknown; eventId?: unknown }
      if (props.successMode !== "checkout") continue
      if (typeof props.eventId === "string" && props.eventId !== "") eventIds.add(props.eventId)
    }
  }
  for (const eventId of eventIds) {
    const outcome = await ensureEventPriced(eventId)
    if (outcome.ok && outcome.changed) {
      console.info("[funnels/publish] created a Stripe price for camp", eventId)
    }
  }
}
