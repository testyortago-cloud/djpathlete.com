# Pipeline boards and routing (gap #8)

**Date:** 2026-09-08
**Gap:** #8 of `docs/full-engine-scope-vs-built.md`
**Supersedes:** `docs/superpowers/specs/2026-09-01-full-engine-phase4-pipeline-boards-design.md`
(status "not yet approved"). That document is a strong draft and most of it survives.
This one records where production has moved under it and where its reasoning breaks.

**Branch from `feat/contact-sources`, NOT from `main`.** Both gaps modify
`app/api/stripe/webhook/route.ts` — #14 at the contact-capture call (line ~262), this
one at the `applyPipelineEvent` calls (~237 and ~496). Cutting from `main` guarantees a
conflict in that file.

---

## 1. The gap, precisely

`applyPipelineEvent` takes an optional `pipelineKey` and **no caller anywhere passes
one.** Verified 2026-09-08: the three real event writers —
`lib/bookings/ingest.ts:311`, `app/api/quiz/submit/route.ts:280`,
`app/api/stripe/webhook/route.ts:237` and `:496` — pass none, and
`lib/automation/pipeline-reconcile.ts` hardcodes `DEFAULT_PIPELINE_KEY`. So every
booking, payment and quiz result lands on Coaching. A camp registration and a coaching
enquiry are the same card in the same column.

Production today: **one** pipeline (`coaching`), four stages, **3** opportunities.

The board editor is the easy half. **Routing is the hard half and does not exist in any
form.**

---

## 2. Where the 2026-09-01 design is now wrong

### 2.1 Its Programs & Products predicate does not discriminate

The design proposes routing that board on "the same `stripe_price_id`-plus-catalogue
predicate, not just 'was priced'". Measured on production 2026-09-08:

| | count |
|---|---|
| `programs` rows | **75**, all `is_active = true` |
| priced (`price_cents > 0`) | **23** (the design said 18) |
| of those, `stripe_price_id` present | **23 — every one** |
| `is_public = true` | **1** |
| private `subscription` | 17 |
| private `one_time` | 5 |

`stripe_price_id` is present on all 23, so a predicate built on it routes every bespoke
athlete plan onto a products board. **The discriminator is `is_public`.** Note also that
`programs` has TWO visibility columns and `is_active` is true for all 75 rows, making it
useless as a filter.

### 2.2 Therefore: three boards, not four

**Seed Camps & Clinics and Assessment. Do NOT seed Programs & Products.**

Of the 23 priced programmes, **17 are private subscriptions named after the athlete they
were built for.** Those are not products; they are coaching sales, and Coaching is where
they already correctly land. Exactly one row is public. A Programs & Products board would
either take all 23 and become a client list with stages — the design's own stated fear —
or take only the catalogue one and hold a single card.

The editor still gets built, so a Programs & Products board is one click away the day a
second catalogue product exists, and `routeToPipeline` gains a rule then. **Seeding a
board that is empty or wrong is worse than not seeding it**, and un-seeding one later
needs a data migration.

*This is a controller ruling taken while the owner was asleep. The reversible direction was
chosen deliberately.* Still the owner's to decide: whether catalogue-product sales should
ever be split off Coaching at all. That is a "how do you want to read your own numbers"
question, not a technical one.

---

## 3. Routing

### 3.0 The earlier design's `routeToPipeline(event)` CANNOT WORK — read the union

This is the correction that matters most, and it was found by reading
`PipelineEvent` rather than trusting the routing table.

```ts
export type PipelineEvent =
  | { kind: "booking"; status: ...; occurredAt: Date }
  | { kind: "payment"; amountCents: number; currency: string; occurredAt: Date }
  | { kind: "refund"; amountRefundedCents: number; occurredAt: Date }
  | { kind: "quiz_result"; tier: string; occurredAt: Date }
```

**A `payment` carries an amount, a currency and a time. Nothing else.** It does not
say what was bought. And `event_signup` and `inquiry` are not `PipelineEvent` kinds
at all — the earlier design's routing table routes on facts the union does not carry.
A pure `routeToPipeline(event)` would have nothing to switch on and would silently
return the default for everything, which is exactly today's behaviour wearing a new
function's clothes.

**The discriminating fact exists, but only at the CALL SITE.** For a checkout it is
`session.metadata?.type` — the same discriminator gap #14 used for
`checkoutContactSource` (`shop_order`, `event_signup`, `funnel_purchase`,
`session_pack`, …). For an inquiry it is `inquiries.service_type`. So the routing
function must take a subject assembled at the call site, not the bare event:

```ts
export type RoutingSubject = {
  event: PipelineEvent["kind"]
  /** Stripe checkout `metadata.type`, when this came from a checkout. */
  checkoutType?: string | null
  /** `inquiries.service_type`, when this came from an inquiry. */
  serviceType?: string | null
}

export function routeToPipeline(subject: RoutingSubject): string
```

Still pure, still one unit-testable table — but with an input that actually contains
the answer.

### 3.1 A REFUND MUST FOLLOW THE CARD IT REFUNDS, and this is a trap

`applyPipelineEvent` resolves the existing card with
`readMostRecentOpportunity(contactId, pipelineId, …)` — scoped to ONE pipeline. A
refund event carries only `amountRefundedCents`; nothing in it says which board the
original payment landed on.

So if a camp payment routes to Camps & Clinics and its refund routes to Coaching, the
refund **finds no won card and silently does nothing**. Today this cannot happen
because every event lands on Coaching; **creating a second board is exactly what makes
it reachable.**

**Rule: a refund is NOT routed by subject. It must be resolved against the board that
holds the contact's most recent won card**, or the refund path must be given the
original opportunity's `pipeline_id` explicitly. Decide which in Task 1 and write a
test that refunds a payment which landed on a non-default board.

### 3.2 The routing table

One pure function, no database access, so the whole table is a unit test:

| Event | Board |
|---|---|
| `booking` (consult) | `coaching` |
| `event_signup`, and payments for an `events` row | `camps_clinics` |
| `inquiry` with `service_type = 'assessment'` | `assessment` |
| `quiz` result | `coaching` |
| programme or shop purchase | `coaching` (see §2.2 — correct, not a gap) |
| anything unmatched | `coaching` |

**Keep the fallback.** An event whose board cannot be determined lands on Coaching — it
must not throw and must not vanish. `PipelineNotConfiguredError` already exists for the
genuinely broken case (no board for a key, or a board with no stages); an unroutable event
is a different, softer thing.

---

## 4. Two runtime traps that MUST be checked before widening anything

Both are quoted from the gap brief and neither has been re-verified in this document —
**verify each in Task 1 before any board is created.**

1. **A board with a missing stage kind makes `decideMove` throw at RUNTIME, not build
   time — and it is THREE requirements, not two.** Read from the source rather than
   repeated from the earlier design:

   - `pipeline-move.ts:112-113` — `if (!open.length) throw new Error("pipeline has no open stage")`
   - `pipeline-move.ts:118-119` — `const s = stages.find((x) => x.kind === kind); if (!s) throw new Error(\`pipeline has no ${kind} stage\`)`

   So a board needs **at least one `open`, at least one `won`, and at least one `lost`**
   stage or payment handling throws. The editor's server-side invariant is not cosmetic: a
   saved board that violates it is a board that breaks payment handling for every card on it.
   Enforce it where the board is WRITTEN, not only where it is drawn — a guard on the client
   path is not a guard.

   **The subtlety the "exactly one" phrasing hides:** the lookup is `.find()`, so MORE than
   one `won` stage does NOT throw — it silently takes whichever comes first in the array.
   Two `won` stages is therefore not a loud failure but a quiet, order-dependent choice of
   where a paid card lands. The editor must reject a second `won` or `lost` stage for that
   reason, not merely for tidiness.
2. **`readMostRecentOpportunity` throws a bare `Error` on a cross-board `stage_id` — and
   the danger is NARROWER and more specific than the earlier design says.** I read the
   function and the schema rather than repeating the warning:

   `readMostRecentOpportunity` already filters `.eq("pipeline_id", pipelineId)` and matches
   the row's `stage_id` against that pipeline's own `stages`. So the throw does **not** fire
   because a contact holds cards on two boards — that case is filtered and is perfectly
   legal. It fires only when a single opportunity's `stage_id` does not belong to its OWN
   `pipeline_id`. That is a data inconsistency, not a multi-board state.

   **Nothing in the schema prevents it.** `opportunities_stage_id_fkey` is
   `FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id)` with no further condition, and
   there is NO constraint tying `stage_id` to `pipeline_id`. It is unreachable today only
   because one board exists and every write goes through `lib/db/pipeline.ts`, which
   resolves stages from the pipeline it just looked up.

   **So the concrete rule for this gap: no surface may move a card to a stage on a different
   board.** Not the editor, not a manual move, not the reconciler. If a cross-board move is
   ever wanted, it must write `pipeline_id` and `stage_id` together in one statement. A
   contact holding one card per board is fine and needs no guard.

---

## 5. What the editor must enforce server-side

- Exactly one `won` stage and exactly one `lost` stage (see §4.1).
- `pipeline_stages_key_per_pipeline UNIQUE (pipeline_id, key)` and
  `pipeline_stages_position_per_pipeline UNIQUE (pipeline_id, position)` — the position one
  is the same non-deferrable-renumber problem gap #11 solved in `00256`'s
  `save_sequence_steps`. **Reuse that two-phase negative-parking pattern rather than
  inventing a second one.**
- `pipeline_stages_thresholds_ordered` (amber <= red).
- A stage holding opportunities cannot be deleted — **and the database already enforces
  this.** `opportunities_stage_id_fkey` carries no `ON DELETE` clause, so it defaults to
  `NO ACTION` and the delete is refused. Do NOT reimplement the rule; catch the
  foreign-key violation and turn it into a sentence a coach can act on. (Contrast
  `pipeline_stages_pipeline_id_fkey`, which IS `ON DELETE CASCADE` — deleting a whole
  pipeline takes its stages with it, and `opportunities_pipeline_id_fkey` cascades the
  cards too, so that path is consistent.) The friendly-message-plus-real-guard split is the
  same one gap #11 used for removing a step that has already sent messages.
- Every read and write carries `business_id`. RLS is on all four pipeline tables since
  `00231`; `lib/db/pipeline.ts` is the only module issuing `.from()` against them and its
  `getClient()` is service-role. **Keep both properties true.**

---

## 6. Copy

The Pipeline page says "pipeline", "card" and "stages". It does **not** say "board" —
match the screen that exists. No "opportunity" in anything a coach reads.

---

## 7. Out of scope

- No Programs & Products board (§2.2).
- No change to `decideMove`'s forward-only rule.
- No agency-style cross-tenant access. That is the unresolved SaaS scoping question in
  `CLAUDE.md` and it does not belong in a task that happens to touch pipelines.
