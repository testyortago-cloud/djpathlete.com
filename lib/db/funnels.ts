// lib/db/funnels.ts — DAL for the funnel builder (00202).
//
// The admin owns writes; the public /go route reads only published versions.
// Per repo convention the Database generic is dropped and rows are cast here.

import { createServiceRoleClient } from "@/lib/supabase"
import { compileFunnelStep } from "@/lib/funnels/compile"
import type { CompileError, FunnelNode } from "@/lib/funnels/compile/types"
import type {
  Funnel,
  FunnelStep,
  FunnelStepVersion,
  FunnelSubmission,
  FunnelStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// ---------------------------------------------------------------------------
// Funnels
// ---------------------------------------------------------------------------

export async function listFunnels(opts: { status?: FunnelStatus } = {}): Promise<Funnel[]> {
  const supabase = getClient()
  let query = supabase.from("funnels").select("*").order("updated_at", { ascending: false })
  if (opts.status) query = query.eq("status", opts.status)
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
  created_by?: string | null
}

/**
 * Creates a funnel plus its entry step, because a funnel with no page is not a
 * thing the owner can do anything with.
 */
export async function createFunnel(input: CreateFunnelInput): Promise<Funnel> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnels")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      created_by: input.created_by ?? null,
    })
    .select("*")
    .single()
  if (error) throw new Error(`createFunnel: ${error.message}`)

  const funnel = data as Funnel
  const { error: stepError } = await supabase.from("funnel_steps").insert({
    funnel_id: funnel.id,
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
  })
  if (stepError) throw new Error(`createFunnel(entry step): ${stepError.message}`)

  return funnel
}

export async function updateFunnel(
  id: string,
  input: Partial<Pick<Funnel, "slug" | "name" | "description" | "status">>,
): Promise<Funnel> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnels")
    .update({ ...input, updated_at: new Date().toISOString() })
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
}

export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<FunnelSubmission> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_submissions")
    .insert({
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
    })
    .select("*")
    .single()
  if (error) throw new Error(`createSubmission: ${error.message}`)
  return data as FunnelSubmission
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

export async function listSubmissions(
  funnelId: string,
  limit = 200,
): Promise<FunnelSubmission[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_submissions")
    .select("*")
    .eq("funnel_id", funnelId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listSubmissions: ${error.message}`)
  return (data ?? []) as FunnelSubmission[]
}

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
