# Lead Engine Stage 1c — Pipeline Board and Campaign-to-Revenue

Design, reconciled against this repo on 2026-08-19. Parent authority:
`docs/superpowers/specs/2026-08-18-lead-engine-design.md` §8 (pipeline and
campaign-to-revenue), §2.3 (one board, machinery for N), §10 (repo constraints).

Stage 1a shipped the contact spine; Stage 1b shipped the sequence engine (merged
`89aabaa8`, migrations `00216`-`00218` live, engine gated off). Stage 1c is the
remainder of Stage 1: the board, the self-moving cards, and the revenue join.

---

## 1. What this is

A single pipeline board where a card represents one live deal, moved by events the
repo already emits, plus a report that traces money back to the campaign that
produced it.

It is explicitly **not** a lead list. The sequence engine owns nurture; the board
owns deals a human is actively working.

## 2. The four decisions

These were settled with Darren before this document existed. Each rejects a cheaper
option for a stated reason.

### 2.1 A card is created by a qualifying event, never per contact

An opportunity is created when a contact **books a consult** or **completes a
checkout** — not when a contact is created.

The evidence is the system being replaced: Finding 3 of the specification counted
437 GHL opportunities, 422 in a single pipeline, **435 still open and none valued**.
That is what auto-creating a card per lead produces — a board nobody can read,
where staleness colouring is noise because everything is stale. §2.3 of the parent
spec already ruled against rebuilding unused scaffolding in a new place.

### 2.2 Four stages, every move event-driven

```
Consult Booked  →  Consulted  →  Won
                              ↘  Lost
```

| Move | Trigger | Source |
|---|---|---|
| *(card created)* → Consult Booked | booking `scheduled` | GHL booking webhook |
| Consult Booked → Consulted | booking `completed` | GHL booking webhook |
| any → Won | payment succeeded | Stripe webhook |
| any → Lost | booking `cancelled` / `no_show` | GHL booking webhook |

Every arrow is an event that already exists in this repo today. A "Proposal Sent"
stage was rejected for exactly this reason: nothing emits it, so its staleness
colouring would measure Darren's admin habits rather than the lead's behaviour.

### 2.3 Value is actual money only

`value_cents` is NULL until a card is Won, then set from the payment amount. There
is no expected-value or forecast field.

A forecast built from one default package price reads as precision it does not have.
And manual valuation is not a hypothesis — it was tested: none of the 437 GHL cards
carried a value. Per the repo's own rule (*name the reader before writing a column*),
`value_cents` has exactly two readers: the board's Won column total, and §7's
campaign-to-revenue report.

**Consequence to state plainly:** the board cannot report what the open pipeline is
"worth". That is intended.

### 2.4 A human's Won/Lost outranks a later event

Cards are draggable and every move is recorded with its actor. Events advance cards
normally, with one guard: **an event never moves a card out of Won or Lost that a
human put there.** Marking someone Lost after they say no is final; a stray
re-booking cannot resurrect it.

The event that was refused is still recorded in `opportunity_stage_events` with
`refused_reason`, so a suppressed move is visible rather than silently dropped.
A fully-pinned alternative was rejected because a card nudged by hand would stop
tracking the payment that should mark it Won, and would vanish from the revenue
report without any signal.

**The guard is specifically about human closes.** A card closed by the *system*
(auto-Lost on a no-show) is still movable by a later event — if that person turns
up and pays, it becomes Won. Only a close made by a person is final.

Implemented as `opportunities.closed_trigger`
(`manual|booking|payment|reconciler`), set on the same write that sets `outcome`.
A close is final exactly when `closed_trigger = 'manual'`. This is the denormalised
form of the closing `opportunity_stage_events` row's `trigger`, readable without a
join on the hot path since every inbound event must consult it.

**Why not `closed_by_user_id`:** the obvious version stores *who* closed it and
treats non-NULL as "a human did this". But that column needs
`REFERENCES users(id) ON DELETE SET NULL`, so deleting a departing admin's account
would silently rewrite their deliberate Lost decisions into system closes and
un-pin every one of those cards — months later, with no signal. Identity must not
carry the semantics. `closed_by_user_id` is still stored alongside, nullable and
purely informational, for "who closed this".


**The re-booking loophole, closed.** §3.3's unique index only covers *open*
opportunities, so a contact whom Darren marked Lost could book again and get a
brand-new card — putting a ruled-out lead straight back in the working set through
a side door, which is the precise outcome §2.4 exists to prevent. Rule: a booking
for a contact with a **human-set** Lost on that pipeline within the last **30 days**
creates no card, and is recorded as a refused event against the closed
opportunity. After 30 days a new booking is treated as a genuinely new deal.
The window is a stated default, listed in §13 for Darren to confirm.

## 3. Schema — migration `00219_lead_engine_pipeline.sql`

`business_id` on every table, defaulting to
`'00000000-0000-0000-0000-000000000001'`, per the Stage 1a contract.

### 3.1 `pipelines`
`id`, `business_id`, `key` (unique per business), `name`, `status`
(`active|archived`), `created_at`, `updated_at`.

Machinery for N boards; exactly one seeded (**Coaching**), per parent §2.3.

### 3.2 `pipeline_stages`
`id`, `business_id`, `pipeline_id`, `key`, `name`, `position` (int, unique per
pipeline), `kind` (`open|won|lost`), `amber_after_days`, `red_after_days`,
`created_at`.

`kind` is what the movement rules key on — never the stage name, so renaming
"Consulted" cannot break the state machine. Staleness thresholds live per stage
because a card sitting three days in Consult Booked means something different from
three days in Consulted.

### 3.3 `opportunities`
`id`, `business_id`, `pipeline_id`, `contact_id` (FK `contacts(id)` ON DELETE
CASCADE), `stage_id`, `entered_stage_at`, `value_cents` (nullable),
`currency`, `source_session_id`, `outcome` (nullable `won|lost`),
`outcome_reason` (nullable), `closed_at`, `closed_trigger` (nullable
`manual|booking|payment|reconciler` — `manual` means final; see §2.4),
`closed_by_user_id` (nullable, informational only), `created_at`, `updated_at`.

- `source_session_id` is **copied from `contacts.first_touch_session_id` at card
  creation** and never updated afterwards. First touch is a property of the deal at
  the moment it began; re-reading it live would let a later merge silently rewrite
  history under a closed, already-reported deal.
- Partial unique index: **one open opportunity per (contact, pipeline)** —
  `WHERE outcome IS NULL`. A contact who books twice while the first deal is live
  updates that card rather than spawning a second.

### 3.4 `opportunity_stage_events`
`id`, `business_id`, `opportunity_id` (FK ON DELETE CASCADE), `from_stage_id`
(nullable — card creation has no origin), `to_stage_id`, `trigger`
(`booking|payment|manual|reconciler`), `actor_user_id` (nullable; NULL = system),
`refused_reason` (nullable), `occurred_at`, `metadata` jsonb.

**Deliberately a separate table, not `contact_timeline_events`.** Stage 1b gave
timeline events a retention cron that scrubs `metadata` because it carries raw
funnel-payload PII. Stage history is a business record, carries no payload PII, and
must outlive that window — putting it in the timeline would quietly delete the audit
trail of how a deal closed.

### 3.5 Cascade obligation (parent spec §10)

Stage 1c adds **exactly one** new cascading child of `contacts`:
`opportunities.contact_id`. `opportunity_stage_events` hangs off `opportunities`,
not off `contacts`, so it is carried transitively — re-pointing an opportunity's
`contact_id` leaves its `opportunity_id` unchanged and its history intact.

Re-run the mandatory grep from the Stage 1b plan and read it carefully:

```bash
grep -n "REFERENCES public.contacts(id)" supabase/migrations/*.sql
```

Today it returns **six lines, five of which are real FKs** — the sixth
(`00217:50`) is the instructional comment inside `merge_contacts` telling you to
run this grep. After `00219` it must return **seven lines / six real FKs**. A
seventh real FK means something was added that this design did not account for, and
the merge function is wrong until proven otherwise.

`merge_contacts` (`00217`) must re-point `opportunities` before its cascade delete.
This is the exact bug class Stage 1a shipped and Stage 1b caught.

**Merge conflict rule:** if both contacts have an open opportunity in the same
pipeline, the partial unique index would reject the move. Keep the one **further
along** (higher stage `position`), tie-broken by earlier `created_at` then `id`, and
close the other as `lost` with reason `merged_into_survivor` — mirroring the rule
`merge_contacts` already applies to `sequence_runs`.

## 4. Movement — `lib/lead-engine/pipeline-move.ts`

A pure decision function, the same shape as Stage 1b's `decideStep`:

```
decideMove(current: OpportunityState, event: PipelineEvent) → MoveDecision
```

`MoveDecision` is one of `create | advance | close | refuse | noop`. It touches no
database and is where every rule in §2.2 and §2.4 is tested — including the terminal
guard, which is a pure predicate over `(outcome, actor_of_last_move)`.

The impure caller writes the row, the stage event, and the audit entry.

**Ordering rule:** a stage only ever advances to a higher `position`, except closes.
A `booking.completed` arriving after a `payment` does not drag a Won card backwards.

## 5. Hooks — where cards actually move

Both webhooks already resolve a contact and call `exitRunsForContact` inside a
try/catch that logs and never fails the webhook. Card movement joins them there,
under the same discipline.

- `app/api/webhooks/ghl-booking/route.ts` — already switches on
  `scheduled|completed|cancelled|no_show`, already calls
  `findContactByIdentifiers({ email, phone })`.
- `app/api/stripe/webhook/route.ts` — already resolves
  `findContactByIdentifiers({ userId, email })` on `checkout.session.completed`.
  `value_cents` and `currency` come from the session's `amount_total` / `currency`.

A hook failure must never fail the webhook. Stripe retries a 500 and GHL may not.

## 6. The reconciler — `lib/automation/pipeline-reconcile.ts`

A hook that throws *after* the booking row is written loses a card permanently, and
the only way to notice is a deal missing from the board. The reconciler makes
completeness an invariant.

A pure aggregator behind the established pattern: Firebase `onSchedule` → POST
`/api/admin/internal/pipeline-reconcile` → `INTERNAL_CRON_TOKEN` bearer check →
`isCronSkipped({ enabledKey: "cron_pipeline_reconcile_enabled", defaultEnabled: false })`.

It scans a bounded recent window for:
1. `bookings` with a resolvable contact and no open/closed opportunity → create.
2. `payments` with `status='succeeded'` whose contact has an open opportunity → win it.

Every row it creates is written with `trigger='reconciler'`, so the board can be
audited for how much of it the hooks missed. **A non-zero reconciler count is a bug
signal, not routine** — it is reported in the cron summary for the automation-health
watchdog, and the job registers in `CRON_CATALOG` plus `VERCEL_ROUTE_JOBS` (Stage 1b
proved these drift silently and added an agreement test).

Idempotency: the partial unique index on open opportunities is the backstop; the
reconciler additionally matches on `source booking/payment id` in `metadata`.

## 7. Campaign-to-revenue

The join, entirely over columns that exist today:

```
marketing_attribution.session_id
   ← contacts.first_touch_session_id   (copied to opportunities.source_session_id)
   → opportunities (outcome='won', value_cents)
```

Grouped by `utm_campaign` / `utm_source` / `gclid`, reporting **won value and count**
per campaign. Revenue is read from `opportunities.value_cents`, not re-derived from
`payments`, so the number on the board and the number in the report are the same
number by construction.

Per parent §8 there is nothing to back-fill: reporting starts at launch, and **the
first month's report will be thin. Say this to Darren before launch so it is
expected.**

### 7.1 Folded-in debt — the merge loses first touch

`merge_contacts` never touches `first_touch_session_id`, so merging keeps the
survivor's value even when the loser's is the genuinely earlier touch. Today the
column has no reader so nothing breaks; Stage 1c makes it the root of every number
in this report.

Fix in `00220`: on merge, the survivor keeps the **earliest non-null**
`first_touch_session_id` of the two. Ordered by the attribution row's
`first_seen_at`, falling back to the contact's `created_at` when no attribution row
exists. Already-created opportunities keep their copied `source_session_id`
untouched, per §3.3.

## 8. Staleness

Computed at read time from `now() - entered_stage_at` against the stage's
`amber_after_days` / `red_after_days`. **Never stored** (parent §8) — a stored flag
is wrong the moment the clock moves and needs a job to keep true.

Cards in a `won`/`lost` stage are never stale.

## 9. Surfaces

- `/admin/pipeline` — the board. Columns per stage, cards showing contact name,
  age in stage, staleness colour, and value on Won. Drag via `@dnd-kit` (already a
  dependency, already used elsewhere in this repo).
- Campaign-to-revenue table on the existing insights surface, built with
  `components/ui/data-table.tsx` — the house standard per CLAUDE.md. Not a
  hand-rolled `<table>`.
- Business identity from `business_settings`; **no brand literals**. Stage 1b's
  `no-brand-literals` scan test extends to cover the new files.

## 10. Audit slugs (closed taxonomy — `lib/audit/actions.ts`)

| slug | category |
|---|---|
| `pipeline.opportunity_created` | `automation` |
| `pipeline.opportunity_moved` | `admin_write` (manual) / `automation` (event) |
| `pipeline.opportunity_won` | `commerce` |
| `pipeline.opportunity_lost` | `commerce` |

## 11. Testing (parent §12 — targeted suites plus a build)

Deepest coverage on `decideMove`, which is pure and therefore cheap to exhaust:

- the terminal guard — an event may not lift a human-set Won/Lost, and the refusal
  is recorded
- backwards-move refusal — `booking.completed` after `payment`
- one-open-per-contact-per-pipeline under a second booking
- merge with a contested open opportunity in the same pipeline
- reconciler idempotency — a second pass creates nothing
- staleness boundaries at exactly `amber_after_days` and `red_after_days`
- the cascade re-review grep returns **six**, and `merge_contacts` re-points
  `opportunities`
- the `no-brand-literals` scan over the new files
- `CRON_CATALOG` ↔ `VERCEL_ROUTE_JOBS` agreement for `pipeline-reconcile`

Baseline discipline: compare the **total** `tsc --noEmit` count against `main`,
never a grep for own filenames. The baseline is **251**, measured on `main` at
`89aabaa8` on 2026-08-19 — **not the 258 quoted by the Stage 1a and 1b plans**,
which Stage 1b lowered by fixing seven pre-existing errors in
`__tests__/api/admin/automation/trigger.test.ts`. Re-measure rather than quoting
this number if `main` has moved.

A falling count needs explaining as much as a rising one: seven fixed and seven
introduced also nets to zero. Normalise line/column out of both error lists and
`comm` them; do not compare totals alone.

## 12. Out of scope

- Additional boards beyond Coaching — configuration, not code (parent §2.3).
- SMS-driven movement — Stage 2, blocked on Twilio A2P registration.
- Back-filling historical GHL opportunities — parent §8: nothing to back-fill.
- Wiring the remaining entry points into `recordContactEvent` — Stage 4.

## 13. Open questions

1. **Consult booking source.** All four moves depend on the GHL booking webhook,
   which stays live until switch-over. If the Athlete Quiz replacement changes how
   consults are booked, §2.2's first two arrows need re-pointing.
2. ~~**Refunds.**~~ **RESOLVED 2026-08-19 — Darren approved.** See §14.
3. ~~**The 30-day re-booking suppression window**~~ **RESOLVED 2026-08-19 —
   Darren confirmed 30 days.** `REBOOKING_SUPPRESSION_DAYS = 30` stands as built;
   no change required.

## 14. Refunds (resolved)

A refund **reopens nothing**. The card stays Won — the deal did happen — but its
contribution to revenue is corrected so the campaign report self-heals.

On `charge.refunded`, resolve the contact from the refunded payment and amend
their most recent Won opportunity:

- `value_cents := max(0, value_cents - amount_refunded)`
- `outcome_reason := 'refunded'` when the result reaches 0, otherwise
  `'partially_refunded'`

**Why subtract rather than zero.** The approved shape was "zero it", and for a
full refund subtraction gives exactly that. But Stripe fires `charge.refunded`
for *partial* refunds too, and zeroing a $1,200 deal because $100 came back would
understate revenue as badly as ignoring the refund overstates it. Subtraction is
the same decision, correct in both cases.

**Stated limitation.** The link from refund to card is contact + recency, because
a refund carries a `payment_intent`, not the checkout session id the Won card was
created from. A contact with two Won deals gets their most recent one amended,
which may be the wrong one. Accepted rather than solved: correcting it means
threading the payment intent onto the opportunity at creation, which is more
schema than a rare case earns. Revisit if it is ever observed.

Refund handling writes through the same `applyPipelineEvent` path and records an
`opportunity_stage_events` row, so an amended value is never a silent edit.
