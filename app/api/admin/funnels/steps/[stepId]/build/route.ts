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
//
// ---------------------------------------------------------------------------
// THE BUILD PATH STREAMS. THE RESET PATH DOES NOT.
// ---------------------------------------------------------------------------
// A build turn is ~30 seconds and used to be a single blocking JSON response,
// so the only thing the UI could show for the whole call was a spinner. It now
// returns `text/event-stream`: the model call reads through
// `streamOneAttempt`, which reports each section as the model writes it, and
// the turn ends with a `result` event carrying THE EXACT SAME `TurnResponse`
// OBJECT the route used to return.
//
// That last part is what keeps this a transport change and not a contract
// change. Every rule the client applies to a turn — `compile === null` moves
// nothing but the revision, `resolutionError !== null` must not overwrite
// `unresolved` — is handed the same object it was handed before.
//
// `reset` copies a stored document forward without calling a model, so it has
// nothing to stream and stays plain JSON. The client tells them apart by
// `Content-Type`, not by which button was pressed.
//
// See `streamingResponse` for which failures stay real HTTP statuses (all the
// ones that can happen before the first byte) and which ride out as a `fail`
// event (the ones that cannot).
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { buildRequestSchema } from "@/lib/validators/funnel"
import { streamAgent } from "@/lib/ai/anthropic"
import {
  BUILD_STREAM_HEARTBEAT,
  encodeBuildStreamEvent,
  type BuildStreamEvent,
} from "@/lib/funnels/sections/build-stream"
import { changedSections, collectStreamedSections, type StreamedSection } from "@/lib/funnels/sections/stream-progress"
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
  type BuildResult,
} from "@/lib/funnels/sections/prompt"
import {
  loadCatalogues,
  resolveDoc,
  type BrokenStepLink,
  type Catalogue,
  type Catalogues,
  type DanglingAnchor,
  type FunnelStepRef,
  type UnresolvedCta,
} from "@/lib/funnels/sections/resolve"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import { opsRewrotePage, reviewDoc, shouldReview } from "@/lib/funnels/sections/review/pipeline"
import {
  SECTION_BUILDER_EDIT_MAX_TOKENS,
  SECTION_BUILDER_MODEL,
  SECTION_BUILDER_RATE_LIMIT_MAX,
  SECTION_BUILDER_RATE_LIMIT_WINDOW_MS,
} from "@/lib/funnels/sections/builder-config"

/**
 * A first draft is a whole page in one response and an iterative turn can be a
 * 24-section `set_page` rewrite. 300s is the ceiling; the model budgets below
 * are what actually bound a call.
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
  const timestamps = (rateLimitMap.get(userId) ?? []).filter((t) => now - t < SECTION_BUILDER_RATE_LIMIT_WINDOW_MS)
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
   * value here means "not checked", never "all clear".
   *
   * The actual gate is `gateSectionDoc` in
   * `app/api/admin/funnels/steps/[stepId]/publish/route.ts`, which re-resolves
   * against a live catalogue before it writes a version row. That sentence was
   * here before the function was — for three stages this field's own doc
   * comment (and two other files) pointed at a publish route that compiled and
   * wrote with no gate in it, so a turn that could not check its links led to a
   * page that nothing ever checked. Note also the OPPOSITE decision on the two
   * sides: this route degrades when the catalogue is unreadable (it runs on
   * every turn; throwing would stop all editing), the publish route REFUSES
   * (one deliberate click; publishing unchecked is what the gate exists to
   * prevent). Both are documented at their own site.
   */
  resolutionError: string | null
  /**
   * Which path produced this revision. Mirrors `funnel_step_turns.source`.
   *
   * `review` is the AI review stage. It is a distinct value rather than
   * another `ai` because the client renders it differently and because "Go
   * back to here" has to be able to undo a polish without also discarding the
   * draft it polished.
   */
  source: "ai" | "revert" | "review"
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
  brokenStepLinks: BrokenStepLink[]
  error: string | null
}

/**
 * `resolveDoc` carries an explicit MUST-WRAP note: it throws rather than
 * reporting a clean `unresolved: []` over a corrupt document, because a clean
 * empty list would WRONGLY UNBLOCK PUBLISH. Honouring that here means catching
 * it and saying so, not swallowing it into an empty list.
 */
function resolveSafely(
  doc: SectionDoc,
  catalogues: Catalogues | null,
  catalogueError: string | null,
  pages: FunnelStepRef[] | null,
): Resolution {
  if (!catalogues) {
    return {
      doc,
      unresolved: [],
      danglingAnchors: [],
      brokenStepLinks: [],
      error: `CTA links were not checked this turn: the catalogue could not be read (${catalogueError ?? "unknown error"}).`,
    }
  }
  try {
    // `pages` may legitimately be `null` here — this route degrades rather
    // than throwing, because `loadCatalogues` runs on EVERY builder turn and
    // a throw would take down all editing. `null` means step links go
    // unchecked for this turn; the publish route re-checks and fails closed.
    const result = resolveDoc(doc, catalogues, pages)
    return {
      doc: result.doc,
      unresolved: result.unresolved,
      danglingAnchors: result.danglingAnchors,
      brokenStepLinks: result.brokenStepLinks,
      error: null,
    }
  } catch (error) {
    console.error("[funnels/build] resolveDoc threw — continuing without resolution:", error)
    return {
      doc,
      unresolved: [],
      danglingAnchors: [],
      brokenStepLinks: [],
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
  /**
   * Sibling step slugs, for the PROMPT. Never includes this step, so the model
   * is not offered a link from a page to itself.
   */
  stepSlugs: string[]
  /**
   * Every page of the funnel, for the VALIDATOR — and it DOES include this
   * step, because a "start over" button linking to its own page is legitimate
   * and must not be reported broken.
   *
   * `null` means the read failed, which `resolveDoc` reads as "not checked".
   * It must never degrade to `[]`: that would mean "this funnel has no pages"
   * and would brand every step link in the document broken on the strength of
   * one Supabase blip.
   */
  allPages: FunnelStepRef[] | null
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
      allPages: steps.map((s) => ({ slug: s.slug, name: s.name })),
      faqPageKeys: Object.keys(faqCounts).sort(),
    }
  } catch (error) {
    console.error("[funnels/build] page context load failed — continuing degraded:", error)
    // `allPages: null`, NOT `[]`. Everything else here degrades to "less
    // information"; an empty page list would degrade to a WRONG ANSWER —
    // every step link reported broken — and block a publish that is fine.
    return { funnelBasePath: undefined, stepSlugs: [], allPages: null, faqPageKeys: [] }
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

      if (parsed.data.action === "polish") {
        return await handlePolish({
          stepId,
          funnelId: step.funnel_id,
          stepSlug: step.slug,
          draft,
          expectedRevision: parsed.data.revision,
          userId,
        })
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
  const resolution = resolveSafely(restored, catalogues, catalogueError, context.allPages)
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

// ---------------------------------------------------------------------------
// SSE PLUMBING
//
// The build path streams; the reset path does not. That split is deliberate
// and the client branches on `Content-Type` rather than on which button was
// pressed: `reset` copies a stored document forward without calling a model,
// so it has nothing to stream and no reason to pay for the framing.
//
// WHAT STAYS A REAL HTTP STATUS. Everything that can fail BEFORE the model is
// reached — auth, permission, rate limit, unknown step, `stale_revision`,
// `doc_invalid` — keeps its status code and JSON body byte for byte, because
// those codes are load-bearing in the client (`handleErrorResponse` branches
// on 409 to resync the revision and on 422 to offer the restore button) and
// because a pre-flight failure has, by construction, nothing to stream.
//
// Once the first byte is written the status is 200 forever, so the failures
// that can still happen after that point — `appendTurn` losing the
// compare-and-swap on the assistant turn — ride out as a `fail` event carrying
// the status and body they would have had. The client hands that straight to
// the same `handleErrorResponse`. One decision, one place.
// ---------------------------------------------------------------------------

/** How often to send an SSE comment so proxies don't drop an idle stream. */
const HEARTBEAT_MS = 15_000

// ---------------------------------------------------------------------------
// THE WORK MUST NOT BE AWAITED INSIDE `start()`.
// ---------------------------------------------------------------------------
// This used to be `new ReadableStream({ async start(controller) { await run() } })`,
// which reads perfectly and delivers NOTHING until the turn is over. A stream
// whose `start` returns a promise is not considered started until that promise
// settles, so the whole point of the format — watching the page get written —
// was lost behind a single flush at the end.
//
// AND IT LOOKS EXACTLY LIKE A HANG RATHER THAN A BUG, which is why it survived:
// `INITIAL_STREAM.phase` on the client is `"reading"`, set locally before any
// event arrives. So a stream that delivers no events shows "Reading your brief"
// with a spinner for the entire turn and then jumps straight to the finished
// page. Every phase after the first is emitted correctly by the code below and
// none of them was ever seen. The owner's report was "it's stuck on the first
// step and never goes to the others", which is precisely this.
//
// A `TransformStream` writer, written to by a function nobody awaits, is the
// shape that actually flushes: the Response is constructed around `readable`
// and returned immediately, while the turn goes on filling `writable`.
// ---------------------------------------------------------------------------
function streamingResponse(run: (emit: (event: BuildStreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  void (async () => {
    {
      let closed = false

      const write = (payload: string) => {
        if (closed) return
        try {
          void writer.write(encoder.encode(payload))
        } catch {
          // The consumer went away — a closed tab, a navigation, a dropped
          // connection. THE TURN KEEPS RUNNING ON PURPOSE. The owner's message
          // is already in the transcript (it is written before anything is
          // spent), so abandoning the turn here would leave a question with no
          // answer next to it and a model call paid for and thrown away.
          // Everything downstream still writes; only the reporting stops.
          closed = true
        }
      }

      const heartbeat = setInterval(() => write(BUILD_STREAM_HEARTBEAT), HEARTBEAT_MS)

      try {
        await run((event) => write(encodeBuildStreamEvent(event)))
      } catch (error) {
        // Nothing below may 500 — and once the stream is open, nothing CAN:
        // the status was decided at the first byte. An unexpected throw is
        // reported as the 500 it would have been.
        console.error("[funnels/build] stream failed:", error)
        write(
          encodeBuildStreamEvent({
            type: "fail",
            status: 500,
            body: { error: "Something went wrong. Nothing was changed." },
          }),
        )
      } finally {
        clearInterval(heartbeat)
        closed = true
        try {
          await writer.close()
        } catch {
          // Already closed by the consumer disconnecting.
        }
      }
    }
  })()

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform` matters as much as `no-cache`: a proxy that "optimises"
      // the body would re-chunk the frames this format depends on.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx-family proxies buffer proxied responses by default, which turns
      // a 30-second stream into a 30-second wait followed by everything at
      // once — the exact failure this whole change exists to remove.
      "X-Accel-Buffering": "no",
    },
  })
}

// ---------------------------------------------------------------------------
// (c2) The Polish path — a review with no build in front of it.
//
// Its own action rather than a flag on a message body, and that is the
// difference between one model call and five: a message body would run the
// builder first, spending an Opus call answering a message the owner never
// wrote, and would append a build turn saying nothing ahead of the review turn
// that says everything.
//
// It shares `handleBuild`'s two pre-flight refusals verbatim, because both
// reasons survive the change of action: a document this builder cannot read
// cannot be polished either, and a client that is behind would have its review
// turn rejected by the compare-and-swap anyway — better to say so before
// spending four model calls than after.
// ---------------------------------------------------------------------------

interface PolishArgs {
  stepId: string
  funnelId: string
  stepSlug: string
  draft: NonNullable<Awaited<ReturnType<typeof getDraft>>>
  expectedRevision: number
  userId: string
}

async function handlePolish(args: PolishArgs): Promise<Response> {
  const { stepId, funnelId, stepSlug, draft, expectedRevision, userId } = args
  const startTime = Date.now()

  if (draft.docInvalid) {
    const resetToRevision = await lastGoodRevision(stepId)
    return NextResponse.json(
      {
        error:
          "This page's saved content is not a document this builder can read, so there is nothing to polish. " +
          (resetToRevision === null
            ? "There is no earlier version to restore."
            : `Restore step ${resetToRevision} to carry on from the last version that still opens.`),
        code: "doc_invalid",
        currentRevision: draft.revision,
        resetToRevision,
      },
      { status: 422 },
    )
  }

  // Polish is a review of a page that EXISTS. There is no seed document here
  // and there must not be: reviewing a placeholder footer would spend four
  // model calls to discover that a one-section page is too short.
  if (draft.doc === null) {
    return NextResponse.json(
      { error: "There is no page to polish yet. Describe the page you want and the builder will draft it first." },
      { status: 409 },
    )
  }

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

  // THE KILL SWITCH APPLIES HERE TOO. `SECTION_REVIEW_MAX_ROUNDS = 0` turns the
  // review off, and a Polish press that still wrote "I found nothing worth
  // changing" and advanced the revision would be the switch reporting a review
  // it never ran. `shouldReview` owns that decision for both paths; the
  // automatic one already asks it.
  if (!shouldReview({ rewrotePage: false, requested: true })) {
    return NextResponse.json(
      { error: "Page review is switched off right now." },
      { status: 503 },
    )
  }

  const [context, catalogueLoad] = await Promise.all([loadPageContext(funnelId, stepSlug), loadCataloguesSafely()])
  const { catalogues, error: catalogueError } = catalogueLoad
  const doc = draft.doc

  // No user turn is appended. The owner did not write a message, and a
  // fabricated one ("Polish this page") in the transcript would be a sentence
  // they never typed sitting in their own conversation.
  return streamingResponse((emit) =>
    runReviewStage({
      emit,
      stepId,
      userId,
      doc,
      baseRevision: draft.revision,
      context,
      catalogues,
      standalone: true,
      catalogueError,
      startTime,
    }),
  )
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

  // Everything above this line can still be an ordinary HTTP failure with a
  // status the client branches on. Everything below it happens inside an open
  // 200 — see the SSE note above `streamingResponse`.
  return streamingResponse((emit) =>
    runTurn({
      emit,
      stepId,
      userId,
      draft,
      isFirstDraft,
      baseDoc,
      systemPrompt,
      baseTurnMessage,
      context,
      catalogues,
      catalogueError,
      revisionAfterUserTurn,
    }),
  )
}

/**
 * One model call, read as it is written.
 *
 * Returns the SAME validated object `callAgent` used to return, so everything
 * downstream — `applyOps`, `seedSurvived`, the blocked branch — is untouched
 * by the fact that it arrived in pieces. The streaming is reporting only; the
 * document is built from the final validated object exactly as before.
 *
 * ---------------------------------------------------------------------------
 * WHY `fullStream` AND NOT `partialObjectStream`.
 * ---------------------------------------------------------------------------
 * They are two views of one stream and only one consumer is allowed. The
 * partial view carries the objects but nothing else; the full view carries the
 * partial objects AND the text deltas (the live output meter) AND the finish
 * event with the provider's real token usage. Taking the partial view would
 * mean either no meter or a fabricated one.
 *
 * `.object` is awaited AFTER the iteration and rejects on a refusal, a
 * truncated response or a schema violation — the same three failures
 * `generateObject` used to throw, so the caller's existing catch still catches
 * exactly what it did before. Its handler is attached BEFORE the loop, because
 * a rejection with no handler yet attached is an unhandled rejection even when
 * the caller goes on to await it.
 */
async function streamOneAttempt(opts: {
  emit: (event: BuildStreamEvent) => void
  systemPrompt: string
  turnMessage: string
  maxTokens: number
  onUsage: (usage: { tokensUsed: number; cacheCreation: number; cacheRead: number }) => void
}): Promise<BuildResult> {
  const stream = streamAgent(opts.systemPrompt, opts.turnMessage, buildResultSchema, {
    model: SECTION_BUILDER_MODEL,
    maxTokens: opts.maxTokens,
    cacheSystemPrompt: true,
  })

  const objectPromise = stream.object
  // See the note above: claim the rejection now, await the value later.
  objectPromise.catch(() => {})

  let seen: StreamedSection[] = []
  let deltas = 0
  let lastMeterAt = 0
  let announcedWriting = false

  for await (const part of stream.fullStream) {
    if (part.type === "text-delta") {
      deltas += 1
      // Throttled: a 24-section page is thousands of deltas, and a frame per
      // delta would spend more bytes on the meter than on the page.
      const now = Date.now()
      if (now - lastMeterAt >= 250) {
        lastMeterAt = now
        opts.emit({ type: "usage", outputTokens: deltas, exact: false })
      }
      continue
    }

    if (part.type === "object") {
      const next = collectStreamedSections(part.object)
      if (!announcedWriting && next.length > 0) {
        opts.emit({ type: "phase", phase: "writing" })
        announcedWriting = true
      }
      for (const section of changedSections(seen, next)) {
        opts.emit({ type: "section", section })
      }
      seen = next
      continue
    }

    if (part.type === "finish") {
      const usage = part.usage
      opts.emit({ type: "usage", outputTokens: usage.outputTokens ?? deltas, exact: true })
      opts.onUsage({
        tokensUsed: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        cacheCreation: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
      })
    }
    // `type: "error"` needs no branch: the same failure comes back out of
    // `await objectPromise` below, where one catch already handles it.
  }

  return await objectPromise
}

interface TurnRunArgs {
  emit: (event: BuildStreamEvent) => void
  stepId: string
  userId: string
  draft: NonNullable<Awaited<ReturnType<typeof getDraft>>>
  isFirstDraft: boolean
  baseDoc: SectionDoc
  systemPrompt: string
  baseTurnMessage: string
  context: PageContext
  catalogues: Catalogues | null
  catalogueError: string | null
  revisionAfterUserTurn: number
}

/**
 * One turn, from the model call to the stored document, reporting progress as
 * it goes.
 *
 * Split out of `handleBuild` rather than nested in a closure there: this is
 * the part that streams, it is two hundred lines long, and burying it inside
 * the request handler would put the pre-flight checks and the model loop at
 * the same indentation while only one of them can still choose a status code.
 *
 * IT NEVER RETURNS A STATUS. By the time it runs, the response is a 200 with
 * an open body. Every outcome leaves through `emit`, and exactly one terminal
 * `result` or `fail` event ends it.
 */
async function runTurn(args: TurnRunArgs): Promise<void> {
  const {
    emit,
    stepId,
    userId,
    draft,
    isFirstDraft,
    baseDoc,
    systemPrompt,
    baseTurnMessage,
    context,
    catalogues,
    catalogueError,
    revisionAfterUserTurn,
  } = args

  emit({ type: "phase", phase: "reading" })

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

    if (attempt > 0) {
      // CLEAR, DO NOT APPEND. Attempt 2 rewrites the same page, so its sections
      // replace attempt 1's on screen rather than doubling them.
      emit({ type: "restart", attempt: attempt + 1 })
    }
    emit({ type: "phase", phase: "planning" })

    let content
    try {
      content = await streamOneAttempt({
        emit,
        systemPrompt,
        turnMessage,
        maxTokens,
        onUsage: (usage) => {
          // `+=` across attempts, never `=`: a retry that succeeds still cost
          // the tokens the rejected attempt burned, and a spend log that
          // reports only the winning call understates every retried turn.
          tokensUsed += usage.tokensUsed
          cacheCreation += usage.cacheCreation
          cacheRead += usage.cacheRead
        },
      })
    } catch (error) {
      // A model refusal (`stop_reason: "refusal"`) surfaces through
      // `generateObject` as a parse failure, and so does a truncated or
      // schema-violating response. Same treatment as a Zod error, because at
      // this layer that is what it is.
      lastErrors = [(error as Error).message]
      continue
    }

    // The model has stopped writing. Applying the ops, resolving CTA refs
    // against the real catalogue and compiling is its own several-second chunk
    // of the wait, and its own way to fail, so it gets its own phase.
    emit({ type: "phase", phase: "checking" })

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
    emit({ type: "result", turn: response })
    return
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
    if (!blockedTurn.ok) return emitAppendFailure(emit, blockedTurn)

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
    emit({ type: "result", turn: response })
    return
  }

  // -------------------------------------------------------------------------
  // Resolve -> compile -> write. See the header note on why resolution runs
  // BEFORE the compile and why the RESOLVED document is what gets stored.
  // -------------------------------------------------------------------------
  const resolution = resolveSafely(outcome.doc, catalogues, catalogueError, context.allPages)
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
  if (!assistantTurn.ok) return emitAppendFailure(emit, assistantTurn)

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

  // THE BUILT PAGE IS EMITTED FIRST, BEFORE ANY REVIEW RUNS.
  //
  // The ordering is the whole safety argument. By this line the owner's
  // document is written, the revision has advanced, and `result` has told the
  // client about both — so everything the review does afterwards is additive,
  // and a review that fails, hangs or is abandoned leaves them with exactly
  // the page the builder made rather than an error about a turn that worked.
  emit({ type: "result", turn: response })

  // `opsRewrotePage`, not `outcome.receipt.isRewrite` — see `shouldReview`.
  // The receipt's flag is a 60%-of-sections volume heuristic, so on a short
  // page an ordinary headline edit reads as a full rewrite and would spend
  // four model calls reviewing a typo fix.
  if (!shouldReview({ rewrotePage: opsRewrotePage(outcome.ops), requested: false })) return

  await runReviewStage({
    emit,
    stepId,
    userId,
    doc: resolution.doc,
    baseRevision: assistantTurn.revision,
    context,
    catalogues,
    catalogueError,
    startTime,
    // The build turn has already emitted `result`, so this stage must not
    // emit a second terminal event and must stay silent when it finds
    // nothing.
    standalone: false,
  })
}

// ---------------------------------------------------------------------------
// (f) The review stage.
//
// Shared by the automatic path above (a first draft, where every word on the
// page is the model's own) and the Polish button below (an explicit ask). One
// implementation, because the only difference between them is what decided to
// call it.
//
// NOTHING IN HERE MAY EMIT `fail` OR THROW. It runs after a document is
// already saved — in `runTurn`'s case after `result` has already been sent —
// so there is no failure here that should reach the owner as a broken turn.
// `reviewDoc` has no throwing path and reports trouble in `error`; this
// function's job is to make the same promise about the WRITE that follows it.
// ---------------------------------------------------------------------------

interface ReviewStageArgs {
  emit: (event: BuildStreamEvent) => void
  stepId: string
  userId: string
  /** The document as it stands, already resolved and stored. */
  doc: SectionDoc
  /** The revision the review's own turn must supersede. */
  baseRevision: number
  context: PageContext
  catalogues: Catalogues | null
  catalogueError: string | null
  startTime: number
  /**
   * True on the Polish path, where this stage IS the turn.
   *
   * It changes what silence means. After a build, a review that found nothing
   * should say nothing — the owner asked for a page and already has one, and an
   * "I changed nothing" entry on every draft is noise. After a Polish press the
   * owner asked THIS question directly, so "nothing needed changing" is the
   * answer and has to be both written down and delivered as a terminal event —
   * otherwise the stream ends with no terminal at all and the client correctly
   * reports a dropped connection.
   */
  standalone: boolean
}

async function runReviewStage(args: ReviewStageArgs): Promise<void> {
  const { emit, stepId, userId, doc, baseRevision, context, catalogues, catalogueError, startTime, standalone } = args

  const reviewStartedAt = Date.now()
  emit({ type: "phase", phase: "reviewing" })

  const review = await reviewDoc({
    doc,
    onFinding: (finding) => emit({ type: "finding", finding }),
  })

  if (review.error !== null) {
    // Logged, not surfaced on the automatic path: the owner has a page, and
    // telling them a background improvement did not happen reads as a failure
    // of the thing that did. On the Polish path it IS the thing they asked
    // for, so it becomes a real failure event.
    console.warn("[funnels/build] review stage did not complete:", review.error)
    if (standalone) {
      emit({
        type: "fail",
        status: 502,
        body: { error: "The reviewer could not finish. Your page has not been changed." },
      })
    }
    return
  }

  if (!review.changed) {
    if (!standalone) return
    await emitNoChangeReview({ emit, stepId, userId, baseRevision, summary: review.summary })
    return
  }

  emit({ type: "phase", phase: "polishing" })

  // Resolve and compile the REVISED document by the same route the build turn
  // takes. The review emits ops against the resolved doc, and `resolveDoc` is
  // idempotent by design — but a reviser that rewrote a CTA's `ref` has
  // introduced a NAME that has never been resolved, and skipping this would
  // store it unresolved and block publish with no warning anywhere.
  const resolution = resolveSafely(review.doc, catalogues, catalogueError, context.allPages)
  const compile = compileDoc(resolution.doc, context.funnelBasePath)

  const reviewTurn = await appendTurn({
    stepId,
    expectedRevision: baseRevision,
    role: "assistant",
    source: "review",
    status: "complete",
    message: review.summary,
    ops: review.ops,
    doc: resolution.doc,
    compileStatus: compileStatus(compile),
    compileProblems: { problems: compile.problems, warnings: compile.warnings },
    unresolved: unresolvedForStorage(resolution),
    model: SECTION_BUILDER_MODEL,
    // The stage's OWN spend — three Sonnet critics plus one Opus reviser per
    // round. Recorded because this feature roughly triples the AI cost of a
    // first draft, and every other model call on this route is already
    // accounted for; a cost visible only on the invoice is one nobody can
    // attribute to a feature.
    tokensInput: review.tokensUsed,
    // Measured from when the REVIEW started, not from the request. `startTime`
    // covers the build too, and reusing it here would report the review as
    // having taken the whole turn — which is exactly the number someone would
    // later use to decide the review is too slow.
    latencyMs: Date.now() - reviewStartedAt,
    createdBy: userId,
  })

  // A LOST RACE IS NOT AN ERROR ON THE AUTOMATIC PATH.
  //
  // It means the owner edited the page while the review was running, and their
  // edit wins: a background improvement must never beat a human who was typing
  // at the same moment. They already have a correct page and a correct revision
  // from `result`, so the right thing to do is drop the polish silently.
  //
  // ON THE POLISH PATH THERE IS NO `result` BEHIND IT. Returning silently there
  // ends the stream with no terminal event at all, and the client — correctly —
  // reports a dropped connection instead of resyncing the revision. So the same
  // 409 the pre-flight check would have produced is emitted as a `fail`, which
  // `handleErrorResponse` already knows how to turn into a resync.
  if (!reviewTurn.ok) {
    console.warn("[funnels/build] review turn lost the compare-and-swap; the owner's own edit wins")
    if (standalone) {
      emit({
        type: "fail",
        status: 409,
        body: {
          error: "Someone else changed this page while the reviewer was reading it. Reload and try again.",
          code: "stale_revision",
          currentRevision: "currentRevision" in reviewTurn ? reviewTurn.currentRevision : baseRevision,
        },
      })
    }
    return
  }

  emit({
    type: "review",
    turn: {
      revision: reviewTurn.revision,
      doc: resolution.doc,
      reply: review.summary,
      blocked: false,
      receipt: review.receipt,
      compile,
      unresolved: resolution.unresolved,
      danglingAnchors: resolution.danglingAnchors,
      resolutionError: resolution.error,
      source: "review",
    } satisfies TurnResponse,
  })
}

/**
 * The Polish path's "nothing needed changing" answer.
 *
 * Written down as a real turn rather than emitted as a bare toast, because the
 * owner asked a question and the transcript is where this builder's answers
 * live — a verdict that vanishes on reload is a verdict they will ask for
 * again. The turn carries NO document: `compile === null` on the client side
 * moves the revision and appends the message without touching the preview,
 * which is exactly right for a turn that changed nothing.
 */
async function emitNoChangeReview(args: {
  emit: (event: BuildStreamEvent) => void
  stepId: string
  userId: string
  baseRevision: number
  summary: string
}): Promise<void> {
  const { emit, stepId, baseRevision, summary, userId } = args
  const reply = summary.trim() === "" ? "I read the page through and found nothing worth changing." : summary

  const turn = await appendTurn({
    stepId,
    expectedRevision: baseRevision,
    role: "assistant",
    source: "review",
    status: "complete",
    message: reply,
    model: SECTION_BUILDER_MODEL,
    createdBy: userId,
  })

  if (!turn.ok) {
    // The owner edited while the review ran. Their edit wins, and the stream
    // still has to terminate — a Polish that ends in silence reads as a
    // dropped connection.
    emit({
      type: "fail",
      status: 409,
      body: {
        error: "Someone else changed this page while the reviewer was reading it. Reload and try again.",
        code: "stale_revision",
        currentRevision: turn.ok === false && "currentRevision" in turn ? turn.currentRevision : baseRevision,
      },
    })
    return
  }

  emit({
    type: "result",
    turn: {
      revision: turn.revision,
      doc: null,
      reply,
      blocked: false,
      receipt: null,
      compile: null,
      unresolved: [],
      danglingAnchors: [],
      resolutionError: null,
      source: "review",
    } satisfies TurnResponse,
  })
}

/**
 * (e) `appendTurn`'s two failure results, once the response is already a 200.
 *
 * This REPLACED a `staleOrNotFound` helper that returned the same two bodies as
 * real HTTP responses. Nothing calls that shape any more — the only two callers
 * were the blocked and success paths, and both now run inside an open stream —
 * so it was deleted rather than left behind as a second, unreachable definition
 * of what a 409 means here. `handleReset` never used it; it inlines its own,
 * because it can also fail with `revision_has_no_doc`.
 *
 * The status and body still have to be EXACTLY what the pre-flight 409 sends:
 * the client feeds stream failures and HTTP failures into the same
 * `handleErrorResponse`, so a `stale_revision` missing its `code` or its
 * `currentRevision` would silently stop the tab resyncing on precisely the race
 * the compare-and-swap exists to catch.
 */
function emitAppendFailure(
  emit: (event: BuildStreamEvent) => void,
  result: { ok: false; reason: "stale_revision"; currentRevision: number } | { ok: false; reason: "not_found" },
): void {
  if (result.reason === "not_found") {
    emit({ type: "fail", status: 404, body: { error: "Not found" } })
    return
  }
  emit({
    type: "fail",
    status: 409,
    body: {
      error: "Someone else changed this page while you were working on it. Reload and try again.",
      code: "stale_revision",
      currentRevision: result.currentRevision,
    },
  })
}
