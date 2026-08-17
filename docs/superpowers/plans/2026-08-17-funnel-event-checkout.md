# Funnel Event Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A funnel's Register form submits straight to Stripe Checkout for a paid event, using the details and waiver consent it already collected, instead of sending the parent to the event's own page to re-enter everything.

**Architecture:** The existing `form` island learns `successMode: "checkout"`. Each field carries an optional `role` naming which `createEventSignupSchema` value it supplies, so nothing is inferred from labels. `/api/funnels/submit` grows one branch that writes the lead first, then calls a helper shared with `/api/events/[id]/checkout`. The publish gate refuses a checkout form whose camp cannot take money, using event rows `loadCatalogues` already fetches.

**Tech Stack:** Next.js 16 App Router, Zod 4, Supabase (service role), Stripe Checkout, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-17-funnel-event-checkout-design.md](../specs/2026-08-17-funnel-event-checkout-design.md)

## Global Constraints

- **Zod 4.** `.superRefine()` runs even when inner checks already failed — guard every array index and property read inside it. See `lib/validators/funnel.ts` for the bug this caused.
- **Never restate a schema.** Import `createEventSignupSchema` from `@/lib/validators/event-signups`; never re-declare its shape. This repo has shipped three bugs from restating instead of importing (`prompt.ts` counts them).
- **`CatalogueEntry` additions must be OPTIONAL.** `resolve.ts:150`: a `Catalogue` gaining a required key `loadCatalogue` does not supply is how a CTA silently fails to resolve.
- **Return URLs are built server-side from the funnel's own slugs.** Never from request input. `{CHECKOUT_SESSION_ID}` must reach Stripe unescaped.
- **The published form config is the authority.** `getPublishedFormConfig` returns the island's whole `props`; read `successMode`, `eventId` and `fields` from it, never from the request body.
- **Flag:** reuse `FUNNEL_CHECKOUT_FLAG` (`funnel_anonymous_checkout_enabled`), default `FUNNEL_CHECKOUT_DEFAULT` (`false`), passed explicitly at every call site. Flag off returns **404**, not 403.
- **Tests:** `npx vitest run <path>` targeted only. Never the full suite. A build gate is `npx tsc --noEmit` grepped for your own files.
- **Commit per task.** Do not push. Do not deploy. Do not write to the production database.

---

### Task 1: The field-role contract

**Files:**
- Modify: `lib/funnels/islands.ts:81-90` (`funnelFormFieldSchema`), `lib/funnels/islands.ts:94-115` (`formIslandSchema`)
- Test: `__tests__/lib/funnels/islands.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FORM_FIELD_ROLES` (readonly tuple), `type FormFieldRole`, `CHECKOUT_REQUIRED_ROLES` (readonly tuple), `funnelFormFieldSchema` with optional `role`, `formIslandSchema` with `successMode: "message" | "redirect" | "checkout"` and optional `eventId: string` (uuid).

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/funnels/islands.test.ts — append
import { CHECKOUT_REQUIRED_ROLES, FORM_FIELD_ROLES, formIslandSchema } from "@/lib/funnels/islands"

const EVENT_ID = "11111111-2222-4333-8444-555555555555"

/** A form that satisfies every checkout rule. Individual tests break ONE thing. */
function checkoutForm(overrides: Record<string, unknown> = {}) {
  return {
    formKey: "register",
    successMode: "checkout",
    eventId: EVENT_ID,
    fields: [
      { name: "parent_name", label: "Your name", type: "text", required: true, role: "parent_name" },
      { name: "email", label: "Email", type: "email", required: true, role: "parent_email" },
      { name: "player", label: "Player's name", type: "text", required: true, role: "athlete_name" },
      { name: "age", label: "Player's age", type: "select", required: true, role: "athlete_age", options: ["12", "13"] },
      { name: "waiver", label: "I accept the waiver", type: "checkbox", required: true, role: "waiver_accepted" },
    ],
    ...overrides,
  }
}

describe("the field-role contract", () => {
  it("accepts a fully-roled checkout form", () => {
    const parsed = formIslandSchema.safeParse(checkoutForm())
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it("rejects two fields claiming the same role", () => {
    const form = checkoutForm()
    form.fields.push({ name: "email2", label: "Confirm email", type: "email", required: true, role: "parent_email" })
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it.each(CHECKOUT_REQUIRED_ROLES)("rejects a checkout form with no %s field", (role) => {
    const form = checkoutForm()
    form.fields = form.fields.filter((f) => f.role !== role)
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it("rejects a checkout form with no eventId — there is nothing to sell", () => {
    expect(formIslandSchema.safeParse(checkoutForm({ eventId: undefined })).success).toBe(false)
  })

  it("requires waiver_accepted to be a required checkbox", () => {
    const asText = checkoutForm()
    asText.fields = asText.fields.map((f) => (f.role === "waiver_accepted" ? { ...f, type: "text" } : f))
    expect(formIslandSchema.safeParse(asText).success).toBe(false)

    const optional = checkoutForm()
    optional.fields = optional.fields.map((f) => (f.role === "waiver_accepted" ? { ...f, required: false } : f))
    expect(formIslandSchema.safeParse(optional).success).toBe(false)
  })

  it("requires parent_email to be type email", () => {
    const form = checkoutForm()
    form.fields = form.fields.map((f) => (f.role === "parent_email" ? { ...f, type: "text" } : f))
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it("requires athlete_age to be a select or text", () => {
    const form = checkoutForm()
    form.fields = form.fields.map((f) => (f.role === "athlete_age" ? { ...f, type: "textarea" } : f))
    expect(formIslandSchema.safeParse(form).success).toBe(false)
  })

  it("ignores roles entirely when successMode is not checkout", () => {
    // MUTANT: enforcing the required-role rule unconditionally. A lead-gen form
    // carrying one stray role would stop publishing, which is a regression on
    // every existing page.
    const leadgen = {
      formKey: "optin",
      successMode: "message",
      fields: [{ name: "email", label: "Email", type: "email", required: true, role: "parent_email" }],
    }
    expect(formIslandSchema.safeParse(leadgen).success).toBe(true)
  })

  it("keeps unroled fields — the owner's own questions survive", () => {
    const form = checkoutForm()
    form.fields.push({ name: "level", label: "Current level", type: "select", options: ["New", "Club"] })
    const parsed = formIslandSchema.safeParse(form)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.fields.some((f) => f.name === "level" && f.role === undefined)).toBe(true)
  })

  it("still accepts every pre-existing form shape", () => {
    // The two default props shipped in ISLANDS.form must remain valid.
    expect(
      formIslandSchema.safeParse({
        formKey: "optin",
        fields: [
          { name: "first_name", label: "First name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
        ],
        submitLabel: "Get instant access",
        successMode: "message",
        successMessage: "You're in — check your inbox.",
      }).success,
    ).toBe(true)
  })

  it("names every role in FORM_FIELD_ROLES that createEventSignupSchema can take", async () => {
    // Asserted as AGREEMENT with the real validator, never against a hardcoded
    // list: a role the signup schema cannot accept is a role that maps nowhere.
    const { createEventSignupSchema } = await import("@/lib/validators/event-signups")
    const signupKeys = Object.keys(createEventSignupSchema.shape)
    for (const role of FORM_FIELD_ROLES) expect(signupKeys).toContain(role)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/funnels/islands.test.ts`
Expected: FAIL — `FORM_FIELD_ROLES` is not exported.

- [ ] **Step 3: Implement**

In `lib/funnels/islands.ts`, above `funnelFormFieldSchema`:

```ts
/**
 * WHICH SIGNUP VALUE A FIELD CARRIES, DECLARED RATHER THAN GUESSED.
 *
 * Every name here is a key of `createEventSignupSchema` (islands.test.ts asserts
 * that agreement against the real schema). Nothing infers meaning from a label
 * or a field name: "Player's name" carries `athlete_name` because the form says
 * so, and renaming it to "Your child" keeps working.
 *
 * A field with NO role is not second-class — it is an ordinary question whose
 * answer lands in the funnel submission payload, which is how an owner's own
 * "Current level" question survives a form that also takes payment.
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
 * `sport`, `notes` and `parent_phone` are optional there and optional here.
 */
export const CHECKOUT_REQUIRED_ROLES = [
  "parent_name",
  "parent_email",
  "athlete_name",
  "athlete_age",
  "waiver_accepted",
] as const
```

Add to `funnelFormFieldSchema`'s object (after `options`):

```ts
  /** See FORM_FIELD_ROLES. Only read when successMode is "checkout". */
  role: z.enum(FORM_FIELD_ROLES).optional(),
```

In `formIslandSchema`, change `successMode` and add `eventId`:

```ts
    successMode: z.enum(["message", "redirect", "checkout"]).optional().default("message"),
```

```ts
    /**
     * The camp or clinic this form sells. A uuid the OWNER supplies via
     * island-fields.ts, exactly as the event island's is.
     *
     * `UUID_FIELD_PATHS` is generated from the section schemas, so the builder
     * prompt tells the model to omit this. That is necessary and not sufficient
     * — see the `leadMagnetId` note below: a prompt is a request, not a
     * validator. `publishGate` is what verifies the id names an event that can
     * actually take money.
     */
    eventId: z.string().uuid().optional(),
```

Then extend the existing `.superRefine(...)` chained onto `formIslandSchema` (or add one if the redirect rule uses `.refine`) with the role rules. **Guard every index — Zod 4 runs this even after inner failures:**

```ts
  .superRefine((props, ctx) => {
    const fields = Array.isArray(props.fields) ? props.fields : []

    // One field per role, whatever the success mode.
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

    if (props.successMode !== "checkout") return

    if (typeof props.eventId !== "string" || props.eventId === "") {
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

    const waiverIndex = seen.get("waiver_accepted")
    const waiver = waiverIndex === undefined ? undefined : fields[waiverIndex]
    if (waiver && (waiver.type !== "checkbox" || waiver.required !== true)) {
      ctx.addIssue({
        code: "custom",
        path: ["fields", waiverIndex, "type"],
        message: "The waiver field must be a required checkbox — a legal gate that can be left blank is not a gate.",
      })
    }

    const emailIndex = seen.get("parent_email")
    const email = emailIndex === undefined ? undefined : fields[emailIndex]
    if (email && email.type !== "email") {
      ctx.addIssue({
        code: "custom",
        path: ["fields", emailIndex, "type"],
        message: "The parent email field must be type email.",
      })
    }

    const ageIndex = seen.get("athlete_age")
    const age = ageIndex === undefined ? undefined : fields[ageIndex]
    if (age && age.type !== "select" && age.type !== "text") {
      ctx.addIssue({
        code: "custom",
        path: ["fields", ageIndex, "type"],
        message: "The athlete age field must be a select or a text field.",
      })
    }
  })
```

Note: `required` carries `.default(false)`, so a parsed field always has a boolean — but this refine sees the RAW input on some Zod paths. Compare with `!== true` rather than `=== false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/funnels/islands.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the neighbours that consume this schema**

Run: `npx vitest run __tests__/lib/funnels/ __tests__/lib/funnels/sections/leadgen.test.ts`
Expected: PASS. `leadgen.test.ts` walks the island classes and `prompt.test.ts` asserts UUID rules — if `prompt.test.ts` fails because `eventId` joined `UUID_FIELD_PATHS`, that is the generated prompt correctly changing; update the expectation, do not remove the field.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/islands.ts __tests__/lib/funnels/islands.test.ts
git commit -m "feat(funnels): a form field can declare which signup value it carries"
```

---

### Task 2: The catalogue learns whether a camp can take money

**Files:**
- Modify: `lib/funnels/sections/resolve.ts:159-163` (`CatalogueEntry`), `lib/funnels/sections/resolve.ts:249-255` (`toCatalogue`)
- Test: `__tests__/lib/funnels/sections/resolve.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CatalogueEntry` with optional `priced?: boolean` and `soldOut?: boolean`, populated for events only.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/resolve.test.ts — append
describe("toCatalogue carries what a checkout gate needs", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    id: "11111111-2222-4333-8444-555555555555",
    title: "Summer Camp",
    stripe_price_id: "price_123",
    capacity: 12,
    signup_count: 3,
    ...over,
  })

  it("marks an event with a stripe price as priced and not sold out", () => {
    const cat = toCatalogue({ programs: [], sessionPacks: [], events: [event()] as never })
    expect(cat.event[0]).toMatchObject({ name: "Summer Camp", priced: true, soldOut: false })
  })

  it("marks an event with no stripe price as unpriced", () => {
    const cat = toCatalogue({ programs: [], sessionPacks: [], events: [event({ stripe_price_id: null })] as never })
    expect(cat.event[0].priced).toBe(false)
  })

  it("marks a full event sold out — at capacity and over it", () => {
    const at = toCatalogue({ programs: [], sessionPacks: [], events: [event({ signup_count: 12 })] as never })
    expect(at.event[0].soldOut).toBe(true)
    const over = toCatalogue({ programs: [], sessionPacks: [], events: [event({ signup_count: 13 })] as never })
    expect(over.event[0].soldOut).toBe(true)
  })

  it("leaves programs and packs without the event-only keys", () => {
    // MUTANT: setting priced/soldOut for every kind. A program's ability to be
    // sold is not decided by an event's Stripe price, and a gate reading these
    // on a program would be reading a fabricated answer.
    const cat = toCatalogue({
      programs: [{ id: "p", name: "Program" }] as never,
      sessionPacks: [{ id: "s", name: "Pack" }] as never,
      events: [],
    })
    expect(cat.program[0].priced).toBeUndefined()
    expect(cat.session_pack[0].soldOut).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts -t "checkout gate needs"`
Expected: FAIL — `priced` is undefined.

- [ ] **Step 3: Implement**

`CatalogueEntry` gains two optional keys:

```ts
export interface CatalogueEntry {
  id: string
  name: string
  /**
   * EVENTS ONLY, AND OPTIONAL ON PURPOSE. `resolve.ts`'s own warning above says
   * a `Catalogue` key that `loadCatalogue` does not supply must never be
   * required — that is how a CTA silently fails to resolve. A program has no
   * Stripe price of the kind an event signup needs, so it carries neither key
   * and a reader must treat `undefined` as "not applicable", never as false.
   */
  priced?: boolean
  /** Events only: `signup_count >= capacity`. */
  soldOut?: boolean
}
```

`toCatalogue`'s event branch:

```ts
    event: events.map((row) => ({
      id: row.id,
      name: row.title,
      // Both derived from rows already in hand — `getPublishedEvents` does
      // `select("*")`, so this costs no extra query.
      priced: typeof row.stripe_price_id === "string" && row.stripe_price_id.length > 0,
      soldOut: row.signup_count >= row.capacity,
    })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts`
Expected: PASS, including the pre-existing "a Catalogue key loadCatalogue omits" test.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/resolve.ts __tests__/lib/funnels/sections/resolve.test.ts
git commit -m "feat(funnels): the catalogue says whether an event can take a payment"
```

---

### Task 3: The publish gate refuses a form that cannot be paid

**Files:**
- Modify: `lib/funnels/sections/resolve.ts` — `ResolveResult` (:627), `resolveDoc`, `publishGate` (:1220)
- Test: `__tests__/lib/funnels/sections/resolve.test.ts`

**Interfaces:**
- Consumes: `CatalogueEntry.priced` / `.soldOut` (Task 2), `formIslandSchema`'s `successMode` / `eventId` (Task 1).
- Produces: `ResolveResult.unsellableCheckouts: UnsellableCheckout[]` (blocker) and `ResolveResult.soldOutCheckouts: SoldOutCheckout[]` (warning); `publishGate` folds the first into `blockers` and the second into `warnings`.

```ts
export interface UnsellableCheckout {
  sectionId: string
  eventId: string
  reason: "unknown" | "not_offered" | "unpriced"
}
export interface SoldOutCheckout {
  sectionId: string
  eventId: string
  name: string
}
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/resolve.test.ts — append
describe("publishGate on a form that takes payment", () => {
  const EVENT_ID = "11111111-2222-4333-8444-555555555555"

  /** A one-section doc whose form sells EVENT_ID. */
  function docSellingEvent(): SectionDoc {
    return {
      version: 1,
      theme: {},
      sections: [
        {
          id: "signup",
          kind: "form",
          props: {
            heading: "Reserve a spot",
            formKey: "register",
            successMode: "checkout",
            eventId: EVENT_ID,
            fields: [
              { name: "parent_name", label: "Your name", type: "text", required: true, role: "parent_name" },
              { name: "email", label: "Email", type: "email", required: true, role: "parent_email" },
              { name: "player", label: "Player", type: "text", required: true, role: "athlete_name" },
              { name: "age", label: "Age", type: "select", required: true, role: "athlete_age", options: ["12"] },
              { name: "waiver", label: "I accept", type: "checkbox", required: true, role: "waiver_accepted" },
            ],
          },
        },
      ],
    } as unknown as SectionDoc
  }

  function cataloguesWith(entry: Partial<CatalogueEntry> | null): Catalogues {
    const list = entry === null ? [] : [{ id: EVENT_ID, name: "Summer Camp", priced: true, soldOut: false, ...entry }]
    const empty = { program: [], session_pack: [], event: [] }
    return { recognition: { ...empty, event: list }, offer: { ...empty, event: list }, faqPageKeys: [] } as Catalogues
  }

  it("blocks when the camp is not in the offer set", () => {
    const result = resolveDoc(docSellingEvent(), cataloguesWith(null), null)
    const gate = publishGate(result)
    expect(gate.ok).toBe(false)
    expect(gate.blockers.join(" ")).toMatch(/camp|clinic|event/i)
  })

  it("blocks when the camp has no Stripe price", () => {
    const gate = publishGate(resolveDoc(docSellingEvent(), cataloguesWith({ priced: false }), null))
    expect(gate.ok).toBe(false)
    expect(gate.blockers.join(" ")).toMatch(/price|booking/i)
  })

  it("WARNS but still publishes when the camp is full", () => {
    // Asserted as a warning, not merely "not a blocker": a full camp is a
    // legitimate page an owner may want live saying so, and collapsing this
    // into a blocker would stop them publishing it.
    const gate = publishGate(resolveDoc(docSellingEvent(), cataloguesWith({ soldOut: true }), null))
    expect(gate.ok).toBe(true)
    expect(gate.warnings.join(" ")).toMatch(/full|sold out/i)
  })

  it("passes a sellable camp with no warnings of its own", () => {
    const gate = publishGate(resolveDoc(docSellingEvent(), cataloguesWith({}), null))
    expect(gate.ok).toBe(true)
    expect(gate.warnings.join(" ")).not.toMatch(/full|sold out/i)
  })

  it("leaves a lead-gen form pointing at the same unpriced camp alone", () => {
    // MUTANT: gating on eventId regardless of successMode. An ordinary opt-in
    // form is not selling anything and must not inherit a payment blocker.
    const doc = docSellingEvent()
    ;(doc.sections[0].props as Record<string, unknown>).successMode = "message"
    const gate = publishGate(resolveDoc(doc, cataloguesWith({ priced: false }), null))
    expect(gate.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts -t "takes payment"`
Expected: FAIL — `gate.ok` is true for the unknown-camp case.

- [ ] **Step 3: Implement**

Add both interfaces near `UnknownFaqKey`. Add the two arrays to `ResolveResult` with the same comment convention (`/** NON-EMPTY MEANS PUBLISH IS BLOCKED. */` on `unsellableCheckouts` only).

In `resolveDoc`, after the FAQ pass, walk the form sections:

```ts
  // FORMS THAT TAKE MONEY. Only `successMode: "checkout"` is inspected — an
  // opt-in form carrying an eventId is not selling anything, and a blocker on
  // it would break pages that work today.
  const unsellableCheckouts: UnsellableCheckout[] = []
  const soldOutCheckouts: SoldOutCheckout[] = []
  for (const section of doc.sections) {
    if (section.kind !== "form") continue
    const props = section.props as { successMode?: unknown; eventId?: unknown }
    if (props.successMode !== "checkout") continue
    const eventId = typeof props.eventId === "string" ? props.eventId : ""
    if (eventId === "") {
      unsellableCheckouts.push({ sectionId: section.id, eventId: "", reason: "unknown" })
      continue
    }
    const offered = catalogues.offer.event.find((entry) => entry.id === eventId)
    if (!offered) {
      // Recognition answers a different question — "did this row ever exist?" —
      // so a known-but-not-currently-offered camp gets its own reason and its
      // own sentence, rather than being reported as a typo.
      const known = catalogues.recognition.event.find((entry) => entry.id === eventId)
      unsellableCheckouts.push({ sectionId: section.id, eventId, reason: known ? "not_offered" : "unknown" })
      continue
    }
    if (offered.priced !== true) {
      unsellableCheckouts.push({ sectionId: section.id, eventId, reason: "unpriced" })
      continue
    }
    if (offered.soldOut === true) {
      soldOutCheckouts.push({ sectionId: section.id, eventId, name: offered.name })
    }
  }
```

Return both from `resolveDoc` (every construction site of `ResolveResult` in the file must supply them — including early returns).

Add the describers beside the existing ones:

```ts
function describeUnsellableCheckout(problem: UnsellableCheckout): string {
  const where = `Section "${problem.sectionId}" takes payment`
  if (problem.reason === "unpriced") {
    return `${where} but its camp has no price set up in Stripe yet, so a visitor could not pay for it.`
  }
  if (problem.reason === "not_offered") {
    return `${where} but its camp is not currently open — it may be unpublished, cancelled or already finished.`
  }
  return `${where} but does not name a camp that exists.`
}

function describeSoldOutCheckout(problem: SoldOutCheckout): string {
  return `Section "${problem.sectionId}" sells "${problem.name}", which is full. Visitors will be told it is full instead of paying.`
}
```

Wire them into `publishGate`:

```ts
  const blockers = [
    ...result.unresolved.map(describeUnresolved),
    ...result.unknownFaqKeys.map(describeUnknownFaqKey),
    ...result.brokenStepLinks.map(describeBrokenStepLink),
    // A page that charges for a camp which cannot take money must not go live.
    ...result.unsellableCheckouts.map(describeUnsellableCheckout),
  ]
  const warnings = [
    ...result.danglingAnchors.map(describeDanglingAnchor),
    ...result.soldOutCheckouts.map(describeSoldOutCheckout),
  ]
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts`
Expected: PASS. Fix any pre-existing test that builds a `ResolveResult` literal — it now needs both new arrays.

- [ ] **Step 5: Run the publish surface**

Run: `npx vitest run __tests__/app/api/admin/funnels/ __tests__/lib/funnels/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/resolve.ts __tests__/lib/funnels/sections/resolve.test.ts
git commit -m "feat(funnels): publishing refuses a form whose camp cannot take money"
```

---

### Task 4: One event-checkout helper, two callers

**Files:**
- Create: `lib/events/checkout.ts`
- Modify: `app/api/events/[id]/checkout/route.ts` (replace its body with a call), `lib/stripe.ts:353-377` (`createEventCheckoutSession` gains optional URLs)
- Test: `__tests__/lib/events/checkout.test.ts`

**Interfaces:**
- Consumes: `createEventSignupSchema`, `createSignup`, `getActiveDocument`, `createEventCheckoutSession`.
- Produces:

```ts
export type EventCheckoutOutcome =
  | { ok: true; sessionUrl: string; signupId: string }
  | { ok: false; status: 400 | 409 | 502; error: string }

export async function createEventSignupCheckout(opts: {
  event: Event
  input: CreateSignupInput            // already parsed by createEventSignupSchema
  ipAddress: string | null
  userAgent: string | null
  tracking?: CheckoutTrackingParams
  baseUrl: string
  returnUrls?: { successUrl: string; cancelUrl: string }
}): Promise<EventCheckoutOutcome>
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/events/checkout.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const createSignup = vi.fn()
const getActiveDocument = vi.fn()
const createEventCheckoutSession = vi.fn()
const from = vi.fn()

vi.mock("@/lib/db/event-signups", () => ({ createSignup: (...a: unknown[]) => createSignup(...a) }))
vi.mock("@/lib/db/legal-documents", () => ({ getActiveDocument: (...a: unknown[]) => getActiveDocument(...a) }))
vi.mock("@/lib/stripe", () => ({ createEventCheckoutSession: (...a: unknown[]) => createEventCheckoutSession(...a) }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}))

import { createEventSignupCheckout } from "@/lib/events/checkout"

const EVENT = {
  id: "e1", slug: "summer-camp", type: "camp", status: "published",
  stripe_price_id: "price_1", capacity: 12, signup_count: 3, title: "Summer Camp",
} as never

const INPUT = {
  parent_name: "Dana Reed", parent_email: "dana@example.com", parent_phone: null,
  athlete_name: "Sam Reed", athlete_age: 13, sport: null, notes: null, waiver_accepted: true,
} as never

beforeEach(() => {
  createSignup.mockReset().mockResolvedValue({ id: "s1" })
  getActiveDocument.mockReset().mockResolvedValue({ id: "doc1" })
  createEventCheckoutSession.mockReset().mockResolvedValue({ id: "cs_1", url: "https://stripe.test/pay" })
  from.mockReset().mockReturnValue({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) })
})

describe("createEventSignupCheckout", () => {
  const base = { event: EVENT, input: INPUT, ipAddress: "1.2.3.4", userAgent: "UA", baseUrl: "https://x.test" }

  it("files the waiver evidence with the signup", async () => {
    const out = await createEventSignupCheckout(base)
    expect(out).toMatchObject({ ok: true, sessionUrl: "https://stripe.test/pay", signupId: "s1" })
    const [, , signupType, waiver] = createSignup.mock.calls[0]
    expect(signupType).toBe("paid")
    expect(waiver).toMatchObject({ document_id: "doc1", ip_address: "1.2.3.4", user_agent: "UA" })
  })

  it("does not send waiver_accepted through to the database row", async () => {
    // The column is waiver_accepted_at, set from the evidence object. Passing
    // the boolean through would attempt to insert a column that does not exist.
    await createEventSignupCheckout(base)
    expect(createSignup.mock.calls[0][1]).not.toHaveProperty("waiver_accepted")
  })

  it("refuses at capacity without creating a signup", async () => {
    const out = await createEventSignupCheckout({ ...base, event: { ...EVENT, signup_count: 12 } as never })
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(createSignup).not.toHaveBeenCalled()
  })

  it("refuses an event with no Stripe price without creating a signup", async () => {
    const out = await createEventSignupCheckout({ ...base, event: { ...EVENT, stripe_price_id: null } as never })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(createSignup).not.toHaveBeenCalled()
  })

  it("reports a Stripe failure as 502 rather than throwing", async () => {
    createEventCheckoutSession.mockRejectedValue(new Error("stripe down"))
    const out = await createEventSignupCheckout(base)
    expect(out).toMatchObject({ ok: false, status: 502 })
  })

  it("passes custom return urls straight through", async () => {
    await createEventSignupCheckout({
      ...base,
      returnUrls: { successUrl: "https://x.test/go/f/thank-you", cancelUrl: "https://x.test/go/f/register" },
    })
    expect(createEventCheckoutSession.mock.calls[0][0]).toMatchObject({
      successUrl: "https://x.test/go/f/thank-you",
      cancelUrl: "https://x.test/go/f/register",
    })
  })

  it("passes no return urls when none are given, leaving the event page default", async () => {
    await createEventSignupCheckout(base)
    const arg = createEventCheckoutSession.mock.calls[0][0]
    expect(arg.successUrl).toBeUndefined()
    expect(arg.cancelUrl).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/events/checkout.test.ts`
Expected: FAIL — module `@/lib/events/checkout` not found.

- [ ] **Step 3: Implement `lib/stripe.ts` first**

```ts
export async function createEventCheckoutSession(opts: {
  event: Event
  signup: EventSignup
  parentEmail: string
  baseUrl: string
  tracking?: CheckoutTrackingParams
  /**
   * Where Stripe returns the visitor. OPTIONAL, defaulting to the event's own
   * pages so this function's existing caller is untouched. A funnel passes its
   * own pages instead — otherwise a funnel-born checkout ends on the event's
   * success page and the funnel's Confirmation step is never seen.
   */
  successUrl?: string
  cancelUrl?: string
}): Promise<Stripe.Checkout.Session> {
```

and in the create call:

```ts
    success_url:
      opts.successUrl ?? `${opts.baseUrl}/${segment}/${opts.event.slug}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: opts.cancelUrl ?? `${opts.baseUrl}/${segment}/${opts.event.slug}?checkout=cancelled`,
```

Then `lib/events/checkout.ts` — lift the body of the events route verbatim, returning outcomes instead of `NextResponse`. Header comment:

```ts
// lib/events/checkout.ts — event signup + Stripe session, for every caller.
//
// EXTRACTED SO THERE IS ONE COPY, NOT TWO. The capacity check, the waiver
// evidence write and the Stripe session were the body of
// /api/events/[id]/checkout; a funnel form now needs exactly the same sequence.
// Restating it would let the two drift, and the halves that would drift are the
// legal gate and the money.
//
// RETURNS OUTCOMES, NEVER Responses, and never throws for an expected failure:
// its two callers answer to different clients (an event page modal and a funnel
// form) and each maps a status to its own copy.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/events/checkout.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the events route to call it, and prove it unchanged**

Replace the route's middle with `createEventSignupCheckout({...})`, mapping `{ok:false}` to `NextResponse.json({error}, {status})` and `{ok:true}` to `{sessionUrl, signupId}`. Pass **no** `returnUrls`.

Run: `npx vitest run __tests__/api/ __tests__/lib/events/ -t "checkout"`
Expected: PASS — the event route's existing tests must pass untouched. If none exist, do not add them here; Task 4 is covered by the helper's tests plus the route's type check.

- [ ] **Step 6: Commit**

```bash
git add lib/events/checkout.ts lib/stripe.ts app/api/events/\[id\]/checkout/route.ts __tests__/lib/events/checkout.test.ts
git commit -m "refactor(events): one signup-and-checkout helper, so a funnel can reuse it"
```

---

### Task 5: The submit route's checkout branch

**Files:**
- Modify: `app/api/funnels/submit/route.ts`
- Test: `__tests__/app/api/funnels/submit-checkout.test.ts`

**Interfaces:**
- Consumes: `createEventSignupCheckout` (Task 4), `FORM_FIELD_ROLES` / `CHECKOUT_REQUIRED_ROLES` (Task 1), `listSteps` from `@/lib/db/funnels`, `FUNNEL_CHECKOUT_FLAG` / `FUNNEL_CHECKOUT_DEFAULT`, `getSetting`.
- Produces: response `{ sessionUrl: string }` for checkout forms; `signupInputFromRoles(fields, values)` exported from `lib/funnels/checkout/roles.ts` for testing.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/app/api/funnels/submit-checkout.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const getPublishedFormConfig = vi.fn()
const createSubmission = vi.fn()
const getFunnelById = vi.fn()
const getStep = vi.fn()
const listSteps = vi.fn()
const getEventById = vi.fn()
const getSetting = vi.fn()
const createEventSignupCheckout = vi.fn()

vi.mock("@/lib/db/funnels", () => ({
  getPublishedFormConfig: (...a: unknown[]) => getPublishedFormConfig(...a),
  createSubmission: (...a: unknown[]) => createSubmission(...a),
  getFunnelById: (...a: unknown[]) => getFunnelById(...a),
  getStep: (...a: unknown[]) => getStep(...a),
  listSteps: (...a: unknown[]) => listSteps(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventById(...a) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSetting(...a) }))
vi.mock("@/lib/events/checkout", () => ({
  createEventSignupCheckout: (...a: unknown[]) => createEventSignupCheckout(...a),
}))
vi.mock("@/lib/email", () => ({ sendNewFunnelLeadEmail: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/funnels/submit/route"

const FUNNEL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const STEP_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
const EVENT_ID = "cccccccc-3333-4333-8333-cccccccccccc"

const CHECKOUT_FIELDS = [
  { name: "parent_name", label: "Your name", type: "text", required: true, role: "parent_name" },
  { name: "email", label: "Email", type: "email", required: true, role: "parent_email" },
  { name: "player", label: "Player's name", type: "text", required: true, role: "athlete_name" },
  { name: "age", label: "Player's age", type: "select", required: true, role: "athlete_age", options: ["13"] },
  { name: "level", label: "Current level", type: "select", options: ["New"] },
  { name: "waiver", label: "I accept the waiver", type: "checkbox", required: true, role: "waiver_accepted" },
]

const VALUES = {
  parent_name: "Dana Reed",
  email: "dana@example.com",
  player: "Sam Reed",
  age: "13",
  level: "New",
  waiver: "on",
}

function request(values: Record<string, string> = VALUES) {
  return new Request("http://t.test/api/funnels/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ funnelId: FUNNEL_ID, stepId: STEP_ID, formKey: "register", values, elapsedMs: 9000 }),
  })
}

beforeEach(() => {
  getPublishedFormConfig.mockReset().mockResolvedValue({
    formKey: "register",
    successMode: "checkout",
    eventId: EVENT_ID,
    fields: CHECKOUT_FIELDS,
  })
  createSubmission.mockReset().mockResolvedValue({ id: "sub1" })
  getFunnelById.mockReset().mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp-2026", name: "Summer Camp" })
  getStep.mockReset().mockResolvedValue({ id: STEP_ID, slug: "register", name: "Register" })
  listSteps.mockReset().mockResolvedValue([
    { id: STEP_ID, slug: "register", name: "Register", position: 1 },
    { id: "z", slug: "thank-you", name: "Confirmation", position: 2 },
  ])
  getEventById.mockReset().mockResolvedValue({
    id: EVENT_ID, slug: "camp", type: "camp", status: "published",
    stripe_price_id: "price_1", capacity: 12, signup_count: 1, title: "Camp",
  })
  getSetting.mockReset().mockResolvedValue(true)
  createEventSignupCheckout.mockReset().mockResolvedValue({ ok: true, sessionUrl: "https://stripe.test/pay", signupId: "s1" })
})

describe("POST /api/funnels/submit — checkout forms", () => {
  it("returns the Stripe session url", async () => {
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sessionUrl: "https://stripe.test/pay" })
  })

  it("maps the owner's field names onto the signup schema via roles", async () => {
    await POST(request())
    expect(createEventSignupCheckout.mock.calls[0][0].input).toMatchObject({
      parent_name: "Dana Reed",
      parent_email: "dana@example.com",
      athlete_name: "Sam Reed",
      athlete_age: 13, // a NUMBER — the form yields "13"
      waiver_accepted: true, // a BOOLEAN — the form yields "on"
    })
  })

  it("writes the lead BEFORE calling Stripe", async () => {
    const order: string[] = []
    createSubmission.mockImplementation(async () => {
      order.push("submission")
      return { id: "sub1" }
    })
    createEventSignupCheckout.mockImplementation(async () => {
      order.push("checkout")
      return { ok: true, sessionUrl: "u", signupId: "s" }
    })
    await POST(request())
    expect(order).toEqual(["submission", "checkout"])
  })

  it("keeps the lead when Stripe fails", async () => {
    // The visitor most worth calling is the one who filled the form and could
    // not pay. Losing them to a Stripe outage is the failure this ordering exists
    // to prevent.
    createEventSignupCheckout.mockResolvedValue({ ok: false, status: 502, error: "Payment provider unavailable, please try again" })
    const res = await POST(request())
    expect(res.status).toBe(502)
    expect(createSubmission).toHaveBeenCalled()
  })

  it("keeps the owner's unroled answers in the submission payload", async () => {
    await POST(request())
    expect(createSubmission.mock.calls[0][0].payload).toMatchObject({ level: "New" })
  })

  it("404s when the checkout flag is off", async () => {
    getSetting.mockResolvedValue(false)
    const res = await POST(request())
    expect(res.status).toBe(404)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("passes funnel-scoped return urls built from the funnel's own slugs", async () => {
    await POST(request())
    const { returnUrls } = createEventSignupCheckout.mock.calls[0][0]
    expect(returnUrls.successUrl).toContain("/go/summer-camp-2026/thank-you")
    expect(returnUrls.successUrl).toContain("session_id={CHECKOUT_SESSION_ID}")
    expect(returnUrls.cancelUrl).toContain("/go/summer-camp-2026/register")
    expect(returnUrls.cancelUrl).toContain("checkout=cancelled")
  })

  it("rejects an age outside the signup schema's range with the owner's own label", async () => {
    const res = await POST(request({ ...VALUES, age: "42" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Player's age/)
  })

  it("rejects an unticked waiver", async () => {
    const res = await POST(request({ ...VALUES, waiver: "" }))
    expect(res.status).toBe(400)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("leaves a message-mode form completely unchanged", async () => {
    getPublishedFormConfig.mockResolvedValue({
      formKey: "optin",
      successMode: "message",
      fields: [{ name: "email", label: "Email", type: "email", required: true }],
    })
    const res = await POST(request({ email: "a@b.test" }))
    expect(await res.json()).toMatchObject({ ok: true })
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
    expect(getSetting).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/app/api/funnels/submit-checkout.test.ts`
Expected: FAIL — the route returns `{ok:true}` and never calls the checkout helper.

- [ ] **Step 3: Implement the role mapper**

Create `lib/funnels/checkout/roles.ts`:

```ts
// lib/funnels/checkout/roles.ts — form answers to a signup payload.
//
// THE MAPPING IS THE FORM'S DECLARATION, NOT A GUESS. Every value here is
// located by `field.role`; nothing reads a label or a field name. The output is
// handed to `createEventSignupSchema`, which is IMPORTED by the caller and never
// restated — this file's job is only to move values into the right keys and to
// turn HTML's strings into the types that schema wants.

import type { FunnelFormField } from "@/lib/funnels/islands"

export interface RoleMappedSignup {
  parent_name: string
  parent_email: string
  parent_phone: string | null
  athlete_name: string
  athlete_age: number | null
  sport: string | null
  notes: string | null
  waiver_accepted: boolean
}

/** The label the owner gave a role, for error copy. Empty when unroled. */
export function labelForRole(fields: FunnelFormField[], role: string): string {
  return fields.find((field) => field.role === role)?.label ?? role
}

export function signupInputFromRoles(
  fields: FunnelFormField[],
  values: Record<string, string>,
): RoleMappedSignup {
  const get = (role: string): string => {
    const field = fields.find((candidate) => candidate.role === role)
    if (!field) return ""
    return (values[field.name] ?? "").trim()
  }
  const orNull = (role: string): string | null => {
    const value = get(role)
    return value === "" ? null : value
  }

  // An unchecked checkbox submits nothing; a checked one submits "on". Anything
  // else truthy is still a tick — but "false" and "0" are NOT, because a client
  // could submit them and `Boolean("false")` is true.
  const ticked = get("waiver_accepted").toLowerCase()
  const waiverAccepted = ticked !== "" && ticked !== "false" && ticked !== "0" && ticked !== "off"

  // `Number("")` is 0 and `parseInt("13 years")` is 13 — neither is what an age
  // field means. Only a clean integer string counts; anything else is null, and
  // createEventSignupSchema rejects null with its own message.
  const rawAge = get("athlete_age")
  const athleteAge = /^\d{1,3}$/.test(rawAge) ? Number(rawAge) : null

  return {
    parent_name: get("parent_name"),
    parent_email: get("parent_email"),
    parent_phone: orNull("parent_phone"),
    athlete_name: get("athlete_name"),
    athlete_age: athleteAge,
    sport: orNull("sport"),
    notes: orNull("notes"),
    waiver_accepted: waiverAccepted,
  }
}
```

- [ ] **Step 4: Implement the route branch**

After the existing `payload` loop and **after** `createSubmission` / `upsertLead`, before the response:

```ts
  if (config.successMode === "checkout") {
    // MONEY. Same gate as /api/funnels/checkout, same 404 for the same reason:
    // a 403 confirms the endpoint exists and is merely disabled.
    if (!(await getSetting<boolean>(FUNNEL_CHECKOUT_FLAG, FUNNEL_CHECKOUT_DEFAULT))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const eventId = typeof config.eventId === "string" ? config.eventId : ""
    const event = eventId === "" ? null : await getEventById(eventId)
    if (!event || event.status !== "published") {
      return NextResponse.json({ error: "This camp is not open for booking yet." }, { status: 400 })
    }

    const signupInput = signupInputFromRoles(fields, parsedBody.values)
    const parsedSignup = createEventSignupSchema.safeParse(signupInput)
    if (!parsedSignup.success) {
      // Reported with the OWNER'S OWN LABEL. "athlete_age must be at most 21"
      // names a field the parent never saw.
      const issue = parsedSignup.error.issues[0]
      const role = typeof issue?.path?.[0] === "string" ? issue.path[0] : ""
      const label = role === "" ? "This form" : labelForRole(fields, role)
      const detail = role === "athlete_age" ? "must be between 6 and 21" : (issue?.message ?? "is not valid")
      return NextResponse.json({ error: `${label} ${detail}.` }, { status: 400 })
    }

    const steps = await listSteps(parsedBody.funnelId)
    const funnel = await getFunnelById(parsedBody.funnelId)
    const base = getBaseUrl()
    // The LAST step by position is the funnel's confirmation page — where a
    // completed purchase belongs, and what the rail already labels "ends here".
    const last = [...steps].sort((a, b) => a.position - b.position).at(-1)
    const funnelPath = `${base}/go/${funnel?.slug ?? ""}`
    const returnUrls =
      funnel && last
        ? {
            // `{CHECKOUT_SESSION_ID}` is Stripe's placeholder and must not be escaped.
            successUrl: `${funnelPath}/${last.slug}?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${funnelPath}/${step.slug}?checkout=cancelled`,
          }
        : undefined

    const outcome = await createEventSignupCheckout({
      event,
      input: parsedSignup.data,
      ipAddress: ip === "unknown" ? null : ip,
      userAgent: request.headers.get("user-agent"),
      tracking,
      baseUrl: base,
      returnUrls,
    })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    return NextResponse.json({ sessionUrl: outcome.sessionUrl })
  }
```

Reuse the route's existing `tracking` / attribution values if it already computes them; otherwise resolve them the way `/api/events/[id]/checkout` does, from `parseAttrCookie` + `getAttributionBySession`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run __tests__/app/api/funnels/`
Expected: PASS, including the pre-existing submit tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/funnels/submit/route.ts lib/funnels/checkout/roles.ts __tests__/app/api/funnels/submit-checkout.test.ts
git commit -m "feat(funnels): a Register form can take the payment itself"
```

---

### Task 6: The form shows the waiver and follows Stripe

**Files:**
- Modify: `components/funnels/islands/FunnelForm.tsx`, `components/funnels/islands/FormIsland.tsx`, `lib/funnels/island-fields.ts` (form entry), `lib/funnels/sections/styles.ts` (waiver box)
- Test: `__tests__/components/admin/funnel-form-checkout.test.tsx`

**Interfaces:**
- Consumes: the route's `{sessionUrl}` (Task 5).
- Produces: `FunnelForm` accepts `waiverHtml?: string | null`; on a `{sessionUrl}` response it assigns `window.location.href`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/admin/funnel-form-checkout.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FunnelForm } from "@/components/funnels/islands/FunnelForm"

const FIELDS = [
  { name: "email", label: "Email", type: "email" as const, required: true, role: "parent_email" as const },
  { name: "waiver", label: "I accept the waiver", type: "checkbox" as const, required: true, role: "waiver_accepted" as const },
]

function setup(over: Record<string, unknown> = {}) {
  return render(
    <FunnelForm
      funnelId="f" stepId="s" formKey="register" fields={FIELDS}
      submitLabel="Pay and hold the spot" successMode="message" successMessage="ok"
      {...over}
    />,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("a funnel form that takes payment", () => {
  it("renders the waiver document above the consent tick", () => {
    setup({ waiverHtml: "<p>Waiver terms here</p>" })
    expect(screen.getByText("Waiver terms here")).toBeInTheDocument()
  })

  it("falls back to a link when there is no active waiver document", () => {
    setup({ waiverHtml: null, successMode: "checkout" })
    expect(screen.getByRole("link", { name: /waiver/i })).toHaveAttribute("href", "/liability-waiver")
  })

  it("sends the visitor to Stripe when the server returns a session url", async () => {
    const assign = vi.fn()
    Object.defineProperty(window, "location", { value: { href: "", assign }, writable: true })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sessionUrl: "https://stripe.test/pay" }), { status: 200 }),
    )
    setup({ successMode: "checkout" })
    await userEvent.type(screen.getByLabelText(/Email/), "a@b.test")
    await userEvent.click(screen.getByLabelText(/I accept the waiver/))
    await userEvent.click(screen.getByRole("button", { name: /Pay and hold the spot/ }))
    await waitFor(() => expect(window.location.href).toBe("https://stripe.test/pay"))
  })

  it("shows the server's message when the camp is full", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "This camp is full." }), { status: 409 }),
    )
    setup({ successMode: "checkout" })
    await userEvent.type(screen.getByLabelText(/Email/), "a@b.test")
    await userEvent.click(screen.getByLabelText(/I accept the waiver/))
    await userEvent.click(screen.getByRole("button", { name: /Pay and hold the spot/ }))
    expect(await screen.findByText("This camp is full.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/components/admin/funnel-form-checkout.test.tsx`
Expected: FAIL — no waiver is rendered.

- [ ] **Step 3: Implement**

`FunnelForm`: add `waiverHtml?: string | null` to props. Immediately before the field whose `role === "waiver_accepted"`, render:

```tsx
{field.role === "waiver_accepted" ? (
  <div className="djp-waiver" data-djp-waiver>
    {waiverHtml ? (
      // The document itself, so the tick beside it is informed consent. Same
      // treatment EventSignupModal gives it, including this fallback.
      <div dangerouslySetInnerHTML={{ __html: waiverHtml }} />
    ) : (
      <p>
        Please read the{" "}
        <a href="/liability-waiver" target="_blank" rel="noreferrer">
          liability waiver
        </a>{" "}
        before continuing.
      </p>
    )}
  </div>
) : null}
```

In `handleSubmit`, after `response.ok`, before the existing redirect handling:

```tsx
      const body = (await response.json().catch(() => null)) as { sessionUrl?: string } | null
      // A checkout form's success IS a redirect to Stripe. Checked before
      // `successMode` so a page published as "message" that later became a
      // checkout form still sends the visitor to pay rather than thanking them
      // for a payment they never made.
      if (typeof body?.sessionUrl === "string" && body.sessionUrl.startsWith("https://")) {
        window.location.href = body.sessionUrl
        return
      }
```

`FormIsland`: when `props.successMode === "checkout"`, prepare the waiver exactly as `app/(marketing)/camps/[slug]/page.tsx:55-56` already does — same two functions, so the funnel and the event page render one document one way:

```tsx
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal/render"   // the module camps/[slug] imports it from

const waiverDoc = props.successMode === "checkout" ? await getActiveDocument("liability_waiver") : null
const waiverHtml = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null
```

`legal_documents.content` is markdown-ish source; `renderLegalContent` is what turns it into the HTML the event page injects. Confirm the import path of `renderLegalContent` from that page rather than assuming it.

`island-fields.ts`, the `form` entry: add `{ name: "eventId", label: "Camp / clinic ID", type: "text" }`.

`styles.ts`, beside the other form rules — **no backticks in comments in this file, it is a template literal**:

```
${ROOT} .djp-form .djp-waiver {
  max-height: 11rem;
  overflow-y: auto;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--djp-radius, 0.6rem);
  background: var(--surface);
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--muted-foreground);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/components/admin/funnel-form-checkout.test.tsx __tests__/components/admin/funnel-form-editable.test.tsx __tests__/lib/funnels/sections/leadgen.test.ts`
Expected: PASS. `leadgen.test.ts` asserts every emitted class is styled — `djp-waiver` must be in the stylesheet or it fails.

- [ ] **Step 5: Commit**

```bash
git add components/funnels/islands/ lib/funnels/island-fields.ts lib/funnels/sections/styles.ts __tests__/components/admin/funnel-form-checkout.test.tsx
git commit -m "feat(funnels): the form shows the waiver and follows Stripe"
```

---

### Task 7: Tell the builder's model about it

**Files:**
- Modify: `lib/funnels/sections/prompt.ts` (the form island's generated guidance)
- Test: `__tests__/lib/funnels/sections/prompt.test.ts`

**Interfaces:**
- Consumes: Task 1's schema.
- Produces: prompt text covering `successMode: "checkout"`, roles, and the `eventId` omission.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/prompt.test.ts — append
describe("the prompt describes a form that takes payment", () => {
  it("names every role the schema accepts", () => {
    for (const role of FORM_FIELD_ROLES) expect(SECTION_BUILDER_BLOCK_A).toContain(role)
  })

  it("tells the model to omit eventId, since it is a uuid", () => {
    expect(SECTION_BUILDER_BLOCK_A).toContain("eventId")
  })

  it("states that a checkout form needs every required role", () => {
    expect(SECTION_BUILDER_BLOCK_A).toMatch(/checkout/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts -t "takes payment"`
Expected: FAIL — roles are absent from Block A.

- [ ] **Step 3: Implement**

Because Block A is generated from the registry, `role` and `eventId` may already appear via the schema walk. Run the test first: if roles appear and only the *rule* is missing, add prose to the form island's guidance:

```
A form with successMode "checkout" SELLS A CAMP, and it may only be written when
the owner has already given you a camp to sell. It needs a field for each of
parent_name, parent_email, athlete_name, athlete_age and waiver_accepted, each
carrying that value in its "role". You never write eventId — the owner fills it
in. A checkout form without every required role cannot be published, so if you
are unsure, write an ordinary form with successMode "message" instead.
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts __tests__/lib/funnels/sections/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/prompt.ts __tests__/lib/funnels/sections/prompt.test.ts
git commit -m "feat(funnels): the builder knows how to write a form that sells a camp"
```

---

## Final verification

- [ ] `npx vitest run __tests__/lib/funnels/ __tests__/app/api/funnels/ __tests__/lib/events/ __tests__/components/admin/funnel-form-checkout.test.tsx` — all green
- [ ] `npx tsc --noEmit 2>&1 | grep -E "funnels|events|stripe"` — no new errors (the repo's baseline has 258 pre-existing errors in unrelated files; compare, do not read the total)
- [ ] `git log --oneline` shows one commit per task
- [ ] Confirm nothing was pushed: `git status -sb` shows the branch ahead of origin

## Deliberately not done here

Programs, packs, digital products. Resume tokens. Waiver e-signature. Multi-athlete signups. Age-vs-camp-range checks. Moving the owner's Payment page copy — content work in the builder. Turning the flag on in production — an owner decision, and the flag is off by default because this is money.
