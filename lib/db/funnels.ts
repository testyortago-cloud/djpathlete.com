// lib/db/funnels.ts — DAL for the funnel builder (00202).
//
// The admin owns writes; the public /go route reads only published versions.
// Per repo convention the Database generic is dropped and rows are cast here.

import { createServiceRoleClient } from "@/lib/supabase"
import { hasIntakeColumns } from "@/lib/db/funnel-schema-support"
import { ENTRY_STEP_SLUG } from "@/lib/funnels/templates"
import { compileFunnelStep } from "@/lib/funnels/compile"
import type { CompileError, FunnelNode } from "@/lib/funnels/compile/types"
import type {
  Funnel,
  FunnelStep,
  FunnelStepVersion,
  FunnelSubmission,
  FunnelSubmissionKind,
  FunnelStatus,
  FunnelKind,
  FunnelGoal,
  OfferKind,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ---------------------------------------------------------------------------
// Funnels
// ---------------------------------------------------------------------------

export async function listFunnels(
  opts: { status?: FunnelStatus; kind?: FunnelKind } = {},
): Promise<Funnel[]> {
  const supabase = getClient()
  let query = supabase.from("funnels").select("*").order("updated_at", { ascending: false })
  if (opts.status) query = query.eq("status", opts.status)
  // Deliberately only applied when asked. Callers that want both types — the
  // leads inbox, the builder's own lookups — must keep getting both.
  if (opts.kind) query = query.eq("kind", opts.kind)
  const { data, error } = await query
  if (error) throw new Error(`listFunnels: ${error.message}`)
  return (data ?? []) as Funnel[]
}

export async function getFunnelById(id: string): Promise<Funnel | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("funnels").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(`getFunnelById: ${error.message}`)
  return (data as Funnel | null) ?? null
}

export async function getFunnelBySlug(slug: string): Promise<Funnel | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnels")
    .select("*")
    .ilike("slug", slug)
    .maybeSingle()
  if (error) throw new Error(`getFunnelBySlug: ${error.message}`)
  return (data as Funnel | null) ?? null
}

export interface CreateFunnelInput {
  slug: string
  name: string
  description?: string | null
  kind?: FunnelKind
  goal?: FunnelGoal | null
  created_by?: string | null
  /** Which template produced this funnel. See `lib/funnels/templates.ts`. */
  template?: string | null
  audience?: string | null
  /** Both halves or neither — `funnels_offer_paired_check` enforces it. */
  offer?: { kind: OfferKind; ref: string } | null
  starts_at?: string | null
  ends_at?: string | null
  auto_offline_at_end?: boolean
  notify_emails?: string[] | null
  /**
   * The step plan.
   *
   * OPTIONAL, AND THAT IS LOAD-BEARING: every caller that predates templates —
   * `CreatePageDialog` above all — sends nothing here and must keep getting
   * exactly the single entry step it got before, named by `kind` the way the
   * 2026-08-12 split named it.
   */
  steps?: {
    name: string
    slug: string
    goal: FunnelGoal | null
    /**
     * The step's page, written at creation instead of left blank for the AI
     * page builder.
     *
     * SERVER-DERIVED ONLY. `createStepPlanSchema` does not accept a document,
     * so no request can hand one in — the quiz template's route builds it from
     * `buildQuizFunnelDoc`. A client-supplied `SectionDoc` would walk straight
     * past everything the section grammar exists to enforce.
     *
     * Absent rather than null when unused, so every other template's step row
     * is byte for byte the row it has always been.
     */
    projectData?: unknown
  }[]
}

/**
 * Creates a funnel plus its entry step, because a funnel with no page is not a
 * thing the owner can do anything with.
 *
 * RETURNS THE ENTRY STEP'S ID, and that is load-bearing rather than
 * incidental: the create dialog routes straight into the builder for that step,
 * and without the id it would have to drop the owner back on the list — the
 * behaviour the richer create flow exists to replace. The step insert used to
 * discard its result.
 */
export async function createFunnel(
  input: CreateFunnelInput,
): Promise<Funnel & { entryStepId: string }> {
  const supabase = getClient()

  // Migration 00210 may not have reached this database yet — see
  // `lib/db/funnel-schema-support.ts` for the deploy-race caveat this
  // satisfies, and for why `.env.local` hits it every time. When the columns
  // are absent everything below degrades to the exact insert this function
  // performed before 00210 rather than 500ing.
  const intake = await hasIntakeColumns(supabase)

  const { data, error } = await supabase
    .from("funnels")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind ?? "page",
      goal: input.goal ?? null,
      created_by: input.created_by ?? null,
      ...(intake
        ? {
            template: input.template ?? null,
            audience: input.audience ?? null,
            // Both halves from the one source, so the paired CHECK cannot be
            // tripped by writing a kind with no ref.
            offer_kind: input.offer?.kind ?? null,
            offer_ref: input.offer?.ref ?? null,
            starts_at: input.starts_at ?? null,
            ends_at: input.ends_at ?? null,
            auto_offline_at_end: input.auto_offline_at_end ?? false,
            notify_emails: input.notify_emails ?? null,
          }
        : {}),
    })
    .select("*")
    .single()
  if (error) throw new Error(`createFunnel: ${error.message}`)

  const funnel = data as Funnel

  // No plan means the pre-template behaviour, byte for byte: one entry step,
  // named by kind. A funnel's first page is "Step 1"; a landing page's only
  // page is the page itself. Same row, read differently on two screens.
  const planned =
    input.steps && input.steps.length > 0
      ? input.steps
      : [
          {
            name: input.kind === "funnel" ? "Step 1" : "Landing page",
            slug: ENTRY_STEP_SLUG,
            goal: null,
          },
        ]

  const { data: stepRows, error: stepError } = await supabase
    .from("funnel_steps")
    .insert(
      planned.map((step, index) => ({
        funnel_id: funnel.id,
        // The entry step's path is not the client's to choose: `/go/<slug>` is
        // served by whichever step is `index`. The validator refuses anything
        // else; this makes it true regardless.
        slug: index === 0 ? ENTRY_STEP_SLUG : step.slug,
        name: step.name,
        // The MULTI-STEP PLAN STILL WORKS without 00210 — slug, name, position
        // and is_entry all predate it. Only the per-step goal is lost, so a
        // funnel created in the window has its shape and not its intent.
        ...(intake ? { goal: step.goal ?? null } : {}),
        position: index,
        is_entry: index === 0,
        ...(step.projectData !== undefined ? { project_data: step.projectData } : {}),
      })),
    )
    .select("id, slug")
  if (stepError) throw new Error(`createFunnel(entry step): ${stepError.message}`)

  // BY SLUG, NOT BY POSITION IN THE RETURNED ARRAY. Postgres does not promise
  // that RETURNING comes back in VALUES order, and the create dialog routes the
  // owner straight into whichever step this names — so `stepRows[0]` would
  // occasionally open the confirmation page as though it were step one.
  const entry = (stepRows as { id: string; slug: string }[] | null)?.find(
    (row) => row.slug === ENTRY_STEP_SLUG,
  )
  if (!entry) throw new Error("createFunnel(entry step): the entry step was not returned")

  return { ...funnel, entryStepId: entry.id }
}

/**
 * `offer` is accepted in the SAME nested shape `createFunnel` takes and is split
 * into its two columns here, so callers never hand Supabase a key called
 * `offer` — there is no such column, and the update would 500 from Postgres.
 *
 * That is not hypothetical: widening `updateFunnelSchema` without widening this
 * signature type-checks (excess-property checks do not apply to a variable), so
 * a PATCH carrying an offer parsed cleanly and then failed at the database.
 */
export type UpdateFunnelInput = Partial<
  Pick<
    Funnel,
    | "slug"
    | "name"
    | "description"
    | "status"
    | "kind"
    | "goal"
    | "audience"
    | "starts_at"
    | "ends_at"
    | "auto_offline_at_end"
    | "notify_emails"
  >
> & { offer?: { kind: OfferKind; ref: string } | null }

export async function updateFunnel(id: string, input: UpdateFunnelInput): Promise<Funnel> {
  const supabase = getClient()
  const { offer, audience, starts_at, ends_at, auto_offline_at_end, notify_emails, ...core } = input

  // Same tolerance as createFunnel. `core` — slug, name, description, status,
  // kind, goal — predates 00210 and always writes; the intake half is dropped
  // when the columns are not there yet. A rename, and more importantly a
  // PUBLISH, must not fail because a migration is fifteen seconds behind.
  const intake = await hasIntakeColumns(supabase)

  // `undefined` means "not supplied" and must not become a write; an explicit
  // `null` means "clear it" and must. Spreading each key only when it is
  // present keeps both halves of the paired CHECK in step.
  const intakeColumns = intake
    ? {
        ...(offer === undefined
          ? {}
          : { offer_kind: offer?.kind ?? null, offer_ref: offer?.ref ?? null }),
        ...(audience === undefined ? {} : { audience }),
        ...(starts_at === undefined ? {} : { starts_at }),
        ...(ends_at === undefined ? {} : { ends_at }),
        ...(auto_offline_at_end === undefined ? {} : { auto_offline_at_end }),
        ...(notify_emails === undefined ? {} : { notify_emails }),
      }
    : {}

  const { data, error } = await supabase
    .from("funnels")
    .update({ ...core, ...intakeColumns, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw new Error(`updateFunnel: ${error.message}`)
  return data as Funnel
}

export async function deleteFunnel(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("funnels").delete().eq("id", id)
  if (error) throw new Error(`deleteFunnel: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export async function listSteps(funnelId: string): Promise<FunnelStep[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_steps")
    .select("*")
    .eq("funnel_id", funnelId)
    .order("position", { ascending: true })
  if (error) throw new Error(`listSteps: ${error.message}`)
  return (data ?? []) as FunnelStep[]
}

/**
 * Every step's DOCUMENT, for the one question that has to be asked across the
 * whole app: "does anything still point at this quiz?"
 *
 * A `quiz` block names its quiz inside `project_data`, which Postgres cannot
 * index for this and PostgREST cannot filter on, so the only way to answer is
 * to walk the documents. There is exactly one caller -- the funnel DELETE
 * route -- and it calls this ONLY when the funnel being deleted actually ran a
 * quiz, which is rare. A funnel with no quiz pays nothing.
 *
 * ONLY THE COLUMNS THE WALK NEEDS. `select("*")` would pull every page's
 * compiled HTML alongside its document.
 */
export async function listStepDocuments(): Promise<
  { id: string; funnel_id: string; name: string; project_data: unknown }[]
> {
  const supabase = getClient()
  const { data, error } = await supabase.from("funnel_steps").select("id, funnel_id, name, project_data")
  if (error) throw new Error(`listStepDocuments: ${error.message}`)
  return (data ?? []) as { id: string; funnel_id: string; name: string; project_data: unknown }[]
}

export async function getStep(id: string): Promise<FunnelStep | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("funnel_steps").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(`getStep: ${error.message}`)
  return (data as FunnelStep | null) ?? null
}

export interface CreateStepInput {
  funnel_id: string
  slug: string
  name: string
  position?: number
}

export async function createStep(input: CreateStepInput): Promise<FunnelStep> {
  const supabase = getClient()
  const existing = await listSteps(input.funnel_id)
  const { data, error } = await supabase
    .from("funnel_steps")
    .insert({
      funnel_id: input.funnel_id,
      slug: input.slug,
      name: input.name,
      position: input.position ?? existing.length,
      is_entry: existing.length === 0,
    })
    .select("*")
    .single()
  if (error) throw new Error(`createStep: ${error.message}`)
  return data as FunnelStep
}

export type UpdateStepInput = Partial<
  Pick<
    FunnelStep,
    | "slug"
    | "name"
    | "position"
    | "seo_title"
    | "seo_description"
    | "og_image_url"
    | "noindex"
    | "project_data"
  >
>

export async function updateStep(id: string, input: UpdateStepInput): Promise<FunnelStep> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_steps")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw new Error(`updateStep: ${error.message}`)
  return data as FunnelStep
}

export async function deleteStep(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("funnel_steps").delete().eq("id", id)
  if (error) throw new Error(`deleteStep: ${error.message}`)
}

/** Saves the editor draft. Does not affect what visitors currently see. */
export async function saveStepDraft(
  id: string,
  projectData: unknown,
): Promise<FunnelStep> {
  return updateStep(id, { project_data: projectData })
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export type PublishStepResult =
  | { ok: true; version: FunnelStepVersion; warnings: CompileError[] }
  | { ok: false; errors: CompileError[] }

/**
 * Compiles editor output and, if it is clean, writes an immutable version row
 * and points the step at it. A compile failure writes nothing — the live page
 * keeps serving the previous version.
 */
export async function publishStep(input: {
  stepId: string
  html: string
  css: string
  projectData?: unknown
  publishedBy?: string | null
}): Promise<PublishStepResult> {
  const compiled = compileFunnelStep({ html: input.html, css: input.css })
  if (!compiled.ok) return { ok: false, errors: compiled.errors }

  const supabase = getClient()

  const { data: latest, error: latestError } = await supabase
    .from("funnel_step_versions")
    .select("version")
    .eq("step_id", input.stepId)
    .order("version", { ascending: false })
    .limit(1)
  if (latestError) throw new Error(`publishStep(latest): ${latestError.message}`)

  const nextVersion = ((latest?.[0] as { version: number } | undefined)?.version ?? 0) + 1

  const { data, error } = await supabase
    .from("funnel_step_versions")
    .insert({
      step_id: input.stepId,
      version: nextVersion,
      nodes: compiled.nodes,
      css: compiled.css,
      project_data: input.projectData ?? null,
      published_by: input.publishedBy ?? null,
    })
    .select("*")
    .single()
  if (error) throw new Error(`publishStep(insert): ${error.message}`)

  const version = data as FunnelStepVersion

  const { error: pointerError } = await supabase
    .from("funnel_steps")
    .update({ published_version_id: version.id, updated_at: new Date().toISOString() })
    .eq("id", input.stepId)
  if (pointerError) throw new Error(`publishStep(pointer): ${pointerError.message}`)

  return { ok: true, version, warnings: compiled.warnings }
}

/**
 * The version NUMBER a step is currently serving — the "3" in "version 3".
 *
 * For DISPLAY only, and deliberately nothing more. It says which snapshot is
 * live; it does not say whether the draft still matches that snapshot, and it
 * must not be read as if it did. Proving "nothing has changed since" would mean
 * comparing the stored document with the one publish would render TODAY, and
 * those disagree for reasons that have nothing to do with the owner editing —
 * `project_data` is `jsonb`, which does not preserve key order, and the
 * document publish sends is the RESOLVED one, so a program renamed since would
 * read as an edit. Getting that comparison wrong in the "unchanged" direction
 * would disable Publish on a page that genuinely needs republishing, so the
 * builder only claims "up to date" about publishes it watched happen.
 *
 * Takes the version ID rather than the step ID because every caller has already
 * loaded the step row and holds it.
 */
export async function getVersionNumber(versionId: string): Promise<number | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_step_versions")
    .select("version")
    .eq("id", versionId)
    .maybeSingle()
  if (error) throw new Error(`getVersionNumber: ${error.message}`)
  return (data as { version: number } | null)?.version ?? null
}

export interface PublishedStep {
  funnel: Funnel
  step: FunnelStep
  nodes: FunnelNode[]
  css: string
}

/**
 * Everything the public route needs, in one place. Returns null when the funnel
 * or step does not exist, or has never been published.
 *
 * `includeUnpublished` is for the owner's preview — it falls back to the latest
 * version regardless of the funnel's status.
 */
export async function getPublishedStep(
  funnelSlug: string,
  stepSlug?: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<PublishedStep | null> {
  const funnel = await getFunnelBySlug(funnelSlug)
  if (!funnel) return null
  if (funnel.status !== "published" && !opts.includeUnpublished) return null

  const supabase = getClient()
  let query = supabase.from("funnel_steps").select("*").eq("funnel_id", funnel.id)
  query = stepSlug ? query.eq("slug", stepSlug) : query.eq("is_entry", true)

  const { data: stepRow, error: stepError } = await query.maybeSingle()
  if (stepError) throw new Error(`getPublishedStep(step): ${stepError.message}`)
  if (!stepRow) return null

  const step = stepRow as FunnelStep

  let versionQuery = supabase.from("funnel_step_versions").select("*")
  if (step.published_version_id) {
    versionQuery = versionQuery.eq("id", step.published_version_id)
  } else if (opts.includeUnpublished) {
    versionQuery = versionQuery.eq("step_id", step.id).order("version", { ascending: false }).limit(1)
  } else {
    return null
  }

  const { data: versionRows, error: versionError } = await versionQuery
  if (versionError) throw new Error(`getPublishedStep(version): ${versionError.message}`)

  const version = (versionRows?.[0] as FunnelStepVersion | undefined) ?? null
  if (!version) return null

  return {
    funnel,
    step,
    nodes: (version.nodes as FunnelNode[]) ?? [],
    css: version.css ?? "",
  }
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export interface CreateSubmissionInput {
  funnel_id: string
  step_id: string
  form_key: string
  email?: string | null
  name?: string | null
  phone?: string | null
  payload: Record<string, unknown>
  attribution_session_id?: string | null
  ip_address?: string | null
  user_agent?: string | null
  lead_user_id?: string | null
  /** 00230. Omitted means a form fill, which is what every caller before it was. */
  kind?: FunnelSubmissionKind
  /** 00230. The completed quiz attempt this lead came from. */
  quiz_attempt_id?: string | null
}

/** The two columns 00230 added. Named once, for the retry below. */
const POST_00230_COLUMNS = ["kind", "quiz_attempt_id"] as const

/**
 * PostgREST's "column not in the schema cache".
 *
 * The message is checked as well as the code because PostgREST has renumbered
 * this before -- the same belt-and-braces pair `lib/db/lead-inquiries.ts` uses
 * for the 00211 click ids.
 */
function isPre00230SchemaError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204") return true
  return POST_00230_COLUMNS.some((column) => (error.message ?? "").includes(`'${column}'`))
}

export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<FunnelSubmission> {
  const supabase = getClient()
  const row = {
    funnel_id: input.funnel_id,
    step_id: input.step_id,
    form_key: input.form_key,
    email: input.email ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
    payload: input.payload,
    attribution_session_id: input.attribution_session_id ?? null,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    lead_user_id: input.lead_user_id ?? null,
    kind: input.kind ?? "form",
    quiz_attempt_id: input.quiz_attempt_id ?? null,
  }

  const { data, error } = await supabase.from("funnel_submissions").insert(row).select("*").single()
  if (!error) return data as FunnelSubmission

  // MIGRATIONS AND DEPLOYS RACE ON MERGE TO MAIN. For one deploy this code can
  // be running against the pre-00230 schema, where PostgREST rejects the WHOLE
  // insert over two columns it has never heard of. Losing the label on a quiz
  // lead is a cosmetic problem; losing the lead is not, so the retry drops
  // only the new columns and keeps every answer.
  if (!isPre00230SchemaError(error)) {
    // THE CODE TRAVELS WITH THE MESSAGE. The house DAL convention throws a raw
    // PostgREST object, which the standard cron shell writes out as the literal
    // string "[object Object]" -- and a caller that needs to tell a duplicate
    // (23505, the unique index on quiz_attempt_id, meaning the lead is already
    // filed) from a real failure has nothing to read.
    throw Object.assign(new Error(`createSubmission: ${error.message}`), { code: error.code })
  }

  const legacy = { ...row } as Record<string, unknown>
  for (const column of POST_00230_COLUMNS) delete legacy[column]
  console.warn("[funnels] funnel_submissions is pre-00230; the lead was kept without its kind")

  const { data: retried, error: retryError } = await supabase
    .from("funnel_submissions")
    .insert(legacy)
    .select("*")
    .single()
  if (retryError) {
    throw Object.assign(new Error(`createSubmission: ${retryError.message}`), { code: retryError.code })
  }
  return retried as FunnelSubmission
}

/**
 * Submission counts keyed by funnel id, for the funnel cards. One query rather
 * than one per card. Paginated because `.select()` caps at ~1000 rows and this
 * is a growth table.
 */
export async function getSubmissionCountsByFunnel(): Promise<Record<string, number>> {
  const supabase = getClient()
  const counts: Record<string, number> = {}
  const PAGE = 1000

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("funnel_submissions")
      .select("funnel_id")
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`getSubmissionCountsByFunnel: ${error.message}`)

    const rows = (data ?? []) as { funnel_id: string }[]
    for (const row of rows) counts[row.funnel_id] = (counts[row.funnel_id] ?? 0) + 1
    if (rows.length < PAGE) break
  }

  return counts
}

// `listSubmissions` USED TO LIVE HERE AND IS DELETED. It was written when this
// subsystem shipped and was imported by no file in the repo — the leads it
// would have returned were unreadable for the whole of that time. Its job now
// belongs to `lib/db/funnel-leads.ts`, which joins the page name, paginates
// past PostgREST's 1000-row cap, and filters.
//
// Removed rather than left in place: two list functions over one table, one of
// them unused and neither obviously canonical, is how the next person writes a
// third.

/**
 * Finds the published form island config for a step, so the submission route
 * validates against what was actually published rather than what the browser
 * claims the form contained.
 */
export async function getPublishedFormConfig(
  stepId: string,
  formKey: string,
): Promise<Record<string, unknown> | null> {
  const supabase = getClient()
  const { data: stepRow, error: stepError } = await supabase
    .from("funnel_steps")
    .select("published_version_id")
    .eq("id", stepId)
    .maybeSingle()
  if (stepError) throw new Error(`getPublishedFormConfig(step): ${stepError.message}`)

  const versionId = (stepRow as { published_version_id: string | null } | null)
    ?.published_version_id
  if (!versionId) return null

  const { data: versionRow, error: versionError } = await supabase
    .from("funnel_step_versions")
    .select("nodes")
    .eq("id", versionId)
    .maybeSingle()
  if (versionError) throw new Error(`getPublishedFormConfig(version): ${versionError.message}`)
  if (!versionRow) return null

  const nodes = ((versionRow as { nodes: unknown }).nodes as FunnelNode[]) ?? []
  return findFormIsland(nodes, formKey)
}

function findFormIsland(
  nodes: FunnelNode[],
  formKey: string,
): Record<string, unknown> | null {
  for (const node of nodes) {
    if (node.t === "island" && node.name === "form" && node.props.formKey === formKey) {
      return node.props
    }
    if (node.t === "el") {
      const found = findFormIsland(node.children, formKey)
      if (found) return found
    }
  }
  return null
}
