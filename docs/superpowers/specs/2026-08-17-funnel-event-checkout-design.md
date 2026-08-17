# Funnel event checkout: the Register step takes the money

**Status:** design approved in conversation 2026-08-17. Successor to
[2026-08-15-funnel-anonymous-checkout-design.md](2026-08-15-funnel-anonymous-checkout-design.md),
which put events third on its roadmap and said what they would cost.

## 1. The report

> "i need to regenerate because when i clicked the pay it goes to the event"

The owner's funnel is Details → Register → Payment → Confirmation. Clicking **Pay
and hold the spot** on the Payment page left the funnel entirely and landed on
`/camps/hi-performance-soccer-camp-copy`, where the parent had to enter their
name, email, the athlete's details and the waiver **a second time** before
reaching Stripe.

Nothing was broken. `EventIsland` renders its CTA as a link, by design:

```ts
const href = `/${event.type}s/${event.slug}`   // EventIsland.tsx:31
```

Its own header says it links "to the event page that already owns registration."
That is a correct decision for an event embedded in a marketing page and the
wrong one for an event embedded in a funnel whose previous step just collected
everything the signup needs.

Two things the owner reasonably expected, which are worth writing down because
neither is true:

- **Regenerating the page cannot fix it.** The href is computed in code at render
  time from the event row. It is never written into the page document, so
  rebuilding the page with the AI builder changes nothing.
- **The anonymous-checkout flag cannot fix it either.**
  `funnel_anonymous_checkout_enabled` gates `/api/funnels/checkout`, which accepts
  `productKind: z.literal("program")`. An event would be refused by that route
  with the flag on.

## 2. What is already true

Read before designing, so the design reuses rather than restates.

**`/api/events/[id]/checkout`** — anonymous by design. Validates
`createEventSignupSchema`; requires the event published with a `stripe_price_id`;
refuses at capacity with `at_capacity`; loads the active `liability_waiver`;
`createSignup(..., "paid", {document_id, ip_address, user_agent})`;
`createEventCheckoutSession`; stores `stripe_session_id`; returns
`{sessionUrl, signupId}`. Capacity is *reserved post-payment* by the
`confirm_event_signup` RPC in the Stripe webhook, which auto-refunds the loser of
a race for the last slot.

**`/api/funnels/submit`** — honeypot (`website`), `MIN_ELAPSED_MS`, per-IP rate
limit, and **the published form config is the authority on which fields exist**.
Validates required and email fields, writes the submission, upserts a lead,
carries the `djp_attr` session.

**`formIslandSchema`** — `successMode: "message" | "redirect"`. `redirectUrl` is
scheme- and host-allowlisted because it is assigned to `window.location.href`
"at the exact moment a visitor has handed over their email."

**`createEventCheckoutSession`** — hardcodes
`success_url: {baseUrl}/{segment}/{slug}/success?session_id={CHECKOUT_SESSION_ID}`
and `cancel_url: {baseUrl}/{segment}/{slug}?checkout=cancelled`. A funnel-born
checkout returning there would strand the visitor on the event's pages and the
funnel's own Confirmation step would never be seen.

**The prior spec's objection**, quoted in full because this design has to answer
it:

> `createEventSignupSchema` requires `parent_name`, `parent_email`,
> `athlete_name`, `athlete_age` (6–21), optional phone/sport/notes, and
> `waiver_accepted` which must be literally `true` … That is a real multi-field
> form with a **legal gate**, not a payload a button can synthesise. Wiring a
> one-click buy button to it would mean either inventing the athlete's details or
> bypassing a liability waiver, and neither is acceptable.

This design does not synthesise the payload. It requires the form to **declare**
which of its fields carry which signup values, and refuses to publish a checkout
form that cannot supply them all.

## 3. Decisions taken with the owner

1. **The waiver becomes real consent, on the Register step.** The active
   `liability_waiver` document is rendered beside the tick, and the tick means
   acceptance. The existing copy — "I understand a signed waiver is required
   before day one" — is an acknowledgement that a waiver is *coming*; sending it
   as `waiver_accepted: true` would file legal evidence (document id, IP, user
   agent) that a parent agreed to a document never shown to them.
2. **The funnel loses its Payment step.** Details → Register → Confirmation. The
   retired page's proof strip, "what happens after payment" and objection FAQ move
   up onto the Register page so the parent reads them *before* paying. This is
   content work the owner does in the builder; no code depends on it.
3. **Approach A**: the existing form island learns to check out, with an explicit
   per-field role contract. Rejected alternatives: a second fixed-field "event
   signup" island (loses the owner's own questions, e.g. "Current level", and
   splits the lead row from the signup row), and client-side chaining (the browser
   would assemble the legal payload, and a failure between the two calls leaves a
   lead who intended to pay with no checkout).

## 4. The field-role contract

`funnelFormFieldSchema` gains one optional field:

```ts
role: z.enum([
  "parent_name", "parent_email", "parent_phone",
  "athlete_name", "athlete_age", "sport", "notes",
  "waiver_accepted",
]).optional()
```

**Roles are the only mapping.** Nothing infers meaning from a label or a field
name. `"Player's name"` carries `role: "athlete_name"` because the form says so,
and a form that renames it to `"Your child"` keeps working.

Rules, all enforced by `formIslandSchema` (a `superRefine`, so they can report
several problems at once):

| Rule | Why |
|---|---|
| A role appears at most once | Two fields claiming `parent_email` is ambiguous, and picking the first silently drops a question the owner meant to ask |
| `successMode: "checkout"` requires `parent_name`, `parent_email`, `athlete_name`, `athlete_age`, `waiver_accepted` | These are `createEventSignupSchema`'s required fields. Missing one guarantees a 400 at a parent's checkout |
| `waiver_accepted` must be `type: "checkbox"` and `required: true` | A legal gate that can be left blank is not a gate |
| `parent_email` must be `type: "email"` | The route already email-validates by type; the role must not introduce a second, weaker path |
| `athlete_age` must be `type: "select"` or `"text"`, and its value must parse to an integer in 6–21 | The schema wants a number and an HTML form yields a string. A select of ages is the sane control; the parse is validated server-side either way |
| `successMode: "checkout"` requires `eventId` | Nothing to sell otherwise |
| Roles are ignored unless `successMode === "checkout"` | A lead-gen form carrying a stray role must not change behaviour |

**Unroled fields keep working and still reach the submission payload.** This is
how the owner's "Current level" question survives: it has no home in
`createEventSignupSchema`, and it does not need one.

`athlete_age` also feeds a **cross-check against the event**: nothing here knows
the camp's own age range, so the 6–21 bound is the schema's, not the camp's. Out
of scope, noted in §9.

## 5. Naming the camp: a uuid the owner supplies, a gate that verifies it

`formIslandSchema` gains `eventId: z.string().uuid().optional()`, edited in the
builder exactly as the event island's is — `island-fields.ts` gets
`{ name: "eventId", label: "Camp / clinic ID", type: "text" }`.

`UUID_FIELD_PATHS` picks it up automatically (it is generated from the section
schemas), so the builder prompt tells the model to omit it. That is necessary and
**not sufficient**, and `islands.ts` already says why, about `leadMagnetId`:

> an id that passes `.uuid()`, passes the compiler, passes the publish gate, and
> then silently emails nobody anything … **A prompt is a request, not a
> validator.**

So the gate is what makes this safe — and it needs **no new database read**, because
the rows are already in hand. `ResolvableCtaKind` is
`"program" | "session_pack" | "event"`, so `loadCatalogues` already fetches every
event a page could point at, and `resolveDoc` stays pure over what it is handed.

What is missing is two fields. `CatalogueEntry` is `{id, name}`, which cannot
answer "can this camp take money?". It gains two **optional** keys, filled by
`toCatalogue` from rows it already has:

```ts
export interface CatalogueEntry {
  id: string
  name: string
  /** Event only: a stripe_price_id exists, so a checkout can be created. */
  priced?: boolean
  /** Event only: signup_count >= capacity. */
  soldOut?: boolean
}
```

Optional, not required, and deliberately so: resolve.ts:150 warns that a
`Catalogue` gaining a *required* key `loadCatalogue` does not supply is how a CTA
goes silently unresolved, and a test pins that.

`publishGate` then decides, purely:

| Condition | Verdict | Why |
|---|---|---|
| `eventId` absent from the **offer** catalogue | **blocker** | The offer set is "currently valid": published, not ended, not cancelled, not completed. A page that charges for a camp which is none of those must not go live |
| In the offer set, `priced !== true` | **blocker** | `/api/events/[id]/checkout` refuses without a `stripe_price_id`. Better the owner learns at publish than a parent at checkout |
| `soldOut === true` | **warning** | A full camp is a legitimate page — the owner may want it live saying so. Blocking publish here would be this design overreaching |

**A tension worth naming**, because the codebase already argues the other side:
the recognition/offer split exists precisely so that un-publishing an event to fix
a typo does not break every funnel page pointing at it — "ROUTINE WORK", per the
comment. This design makes the offer set a blocker *only* for a form that takes
money, where "the camp is not currently open" is a genuine reason not to publish.
A lead-gen form pointing at the same event is untouched.

## 6. The submit branch

`/api/funnels/submit` grows one branch. Everything above it is unchanged, which
matters: the honeypot, the elapsed-time floor, the rate limit and the
"published config is the authority" rule all apply to a paying visitor too.

```
validate as today (required, email, honeypot, rate limit)
  │
  ├─ successMode !== "checkout" → unchanged: submission, lead, {ok:true}
  │
  └─ successMode === "checkout"
       1. flag off → 404 (same shape as /api/funnels/checkout: a 403 is a map)
       2. build signup input from ROLES; createEventSignupSchema.safeParse
             → 400 naming the owner's own label ("Player's age must be 6–21")
       3. event: published? stripe_price_id? capacity?
             → 400 / 409 at_capacity
       4. WRITE THE FUNNEL SUBMISSION AND LEAD FIRST
       5. createEventSignupCheckout(...) → Stripe session
       6. → { sessionUrl }, client assigns window.location.href
```

**Step 4 is ordered deliberately.** The lead is the owner's asset and the cheapest
thing to get right: a parent who fills the form and then hits a Stripe outage must
still appear in the funnel's leads, with their answers, so the owner can chase
them. Writing the submission after a successful session would lose exactly the
visitor most worth calling.

**Shared helper.** Steps 3 and 5 are the body of `/api/events/[id]/checkout`
today. They move to `lib/events/checkout.ts` as
`createEventSignupCheckout({event, input, ip, userAgent, tracking, returnUrls})`,
and **both** routes call it. The event route keeps its current URLs by passing
them explicitly; the funnel route passes its own. Restating the capacity check or
the waiver-evidence write in a second place is how the two drift, and this repo
has shipped that bug three times (`prompt.ts` counts them).

**Return URLs** are built on the server from the funnel's own slugs — never from
client input, which is the same reasoning that put a host allowlist on
`redirectUrl`:

- success → `/go/<funnelSlug>/<lastStepSlug>?session_id={CHECKOUT_SESSION_ID}`
- cancel → `/go/<funnelSlug>/<thisStepSlug>?checkout=cancelled`

The confirmation step is **the funnel's last step by position**. No new prop and
no owner decision: a funnel's last page is where a completed purchase belongs, and
the rail already labels it "ends here". `{CHECKOUT_SESSION_ID}` is Stripe's own
placeholder and must reach it unescaped.

`createEventCheckoutSession` gains optional `successUrl` / `cancelUrl`,
defaulting to today's strings so the event page's behaviour is untouched.

## 7. Rendering the waiver

`FormIsland` (a server component) loads `getActiveDocument("liability_waiver")`
when `successMode === "checkout"` and passes its pre-rendered HTML to
`FunnelForm`, which renders it in a scrollable box immediately above the
`waiver_accepted` field. When there is no active document it falls back to a link
to `/liability-waiver` — the same fallback `EventSignupModal` already makes, for
the same reason.

The tick's label stays owner-editable copy, and the island's default becomes
**"I have read and accept the liability waiver"**. A publish gate cannot judge
prose, so what makes the consent informed is the document rendered beside it, not
the wording of the label.

## 8. Failure behaviour

| Situation | What the parent sees | Where |
|---|---|---|
| Flag off | 404 — the endpoint does not admit it exists | route |
| Camp full | "This camp is full." | 409 `at_capacity` — warned at publish, not blocked |
| No `stripe_price_id` | "This camp is not open for booking yet." | 400, and blocked at publish |
| Stripe down | "Payment provider unavailable, please try again." — **lead already saved** | 502 |
| Waiver unticked | The field's own required error | client + server |
| Age outside 6–21 | "Player's age must be between 6 and 21." | 400 |
| Missing role at publish | Owner sees "This form takes payment but never asks for the parent's name." | publish gate |
| Double submit | Button disabled while submitting; a second POST would create a second pending signup, which capacity-on-payment already tolerates | as today |

## 9. Not in scope

Programs, session packs and digital products (§4 of the prior spec still governs
those). Resume tokens — the two-step flow was retired by decision 2. Waiver
e-signature; this is acceptance of a rendered document, which is what the event
page does today. Multi-athlete signups. Checking the athlete's age against the
camp's own advertised range. Moving the Payment page's copy, which is the owner's
content work in the builder.

## 10. Testing

- **`formIslandSchema`**: duplicate role rejected; each required role missing in
  turn rejected under `checkout` and accepted under `message`; `waiver_accepted`
  as a non-checkbox rejected; stray role under `message` accepted.
- **Publish gate**: unknown, unpublished and unpriced events each **blocked** with
  their own message; a full camp **warns and still publishes** (asserted as a
  warning, not merely "not a blocker", so the distinction cannot rot); a
  `message`-mode form pointing at the same unpriced event unaffected.
- **`CatalogueEntry`**: `priced` / `soldOut` stay optional — the existing test
  that a `Catalogue` key `loadCatalogue` omits cannot become required must still
  pass.
- **Submit route**: `message` mode byte-identical to today; checkout happy path
  returns `sessionUrl`; flag off 404; full 409; unpriced 400; age 400; waiver
  false 400; **submission written before the Stripe call** (assert order, not just
  presence); **lead survives a Stripe throw**.
- **Shared helper**: one behaviour, two callers; the event route's URLs unchanged.
- **`FunnelForm`**: waiver HTML rendered; fallback link when absent; redirect on
  `sessionUrl`; "camp is full" surfaced.
- **Not asserted by mocks alone**: the role→schema mapping is checked against the
  real `createEventSignupSchema`, never a restated copy of its shape.
