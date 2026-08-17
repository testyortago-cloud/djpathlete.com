import { z } from "zod"
// `apply.ts` is a leaf — zod and the section registry, nothing else — so this
// does not drag server code into any bundle that imports a validator.
import { opSchema } from "@/lib/funnels/sections/apply"
import {
  SECTION_BUILDER_MAX_MESSAGE_LENGTH,
  SECTION_BUILDER_MAX_OPS,
  SECTION_REVIEW_MAX_ROUNDS,
} from "@/lib/funnels/sections/builder-config"
import {
  ENTRY_STEP_SLUG,
  FUNNEL_TEMPLATES,
  MAX_FUNNEL_STEPS,
  getTemplate,
  type FunnelTemplateId,
  type TemplateAsk,
} from "@/lib/funnels/templates"
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
 * Bounds on a funnel's or a step's display name, EXPORTED for exactly the
 * reason the slug pattern above is: the create dialogs and the rename dialog
 * gate their submit button on these, and a copied `>= 2` drifts the moment this
 * changes — the owner then meets the difference as a 400 the dialog promised
 * would not happen.
 */
export const FUNNEL_NAME_MIN_LENGTH = 2
export const FUNNEL_NAME_MAX_LENGTH = 120

const nameSchema = z.string().min(FUNNEL_NAME_MIN_LENGTH).max(FUNNEL_NAME_MAX_LENGTH)

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

/**
 * The template vocabulary, DERIVED FROM THE REGISTRY rather than restated. A
 * hand-typed enum here would let the dialog offer a template the schema
 * refuses, which is the exact failure `FUNNEL_GOALS` was introduced to prevent.
 */
const templateIdSchema = z.enum(
  FUNNEL_TEMPLATES.map((template) => template.value) as [FunnelTemplateId, ...FunnelTemplateId[]],
)

/**
 * One planned step. `goal` DEFAULTS to null rather than being required: a
 * thank-you page sells nothing, and forcing the client to send an explicit null
 * for it is a rule with no purpose that every caller would have to remember.
 */
export const createStepPlanSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  goal: goalSchema.nullable().default(null),
})

/**
 * `ref` is bounded at 120 to match `ctaTargetSchema`'s own bound in
 * `lib/funnels/sections/registry.ts`. A longer ref accepted here would be
 * rejected at RENDER — the worst possible place to discover it, because the
 * funnel is already created and the CTA silently degrades to a placeholder.
 */
const offerSchema = z.object({
  kind: z.enum(["program", "session_pack", "event"]),
  ref: z.string().min(1).max(120),
})

export const createFunnelSchema = z
  .object({
    slug: slugSchema.refine((s) => !RESERVED_FUNNEL_SLUGS.has(s), "That slug is reserved"),
    name: nameSchema,
    description: z.string().max(500).nullable().optional(),
    // Defaulted, not required: the create route predates this field and callers
    // that never heard of it must keep working.
    kind: kindSchema.default("page"),
    goal: goalSchema.nullable().optional(),
    // Everything below is optional for the same reason. A body with none of it
    // is the landing-page body, and it must parse exactly as it did before.
    template: templateIdSchema.nullable().optional(),
    audience: z.string().max(300).nullable().optional(),
    offer: offerSchema.nullable().optional(),
    starts_at: z.string().datetime().nullable().optional(),
    ends_at: z.string().datetime().nullable().optional(),
    auto_offline_at_end: z.boolean().optional(),
    notify_emails: z.array(z.string().email()).max(5).nullable().optional(),
    steps: z.array(createStepPlanSchema).min(1).max(MAX_FUNNEL_STEPS).optional(),
  })
  .superRefine((value, ctx) => {
    // ---------------------------------------------------------------------
    // THE CONDITIONAL-FIELD RULE, SERVER SIDE.
    //
    // The dialog HIDES a field its template does not ask for. This REFUSES it.
    // Both read the same `asks` array, so they cannot drift into disagreeing —
    // and without this half, a hidden field is merely invisible, not absent:
    // a hand-crafted POST would store a run window the owner can never see or
    // clear, and the window closer would eventually act on it.
    // ---------------------------------------------------------------------
    const template = getTemplate(value.template)
    // WITH NO TEMPLATE, ONLY `audience` IS ALLOWED — and that is not a special
    // case bolted on, it is what a landing page is. A page has no template
    // (templates describe a step sequence and a page has one step), but
    // `funnels.audience` is a plain column it legitimately sets and the page
    // builder's first prompt reads. Dates, offers and lead recipients remain
    // refused, because those exist only as things a funnel template asks for.
    //
    // Returning `false` for everything here — the obvious reading — silently
    // rejected every landing page that named its reader.
    const asks = (ask: TemplateAsk) =>
      template ? template.asks.includes(ask) : ask === "audience"

    const wantsWindow =
      value.starts_at != null || value.ends_at != null || value.auto_offline_at_end === true
    if (wantsWindow && !asks("dates")) {
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "This kind of funnel has no run window.",
      })
    }
    // Mirrors the migration's funnels_run_window_check, so the owner meets this
    // as a message in the dialog rather than a 500 from Postgres.
    if (value.starts_at && value.ends_at && new Date(value.ends_at) <= new Date(value.starts_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "The end must come after the start.",
      })
    }

    if (value.offer) {
      if (!asks("offer")) {
        ctx.addIssue({
          code: "custom",
          path: ["offer"],
          message: "This kind of funnel has no offer to link.",
        })
      } else if (template && value.offer.kind !== template.offerKind) {
        // A program ref on an event funnel resolves against the wrong table.
        ctx.addIssue({
          code: "custom",
          path: ["offer", "kind"],
          message: "That offer is from the wrong catalogue.",
        })
      }
    }

    if (value.notify_emails?.length && !asks("notify")) {
      ctx.addIssue({
        code: "custom",
        path: ["notify_emails"],
        message: "This kind of funnel captures no leads.",
      })
    }

    if (value.audience && !asks("audience")) {
      ctx.addIssue({
        code: "custom",
        path: ["audience"],
        message: "This kind of funnel does not ask that.",
      })
    }

    // `length > 0`, NOT a bare truthiness check on the array.
    //
    // ZOD 4 RUNS superRefine EVEN WHEN THE INNER SCHEMA ALREADY FAILED. An
    // empty `steps` fails `.min(1)` above and still arrives here, so
    // `value.steps[0].slug` threw a TypeError — turning a body that should be a
    // clean 400 into a 500 from inside the validator. Zod 3 short-circuited;
    // this one does not, and every superRefine in this file that indexes into
    // an array needs the same guard.
    if (value.steps && value.steps.length > 0) {
      // The funnel's address /go/<slug> is served by whichever step is the
      // entry, so a plan that starts anywhere else builds a funnel with no
      // front door.
      if (value.steps[0].slug !== ENTRY_STEP_SLUG) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", 0, "slug"],
          message: `The first step must be "${ENTRY_STEP_SLUG}".`,
        })
      }
      const seen = new Set<string>()
      value.steps.forEach((step, index) => {
        if (seen.has(step.slug)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", index, "slug"],
            message: "Two steps cannot share a path.",
          })
        }
        seen.add(step.slug)
      })
    }
  })

/**
 * NO `template` AND NO `steps`, deliberately.
 *
 * A template describes CREATION. Changing it later would mean deciding what
 * happens to steps the old template made and the new one does not — which is a
 * destructive question a PATCH body should not be able to ask by accident.
 * Steps are managed through `/api/admin/funnels/steps`, which already exists
 * and already orders, renames and deletes them one at a time.
 *
 * The intake fields ARE editable here — a camp's dates move — and they carry no
 * template conditional for the same reason: the funnel already exists, and
 * refusing to let someone clear a date on a funnel whose template was retired
 * would strand the row.
 */
export const updateFunnelSchema = z.object({
  slug: slugSchema.optional(),
  name: nameSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  kind: kindSchema.optional(),
  goal: goalSchema.nullable().optional(),
  audience: z.string().max(300).nullable().optional(),
  offer: offerSchema.nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  auto_offline_at_end: z.boolean().optional(),
  notify_emails: z.array(z.string().email()).max(5).nullable().optional(),
})

export const createStepSchema = z.object({
  funnel_id: z.string().uuid(),
  slug: slugSchema,
  name: nameSchema,
})

export const updateStepSchema = z.object({
  slug: slugSchema.optional(),
  name: nameSchema.optional(),
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
 * TAKING THE POLISH THE REVIEWER PROPOSED.
 *
 * `action: "polish"` now WRITES NOTHING — it streams back a proposal and stops.
 * This is the owner saying yes to one. It is a separate action rather than a
 * flag on the polish body because the two do genuinely different things: one
 * spends five model calls and touches no row, the other spends none and is the
 * only one of the pair that can move a revision.
 *
 * `ops` IS THE PAYLOAD, AND DELIBERATELY NOT `doc`. The server re-applies these
 * against its OWN copy of the page, so the worst a tampered-with body can do is
 * describe a legal edit — which is the same authority the owner already has
 * through the chat. A body carrying a document would let any admin session
 * write any document, skipping `applyOps` entirely.
 *
 * `opSchema` is the SAME schema the route parses model output with. A proposal
 * arriving here has already been through it once on the way out; parsing it
 * again on the way back in is not redundant, because what comes back is
 * whatever the client sent, not what the server sent it.
 *
 * `.min(1)` because an empty batch is not a polish. `reviewDoc` only reports
 * `changed: true` when it has ops, so an empty array here means either a client
 * bug or a hand-made request, and both deserve a 400 rather than a turn that
 * says the reviewer changed something and changed nothing.
 */
export const buildApplyPolishRequestSchema = z.object({
  action: z.literal("apply_polish"),
  revision: z.number().int().min(0),
  // THE PRODUCT, not `SECTION_BUILDER_MAX_OPS` alone. The reviser is capped at
  // that many ops PER ROUND and the review runs up to `SECTION_REVIEW_MAX_ROUNDS`
  // of them, accumulating into one `allOps` batch (review/pipeline.ts). Capping
  // at the per-round number would be correct only while rounds === 1, and would
  // start rejecting legitimate proposals the day somebody raises it — the exact
  // silent-ceiling bug the pipeline's own comment warns about for the loop.
  ops: z.array(opSchema).min(1).max(SECTION_BUILDER_MAX_OPS * SECTION_REVIEW_MAX_ROUNDS),
})

/**
 * Reset, polish and apply_polish FIRST: a body carrying any of those `action`
 * literals fails the message member (no `message`, and the literal disagrees),
 * and a `{message, revision}` body fails all three, so the union is unambiguous
 * in every direction rather than order-dependent.
 */
export const buildRequestSchema = z.union([
  buildResetRequestSchema,
  buildPolishRequestSchema,
  buildApplyPolishRequestSchema,
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
