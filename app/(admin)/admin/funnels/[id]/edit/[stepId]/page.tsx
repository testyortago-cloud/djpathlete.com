// app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx — the AI page builder.
//
// This server component's whole job is to hand `<FunnelBuilder>` a state that
// is TRUE AT MOUNT. It would be far less code to pass the draft down and let
// the client wait for its first turn to learn anything — and that would be
// wrong in a specific, silent way:
//
//   `funnel_step_turns.unresolved` IS A STALE DISPLAY CACHE, NOT A VERDICT.
//   lib/db/funnel-builder.ts:444-456 says so in capitals: it was computed
//   against the catalogue AS IT WAS at that revision, so a program deleted
//   since would let the chat tell the owner a page is publishable when it is
//   not. It also names this stage as the one that must re-resolve instead of
//   trusting it.
//
// So the column is deliberately NOT read. The document is re-resolved here
// against a freshly loaded catalogue and compiled with the same
// `reassemble -> compileFunnelStep` pair the publish route and the draft
// preview both run, and THAT is what the builder opens with. Everything is
// wrapped: a catalogue that cannot be read degrades to "links were not checked"
// (which the UI treats as "unknown", never as "all clear"), and nothing here
// may turn a page the owner wants to edit into an error screen.

import { notFound, redirect } from "next/navigation"
import { getFunnelById, getStep, getVersionNumber, listSteps } from "@/lib/db/funnels"
import { getDraft, listTurns } from "@/lib/db/funnel-builder"
import { compileFunnelStep } from "@/lib/funnels/compile"
import { reassemble } from "@/lib/funnels/sections/doc"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import {
  loadCatalogues,
  resolveDoc,
  type DanglingAnchor,
  type FunnelStepRef,
  type UnresolvedCta,
} from "@/lib/funnels/sections/resolve"
import { SECTION_BUILDER_MAX_MESSAGE_LENGTH } from "@/lib/funnels/sections/builder-config"
import { creationPrompt } from "@/lib/funnels/creation-prompt"
import { FunnelBuilder } from "@/components/admin/funnels/FunnelBuilder"
import { renderDocForPublish } from "@/components/admin/funnels/builder/publish-actions"
import type { BuilderMessage, CompileSummary } from "@/components/admin/funnels/builder/types"

export const metadata = { title: "Edit page" }

interface PageProps {
  params: Promise<{ id: string; stepId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

interface InitialState {
  doc: SectionDoc | null
  unresolved: UnresolvedCta[]
  danglingAnchors: DanglingAnchor[]
  compile: CompileSummary | null
  resolutionError: string | null
}

/**
 * Resolve then compile, in that order and for the same reason the build route
 * gives: compiling first would hand the compiler a document whose CTA refs are
 * still NAMES, and the resolved document is the one the owner should be
 * publishing.
 *
 * ---------------------------------------------------------------------------
 * THE COMPILE HALF BELOW IS A HAND-KEPT TWIN OF `compileDoc` IN
 * `app/api/admin/funnels/steps/[stepId]/build/route.ts:246`, AND THAT IS A
 * KNOWN COST, NOT AN OVERSIGHT.
 * ---------------------------------------------------------------------------
 * This repo has shipped three bugs from restating a rule instead of importing
 * it, so the default is to share. It cannot be shared here yet: the route does
 * not export the helper, and the stage that owns this file may not edit
 * anything under `app/api/` — so "sharing" it today would mean a THIRD copy in
 * a new module that only one of the two callers imports, which is strictly
 * worse than two copies that are visibly twins.
 *
 * What must stay in step is the SHAPE OF THE VERDICT, and there is exactly one
 * rule in it worth guarding: `ok` is `problems.length === 0`, NOT `compiled.ok`.
 * A page whose `reassemble` hit the size cap compiles perfectly cleanly. If the
 * twin is edited, edit this one; the fix that deletes this comment is exporting
 * `compileDoc` from the route and calling it from both sides.
 */
async function resolveAndCompile(
  doc: SectionDoc,
  funnelBasePath: string,
  // `null` means the page list could not be read, which `resolveDoc` treats as
  // "step links not checked". That is the RIGHT degrade here and the wrong one
  // in the publish route: losing the check costs this screen a warning, and
  // nothing on it may turn a page the owner wants to edit into an error.
  pages: FunnelStepRef[] | null,
): Promise<InitialState> {
  let resolvedDoc = doc
  let unresolved: UnresolvedCta[] = []
  let danglingAnchors: DanglingAnchor[] = []
  let resolutionError: string | null = null

  try {
    const catalogues = await loadCatalogues()
    // `resolveDoc` THROWS rather than reporting a clean empty list over a
    // corrupt document, precisely so a caller cannot accidentally unblock
    // publish. Catching it and saying "not checked" honours that; swallowing
    // it into `unresolved: []` would defeat it.
    const resolution = resolveDoc(doc, catalogues, pages)
    resolvedDoc = resolution.doc
    unresolved = resolution.unresolved
    danglingAnchors = resolution.danglingAnchors
  } catch (error) {
    console.error("[funnels/edit] could not check this page's links:", error)
    resolutionError = `CTA links were not checked: ${(error as Error).message}`
  }

  let compile: CompileSummary
  try {
    const rendered = reassemble(resolvedDoc, { funnelBasePath })
    const compiled = compileFunnelStep({ html: rendered.html, css: rendered.css })
    compile = compiled.ok
      ? {
          ok: rendered.problems.length === 0,
          problems: rendered.problems.map((problem) => problem.message),
          warnings: compiled.warnings.map((warning) => warning.message),
        }
      : {
          ok: false,
          problems: [
            ...rendered.problems.map((problem) => problem.message),
            ...compiled.errors.map((compileError) => compileError.message),
          ],
          warnings: [],
        }
  } catch (error) {
    compile = { ok: false, problems: [`This page could not be rendered: ${(error as Error).message}`], warnings: [] }
  }

  return { doc: resolvedDoc, unresolved, danglingAnchors, compile, resolutionError }
}

/**
 * The AI builder for one step of a funnel, or for a landing page.
 *
 * `base` is which URL it is being served from — see the sibling detail screen.
 * The two kinds share this builder but not their address, because the admin
 * sidebar highlights by path prefix. Redirecting on a MISMATCH (rather than on
 * `kind` alone) is what keeps the page route from redirecting to itself.
 */
export async function FunnelBuilderScreen({
  id,
  stepId,
  start,
  base,
}: {
  id: string
  stepId: string
  start?: string | string[]
  base: "pages" | "funnels"
}) {
  const [funnel, step] = await Promise.all([getFunnelById(id), getStep(stepId)])
  if (!funnel || !step || step.funnel_id !== funnel.id) notFound()

  const correctBase = funnel.kind === "page" ? "pages" : "funnels"
  if (correctBase !== base) redirect(`/admin/${correctBase}/${funnel.id}/edit/${step.id}`)

  const publicUrl = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`
  const funnelBasePath = `/go/${funnel.slug}`

  // Neither read is allowed to take the editor down: a transcript that cannot
  // be listed costs the owner their history, not their page. The same goes for
  // the live version number, which is a label — the editor opens without it.
  const [draft, turns, publishedVersion, pages] = await Promise.all([
    getDraft(stepId),
    listTurns(stepId).catch((error) => {
      console.error("[funnels/edit] transcript read failed — opening without history:", error)
      return []
    }),
    step.published_version_id
      ? getVersionNumber(step.published_version_id).catch((error) => {
          console.error("[funnels/edit] could not read the live version number:", error)
          return null
        })
      : Promise.resolve(null),
    // `null` on failure, NOT `[]` — see `resolveDoc`. An empty list would say
    // "this funnel has no pages" and report every step link on the screen as
    // broken; `null` says "not checked", which is what actually happened.
    listSteps(funnel.id)
      .then((rows) => rows.map((row) => ({ slug: row.slug, name: row.name })))
      .catch((error) => {
        console.error("[funnels/edit] could not read the page list — links unchecked:", error)
        return null
      }),
  ])
  if (!draft) notFound()

  const initial: InitialState = draft.doc
    ? await resolveAndCompile(draft.doc, funnelBasePath, pages)
    : { doc: null, unresolved: [], danglingAnchors: [], compile: null, resolutionError: null }

  // WHICH TURNS CAN BE GONE BACK TO: the ones whose stored document still
  // parses. Computed for EVERY turn, not just when the draft is unreadable,
  // because this is now the transcript's undo as well as its recovery.
  //
  // It matters more than it did. Until click-to-edit, a change to this page was
  // an AI turn — deliberate, infrequent, and visible in the chat. Now a
  // double-click and a keystroke commits one, so "step back one" has to exist.
  // The mechanism already did (`revertToRevision`, a `source:'revert'` head
  // turn); only the affordance was missing, and it was only ever wired to
  // corruption recovery.
  const restorable = new Set<number>()
  for (const turn of turns) {
    if (turn.doc === null || turn.doc === undefined) continue
    if (sectionDocSchema.safeParse(turn.doc).success) restorable.add(turn.revision)
  }

  // The newest restorable revision — what the unreadable-document recovery
  // button should be pointed at. Derived from the SAME set as the per-turn
  // controls, so the recovery button and the transcript cannot disagree about
  // which revisions are good.
  let resetToRevision: number | null = null
  if (draft.docInvalid) {
    for (let index = turns.length - 1; index >= 0; index--) {
      if (restorable.has(turns[index].revision)) {
        resetToRevision = turns[index].revision
        break
      }
    }
  }

  const initialMessages: BuilderMessage[] = turns
    .filter((turn) => typeof turn.message === "string" && turn.message.trim() !== "")
    .map((turn) =>
      turn.role === "user"
        ? {
            id: `turn-${turn.revision}`,
            role: "owner" as const,
            text: turn.message,
            revision: turn.revision,
            // An INSPECTOR turn is `role: "user"` AND carries a document — a
            // click edit is written by the owner, not the model — so an owner
            // message is restorable exactly as often as a builder one.
            producedDoc: restorable.has(turn.revision),
          }
        : {
            id: `turn-${turn.revision}`,
            role: "builder" as const,
            text: turn.message,
            revision: turn.revision,
            producedDoc: restorable.has(turn.revision),
            blocked: turn.blocked,
            failed: turn.status === "failed",
            // No receipt: `funnel_step_turns` stores the ops, not the diff the
            // receipt was rendered from, and re-deriving one would mean
            // replaying every op against every intermediate document. Receipts
            // appear for turns taken in this session.
          },
    )

  // `start=1` is a nudge from the create dialog, not the condition. The same
  // guards run again inside the builder, so a hand-edited URL cannot make an
  // established page re-run its creation prompt.
  //
  // `funnel.template !== null` IS WHAT MAKES STEPS 2..N LAZY. The create dialog
  // routes into step one with the nudge; every later step is reached from the
  // step list by an ordinary link with no query string, and would otherwise
  // open blank forever — which would leave the template having named several
  // steps and drafted one. A templated funnel therefore drafts any step that has
  // never been touched, on first open.
  //
  // The real guards are the two that follow, and they are unchanged: a step
  // with no document and no turns has nothing to lose. `FunnelBuilder` re-checks
  // both plus its own `initialPromptFired` ref before sending.
  // A TRUTHY check, not `!== null`. Before migration 00210 lands, `select("*")`
  // returns rows with no `template` key at all — and `undefined !== null` is
  // TRUE, which would fire the creation prompt on every untouched step of every
  // funnel that predates templates. Truthiness covers null, undefined and the
  // empty string alike.
  const wantsFirstDraft =
    (start === "1" || Boolean(funnel.template)) && draft.doc === null && turns.length === 0

  // The sibling read happens ONLY when a draft is actually wanted — which is
  // once in a step's life. Hoisting it above the guard would put an extra query
  // on every open of every page in the account, forever, to compose a string
  // that is thrown away.
  const initialPrompt = wantsFirstDraft
    ? creationPrompt(
        funnel,
        step,
        await listSteps(funnel.id).catch((error) => {
          // Losing the sequence context costs the prompt one line. Losing the
          // editor costs the owner their page.
          console.error("[funnels/edit] could not read sibling steps for the first draft:", error)
          return [step]
        }),
      )
    : null

  return (
    <FunnelBuilder
      funnelId={funnel.id}
      funnelName={funnel.name}
      stepId={step.id}
      stepName={step.name}
      publicUrl={publicUrl}
      funnelStatus={funnel.status}
      funnelKind={funnel.kind}
      initialDoc={initial.doc}
      initialRevision={draft.revision}
      docInvalid={draft.docInvalid}
      resetToRevision={resetToRevision}
      initialUnresolved={initial.unresolved}
      initialDanglingAnchors={initial.danglingAnchors}
      initialCompile={initial.compile}
      initialResolutionError={initial.resolutionError}
      initialMessages={initialMessages}
      initialPublishedVersion={publishedVersion}
      initialPrompt={initialPrompt}
      maxMessageLength={SECTION_BUILDER_MAX_MESSAGE_LENGTH}
      renderForPublish={renderDocForPublish.bind(null, step.id)}
    />
  )
}

export default async function FunnelEditPage({ params, searchParams }: PageProps) {
  const { id, stepId } = await params
  const { start } = await searchParams
  return <FunnelBuilderScreen id={id} stepId={stepId} start={start} base="funnels" />
}
