// app/api/admin/funnels/steps/[stepId]/build/route.ts — one AI page-builder turn.
//
// The owner types a sentence; this route turns it into a new `SectionDoc` and
// hands back the document, a diff receipt, a compile verdict and the list of
// CTAs that did not resolve. Everything it composes already exists and is
// tested with zero mocks — `prompt.ts` (what the model sees), `apply.ts`
// (ops -> doc, transactional), `resolve.ts` (names -> row ids), `doc.ts`
// (doc -> {html, css}), `lib/funnels/compile` (the FROZEN publish compiler)
// and `lib/db/funnel-builder.ts` (the turn log + optimistic lock). This file
// is the wiring, and its whole job is to make sure not one of those can take
// the request down when it fails.
//
// ---------------------------------------------------------------------------
// THE ORDER OF STEPS 5 AND 6 IS DELIBERATELY THE REVERSE OF THE PLAN'S.
// ---------------------------------------------------------------------------
// Plan §5 lists "reassemble -> compile" (5) before "resolve refs" (6). Run in
// that order the compiler would see a document whose CTA refs are still NAMES
// ("Comeback Code"), and `render.ts` would build a checkout island around that
// name as though it were a product id. Worse, the document PERSISTED by the
// turn would still hold names, so `resolveDoc`'s idempotence contract — "by
// turn two the doc already holds real ids", the thing rule 1 of its matcher
// exists to serve — would never become true and every turn would re-resolve
// from scratch forever.
//
// So: applyOps -> resolveDoc (substitutes ids) -> reassemble -> compile, and
// the RESOLVED document is what gets stored and returned. When the catalogue
// cannot be loaded at all, resolution is skipped and the document keeps its
// names; the next turn substitutes them, which is the same idempotence
// working in the caller's favour.
//
// ---------------------------------------------------------------------------
// NOTHING BELOW MAY 500. Five failure paths, each one a real defect found by
// review in an earlier stage:
//
//   (a) `applyOps` SEMANTIC errors feed the auto-retry, not just Zod errors.
//   (b) `docInvalid` is refused, never overwritten.
//   (c) A document no op can repair has a way back: `action: "reset"`.
//   (d) `loadCatalogues` and `resolveDoc` both THROW; both are wrapped and
//       degrade to "resolution unavailable" rather than failing the turn.
//   (e) `stale_revision` is a 409 carrying the current revision; a model
//       refusal or an unparseable response is a 200 with an honest reply and
//       the draft untouched.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { buildRequestSchema } from "@/lib/validators/funnel"
import { callAgent } from "@/lib/ai/anthropic"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { appendTurn, getDraft, listTurns, revertToRevision } from "@/lib/db/funnel-builder"
import { getFunnelById, getStep, listSteps } from "@/lib/db/funnels"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import { applyOps, type DiffReceipt } from "@/lib/funnels/sections/apply"
import { reassemble } from "@/lib/funnels/sections/doc"
import { compileFunnelStep } from "@/lib/funnels/compile"
import {
  buildResultSchema,
  buildSystemPrompt,
  buildTurnMessage,
  type BuilderTurn,
} from "@/lib/funnels/sections/prompt"
import {
  loadCatalogues,
  resolveDoc,
  type Catalogue,
  type Catalogues,
  type DanglingAnchor,
  type UnresolvedCta,
} from "@/lib/funnels/sections/resolve"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import {
  SECTION_BUILDER_EDIT_MAX_TOKENS,
  SECTION_BUILDER_MODEL,
  SECTION_BUILDER_RATE_LIMIT_MAX,
  SECTION_BUILDER_RATE_LIMIT_WINDOW_MS,
} from "@/lib/funnels/sections/builder-config"

/**
 * A first draft is a whole page in one non-streaming response and an iterative
 * turn can be a 24-section `set_page` rewrite. 300s is the ceiling; the model
 * budgets below are what actually bound a call.
 */
export const maxDuration = 300

// ---------------------------------------------------------------------------
// Rate limit — the in-memory shape from app/api/admin/ai-chat/route.ts:11-23,
// with builder-config's constants (20 per 5 minutes) rather than the admin
// chatbot's. Per-instance, like its ancestor: this is a spend brake on one
// owner hammering the button, not a security control.
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, number[]>()

/**
 * Map size that triggers a sweep of fully-expired entries.
 *
 * The ancestor this shape was copied from never frees anything: an entry is
 * pruned only when the SAME user comes back, so one array per user id who has
 * ever pressed the button stays resident for the life of the instance. That is
 * a slow leak rather than a bug — the keys are admin/staff ids, not visitors —
 * but "bounded by how many people ever used it" is not bounded. 500 is chosen
 * to be far past any real admin roster, so the hot path stays one Map lookup
 * and the O(size) walk effectively never runs in production.
 */
const RATE_LIMIT_SWEEP_AT = 500

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  if (rateLimitMap.size > RATE_LIMIT_SWEEP_AT) {
    for (const [key, stamps] of rateLimitMap) {
      // `every` on an empty array is true, so a drained entry goes too. Only
      // entries with NOTHING left inside the window are dropped, which is
      // indistinguishable from never having existed.
      if (stamps.every((t) => now - t >= SECTION_BUILDER_RATE_LIMIT_WINDOW_MS)) rateLimitMap.delete(key)
    }
  }
  const timestamps = (rateLimitMap.get(userId) ?? []).filter(
    (t) => now - t < SECTION_BUILDER_RATE_LIMIT_WINDOW_MS,
  )
  if (timestamps.length >= SECTION_BUILDER_RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps)
    return false
  }
  timestamps.push(now)
  rateLimitMap.set(userId, timestamps)
  return true
}

// ---------------------------------------------------------------------------
// The seed document
//
// `sectionDocSchema` bounds `sections` at 1..24, so there is no such thing as
// an empty valid document — and `applyOps` takes a `SectionDoc`, not
// `SectionDoc | null`. A first draft therefore needs something to apply ops
// TO. This is that something: the cheapest section the registry can express
// (a footer needs only a name, and its `lines`/`links` may both be empty), so
// it drags in no CTA, no catalogue reference and no copy the model might
// imitate.
//
// IT MUST NEVER SURVIVE THE TURN, and that is checked on the OUTPUT rather
// than asserted about the input. `set_page` replaces every section and is what
// Block C tells the model to send when there is no page yet — but a model that
// answers with `add_section` instead would leave this placeholder sitting at
// the bottom of the owner's brand-new page, valid, compiling clean, and
// visible. `seedSurvived()` below turns that into a semantic error that feeds
// the same one-shot retry as an `applyOps` failure, which is the only place a
// correction can actually reach the model.
// ---------------------------------------------------------------------------

const SEED_SECTION_ID = "draft-placeholder"

function seedDoc(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: SEED_SECTION_ID,
        kind: "footer",
        variant: "simple",
        style: {},
        props: { businessName: "New page", lines: [], links: [] },
      },
    ],
  }
}

function seedSurvived(doc: SectionDoc): boolean {
  return doc.sections.some((section) => section.id === SEED_SECTION_ID)
}

const EMPTY_CATALOGUE: Catalogue = { program: [], session_pack: [], event: [] }

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface CompileSummary {
  ok: boolean
  /** Anything that blocks publishing: size caps, fatal compile errors. */
  problems: string[]
  /** Non-fatal: an element the sanitiser dropped. Should normally be empty. */
  warnings: string[]
}

interface TurnResponse {
  revision: number
  doc: SectionDoc | null
  reply: string
  blocked: boolean
  receipt: DiffReceipt | null
  compile: CompileSummary | null
  /**
   * NON-EMPTY MEANS PUBLISH IS BLOCKED — but an EMPTY array means that only
   * when `resolutionError` is null. See `resolutionError`.
   */
  unresolved: UnresolvedCta[]
  /**
   * CTAs pointing at `#something` that names no section in this document.
   *
   * NOT IN THE STAGE BRIEF'S RETURN SHAPE, AND ADDED DELIBERATELY: Stage 1.9's
   * own brief requires these on screen ("warns but does NOT block ... must be
   * visible in the receipt but must never hold a campaign page hostage") and
   * forbids that stage from editing anything under `app/api/`. `resolveDoc`
   * computes them on the same walk that produces `unresolved`, and nothing
   * else in the pipeline can see them — a dead in-page anchor compiles to
   * `ok: true, warnings: []` because `<a href="#nope">` is valid markup. Left
   * out, they would be unreachable by the only stage that needs them.
   */
  danglingAnchors: DanglingAnchor[]
  /**
   * Set when the catalogue could not be read or `resolveDoc` threw, so CTA
   * refs were NOT checked this turn. `unresolved: []` alongside a non-null
   * value here means "not checked", never "all clear" — the publish route
   * re-resolves against a live catalogue and is the actual gate.
   */
  resolutionError: string | null
  /** Which path produced this revision. Mirrors `funnel_step_turns.source`. */
  source: "ai" | "revert"
}

/**
 * `reassemble` -> `compileFunnelStep`, the same pair the publish route runs,
 * flattened into strings for the chat.
 *
 * `reassemble` re-parses the document and THROWS on a bad one. It cannot
 * legitimately throw here (`applyOps` validated its own output), but a throw
 * escaping this function would be a 500 on a turn whose document is already
 * safely computed — so it is caught and reported as a compile problem, which
 * is exactly what an owner needs to see either way.
 */
function compileDoc(doc: SectionDoc, funnelBasePath: string | undefined): CompileSummary {
  try {
    const { html, css, problems } = reassemble(doc, funnelBasePath ? { funnelBasePath } : {})
    const compiled = compileFunnelStep({ html, css })
    if (!compiled.ok) {
      return {
        ok: false,
        problems: [...problems.map((p) => p.message), ...compiled.errors.map((e) => e.message)],
        warnings: [],
      }
    }
    return {
      ok: problems.length === 0,
      problems: problems.map((p) => p.message),
      warnings: compiled.warnings.map((w) => w.message),
    }
  } catch (error) {
    return {
      ok: false,
      problems: [`This page could not be rendered: ${(error as Error).message}`],
      warnings: [],
    }
  }
}

function compileStatus(compile: CompileSummary): "ok" | "warnings" | "failed" {
  if (!compile.ok) return "failed"
  return compile.warnings.length > 0 ? "warnings" : "ok"
}

// ---------------------------------------------------------------------------
// (d) Everything that can throw, wrapped once, in one place.
// ---------------------------------------------------------------------------

/**
 * `loadCatalogues` throws on a truncated recognition read (>= 1000 rows) — and
 * unlike the publish-time truncation it replaced, an unhandled throw here takes
 * down EVERY builder turn on EVERY page, not one page's publish. So the turn
 * proceeds without a catalogue: Block B advertises nothing, resolution is
 * skipped, and the reason is reported back verbatim.
 */
async function loadCataloguesSafely(): Promise<{ catalogues: Catalogues | null; error: string | null }> {
  try {
    return { catalogues: await loadCatalogues(), error: null }
  } catch (error) {
    console.error("[funnels/build] catalogue load failed — continuing without it:", error)
    return { catalogues: null, error: (error as Error).message }
  }
}

interface Resolution {
  doc: SectionDoc
  unresolved: UnresolvedCta[]
  danglingAnchors: DanglingAnchor[]
  error: string | null
}

/**
 * `resolveDoc` carries an explicit MUST-WRAP note: it throws rather than
 * reporting a clean `unresolved: []` over a corrupt document, because a clean
 * empty list would WRONGLY UNBLOCK PUBLISH. Honouring that here means catching
 * it and saying so, not swallowing it into an empty list.
 */
function resolveSafely(doc: SectionDoc, catalogues: Catalogues | null, catalogueError: string | null): Resolution {
  if (!catalogues) {
    return {
      doc,
      unresolved: [],
      danglingAnchors: [],
      error: `CTA links were not checked this turn: the catalogue could not be read (${catalogueError ?? "unknown error"}).`,
    }
  }
  try {
    const result = resolveDoc(doc, catalogues)
    return {
      doc: result.doc,
      unresolved: result.unresolved,
      danglingAnchors: result.danglingAnchors,
      error: null,
    }
  } catch (error) {
    console.error("[funnels/build] resolveDoc threw — continuing without resolution:", error)
    return {
      doc,
      unresolved: [],
      danglingAnchors: [],
      error: `CTA links were not checked this turn: ${(error as Error).message}`,
    }
  }
}

/**
 * What goes in `funnel_step_turns.unresolved`.
 *
 * The column is `unknown` (jsonb) and `appendTurn` defaults it to `[]`, so a
 * turn whose CTA refs were NEVER CHECKED would otherwise persist exactly what a
 * turn with a clean bill of health persists. `TurnResponse.resolutionError`
 * makes that distinction in the response and does not outlive the request — so
 * the stored column would be the same lie this file's header calls out in
 * `revertToRevision`'s display cache, recreated one layer down, and live the
 * moment anything derives "publishable" from it.
 *
 * A turn that could not check therefore stores a MARKER OBJECT rather than a
 * list. `Array.isArray(row.unresolved)` is the reader's test, the reason
 * travels with it, and nothing can mistake it for "all clear".
 */
function unresolvedForStorage(resolution: Resolution): unknown {
  if (resolution.error === null) return resolution.unresolved
  return { checked: false, reason: resolution.error }
}

// ---------------------------------------------------------------------------
// Page context for the prompt and the renderer
// ---------------------------------------------------------------------------

interface PageContext {
  /** "/go/<funnel-slug>" — render.ts degrades `step` CTAs when absent. */
  funnelBasePath: string | undefined
  /** Sibling step slugs, for `{kind:"step"}` CTAs. Never includes this step. */
  stepSlugs: string[]
  faqPageKeys: string[]
}

async function loadPageContext(funnelId: string, thisStepSlug: string): Promise<PageContext> {
  // Degrades rather than throws: none of this is correctness-critical (a
  // missing base path makes a step CTA a disabled placeholder, a missing slug
  // list just means the model is not offered step targets), and a 500 on a
  // failed FAQ count would be an absurd way to lose a page edit.
  try {
    const [funnel, steps, faqCounts] = await Promise.all([
      getFunnelById(funnelId),
      listSteps(funnelId),
      getFaqCountsByPage(),
    ])
    return {
      funnelBasePath: funnel ? `/go/${funnel.slug}` : undefined,
      stepSlugs: steps.map((s) => s.slug).filter((slug) => slug !== thisStepSlug),
      faqPageKeys: Object.keys(faqCounts).sort(),
    }
  } catch (error) {
    console.error("[funnels/build] page context load failed — continuing degraded:", error)
    return { funnelBasePath: undefined, stepSlugs: [], faqPageKeys: [] }
  }
}

/**
 * The transcript as PROSE, oldest first. `listTurns` returns full documents on
 * every row; only `role` and `message` are used here, and `buildTurnMessage`
 * trims to the last `SECTION_BUILDER_HISTORY_TURNS` itself.
 */
function toHistory(turns: Awaited<ReturnType<typeof listTurns>>): BuilderTurn[] {
  return turns
    .filter((turn) => typeof turn.message === "string" && turn.message.trim() !== "")
    .map((turn) => ({ role: turn.role === "user" ? ("owner" as const) : ("builder" as const), text: turn.message }))
}

async function loadHistorySafely(stepId: string): Promise<BuilderTurn[]> {
  try {
    return toHistory(await listTurns(stepId))
  } catch (error) {
    console.error("[funnels/build] transcript read failed — continuing without history:", error)
    return []
  }
}

// ---------------------------------------------------------------------------
// The graceful-failure reply (e). Shape copied from
// app/api/admin/bookkeeping/insights/narrative/route.ts:149-160: the AI leg
// fails, the request still returns 200, and the page keeps what it had.
// ---------------------------------------------------------------------------

const BUILD_FAILED_REPLY = "I couldn't build that — try describing it differently."

export const POST = withAudit(
  {
    action: "funnel.ai_turn",
    category: "admin_write",
    // One audit row per request whatever branch ran; `mode` says which, read
    // off the response rather than the request (the handler has already
    // consumed the request body by the time this runs, and a consumed body
    // cannot be cloned).
    metadata: async (_request, response) => {
      try {
        const body = (await response.json()) as Partial<TurnResponse>
        return {
          mode: body.source ?? "unknown",
          revision: body.revision ?? null,
          blocked: body.blocked ?? null,
        }
      } catch {
        return {}
      }
    },
  },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const userId = session.user.id
    const { stepId } = await ctx.params

    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: "Too many page-builder requests. Give it a minute and try again." },
        { status: 429 },
      )
    }

    const body = await request.json().catch(() => null)
    const parsed = buildRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 })
    }

    try {
      const [draft, step] = await Promise.all([getDraft(stepId), getStep(stepId)])
      if (!draft || !step) return NextResponse.json({ error: "Not found" }, { status: 404 })

      if (parsed.data.action === "reset") {
        return await handleReset(stepId, step.funnel_id, step.slug, parsed.data.toRevision, userId)
      }

      return await handleBuild({
        stepId,
        funnelId: step.funnel_id,
        stepSlug: step.slug,
        draft,
        message: parsed.data.message,
        expectedRevision: parsed.data.revision,
        userId,
      })
    } catch (error) {
      console.error("[POST /api/admin/funnels/steps/:stepId/build]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)

// ---------------------------------------------------------------------------
// (c) The reset path — the way back out of a document no op can repair.
// ---------------------------------------------------------------------------

async function handleReset(
  stepId: string,
  funnelId: string,
  stepSlug: string,
  toRevision: number,
  userId: string,
): Promise<Response> {
  const result = await revertToRevision({ stepId, toRevision, createdBy: userId })
  if (!result.ok) {
    if (result.reason === "stale_revision") {
      return NextResponse.json(
        {
          error: "Someone else changed this page while you were working on it. Reload and try again.",
          code: "stale_revision",
          currentRevision: result.currentRevision,
        },
        { status: 409 },
      )
    }
    if (result.reason === "revision_has_no_doc") {
      return NextResponse.json(
        { error: `Step ${toRevision} has no saved page to restore.`, code: "revision_has_no_doc" },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: "Not found", code: result.reason }, { status: 404 })
  }

  const restored = result.turn.doc as SectionDoc
  const context = await loadPageContext(funnelId, stepSlug)

  // RE-RESOLVED, not read off the restored turn row. `revertToRevision` copies
  // that turn's `unresolved` forward as a display cache computed against the
  // catalogue AS IT WAS then — its own comment calls that out and says the
  // route must re-resolve. A program deleted since would otherwise have the
  // chat tell the owner a page is publishable when it is not.
  const { catalogues, error: catalogueError } = await loadCataloguesSafely()
  const resolution = resolveSafely(restored, catalogues, catalogueError)
  const compile = compileDoc(resolution.doc, context.funnelBasePath)

  const response: TurnResponse = {
    revision: result.revision,
    doc: resolution.doc,
    reply: result.turn.message,
    blocked: false,
    receipt: null,
    compile,
    unresolved: resolution.unresolved,
    danglingAnchors: resolution.danglingAnchors,
    resolutionError: resolution.error,
    source: "revert",
  }
  return NextResponse.json(response)
}

// ---------------------------------------------------------------------------
// The build path
// ---------------------------------------------------------------------------

interface BuildArgs {
  stepId: string
  funnelId: string
  stepSlug: string
  draft: NonNullable<Awaited<ReturnType<typeof getDraft>>>
  message: string
  expectedRevision: number
  userId: string
}

/**
 * The newest revision whose stored document still satisfies `sectionDocSchema`
 * — what `action: "reset"` should be pointed at. Null when the transcript
 * holds nothing restorable, which is the honest answer for a step whose only
 * document was always the invalid one.
 */
async function lastGoodRevision(stepId: string): Promise<number | null> {
  try {
    const turns = await listTurns(stepId)
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i]
      if (turn.doc === null || turn.doc === undefined) continue
      if (sectionDocSchema.safeParse(turn.doc).success) return turn.revision
    }
    return null
  } catch (error) {
    console.error("[funnels/build] could not scan for a restorable revision:", error)
    return null
  }
}

async function handleBuild(args: BuildArgs): Promise<Response> {
  const { stepId, funnelId, stepSlug, draft, message, expectedRevision, userId } = args

  // (b) REFUSE, NEVER OVERWRITE. `project_data` holds something that is not a
  // `SectionDoc`: legacy GrapesJS state, corruption, or a document the
  // registry has since tightened past. Treating that as "no page yet" and
  // starting a fresh document would destroy the owner's existing page — which
  // is exactly why `getDraft` reports this as its own flag instead of
  // collapsing it into `doc: null`.
  //
  // It is also (c). `getDraft` and `applyOps` parse with the SAME schema, so a
  // document with a malformed SECTION — the one no op can repair, because the
  // rejection happens before any op is inspected — arrives here as
  // `docInvalid` too. One branch, one refusal, one way back.
  if (draft.docInvalid) {
    const resetToRevision = await lastGoodRevision(stepId)
    return NextResponse.json(
      {
        error:
          "This page's saved content is not a document this builder can read — it is either from the old " +
          "drag-and-drop editor or it has been corrupted. Nothing has been changed. " +
          (resetToRevision === null
            ? "There is no earlier version to restore, so this page has to be started over deliberately."
            : `Restore step ${resetToRevision} to carry on from the last version that still opens.`),
        code: "doc_invalid",
        currentRevision: draft.revision,
        resetToRevision,
      },
      { status: 422 },
    )
  }

  // The fast half of the optimistic lock. The real guarantee is the
  // compare-and-swap inside `appendTurn` below — this check just saves a model
  // call when the client is visibly behind.
  if (expectedRevision !== draft.revision) {
    return NextResponse.json(
      {
        error: "Someone else changed this page while you were working on it. Reload and try again.",
        code: "stale_revision",
        currentRevision: draft.revision,
      },
      { status: 409 },
    )
  }

  const isFirstDraft = draft.doc === null
  const baseDoc = draft.doc ?? seedDoc()

  const [context, history, catalogueLoad] = await Promise.all([
    loadPageContext(funnelId, stepSlug),
    loadHistorySafely(stepId),
    loadCataloguesSafely(),
  ])
  const { catalogues, error: catalogueError } = catalogueLoad

  // Record what the owner asked for BEFORE spending anything, so the
  // transcript is honest even about turns that then failed — and so this
  // request's write-side lock check happens before the model call rather than
  // after it. A `stale_revision` here is a 409 and nothing has been spent.
  const userTurn = await appendTurn({
    stepId,
    expectedRevision,
    role: "user",
    source: "ai",
    status: "complete",
    message,
    createdBy: userId,
  })
  if (!userTurn.ok) {
    if (userTurn.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(
      {
        error: "Someone else changed this page while you were working on it. Reload and try again.",
        code: "stale_revision",
        currentRevision: userTurn.currentRevision,
      },
      { status: 409 },
    )
  }
  const revisionAfterUserTurn = userTurn.revision

  const systemPrompt = buildSystemPrompt({
    // Block B advertises the OFFER set — the rows a NEW commitment may be made
    // to. Matching resolve.ts's rules 2-3, which search the same list, is what
    // keeps the menu and the door in agreement.
    catalogue: catalogues?.offer ?? EMPTY_CATALOGUE,
    faqPageKeys: context.faqPageKeys,
    stepSlugs: context.stepSlugs,
  })
  const baseTurnMessage = buildTurnMessage({ doc: draft.doc, history, message })

  const startTime = Date.now()
  let logId: string | null = null
  try {
    const log = await createGenerationLog({
      program_id: null,
      client_id: null,
      requested_by: userId,
      status: "pending",
      input_params: { feature: "funnel_page_build", step_id: stepId, first_draft: isFirstDraft },
      output_summary: null,
      error_message: null,
      model_used: SECTION_BUILDER_MODEL,
      tokens_used: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: 1,
      // NO `generation_trigger`, NO `assessment_result_id`: types/database.ts
      // declares them but the live table has no such columns, and PostgREST
      // rejects the ENTIRE insert (PGRST204) on one unknown key. The feature
      // marker lives losslessly in `input_params.feature`, like every caller
      // that demonstrably works in production.
    })
    logId = log.id
  } catch (error) {
    // Spend logging is a ledger, not a gate. Losing the row is worth reporting
    // and not worth failing an owner's page edit over.
    console.error("[funnels/build] could not open a generation log:", error)
  }

  // -------------------------------------------------------------------------
  // (a) ONE RETRY, AND SEMANTIC ERRORS FEED IT TOO.
  //
  // The plan's retry row says "retry with the Zod error appended". An
  // `applyOps` failure — "no section with id x", "a section with id y already
  // exists", "an update_section op must carry props, style or variant" — is
  // NOT a Zod error: `buildResultSchema` accepted the response, `opSchema`
  // accepted every op, and the batch still cannot be applied to THIS document.
  // A route that retried only on a parse failure would turn every one of those
  // into a user-visible dead end, so both classes take the same path: append
  // the errors to Block C verbatim and ask once more.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // ONE WHOLE-PAGE BUDGET, NOT TWO — AND EXPLICITLY NOT
  // `SECTION_BUILDER_SECTION_MAX_TOKENS` (6000).
  //
  // That 6000 was sized in the plan as a PER-SECTION budget, for a design that
  // fanned a first draft out into one call per section. This route makes ONE
  // call per turn (see the header note and the stage report: fan-out was
  // deliberately not built), so the same number would now have to cover the
  // ENTIRE first-draft page — and builder-config's own reasoning for the 8000
  // edit budget is that a `set_page` carrying all 24 sections is the worst
  // realistic response. A first draft IS that response: Block C tells the model
  // to answer a blank page with a single `set_page`, and `seedSurvived()` below
  // rejects it if it does anything else. Under 6000 the model runs out of
  // output mid-JSON, `generateObject` throws a parse error, the one retry does
  // exactly the same thing, and the owner's very first turn on a brand-new page
  // dead-ends.
  //
  // So both paths take the same page-sized budget. If the fan-out is ever
  // built, the per-section number comes back WITH it, not before.
  // -------------------------------------------------------------------------
  const maxTokens = SECTION_BUILDER_EDIT_MAX_TOKENS

  let tokensUsed = 0
  let cacheCreation = 0
  let cacheRead = 0
  let lastErrors: string[] = []
  let outcome:
    | { kind: "applied"; reply: string; ops: unknown; doc: SectionDoc; receipt: DiffReceipt }
    | { kind: "blocked"; reply: string; ops: unknown }
    | null = null

  for (let attempt = 0; attempt < 2 && outcome === null; attempt++) {
    const turnMessage =
      attempt === 0
        ? baseTurnMessage
        : `${baseTurnMessage}\n\n## Your previous answer was rejected\n\n${lastErrors
            .map((line) => `- ${line}`)
            .join("\n")}\n\nFix these and answer again. Send only ops that apply to the document above.`

    let content
    try {
      const result = await callAgent(systemPrompt, turnMessage, buildResultSchema, {
        model: SECTION_BUILDER_MODEL,
        maxTokens,
        cacheSystemPrompt: true,
      })
      content = result.content
      // `+=` across attempts, never `=`: a retry that succeeds still cost the
      // tokens the rejected attempt burned, and a spend log that reports only
      // the winning call understates every retried turn.
      tokensUsed += result.tokens_used ?? 0
      cacheCreation += result.cache_creation_tokens ?? 0
      cacheRead += result.cache_read_tokens ?? 0
    } catch (error) {
      // A model refusal (`stop_reason: "refusal"`) surfaces through
      // `generateObject` as a parse failure, and so does a truncated or
      // schema-violating response. Same treatment as a Zod error, because at
      // this layer that is what it is.
      lastErrors = [(error as Error).message]
      continue
    }

    if (content.blocked) {
      // The model declined. That is an answer, not a failure — do not retry it,
      // do not apply whatever ops came with it.
      outcome = { kind: "blocked", reply: content.reply, ops: content.ops }
      break
    }

    const applied = applyOps(baseDoc, content.ops)
    if (!applied.ok) {
      lastErrors = applied.errors
      continue
    }

    if (isFirstDraft && seedSurvived(applied.doc)) {
      lastErrors = [
        `There is no page yet, so the whole page must come from a single "set_page" op. Your ops left the ` +
          `empty placeholder section "${SEED_SECTION_ID}" on the page. Send one set_page op carrying every ` +
          `section this page should have.`,
      ]
      continue
    }

    outcome = { kind: "applied", reply: content.reply, ops: content.ops, doc: applied.doc, receipt: applied.receipt }
  }

  // -------------------------------------------------------------------------
  // (e) Both attempts failed. 200, an honest reply, the draft untouched, and a
  // `status: "failed"` turn so the transcript says what happened. NEVER a 500.
  // -------------------------------------------------------------------------
  if (outcome === null) {
    const errorMessage = lastErrors.join(" | ") || "Unknown error"
    console.error("[funnels/build] both attempts failed:", errorMessage)
    if (logId) {
      await updateGenerationLog(logId, {
        status: "failed",
        error_message: errorMessage,
        tokens_used: tokensUsed,
        cache_creation_tokens: cacheCreation,
        cache_read_tokens: cacheRead,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      }).catch(() => {})
    }

    const failedTurn = await appendTurn({
      stepId,
      expectedRevision: revisionAfterUserTurn,
      role: "assistant",
      source: "ai",
      status: "failed",
      message: BUILD_FAILED_REPLY,
      model: SECTION_BUILDER_MODEL,
      tokensInput: tokensUsed,
      latencyMs: Date.now() - startTime,
      errorMessage,
      createdBy: userId,
    })
    const response: TurnResponse = {
      revision: failedTurn.ok ? failedTurn.revision : revisionAfterUserTurn,
      doc: draft.doc,
      reply: BUILD_FAILED_REPLY,
      blocked: false,
      receipt: null,
      compile: null,
      unresolved: [],
      danglingAnchors: [],
      resolutionError: null,
      source: "ai",
    }
    return NextResponse.json(response)
  }

  // -------------------------------------------------------------------------
  // The model declined. The draft is left exactly as it was — `appendTurn`
  // with no `doc` moves the revision without touching `project_data`.
  // -------------------------------------------------------------------------
  if (outcome.kind === "blocked") {
    if (logId) {
      await updateGenerationLog(logId, {
        status: "completed",
        output_summary: { blocked: true, ops: 0 },
        tokens_used: tokensUsed,
        cache_creation_tokens: cacheCreation,
        cache_read_tokens: cacheRead,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      }).catch(() => {})
    }

    const blockedTurn = await appendTurn({
      stepId,
      expectedRevision: revisionAfterUserTurn,
      role: "assistant",
      source: "ai",
      status: "complete",
      message: outcome.reply,
      ops: outcome.ops,
      model: SECTION_BUILDER_MODEL,
      tokensInput: tokensUsed,
      tokensOutput: null,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      latencyMs: Date.now() - startTime,
      blocked: true,
      createdBy: userId,
    })
    if (!blockedTurn.ok) return staleOrNotFound(blockedTurn)

    const response: TurnResponse = {
      revision: blockedTurn.revision,
      doc: draft.doc,
      reply: outcome.reply,
      blocked: true,
      receipt: null,
      compile: null,
      unresolved: [],
      danglingAnchors: [],
      resolutionError: null,
      source: "ai",
    }
    return NextResponse.json(response)
  }

  // -------------------------------------------------------------------------
  // Resolve -> compile -> write. See the header note on why resolution runs
  // BEFORE the compile and why the RESOLVED document is what gets stored.
  // -------------------------------------------------------------------------
  const resolution = resolveSafely(outcome.doc, catalogues, catalogueError)
  const compile = compileDoc(resolution.doc, context.funnelBasePath)

  if (logId) {
    await updateGenerationLog(logId, {
      status: "completed",
      output_summary: {
        sections: resolution.doc.sections.length,
        changed: outcome.receipt.changed.length,
        is_rewrite: outcome.receipt.isRewrite,
        compile_ok: compile.ok,
        unresolved: resolution.unresolved.length,
      },
      tokens_used: tokensUsed,
      cache_creation_tokens: cacheCreation,
      cache_read_tokens: cacheRead,
      duration_ms: Date.now() - startTime,
      completed_at: new Date().toISOString(),
    }).catch(() => {})
  }

  // A page that does not compile is still SAVED. This is a draft, not a
  // publish: the publish route is the gate, and refusing to save would leave
  // the owner with no way to iterate towards a page that does compile.
  const assistantTurn = await appendTurn({
    stepId,
    expectedRevision: revisionAfterUserTurn,
    role: "assistant",
    source: "ai",
    status: "complete",
    message: outcome.reply,
    ops: outcome.ops,
    doc: resolution.doc,
    compileStatus: compileStatus(compile),
    // An OBJECT, not the bare array the column's default suggests: problems
    // and warnings are different severities and flattening them into one list
    // would make the log unable to say which was which.
    compileProblems: { problems: compile.problems, warnings: compile.warnings },
    // Not `resolution.unresolved`: see `unresolvedForStorage`. An empty list
    // and "could not check" must not look the same in the row.
    unresolved: unresolvedForStorage(resolution),
    model: SECTION_BUILDER_MODEL,
    tokensInput: tokensUsed,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    latencyMs: Date.now() - startTime,
    createdBy: userId,
  })
  if (!assistantTurn.ok) return staleOrNotFound(assistantTurn)

  const response: TurnResponse = {
    revision: assistantTurn.revision,
    doc: resolution.doc,
    reply: outcome.reply,
    blocked: false,
    receipt: outcome.receipt,
    compile,
    unresolved: resolution.unresolved,
    danglingAnchors: resolution.danglingAnchors,
    resolutionError: resolution.error,
    source: "ai",
  }
  return NextResponse.json(response)
}

/** (e) `appendTurn`'s two failure results, as HTTP. */
function staleOrNotFound(
  result: { ok: false; reason: "stale_revision"; currentRevision: number } | { ok: false; reason: "not_found" },
): Response {
  if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(
    {
      error: "Someone else changed this page while you were working on it. Reload and try again.",
      code: "stale_revision",
      currentRevision: result.currentRevision,
    },
    { status: 409 },
  )
}
