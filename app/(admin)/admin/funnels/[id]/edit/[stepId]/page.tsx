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

import { notFound } from "next/navigation"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { getDraft, listTurns } from "@/lib/db/funnel-builder"
import { compileFunnelStep } from "@/lib/funnels/compile"
import { reassemble } from "@/lib/funnels/sections/doc"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import { loadCatalogues, resolveDoc, type DanglingAnchor, type UnresolvedCta } from "@/lib/funnels/sections/resolve"
import { SECTION_BUILDER_MAX_MESSAGE_LENGTH } from "@/lib/funnels/sections/builder-config"
import { FunnelBuilder } from "@/components/admin/funnels/FunnelBuilder"
import { renderDocForPublish } from "@/components/admin/funnels/builder/publish-actions"
import type { BuilderMessage, CompileSummary } from "@/components/admin/funnels/builder/types"

export const metadata = { title: "Edit page" }

interface PageProps {
  params: Promise<{ id: string; stepId: string }>
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
 */
async function resolveAndCompile(doc: SectionDoc, funnelBasePath: string): Promise<InitialState> {
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
    const resolution = resolveDoc(doc, catalogues)
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

export default async function FunnelEditPage({ params }: PageProps) {
  const { id, stepId } = await params

  const [funnel, step] = await Promise.all([getFunnelById(id), getStep(stepId)])
  if (!funnel || !step || step.funnel_id !== funnel.id) notFound()

  const publicUrl = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`
  const funnelBasePath = `/go/${funnel.slug}`

  // Neither read is allowed to take the editor down: a transcript that cannot
  // be listed costs the owner their history, not their page.
  const [draft, turns] = await Promise.all([
    getDraft(stepId),
    listTurns(stepId).catch((error) => {
      console.error("[funnels/edit] transcript read failed — opening without history:", error)
      return []
    }),
  ])
  if (!draft) notFound()

  const initial: InitialState = draft.doc
    ? await resolveAndCompile(draft.doc, funnelBasePath)
    : { doc: null, unresolved: [], danglingAnchors: [], compile: null, resolutionError: null }

  // The newest revision whose stored document still parses — what the
  // unreadable-document recovery button should be pointed at. Same scan the
  // build route makes; done here so the recovery is on screen the moment the
  // page opens, rather than only after a turn has been refused.
  let resetToRevision: number | null = null
  if (draft.docInvalid) {
    for (let index = turns.length - 1; index >= 0; index--) {
      const turn = turns[index]
      if (turn.doc === null || turn.doc === undefined) continue
      if (sectionDocSchema.safeParse(turn.doc).success) {
        resetToRevision = turn.revision
        break
      }
    }
  }

  const initialMessages: BuilderMessage[] = turns
    .filter((turn) => typeof turn.message === "string" && turn.message.trim() !== "")
    .map((turn) =>
      turn.role === "user"
        ? { id: `turn-${turn.revision}`, role: "owner" as const, text: turn.message }
        : {
            id: `turn-${turn.revision}`,
            role: "builder" as const,
            text: turn.message,
            blocked: turn.blocked,
            failed: turn.status === "failed",
            // No receipt: `funnel_step_turns` stores the ops, not the diff the
            // receipt was rendered from, and re-deriving one would mean
            // replaying every op against every intermediate document. Receipts
            // appear for turns taken in this session.
          },
    )

  return (
    <FunnelBuilder
      funnelId={funnel.id}
      funnelName={funnel.name}
      stepId={step.id}
      stepName={step.name}
      publicUrl={publicUrl}
      initialDoc={initial.doc}
      initialRevision={draft.revision}
      docInvalid={draft.docInvalid}
      resetToRevision={resetToRevision}
      initialUnresolved={initial.unresolved}
      initialDanglingAnchors={initial.danglingAnchors}
      initialCompile={initial.compile}
      initialResolutionError={initial.resolutionError}
      initialMessages={initialMessages}
      maxMessageLength={SECTION_BUILDER_MAX_MESSAGE_LENGTH}
      renderForPublish={renderDocForPublish.bind(null, step.id)}
    />
  )
}
