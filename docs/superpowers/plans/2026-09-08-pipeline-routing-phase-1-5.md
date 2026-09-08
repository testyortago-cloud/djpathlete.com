# Pipeline routing phase 1.5 — give the two new boards a writer

**Why this exists:** phase 1 built correct, tested routing whose two destinations are
unreachable. Verified: `NON_COACHING_CHECKOUT_TYPES` (webhook `route.ts:83`) contains
`event_signup` and line 268 gates `applyPipelineEvent` on NOT being in that set, so an
event-signup payment never reaches routing; and NOTHING anywhere passes `serviceType`, while
no inquiry route calls `applyPipelineEvent` at all. Both new boards have no writer.

**Owner decisions taken 2026-09-08 (awake, explicit):**
1. Yes — an event-signup payment SHOULD create a pipeline card.
2. Yes — build the assessment inquiry path.

---

## Task A — let an event-signup payment create a card on Camps & Clinics

`NON_COACHING_CHECKOUT_TYPES` answers ONE question today ("is this a coaching sale for the
pipeline board") and is used at TWO sites (route.ts:268 completed, :399 expired). Read both
before changing either.

The set now needs splitting, because its members stop being alike:
- `shop_order` and `save_card` still create NO card at all.
- `event_signup` now creates a card — on its ROUTED board, not Coaching.

Keep the "forgets to set metadata.type still counts as coaching" default intact — that comment
at :397 is load-bearing.

**A payment creates a WON card** (`decideMove`'s payment branch), so a paid camp registration
lands Won on Camps & Clinics with its `value_cents`. That is intended: they paid. Confirm it
against `decideMove` rather than assuming.

Tests: an `event_signup` payment creates a card on `camps_clinics`; `shop_order` and
`save_card` still create none; a checkout with NO `metadata.type` still lands on `coaching`;
the expired branch at :399 behaves as before. Mutate each conjunct of the new gate separately.

---

## Task B — an assessment inquiry creates a card

**This is a discriminated-union widening and needs a migration. It is NOT "add a call".**

`PipelineEvent` is `booking | payment | refund | quiz_result` — there is no `inquiry` kind.
`MoveTrigger` is pinned to the DB CHECK `opportunity_stage_events_trigger_check`, last altered
by migration `00254`, and a test ties the TypeScript union to that SQL.

So this needs, in order:
1. A new `PipelineEvent` member, e.g. `{ kind: "inquiry"; serviceType: string | null; occurredAt: Date }`.
2. **A `decideMove` arm for it.** FIRST establish what `decideMove` does today with a kind it
   has no arm for — falls through, returns a default, or throws. That answer decides whether
   the widening is safe before the arm exists. An enquiry should CREATE a card in the first
   OPEN stage; it must never create a Won or Lost one.
3. A new `MoveTrigger` value and **migration `00258`** altering
   `opportunity_stage_events_trigger_check`, plus updating the union-to-SQL pinning test.
   **Re-check the number at branch time — `00256` is on the sequence-management branch and
   `00257` is on this one; both are invisible from some checkouts and collide silently.**
4. `app/api/inquiry/route.ts` calls `applyPipelineEvent` with
   `routeToPipeline({ event: "inquiry", serviceType })`, wrapped so a pipeline failure can never
   fail the enquiry submission — copy the try/catch shape the Stripe webhook already uses.

**RUN THE CONSUMERS' SUITES.** Widening a discriminated union is this repo's most expensive
recorded trap: an earlier branch shipped a runner making ZERO write-backs for two new kinds,
looping silently, past a clean review, because the task ran only its own tests. Every switch or
if-chain over `PipelineEvent` or `MoveTrigger` must be found and checked, and an exhaustiveness
arm added where one is missing so the compiler catches the next widening.

Tests: an assessment inquiry creates a card on `assessment` in an open stage; a NON-assessment
inquiry does not route there; a pipeline failure does not fail the enquiry; the tenant fallback
still applies when a tenant lacks the assessment board.
