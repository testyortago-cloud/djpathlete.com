// lib/funnels/islands.ts — the island registry.
//
// A free-form canvas emits HTML, which cannot express anything interactive.
// The seven things funnel pages need to actually DO are "islands": the canvas
// drops a placeholder element carrying `data-djp-island` + `data-djp-props`,
// the publish compiler validates those props against the schema here, and the
// public renderer swaps in a real React component.
//
// This file is the ONE place the set is defined. The editor builds its block
// palette from it, the compiler validates against it, and the renderer
// switches on it — so those three can never drift apart.

import { z } from "zod"
import { CTA_VARIANTS } from "@/lib/funnels/cta-class"

export const ISLAND_NAMES = ["form", "checkout", "event", "booking", "testimonials", "faq", "quiz"] as const

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
export const SAFE_LINK = /^(?!\/\/)(\/|https:\/\/)/

/**
 * Hosts a redirect is allowed to hand a visitor to.
 *
 * The allowlist exists at all because `SAFE_LINK` only closes the scheme hole
 * (`javascript:`) and the protocol-relative hole (`//evil.example`) —
 * `https://attacker.example/` still passed it, a live open redirect for a
 * lead that just handed over their contact info (Stage 0 safety item 1,
 * docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md).
 *
 * `calendly.com` / `www.calendly.com` are on it by explicit owner decision,
 * not oversight: commit ed8bbfdc's message states "legitimate thank-you
 * pages live off-site (Calendly), so a host allowlist is an owner policy
 * call, not a silent default." This list is that policy call, made once
 * both the open-redirect fix and the Calendly workflow were on the table
 * together. Anyone tightening this list should re-read that commit first.
 */
const REDIRECT_HOSTS: readonly string[] = ["www.darrenjpaul.com", "darrenjpaul.com", "calendly.com", "www.calendly.com"]

const REDIRECT_HOST_ERROR = `Must be a site path or an https URL on one of: ${REDIRECT_HOSTS.join(", ")}`

/**
 * Checked with a try/catch because `new URL()` throws on anything that isn't
 * a well-formed absolute URL, and a validator must fail closed with a Zod
 * issue, not an uncaught exception.
 */
function isAllowedRedirect(value: string): boolean {
  if (value.startsWith("/")) return true
  try {
    return REDIRECT_HOSTS.includes(new URL(value).hostname)
  } catch {
    return false
  }
}

export const FUNNEL_FIELD_TYPES = ["text", "email", "tel", "textarea", "select", "checkbox"] as const
export type FunnelFieldType = (typeof FUNNEL_FIELD_TYPES)[number]

/**
 * WHICH SIGNUP VALUE A FIELD CARRIES, DECLARED RATHER THAN GUESSED.
 *
 * Every name here is a key of `createEventSignupSchema` — islands.test.ts
 * asserts that agreement against the real schema rather than a copy of its
 * shape, because a role the signup schema has no key for is a role that maps
 * nowhere. Nothing infers meaning from a label or a field name: "Player's name"
 * carries `athlete_name` because the form says so, and an owner who renames it
 * to "Your child" keeps a working checkout.
 *
 * A field with NO role is not second-class. It is an ordinary question whose
 * answer lands in the funnel submission payload, which is how an owner's own
 * "Current level" question survives on a form that also takes payment — there
 * is no key for it in the signup schema and it does not need one.
 */
export const FORM_FIELD_ROLES = [
  "parent_name",
  "parent_email",
  "parent_phone",
  "athlete_name",
  "athlete_age",
  "sport",
  "notes",
  "waiver_accepted",
] as const

export type FormFieldRole = (typeof FORM_FIELD_ROLES)[number]

/**
 * The roles `createEventSignupSchema` will not accept a payload without.
 *
 * `parent_phone`, `sport` and `notes` are optional there and optional here. A
 * checkout form missing any role below is refused by `formIslandSchema`, so the
 * owner is told at publish instead of a parent discovering it mid-payment.
 */
export const CHECKOUT_REQUIRED_ROLES = [
  "parent_name",
  "parent_email",
  "athlete_name",
  "athlete_age",
  "waiver_accepted",
] as const

export const funnelFormFieldSchema = z.object({
  /** Submitted key. Constrained so it can be a safe object key and form name. */
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Field name must be lowercase letters, digits and underscores"),
  label: z.string().min(1).max(120),
  type: z.enum(FUNNEL_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  placeholder: z.string().max(120).optional(),
  /** Only meaningful for type=select. */
  options: z.array(z.string().min(1).max(80)).max(30).optional(),
  /** See `FORM_FIELD_ROLES`. Read only when `successMode` is "checkout". */
  role: z.enum(FORM_FIELD_ROLES).optional(),
})

export type FunnelFormField = z.infer<typeof funnelFormFieldSchema>

export const formIslandSchema = z
  .object({
    /** Identifies this form within the step, so submissions can be told apart. */
    formKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Invalid form key"),
    fields: z.array(funnelFormFieldSchema).min(1).max(20),
    submitLabel: z.string().min(1).max(60).optional().default("Submit"),
    successMode: z.enum(["message", "redirect", "checkout"]).optional().default("message"),
    successMessage: z.string().max(400).optional(),
    // FunnelForm assigns this to window.location.href after a successful
    // submission, so an unvalidated value is an open redirect that fires at the
    // exact moment a visitor has handed over their email. Same rule as
    // bookingIslandSchema.href below, which was validated while this was not.
    // Constrains BOTH the scheme (SAFE_LINK) and the host (isAllowedRedirect):
    // a submitted lead can only be sent to a site path or an https URL on an
    // allowlisted host — see REDIRECT_HOSTS above for why Calendly is on it.
    redirectUrl: z
      .string()
      .max(500)
      .regex(SAFE_LINK, "Must be a site path or an https URL")
      .refine(isAllowedRedirect, REDIRECT_HOST_ERROR)
      .optional(),
    /**
     * Emails this lead magnet's asset on success.
     *
     * *** THE ONE UUID FIELD THE PAGE BUILDER'S MODEL CAN LEGALLY WRITE, AND
     * *** THE ONLY EXCEPTION TO "THE AI NEVER WRITES A UUID".
     *
     * Every other row reference in a generated page is a NAME that
     * `lib/funnels/sections/resolve.ts` turns into a real id on the server,
     * with an unresolved one blocking publish. This field is not: it takes a
     * uuid directly, and the rule keeping the model off it is PROMPT TEXT
     * alone (`prompt.ts`'s "You never write a UUID" block, generated from
     * `UUID_FIELD_PATHS`, which this field is what populates). A prompt is a
     * request, not a validator.
     *
     * It is LATENT, not live: nothing reads `form.props.leadMagnetId` today
     * (grep before trusting this sentence). The moment a handler does, it
     * inherits a possibly-fabricated uuid with no resolver and no gate behind
     * it — an id that passes `.uuid()`, passes the compiler, passes the
     * publish gate, and then silently emails nobody anything.
     *
     * SO: BEFORE WIRING A CONSUMER, give it what the CTA refs have — a
     * name-or-id ref resolved against the real lead-magnet rows in
     * `resolveDoc`, reported through `ResolveResult.unresolved` (or a sibling
     * list, as `UnknownFaqKey` is), so an id nobody can find blocks publish
     * instead of failing silently on a live page.
     */
    leadMagnetId: z.string().uuid().nullable().optional(),
    consentText: z.string().max(300).optional(),
    /**
     * The camp or clinic this form sells, when `successMode` is "checkout".
     *
     * A uuid the OWNER supplies through `island-fields.ts`, exactly as the event
     * island's is. `UUID_FIELD_PATHS` is generated from the section schemas, so
     * the builder prompt tells the model to omit it — and per the `leadMagnetId`
     * note above, that is necessary and NOT SUFFICIENT: a prompt is a request,
     * not a validator. What makes this safe is `publishGate`, which refuses to
     * publish a checkout form whose id does not name an event that is currently
     * offered and has a Stripe price. That is the resolver-and-gate treatment
     * `leadMagnetId` is still waiting for.
     */
    eventId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.successMode === "redirect" && !value.redirectUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["redirectUrl"],
        message: "redirectUrl is required when successMode is 'redirect'",
      })
    }

    // ZOD 4 RUNS THIS EVEN WHEN `fields` ITSELF FAILED, so every read below is
    // guarded. `lib/validators/funnel.ts` turned a clean 400 into a 500 by
    // assuming `.min(1)` had short-circuited an array access here.
    const fields = Array.isArray(value.fields) ? value.fields : []

    // One field per role, in EVERY mode. Two fields claiming `parent_email` is
    // ambiguous whatever the form does with them, and resolving it by taking the
    // first silently drops a question the owner meant to ask.
    const seen = new Map<string, number>()
    fields.forEach((field, index) => {
      const role = field?.role
      if (typeof role !== "string") return
      if (seen.has(role)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", index, "role"],
          message: `Two fields both claim the "${role}" role. Only one field may supply each value.`,
        })
        return
      }
      seen.set(role, index)
    })

    if (value.successMode !== "checkout") return

    if (typeof value.eventId !== "string" || value.eventId === "") {
      ctx.addIssue({
        code: "custom",
        path: ["eventId"],
        message: "A form that takes payment must name the camp or clinic it sells.",
      })
    }

    for (const role of CHECKOUT_REQUIRED_ROLES) {
      if (!seen.has(role)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: `This form takes payment but no field carries the "${role}" role.`,
        })
      }
    }

    /**
     * Reports against the FIELD'S OWN PATH, so the builder highlights the field
     * that is wrong rather than the whole form.
     *
     * Takes the index as a definite number: `seen.get()` returns
     * `number | undefined`, and a guard on the FIELD does not narrow the INDEX —
     * `path: ["fields", maybeUndefined, "type"]` is a type error, and four of them
     * nearly shipped here.
     */
    const rejectField = (index: number, message: string) => {
      ctx.addIssue({ code: "custom", path: ["fields", index, "type"], message })
    }

    // `required` carries `.default(false)`, and a superRefine can see raw input
    // on some paths — so compare against `!== true`, never `=== false`.
    const waiverIndex = seen.get("waiver_accepted")
    if (waiverIndex !== undefined) {
      const waiver = fields[waiverIndex]
      if (waiver && (waiver.type !== "checkbox" || waiver.required !== true)) {
        rejectField(
          waiverIndex,
          "The waiver field must be a required checkbox — a legal gate that can be left blank is not a gate.",
        )
      }
    }

    const emailIndex = seen.get("parent_email")
    if (emailIndex !== undefined) {
      const email = fields[emailIndex]
      if (email && email.type !== "email") {
        rejectField(emailIndex, "The field carrying the parent's email must be type email.")
      }
    }

    const ageIndex = seen.get("athlete_age")
    if (ageIndex !== undefined) {
      const age = fields[ageIndex]
      if (age && age.type !== "select" && age.type !== "text") {
        rejectField(ageIndex, "The athlete's age must be a select or a text field, so it can be read as a number.")
      }
    }
  })

// ---------------------------------------------------------------------------
// checkout / event / booking / testimonials / faq
// ---------------------------------------------------------------------------

export const checkoutIslandSchema = z
  .object({
    productKind: z.enum(["program", "session_pack"]),
    // Required only for productKind "program": CheckoutIsland.tsx links to
    // `/client/programs/${productId}`. For "session_pack" the component
    // ignores productId entirely and routes to /client/sessions — requiring a
    // UUID it then discards is exactly the training signal that teaches a
    // model to fabricate ids, so it must be optional in that branch.
    productId: z.string().uuid().optional(),
    label: z.string().min(1).max(60).optional().default("Buy now"),

/**
 * Which CTA treatment this island wears — see `lib/funnels/cta-class.ts`.
 *
 * SET BY THE RENDERER, NEVER BY AN AUTHOR AND NEVER BY THE AI. A CTA in a
 * `SectionDoc` is `{label, target}`; how it should LOOK is a property of where
 * it sits (a hero's primary, a footer's link row), which only the call site in
 * `render.ts` knows. That is also why it has no `ISLAND_TRAITS` entry: there is
 * nothing here for a person to choose.
 *
 * Optional with NO DEFAULT, so a page published before this existed keeps
 * rendering exactly as it does today. See `ctaClassFor`.
 */
  variant: z.enum(CTA_VARIANTS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.productKind === "program" && !value.productId) {
      ctx.addIssue({
        code: "custom",
        path: ["productId"],
        message: "productId is required when productKind is 'program'",
      })
    }
  })

export const eventIslandSchema = z.object({
  eventId: z.string().uuid(),
  showSpots: z.boolean().optional().default(true),
  label: z.string().min(1).max(60).optional().default("Register"),

/**
 * Which CTA treatment this island wears — see `lib/funnels/cta-class.ts`.
 *
 * SET BY THE RENDERER, NEVER BY AN AUTHOR AND NEVER BY THE AI. A CTA in a
 * `SectionDoc` is `{label, target}`; how it should LOOK is a property of where
 * it sits (a hero's primary, a footer's link row), which only the call site in
 * `render.ts` knows. That is also why it has no `ISLAND_TRAITS` entry: there is
 * nothing here for a person to choose.
 *
 * Optional with NO DEFAULT, so a page published before this existed keeps
 * rendering exactly as it does today. See `ctaClassFor`.
 */
  variant: z.enum(CTA_VARIANTS).optional(),
})

export const bookingIslandSchema = z.object({
  label: z.string().min(1).max(60).optional().default("Book a call"),
  /**
   * Where the CTA goes. There is no public booking widget in this app to embed
   * — enquiries run through /contact — so this island is a routed call-to-action
   * rather than an inline calendar.
   */
  href: z.string().max(300).regex(SAFE_LINK, "Must be a site path or an https URL").optional().default("/contact"),

/**
 * Which CTA treatment this island wears — see `lib/funnels/cta-class.ts`.
 *
 * SET BY THE RENDERER, NEVER BY AN AUTHOR AND NEVER BY THE AI. A CTA in a
 * `SectionDoc` is `{label, target}`; how it should LOOK is a property of where
 * it sits (a hero's primary, a footer's link row), which only the call site in
 * `render.ts` knows. That is also why it has no `ISLAND_TRAITS` entry: there is
 * nothing here for a person to choose.
 *
 * Optional with NO DEFAULT, so a page published before this existed keeps
 * rendering exactly as it does today. See `ctaClassFor`.
 */
  variant: z.enum(CTA_VARIANTS).optional(),
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
// quiz
// ---------------------------------------------------------------------------

/**
 * A scored, branching quiz.
 *
 * THE BLOCK HOLDS A POINTER, NOT A COPY. `quizId` references a row in
 * `quizzes`; the questions, weights, bands and result copy all live in the
 * database. That is what makes editing a weight take effect on every page
 * showing the quiz, immediately, with no re-publish — and it is why a funnel
 * cannot publish against a quiz that would fail its activation gate (see
 * `unresolvedQuizzes` in the publish gate).
 *
 * There is deliberately no `questions` prop. Embedding them would make the
 * published page a stale copy the editor could not reach.
 */
export const quizIslandSchema = z.object({
  quizId: z.string().uuid(),
  submitLabel: z.string().min(1).max(60).optional().default("See my result"),
  /** Shown beside the details form the quiz gates its result behind. */
  consentText: z.string().max(300).optional(),
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
    description: "Routes the visitor into the existing purchase flow for a program or session pack.",
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
  quiz: {
    name: "quiz",
    label: "Quiz",
    description: "A scored, branching quiz. Sorts the visitor into an archetype and emails them a result.",
    schema: quizIslandSchema,
    // quizId is intentionally blank: there is no sensible default quiz, and a
    // blank one fails the schema, so the block cannot be published until the
    // owner has picked one. Failing at publish is the point.
    defaultProps: { quizId: "", submitLabel: "See my result" },
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
