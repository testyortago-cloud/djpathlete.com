import { z } from "zod"
import { SECTION_BUILDER_MAX_MESSAGE_LENGTH } from "@/lib/funnels/sections/builder-config"
import type { FunnelGoal } from "@/types/database"

/**
 * EXPORTED so the create dialog can validate as you type with the same pattern
 * the server enforces. It must never grow a second copy on the client.
 */
export const FUNNEL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(FUNNEL_SLUG_PATTERN, "Slug must be lowercase with hyphens only")

/**
 * Slugs that would collide with an existing top-level route or a reserved path.
 * EXPORTED for the same reason as the pattern above: three bugs in this repo
 * came from restating a validation rule instead of calling the one that
 * decides, so a guard and its schema must agree by construction.
 */
export const RESERVED_FUNNEL_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "client",
  "go",
  "login",
  "register",
])

/**
 * What a landing page is for. These are not free labels: every value except
 * `leads` names a CTA target lib/funnels/sections/registry.ts already resolves,
 * so the choice can seed a real call to action. `leads` maps to a form section.
 *
 * The dialog renders its options from this list, so it can never offer an
 * option the schema below would refuse.
 */
export const FUNNEL_GOALS = [
  { value: "leads", label: "Capture leads", hint: "A form that lands in your inbox" },
  { value: "booking", label: "Book a consult", hint: "Sends visitors to your booking flow" },
  { value: "program", label: "Sell a program", hint: "Links to a training program" },
  { value: "session_pack", label: "Sell a session pack", hint: "Links to a pack checkout" },
  { value: "event", label: "Fill an event", hint: "Links to a camp or clinic signup" },
] as const satisfies readonly { value: FunnelGoal; label: string; hint: string }[]

const goalSchema = z.enum(["leads", "booking", "program", "session_pack", "event"])
const kindSchema = z.enum(["page", "funnel"])

export const createFunnelSchema = z.object({
  slug: slugSchema.refine((s) => !RESERVED_FUNNEL_SLUGS.has(s), "That slug is reserved"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  // Defaulted, not required: the create route predates this field and callers
  // that never heard of it must keep working.
  kind: kindSchema.default("page"),
  goal: goalSchema.nullable().optional(),
})

export const updateFunnelSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  kind: kindSchema.optional(),
  goal: goalSchema.nullable().optional(),
})

export const createStepSchema = z.object({
  funnel_id: z.string().uuid(),
  slug: slugSchema,
  name: z.string().min(2).max(120),
})

export const updateStepSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(2).max(120).optional(),
  position: z.number().int().min(0).max(200).optional(),
  seo_title: z.string().max(160).nullable().optional(),
  seo_description: z.string().max(320).nullable().optional(),
  og_image_url: z.string().url().nullable().optional(),
  noindex: z.boolean().optional(),
  /**
   * The DRAFT `SectionDoc` (`lib/funnels/sections/registry.ts`). Was GrapesJS
   * editor state before 00203. Deliberately still `z.unknown()` here rather
   * than `sectionDocSchema`: this schema also serves steps that have never
   * been through the AI builder and still hold legacy GrapesJS state, and the
   * builder's own write path (`lib/db/funnel-builder.ts`) validates the doc
   * with the registry schema before it ever reaches the column.
   */
  project_data: z.unknown().optional(),
})

/**
 * Body of `POST /api/admin/funnels/steps/[id]/build` — one owner message plus
 * the revision the client believes is current.
 *
 * `revision` IS REQUIRED AND IS THE OPTIMISTIC LOCK. Two admin tabs on the
 * same page is a real scenario; without it the second tab's build silently
 * overwrites the first tab's document. `appendTurn` makes the check part of
 * the write (`.eq("doc_revision", expectedRevision)`), and the route turns a
 * `stale_revision` result into a 409 so the client re-syncs rather than
 * clobbering. A schema that made this optional would let a client opt out of
 * the lock by omission, which is the same bug wearing a default value.
 *
 * The length cap is IMPORTED from `builder-config.ts`, never restated: that
 * file is the single place the builder's tunables live, and a bound copied to
 * two places is a bound that drifts. Restating it as `12_000` here would let
 * someone raise the config constant and still be rejected at the door with no
 * indication why.
 */
export const buildMessageRequestSchema = z.object({
  /**
   * Optional and defaulted-by-omission so the documented `{message, revision}`
   * body keeps working verbatim. It exists only so the two members of
   * `buildRequestSchema` below can never both match one body.
   */
  action: z.literal("build").optional(),
  message: z.string().trim().min(1).max(SECTION_BUILDER_MAX_MESSAGE_LENGTH),
  revision: z.number().int().min(0),
})

/**
 * THE WAY BACK OUT OF AN UNREPAIRABLE DOCUMENT.
 *
 * `getDraft` reports `docInvalid: true` for anything in `project_data` that is
 * not a valid `SectionDoc` — legacy GrapesJS state, corruption, or a document
 * that was valid when written and stopped being valid when the registry
 * tightened. `applyOps` rejects the same documents at its entry parse, BEFORE
 * it inspects a single op, so no chat instruction of any kind can repair one:
 * unlike a duplicate section id (which a `set_page` can rewrite away), a
 * schema-invalid section leaves every turn failing with no route back.
 *
 * `funnel_step_turns.doc` holds a FULL document per turn, which is exactly
 * what that table is for, so the way back is to copy an earlier one forward.
 * That is `revertToRevision`, which appends a `source: 'revert'` head turn
 * rather than deleting anything.
 *
 * It rides on the build endpoint rather than a route of its own because it is
 * the same conversation, the same optimistic-lock story and the same response
 * shape — and because the refusal that tells the owner they need it is
 * returned by that endpoint, carrying the `resetToRevision` to send back here.
 *
 * `toRevision` starts at 1, not 0: revision 0 is the state before any turn
 * exists, so no turn row can ever carry it.
 */
export const buildResetRequestSchema = z.object({
  action: z.literal("reset"),
  toRevision: z.number().int().min(1),
})

/**
 * THE POLISH BUTTON — a review with no build in front of it.
 *
 * A review normally rides on a first draft, where the builder has just written
 * every word on the page. Pressing Polish asks for the review ALONE, against
 * the document as it already stands.
 *
 * It is its own action rather than a `review: true` flag on a message body,
 * and that is the difference between one model call and five: a message body
 * would run the builder first, spending an Opus call to answer a message the
 * owner never wrote, and would append a build turn saying nothing before the
 * review turn that says everything.
 *
 * It carries `revision` for the same optimistic-lock reason a message does —
 * the review writes a turn, so it can lose the same compare-and-swap race, and
 * a client that opted out by omission would silently clobber the other tab.
 */
export const buildPolishRequestSchema = z.object({
  action: z.literal("polish"),
  revision: z.number().int().min(0),
})

/**
 * Reset and polish FIRST: a body carrying `action: "reset"` or
 * `action: "polish"` fails the message member (no `message`, and the literal
 * disagrees), and a `{message, revision}` body fails both, so the union is
 * unambiguous in every direction rather than order-dependent.
 */
export const buildRequestSchema = z.union([
  buildResetRequestSchema,
  buildPolishRequestSchema,
  buildMessageRequestSchema,
])

/**
 * Publish-time size caps. Named and exported — not restated as bare literals
 * anywhere else — so `lib/funnels/sections/doc.ts` (which enforces the same
 * ceiling at DRAFT time, before publish, so an oversized page is caught
 * while the owner is still iterating) can never drift from the number this
 * schema actually enforces.
 */
export const FUNNEL_STEP_HTML_MAX_LENGTH = 500_000
export const FUNNEL_STEP_CSS_MAX_LENGTH = 200_000

export const publishStepSchema = z.object({
  html: z.string().max(FUNNEL_STEP_HTML_MAX_LENGTH),
  css: z.string().max(FUNNEL_STEP_CSS_MAX_LENGTH),
  project_data: z.unknown().optional(),
})

export type CreateFunnelData = z.infer<typeof createFunnelSchema>
export type UpdateFunnelData = z.infer<typeof updateFunnelSchema>
export type UpdateStepData = z.infer<typeof updateStepSchema>
export type PublishStepData = z.infer<typeof publishStepSchema>
export type BuildRequestData = z.infer<typeof buildRequestSchema>
