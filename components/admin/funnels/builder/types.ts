// components/admin/funnels/builder/types.ts — the shapes the builder UI holds.
//
// EVERY IMPORT HERE IS `import type`, AND THAT IS LOAD-BEARING.
// `UnresolvedCta` lives in `lib/funnels/sections/resolve.ts`, which imports
// four DAL modules and therefore the Supabase SDK; `DiffReceipt` lives in
// `apply.ts`. A value import of either would drag server code into the admin
// client bundle. `import type` is erased outright, so the UI can speak the
// pipeline's exact vocabulary without carrying any of its machinery.
//
// `BuildTurnResponse` MIRRORS the `TurnResponse` interface declared inside
// `app/api/admin/funnels/steps/[stepId]/build/route.ts`. It is mirrored rather
// than imported because the route does not export it and Stage 1.9 may not
// edit anything under `app/api/`. The two must be kept in step by hand; the
// safest change is to export the route's interface in a later stage and delete
// this one.

import type { DiffReceipt } from "@/lib/funnels/sections/apply"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { DanglingAnchor, UnresolvedCta } from "@/lib/funnels/sections/resolve"

export type { DanglingAnchor, DiffReceipt, SectionDoc, UnresolvedCta }

/** Mirror of the route's `CompileSummary`. */
export interface CompileSummary {
  ok: boolean
  /** Blocks publishing: size caps, fatal compile errors. */
  problems: string[]
  /** Non-fatal: something the sanitiser dropped. Normally empty. */
  warnings: string[]
}

/** Mirror of the route's `TurnResponse` (200 on every branch). */
export interface BuildTurnResponse {
  revision: number
  doc: SectionDoc | null
  reply: string
  blocked: boolean
  receipt: DiffReceipt | null
  /**
   * NULL MEANS "THIS TURN PRODUCED NO DOCUMENT" and is the single flag the UI
   * branches on. The route returns `compile: null` on exactly two paths — the
   * model declined (`blocked`), and both attempts failed — and a non-null
   * compile on every path that wrote a document. Adopting `doc`/`unresolved`/
   * `danglingAnchors` from a null-compile response would replace a real
   * verdict with the route's placeholder empties and silently unblock publish.
   */
  compile: CompileSummary | null
  unresolved: UnresolvedCta[]
  danglingAnchors: DanglingAnchor[]
  /**
   * Non-null means CTA refs were NOT CHECKED this turn. `unresolved: []`
   * beside it means "not checked", never "all clear" — so the UI keeps the
   * previous list rather than taking the empty one.
   */
  resolutionError: string | null
  source: "ai" | "revert"
}

/** The error bodies the build route returns, flattened. */
export interface BuildErrorResponse {
  error?: string
  code?: string
  /** 409 `stale_revision` — what the client should re-sync to. */
  currentRevision?: number
  /** 422 `doc_invalid` — the newest revision whose document still parses. */
  resetToRevision?: number | null
}

/**
 * What a transcript entry knows about the document it left behind.
 *
 * These are FACTS, not a verdict: "can this be restored to" also depends on
 * what the CURRENT revision is, which a message cannot know and which changes
 * under it every turn. `ChatPane` derives the verdict from these plus
 * `currentRevision`, so a message never has to be rewritten when the head moves.
 */
interface Restorable {
  /** `funnel_steps.doc_revision` after this turn. */
  revision?: number
  /** This turn wrote a document, so there is something to go back to. */
  producedDoc?: boolean
}

/** One entry in the transcript. */
export type BuilderMessage =
  | ({ id: string; role: "owner"; text: string } & Restorable)
  | ({
      id: string
      role: "builder"
      text: string
      receipt?: DiffReceipt | null
      compile?: CompileSummary | null
      danglingAnchors?: DanglingAnchor[]
      unresolvedCount?: number
      resolutionError?: string | null
      blocked?: boolean
      failed?: boolean
    } & Restorable)
  /**
   * A publish refusal, routed back INTO the chat rather than a toast, so the
   * "Fix it for me" button sits next to the problem it fixes.
   */
  | { id: string; role: "problems"; text: string; problems: string[] }

/**
 * What the server action hands back for a publish. Either a rendered pair
 * ready to POST at the (unchanged) publish route, or a refusal carrying the
 * live publish gate's own blockers.
 */
export type RenderForPublishResult =
  | {
      ok: true
      html: string
      css: string
      /** Draft-time size-cap problems from `reassemble`. */
      problems: string[]
      /** Dangling anchors, from the live `publishGate` — warnings, not blockers. */
      warnings: string[]
    }
  | { ok: false; blockers: string[]; warnings: string[] }

/** The bound server action the page hands the builder. */
export type RenderForPublish = (doc: SectionDoc) => Promise<RenderForPublishResult>
