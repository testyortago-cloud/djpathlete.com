// lib/funnels/islands.ts — the island registry.
//
// A free-form canvas emits HTML, which cannot express anything interactive.
// The six things funnel pages need to actually DO are "islands": the canvas
// drops a placeholder element carrying `data-djp-island` + `data-djp-props`,
// the publish compiler validates those props against the schema here, and the
// public renderer swaps in a real React component.
//
// This file is the ONE place the set is defined. The editor builds its block
// palette from it, the compiler validates against it, and the renderer
// switches on it — so those three can never drift apart.

import { z } from "zod"

export const ISLAND_NAMES = [
  "form",
  "checkout",
  "event",
  "booking",
  "testimonials",
  "faq",
] as const

export type IslandName = (typeof ISLAND_NAMES)[number]

export function isIslandName(value: unknown): value is IslandName {
  return typeof value === "string" && (ISLAND_NAMES as readonly string[]).includes(value)
}

/** Attribute the canvas stamps on a placeholder element. */
export const ISLAND_ATTR = "data-djp-island"
/** Attribute holding the island's JSON-encoded props. */
export const ISLAND_PROPS_ATTR = "data-djp-props"

// ---------------------------------------------------------------------------
// form
// ---------------------------------------------------------------------------

/**
 * A link we are willing to navigate a visitor to: a root-relative site path or
 * an https URL.
 *
 * The `(?!\/\/)` lookahead is the part that matters. A naive `^(\/|https:\/\/)`
 * accepts `//evil.example`, which is protocol-relative — it reads as a path but
 * navigates off-site on the page's own scheme. `safeUrl` in the compiler has
 * always rejected those; these schemas did not, until a test said so.
 */
const SAFE_LINK = /^(?!\/\/)(\/|https:\/\/)/

export const FUNNEL_FIELD_TYPES = ["text", "email", "tel", "textarea", "select", "checkbox"] as const
export type FunnelFieldType = (typeof FUNNEL_FIELD_TYPES)[number]

export const funnelFormFieldSchema = z.object({
  /** Submitted key. Constrained so it can be a safe object key and form name. */
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "Field name must be lowercase letters, digits and underscores"),
  label: z.string().min(1).max(120),
  type: z.enum(FUNNEL_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  placeholder: z.string().max(120).optional(),
  /** Only meaningful for type=select. */
  options: z.array(z.string().min(1).max(80)).max(30).optional(),
})

export type FunnelFormField = z.infer<typeof funnelFormFieldSchema>

export const formIslandSchema = z
  .object({
    /** Identifies this form within the step, so submissions can be told apart. */
    formKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Invalid form key"),
    fields: z.array(funnelFormFieldSchema).min(1).max(20),
    submitLabel: z.string().min(1).max(60).optional().default("Submit"),
    successMode: z.enum(["message", "redirect"]).optional().default("message"),
    successMessage: z.string().max(400).optional(),
    // FunnelForm assigns this to window.location.href after a successful
    // submission, so an unvalidated value is an open redirect that fires at the
    // exact moment a visitor has handed over their email. Same rule as
    // bookingIslandSchema.href below, which was validated while this was not.
    // NOTE: this constrains the SCHEME, not the host. Redirecting to an
    // arbitrary https host is still permitted because legitimate thank-you
    // pages live off-site; restricting that further is an owner policy call.
    redirectUrl: z
      .string()
      .max(500)
      .regex(SAFE_LINK, "Must be a site path or an https URL")
      .optional(),
    /** Emails this lead magnet's asset on success. */
    leadMagnetId: z.string().uuid().nullable().optional(),
    consentText: z.string().max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.successMode === "redirect" && !value.redirectUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["redirectUrl"],
        message: "redirectUrl is required when successMode is 'redirect'",
      })
    }
  })

// ---------------------------------------------------------------------------
// checkout / event / booking / testimonials / faq
// ---------------------------------------------------------------------------

export const checkoutIslandSchema = z.object({
  productKind: z.enum(["program", "session_pack"]),
  productId: z.string().uuid(),
  label: z.string().min(1).max(60).optional().default("Buy now"),
})

export const eventIslandSchema = z.object({
  eventId: z.string().uuid(),
  showSpots: z.boolean().optional().default(true),
  label: z.string().min(1).max(60).optional().default("Register"),
})

export const bookingIslandSchema = z.object({
  label: z.string().min(1).max(60).optional().default("Book a call"),
  /**
   * Where the CTA goes. There is no public booking widget in this app to embed
   * — enquiries run through /contact — so this island is a routed call-to-action
   * rather than an inline calendar.
   */
  href: z
    .string()
    .max(300)
    .regex(SAFE_LINK, "Must be a site path or an https URL")
    .optional()
    .default("/contact"),
})

export const testimonialsIslandSchema = z.object({
  limit: z.number().int().min(1).max(12).optional().default(3),
  /** Mirrors testimonials.is_featured — the table has no free-text tag column. */
  featuredOnly: z.boolean().optional().default(false),
})

export const faqIslandSchema = z.object({
  /** faqs rows are scoped by page_key, so the owner picks which set to show. */
  pageKey: z.string().min(1).max(60),
  limit: z.number().int().min(1).max(20).optional().default(6),
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface IslandDef {
  name: IslandName
  /** Shown in the editor's block palette. */
  label: string
  description: string
  schema: z.ZodType
  /** Seeded into `data-djp-props` when the block is first dropped. */
  defaultProps: Record<string, unknown>
}

export const ISLANDS: Record<IslandName, IslandDef> = {
  form: {
    name: "form",
    label: "Opt-in form",
    description: "Captures a lead. Submissions land in the funnel with full attribution.",
    schema: formIslandSchema,
    defaultProps: {
      formKey: "optin",
      fields: [
        { name: "first_name", label: "First name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
      ],
      submitLabel: "Get instant access",
      successMode: "message",
      successMessage: "You're in — check your inbox.",
    },
  },
  checkout: {
    name: "checkout",
    label: "Buy button",
    description:
      "Routes the visitor into the existing purchase flow for a program or session pack.",
    schema: checkoutIslandSchema,
    defaultProps: { productKind: "program", productId: "", label: "Buy now" },
  },
  event: {
    name: "event",
    label: "Camp / clinic registration",
    description: "Live dates, price and spots remaining for an event, with a register button.",
    schema: eventIslandSchema,
    defaultProps: { eventId: "", showSpots: true, label: "Register" },
  },
  booking: {
    name: "booking",
    label: "Book a call",
    description: "A call-to-action that sends an application funnel on to the enquiry flow.",
    schema: bookingIslandSchema,
    defaultProps: { label: "Book a call", href: "/contact" },
  },
  testimonials: {
    name: "testimonials",
    label: "Testimonials",
    description: "Pulls live from the testimonials table, so pages stay current without re-editing.",
    schema: testimonialsIslandSchema,
    defaultProps: { limit: 3, featuredOnly: false },
  },
  faq: {
    name: "faq",
    label: "FAQ",
    description: "Pulls live from the faqs table for a chosen page key.",
    schema: faqIslandSchema,
    defaultProps: { pageKey: "", limit: 6 },
  },
}

export const ISLAND_LIST: readonly IslandDef[] = ISLAND_NAMES.map((n) => ISLANDS[n])

/**
 * Validates raw props for an island. Returns the parsed props (with defaults
 * applied) or a list of human-readable errors — publish fails on errors rather
 * than shipping a page with a broken element.
 */
export function parseIslandProps(
  name: IslandName,
  raw: unknown,
): { ok: true; props: Record<string, unknown> } | { ok: false; errors: string[] } {
  const result = ISLANDS[name].schema.safeParse(raw)
  if (result.success) {
    return { ok: true, props: result.data as Record<string, unknown> }
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".")
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return { ok: false, errors }
}
