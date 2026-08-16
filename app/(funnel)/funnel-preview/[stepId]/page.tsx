// app/(funnel)/funnel-preview/[stepId]/page.tsx — the DRAFT preview.
//
// ---------------------------------------------------------------------------
// WHY THIS ROUTE HAS TO EXIST AT ALL
// ---------------------------------------------------------------------------
// `/go/<funnel>/<step>?preview=1` cannot show a draft and never could.
// `getPublishedStep(..., {includeUnpublished: true})` never reads
// `project_data`; it falls back to the newest VERSION ROW
// (lib/db/funnels.ts:291-298), which only exists once something has been
// published. So the owner iterates in chat, clicks Preview, sees the page as
// it was published days ago, and concludes the AI is broken — a silent,
// perfectly plausible wrong answer, which is the worst failure mode this
// feature has.
//
// RESOLVED AND GATED ON READ, THEN COMPILED BY THE SAME COMPILER PUBLISH USES.
// `loadCatalogues -> resolveDoc -> publishGate -> reassemble(resolution.doc) ->
// compileFunnelStep` is exactly the sequence the publish path runs, so this
// shows what publish will actually ship rather than a second, drifting
// rendering of the same document.
//
// THE RESOLVE STEP WAS MISSING FOR A WHOLE STAGE, AND ITS ABSENCE WAS EXACTLY
// THE FAILURE THIS FILE'S HEADER CLAIMS TO PREVENT. The build route stores the
// RESOLVED doc, but a turn whose resolution degraded (catalogue unreadable)
// stores name-refs instead — and this page then reassembled the STORED draft.
// A `{kind:"program", ref:"Comeback Code"}` previewed as a disabled button and
// published as a live checkout island; a `session_pack` previewed WITHOUT its
// productId and published WITH it. Preview and publish disagreeing about the
// same document is a silent, perfectly plausible wrong answer, which is the
// worst failure mode this feature has and the reason the route exists.
//
// The gate runs here for the second half of the same problem: `reassemble`'s
// `problems` are only the SIZE CAPS, so a page full of dead buy buttons — the
// commonest refusal by far — previewed with no banner at all, on the one
// screen the owner uses to decide a page is done.
//
// IT FAILS SOFT, and that is the one place it differs from publish. A
// catalogue read that throws must not turn "look at my draft" into an error
// page: the draft still renders, from the unresolved document, with the
// banner saying publishing will refuse it until the links can be checked —
// which is true, because both publish gates fail CLOSED on the same throw.
//
// WHERE IT LIVES, AND WHY NOT ANYWHERE ELSE:
//   - NOT under /go/ — `[[...step]]` is an optional catch-all and would
//     swallow the path.
//   - NOT `_`-prefixed — the App Router treats `_folders` as private and
//     unroutable.
//   - INSIDE the (funnel) group — that group exists to escape the marketing
//     chrome (navbar, footer, sticky CTA), which would otherwise compete with
//     the landing page's own single call to action, while the ROOT layout
//     still supplies <html>, <body> and the brand fonts.
//
// SELF-GATED. `middleware.ts` matches only `/admin/*` and `/client/*`, so
// everything here is public unless this file says otherwise. The gate is the
// same shape as the sibling preview check in
// app/(funnel)/go/[slug]/[[...step]]/page.tsx:24-31, and it fails CLOSED:
// anything that is not an admin or a staff member gets a 404, not a redirect,
// so the route does not even confirm that a step id exists.

import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import { FUNNEL_ROOT_ID, compileFunnelStep } from "@/lib/funnels/compile"
import { getDraft } from "@/lib/db/funnel-builder"
import { getFunnelById, getStep, listSteps } from "@/lib/db/funnels"
import { reassemble } from "@/lib/funnels/sections/doc"
import { CANVAS_EDIT_CSS } from "@/lib/funnels/sections/edit-css"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"

/**
 * A draft is by definition not ready to be indexed, and this URL is reachable
 * by anyone who is handed it (the gate below refuses them, but a crawler that
 * followed a link would still have recorded the URL).
 */
export const metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ stepId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Everything that is not a page: no document yet, a document this builder
 * cannot read, or one that will not compile. Rendered rather than thrown —
 * `notFound()` here would tell the owner the step does not exist, which is a
 * different and wrong statement.
 */
function PreviewNotice({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-heading text-2xl text-foreground">{title}</h1>
      {lines.length > 0 ? (
        <ul className="mt-6 space-y-2">
          {lines.map((line, index) => (
            <li key={index} className="font-body text-sm text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The page compiles, but publish will refuse it.
 *
 * TWO SOURCES, AND THE SECOND ONE IS THE COMMON CASE. `reassemble`'s
 * `problems` are the PUBLISH size caps (doc.ts's `checkSizeCaps`), which a
 * schema-valid page can barely reach; `publishGate`'s blockers are dead buy
 * buttons and FAQ sections that would render as nothing, which is what
 * actually refuses real pages. A document that busts either still compiles
 * perfectly — `compiled.ok` is true and the preview looks finished. This
 * banner is the only thing standing between that and an owner clicking Publish
 * on the one screen they use to decide a page is done. It sits ABOVE the page
 * rather than replacing it: the draft is still worth looking at, it just
 * cannot ship yet.
 */
function PreviewBlockedBanner({ problems }: { problems: string[] }) {
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-6 py-4">
      <p className="font-heading text-sm text-foreground">This page previews, but publishing will refuse it</p>
      <ul className="mt-2 space-y-1">
        {problems.map((problem, index) => (
          <li key={index} className="font-body text-sm text-muted-foreground">
            {problem}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default async function FunnelDraftPreviewPage({ params, searchParams }: PageProps) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") notFound()

  const { stepId } = await params

  // EDIT MODE ADDS ATTRIBUTES AND A STYLESHEET. NOTHING ELSE.
  //
  // The page the owner clicks on is the same render publish ships, which is the
  // whole reason the canvas is this route rather than a second, client-side
  // drawing of the same document. `?edit=1` is safe to be a query string
  // because this route is already admin-gated above and because the flag cannot
  // reach `/go` or a version row: `reassemble`'s `editable` defaults to false
  // and only this call site ever sets it.
  const { edit } = await searchParams
  const editable = edit === "1"
  const [draft, step] = await Promise.all([getDraft(stepId), getStep(stepId)])
  if (!draft || !step) notFound()

  const funnel = await getFunnelById(step.funnel_id)
  if (!funnel) notFound()

  if (draft.docInvalid) {
    return (
      <PreviewNotice
        title="This page can't be previewed"
        lines={[
          "Its saved content is not a document the page builder can read — either it is from the old " +
            "drag-and-drop editor, or it has been corrupted.",
          "Nothing has been lost. Restore an earlier version from the chat to carry on.",
        ]}
      />
    )
  }

  if (!draft.doc) {
    return (
      <PreviewNotice
        title="Nothing to preview yet"
        lines={["This page has no draft. Describe what you want in the builder chat and it will appear here."]}
      />
    )
  }

  // THE SAME RESOLUTION PUBLISH RUNS, so the preview cannot disagree with it
  // about the same document. `loadCatalogues` and `resolveDoc` both throw
  // (a truncated recognition read; a corrupt document) and BOTH throws are
  // caught here rather than either 500ing a page whose whole job is "let me
  // look at my draft" — the unresolved document is still worth rendering, and
  // the banner says publishing will refuse it, which is exactly what both
  // publish gates do on the same throw.
  let docToRender = draft.doc
  let gateBlockers: string[] = []
  try {
    // Both reads are inside the same try, so either failing lands in the catch
    // below — which already tells the owner publishing will refuse the page
    // until its links can be checked. That is the honest answer here; `null`
    // would quietly claim the step links were fine.
    const [catalogues, pages] = await Promise.all([
      loadCatalogues(),
      listSteps(funnel.id).then((rows) => rows.map((row) => ({ slug: row.slug, name: row.name }))),
    ])
    const resolution = resolveDoc(draft.doc, catalogues, pages)
    docToRender = resolution.doc
    gateBlockers = publishGate(resolution).blockers
  } catch (error) {
    gateBlockers = [
      "This page's links could not be checked, so publishing will refuse it until they can be: " +
        (error as Error).message,
    ]
  }

  // `reassemble` re-parses the document and throws on a bad one. `getDraft`
  // has already parsed it with the same schema, so this cannot legitimately
  // fire — but an uncaught throw in a server component is a 500 error page for
  // an owner who only wanted to look at their draft, and "here is what is
  // wrong with it" is strictly more useful.
  let rendered
  try {
    rendered = reassemble(docToRender, { funnelBasePath: `/go/${funnel.slug}`, editable })
  } catch (error) {
    return <PreviewNotice title="This page can't be rendered" lines={[(error as Error).message]} />
  }

  const compiled = compileFunnelStep({ html: rendered.html, css: rendered.css })

  if (!compiled.ok) {
    return (
      <PreviewNotice
        title="This page can't be compiled"
        lines={[...rendered.problems.map((p) => p.message), ...compiled.errors.map((e) => e.message)]}
      />
    )
  }

  const page = (
    <div id={FUNNEL_ROOT_ID}>
      {/* Scoped by the compiler — every selector is prefixed with this id. */}
      {compiled.css ? <style dangerouslySetInnerHTML={{ __html: compiled.css }} /> : null}
      {/* AFTER the page's own stylesheet, so selection chrome wins at equal
          specificity. Not scoped to the funnel root: `djp-selected` is added to
          the <section> elements themselves, which are inside it anyway. */}
      {editable ? <style dangerouslySetInnerHTML={{ __html: CANVAS_EDIT_CSS }} /> : null}
      <NodeRenderer
        nodes={compiled.nodes}
        context={{
          funnelId: funnel.id,
          funnelSlug: funnel.slug,
          stepId: step.id,
          stepSlug: step.slug,
          // ALWAYS true, never derived from a query string. A draft preview
          // must not create a real lead, a real checkout session or a real
          // event registration — the page is not published, so anything it
          // submits is noise in the owner's real data.
          isPreview: true,
          // The same flag `reassemble` got, for the parts of the page
          // `reassemble` cannot reach. An island's insides are built here, at
          // request time, and never pass through the compiler — so the form's
          // own labels have to be anchored by the component that draws them.
          // Passing the two independently would let the canvas end up with
          // anchors on the page and none in the form, or the reverse.
          editable,
        }}
      />
    </div>
  )

  // A clean draft is returned as the bare funnel root, with nothing of this
  // route's own chrome in it — the preview is supposed to look exactly like the
  // published page. The banner is added ONLY when there is something publish
  // would reject; see `PreviewBlockedBanner`.
  const problems = [...rendered.problems.map((p) => p.message), ...gateBlockers]
  if (problems.length === 0) return page

  return (
    <>
      <PreviewBlockedBanner problems={problems} />
      {page}
    </>
  )
}
