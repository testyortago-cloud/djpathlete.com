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
// COMPILED ON READ, BY THE SAME COMPILER PUBLISH USES.
// `compileFunnelStep(reassemble(doc))` is exactly the pair the publish route
// runs, so this shows what publish will actually ship rather than a second,
// drifting rendering of the same document. Both are pure and take single-digit
// milliseconds, so there is nothing to cache and nothing to invalidate.
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
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { reassemble } from "@/lib/funnels/sections/doc"

/**
 * A draft is by definition not ready to be indexed, and this URL is reachable
 * by anyone who is handed it (the gate below refuses them, but a crawler that
 * followed a link would still have recorded the URL).
 */
export const metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ stepId: string }>
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
 * `reassemble`'s `problems` are the PUBLISH size caps (doc.ts's
 * `checkSizeCaps`), and a document that busts them still compiles perfectly —
 * `compiled.ok` is true and the preview looks finished. This banner is the only
 * thing standing between that and an owner clicking Publish on the one screen
 * they use to decide a page is done. It sits ABOVE the page rather than
 * replacing it: the draft is still worth looking at, it just cannot ship yet.
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

export default async function FunnelDraftPreviewPage({ params }: PageProps) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") notFound()

  const { stepId } = await params
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

  // `reassemble` re-parses the document and throws on a bad one. `getDraft`
  // has already parsed it with the same schema, so this cannot legitimately
  // fire — but an uncaught throw in a server component is a 500 error page for
  // an owner who only wanted to look at their draft, and "here is what is
  // wrong with it" is strictly more useful.
  let rendered
  try {
    rendered = reassemble(draft.doc, { funnelBasePath: `/go/${funnel.slug}` })
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
        }}
      />
    </div>
  )

  // A clean draft is returned as the bare funnel root, with nothing of this
  // route's own chrome in it — the preview is supposed to look exactly like the
  // published page. The banner is added ONLY when there is something publish
  // would reject; see `PreviewBlockedBanner`.
  if (rendered.problems.length === 0) return page

  return (
    <>
      <PreviewBlockedBanner problems={rendered.problems.map((p) => p.message)} />
      {page}
    </>
  )
}
