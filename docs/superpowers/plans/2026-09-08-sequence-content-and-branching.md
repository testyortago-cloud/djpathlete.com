# Sequence content and branching — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gaps #5, #6 and #7 — three sequences that do not exist, real multi-step bodies for the four one-email quiz sequences, and the first use of branching — plus the forward-only guard the owner ruled on.

**Architecture:** One seed migration (`00255`) carries all content. Four small code changes make the content reachable: a new `ContactEventSource`, a writer for it on Stripe's existing `checkout.session.expired` case, metadata at the camp interest signup so a trigger filter can tell interest from paid, and a forward-only guard in `moveOpportunityBySequence`. Two of those widen unions whose consumers the compiler cannot check.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, vitest (node environment), TypeScript.

**Spec:** [docs/superpowers/specs/2026-09-08-sequence-content-and-branching-design.md](../specs/2026-09-08-sequence-content-and-branching-design.md) — read it before Task 1. §4.4 pins the step lists, §6 explains why each arm must terminate, §10 lists the traps.

**Worktree:** `../djpathlete-seq-content`, branch `feat/sequence-content`, cut from `main` @ `82ba10f7`. `.env.local` is symlinked and `npm ci` has been run.

## Global Constraints

- **Node 24.** `source ~/.nvm/nvm.sh && nvm use` before any vitest or tsc. Node is the default vitest environment.
- **tsc baseline is exactly 238 errors across 54 files**, measured in this worktree at the branch point on 2026-09-08. The per-file set is saved at `/tmp/claude-501/tsc-baseline-fileset.txt`. Diff the per-file SET, never the count — a falling count still hides new errors.
- **Pre-existing red, not yours:** `__tests__/migrations/00062.test.ts` fails 3/6 and `__tests__/api/spine/purchase-spine.test.ts` fails 1/11. Both are live-DB tests that fail identically on a clean checkout.
- **Targeted tests only.** Never run the full suite at a checkpoint.
- **Prettier is unclean on ~78 files repo-wide**, including `lib/db/pipeline.ts` and `lib/audit/actions.ts`. Do not reformat them; it buries the real change.
- **Migration `00255` is claimed by this branch.** `00254` is the last on disk. Re-check before pushing — numbers collide silently and git merges the collision clean.
- **Never add a `SINGLETON_BUSINESS_ID` reference in a production file.** Tests may use it; `lib/`, `app/`, `scripts/` may not. The migration writes the literal UUID directly, exactly as `00218`/`00229` do.
- **No brand names under `lib/lead-engine/`, comments included.** A test sweeps for them. Migrations and `docs/` are not swept.
- **Copy is written for a non-programmer.** No "opportunity", no "pipeline stage", no "config", no backticks. These strings reach a coach raw via `run.last_error`.
- **No Claude or AI attribution in commit messages.** No `Co-Authored-By: Claude`, no "Generated with" footer.
- **Do not push, merge, deploy, or touch production.** Dev project is `anjvztjiokcgiyhobknq`; production `epzuvzkokzqtzomeyoha` is read-only by design.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/db/pipeline.ts` | forward-only guard; widen `SequenceMoveResult` skipped reason | 1 |
| `lib/db/contact-detail.ts` | render the new skip reason; add the new source label | 1, 2 |
| `lib/db/contacts.ts` | `ContactEventSource` gains `checkout_abandoned` | 2 |
| `app/api/stripe/webhook/route.ts` | write the abandoned-checkout contact event | 2 |
| `app/api/events/[id]/signup/route.ts` | pass `signup_type` metadata so a filter can select interest | 3 |
| `supabase/migrations/00255_sequence_content_and_branching.sql` | all seeded content | 4, 5 |
| `__tests__/db/pipeline.test.ts` | guard tests | 1 |
| `__tests__/migrations/00255_sequence_content_and_branching.test.ts` | structural assertions over the migration | 6 |

---

## Task 1: Forward-only guard, and both of its blind consumers

**Files:**
- Modify: `lib/db/pipeline.ts:986-989` (the union) and `:1043` (`moveOpportunityBySequence`)
- Modify: `lib/db/contact-detail.ts:314` (the skip-reason chain)
- Test: `__tests__/db/pipeline.test.ts:1595` (the existing `moveOpportunityBySequence` describe block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SequenceMoveResult` skipped reason union gains `"would_move_backwards"`. No later task depends on it.

**Why this task exists:** `decideMove` holds forward-only at `lib/lead-engine/pipeline-move.ts:248`; `moveOpportunityBySequence` does not, making a `stage` step the only automated writer that can drag a card backwards and reset `entered_stage_at`, which is what the board's staleness colour is computed from. The owner ruled forward-only on 2026-09-08.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("moveOpportunityBySequence", …)` block in `__tests__/db/pipeline.test.ts`. The seeded board's stages are `consult_booked` (position 1), `consulted` (2), `won` (3), `lost` (4).

```ts
  it("refuses to drag a card backwards and writes nothing at all", async () => {
    seedBoard()
    seedContact("c-1")
    // Already Consulted — position 2. The step below aims at position 1.
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })

    const result = await moveOpportunityBySequence({
      contactId: "c-1",
      stageKey: "consult_booked",
      pipelineKey: null,
      businessId: SINGLETON_BUSINESS_ID,
      sequenceRunId: RUN_ID,
    })

    expect(result).toEqual({ kind: "skipped", reason: "would_move_backwards" })
    // The card did not move and, just as importantly, entered_stage_at was not
    // reset — a reset silently restarts the staleness colour the board reads.
    expect(store.opportunities[0].stage_id).toBe("stage-consulted")
    expect(updatePatchesFor("opportunities")).toHaveLength(0)
    expect(stageEventsFor("opp-1")).toHaveLength(0)
  })

  it("still allows a forward move of more than one stage", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })

    // consult_booked (1) -> consulted (2) is +1; this asserts the guard is a
    // comparison, not an adjacency check. `won` and `lost` are refused
    // earlier by the kind !== "open" branch, so `consulted` is the only
    // forward target on this board.
    const result = await moveOpportunityBySequence({
      contactId: "c-1",
      stageKey: "consulted",
      pipelineKey: null,
      businessId: SINGLETON_BUSINESS_ID,
      sequenceRunId: RUN_ID,
    })

    expect(result).toMatchObject({ kind: "moved" })
  })
```

- [ ] **Step 2: Run it and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__/db/pipeline.test.ts -t "drag a card backwards"
```

Expected: FAIL. Without the guard the function moves the card, so `result.kind` is `"moved"`, not `"skipped"`.

- [ ] **Step 3: Widen the union**

In `lib/db/pipeline.ts`, line 988:

```ts
  | { kind: "skipped"; reason: "no_opportunity" | "already_closed" | "already_on_stage" | "would_move_backwards" }
```

- [ ] **Step 4: Add the guard**

In `moveOpportunityBySequence`, immediately after the existing `already_on_stage` check (which is the last of the three `current`-based guards):

```ts
  // Forward only, matching `decideMove` (lib/lead-engine/pipeline-move.ts).
  // A sequence step is the only automated writer that could otherwise drag a
  // card backwards, and moving one back resets entered_stage_at — so the
  // board's staleness colour would restart and the coach's queue would show a
  // card as needing a step the person has already taken.
  //
  // SKIPPED, not INVALID: the step is well formed and the sequence author did
  // nothing wrong. Failing the whole run over a card that simply moved on
  // without us would be disproportionate.
  if (toStage.position <= current.stage_position) {
    return { kind: "skipped", reason: "would_move_backwards" }
  }
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run __tests__/db/pipeline.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 6: Render the new reason for the coach**

`lib/db/contact-detail.ts:314` chains over the skip reason and falls through to `null`, so without this the coach reads "A sequence left their card where it was" with no explanation. **tsc cannot catch this** — the chain compares a `string | null`.

```ts
              : reason === "already_on_stage"
                ? "Their card was already at that stage, so nothing changed."
                : reason === "would_move_backwards"
                  ? "Their card is further along than the step asked for, so it was left where it is."
                  : null
```

- [ ] **Step 7: Pin that rendering with a test**

Find the existing `describe` covering `sequence_stage_skipped` in `__tests__/lib/db/contact-detail.test.ts` (search for `already_on_stage`) and add a case in the same style as its neighbours, asserting the new reason produces the sentence above and not `null`.

- [ ] **Step 8: Run the consumer suite**

```bash
npx vitest run __tests__/lib/db/contact-detail.test.ts
```

Expected: PASS.

- [ ] **Step 9: Mutate every test that passed first time**

Mandatory — a green-on-first-run test in this repo has repeatedly pinned nothing. Apply each mutation, confirm a test FAILS, then revert:

1. Change `<=` to `<` in the guard. The backwards test should still pass, but a same-stage move now falls through — confirm the existing `already_on_stage` test catches it. **If nothing fails, the two guards are masking each other**: add a case that distinguishes them.
2. Change `toStage.position <= current.stage_position` to `false`. The backwards test must fail.
3. Delete the `would_move_backwards` arm in `contact-detail.ts`. Step 7's test must fail.
4. Change the guard's return to `{ kind: "skipped", reason: "already_on_stage" }`. The backwards test must fail on the reason.

- [ ] **Step 10: Commit**

```bash
git add lib/db/pipeline.ts lib/db/contact-detail.ts __tests__/db/pipeline.test.ts __tests__/lib/db/contact-detail.test.ts
git commit -m "fix(pipeline): a sequence step may not drag a card backwards

decideMove has held forward-only since it was written; moveOpportunityBySequence
did not, which made a stage step the only automated writer that could move a
card back and reset entered_stage_at -- the value the board's staleness colour
is computed from.

Skipped rather than invalid: the step is well formed, so failing the run would
be disproportionate. The contact timeline gains a sentence for the new reason,
which tsc cannot check because the chain compares a plain string."
```

---

## Task 2: `checkout_abandoned` — a new contact source and its writer

**Files:**
- Modify: `lib/db/contacts.ts:8-25` (the `ContactEventSource` union)
- Modify: `lib/db/contact-detail.ts:165` (`SOURCE_LABELS`)
- Modify: `app/api/stripe/webhook/route.ts:317` (the `checkout.session.expired` case)
- Test: `__tests__/lib/db/contact-detail.test.ts`, plus the Stripe webhook suite

**Interfaces:**
- Consumes: nothing.
- Produces: `ContactEventSource` gains the literal `"checkout_abandoned"`. Task 4 seeds a sequence whose `trigger_source` is that exact string — they must match character for character.

**Why not `funnel_checkout`:** it must keep meaning "bought through a funnel". Spending it on an abandonment inverts its name and would leave gap #14 unclosable in its own terms. Gap #14 stays open; this closes none of it.

- [ ] **Step 1: Widen the union**

`lib/db/contacts.ts`, inside `ContactEventSource`, keeping the existing comment about there being no CHECK constraint:

```ts
  | "purchase"
  /**
   * A Checkout session that expired without being paid. Written from the
   * Stripe webhook's `checkout.session.expired` case. NOT `funnel_checkout`,
   * which means the opposite -- a checkout that succeeded.
   */
  | "checkout_abandoned"
```

- [ ] **Step 2: Give it a label before anything writes it**

`lib/db/contact-detail.ts`, in `SOURCE_LABELS`. This map is `Record<string, string>`, so **a missing entry compiles cleanly and shows the coach a raw slug**:

```ts
  checkout_abandoned: "Started a checkout and did not finish",
```

- [ ] **Step 3: Write the failing webhook test**

In the Stripe webhook suite (`__tests__/api/stripe/` — find the file covering `checkout.session.expired`; if none covers it, add to the main webhook route suite). Pin all three behaviours:

```ts
  it("captures an abandoned coaching checkout as a lead", async () => {
    await postStripeEvent({
      type: "checkout.session.expired",
      data: { object: { id: "cs_1", customer_email: "a@example.com", metadata: {} } },
    })

    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "checkout_abandoned", email: "a@example.com" }),
    )
  })

  it("ignores an abandoned shop checkout", async () => {
    await postStripeEvent({
      type: "checkout.session.expired",
      data: { object: { id: "cs_2", customer_email: "b@example.com", metadata: { type: "shop_order" } } },
    })

    expect(captureLead).not.toHaveBeenCalled()
  })

  it("still reaps an abandoned session pack", async () => {
    await postStripeEvent({
      type: "checkout.session.expired",
      data: { object: { id: "cs_3", customer_email: "c@example.com", metadata: { type: "session_pack" } } },
    })

    expect(handleSessionPackExpired).toHaveBeenCalled()
    expect(captureLead).not.toHaveBeenCalled()
  })
```

- [ ] **Step 4: Run it and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__/api/stripe --environment node
```

Expected: FAIL — `captureLead` is never called on the expired path today.

- [ ] **Step 5a: Parameterise the existing capture helper**

**Do not write a second capture block.** `tryCaptureLeadFromCheckout`
(`app/api/stripe/webhook/route.ts:153`) already does this job for the completed
case — it swallows its own errors so a capture can never fail a payment
webhook, and it records `stripe_session_id` in metadata. It just hardcodes the
source. Give it a parameter:

```ts
async function tryCaptureLeadFromCheckout(
  session: Stripe.Checkout.Session,
  businessId: string,
  source: ContactEventSource,
): Promise<void> {
  try {
    await captureLead({
      source,
      email: session.customer_details?.email ?? session.customer_email ?? null,
      name: session.customer_details?.name ?? null,
      businessId,
      metadata: { stripe_session_id: session.id },
    })
  } catch (err) {
    console.error("[stripe-webhook] lead capture failed", (err as Error).message)
  }
}
```

Then update its **one** existing call site (line 258) to pass `"purchase"`
explicitly:

```ts
        await tryCaptureLeadFromCheckout(session, payerBusinessId ?? platformBusinessId(), "purchase")
```

`ContactEventSource` is already imported in this file via the `captureLead`
import; add it to that import if not.

- [ ] **Step 5b: Call it from the expired case**

Replace the `checkout.session.expired` case at `app/api/stripe/webhook/route.ts:317`:

```ts
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.metadata?.type === "session_pack") {
          await handleSessionPackExpired(session)
        }

        // Lead Engine: an expired session is the ONLY abandonment signal
        // Stripe gives us. It arrives roughly 24 hours after the session was
        // created, so the follow-up is a day late by construction -- that is
        // Stripe's timing, not a choice made here.
        //
        // Gated on the same NON_COACHING_CHECKOUT_TYPES set that decides
        // whether a COMPLETED checkout wins a pipeline card, so "a coaching
        // sale" has exactly one definition in this route. Per that constant's
        // own comment, a new coaching checkout that forgets to set
        // `metadata.type` still counts as coaching.
        if (!NON_COACHING_CHECKOUT_TYPES.has(session.metadata?.type ?? "")) {
          // Same tenant resolution the completed case uses: the payer's own
          // contact row when they have one, the platform seam for a first-time
          // payer who does not.
          const contact = await findContactWithBusinessByIdentifiers({
            userId: session.metadata?.userId ?? null,
            email: session.customer_details?.email ?? session.customer_email ?? null,
          })
          await tryCaptureLeadFromCheckout(
            session,
            contact?.businessId ?? platformBusinessId(),
            "checkout_abandoned",
          )
        }
        break
      }
```

**`platformBusinessId()` is synchronous** — do not `await` it. This route is
already in that function's inventory (it already calls it at line 258), so
`__tests__/lib/tenancy/platform-inventory.test.ts` needs no change. Confirm
that by running it rather than assuming.

**This adds no new `SINGLETON_BUSINESS_ID` reference** and no new platform-seam
*file* — it is a second call in a file that already calls it.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run __tests__/api/stripe --environment node
npx vitest run __tests__/lib/db/contact-detail.test.ts
npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts
```

Expected: all PASS. Route suites sometimes report "no tests" unless `--environment node` is pinned — that is a known trap, not a missing file.

- [ ] **Step 7: Mutate**

1. Remove the `NON_COACHING_CHECKOUT_TYPES` guard entirely — the shop test must fail.
2. Change the expired case's source argument to `"funnel_checkout"` — the first test must fail.
3. Delete the `SOURCE_LABELS` entry — add or confirm a test asserting the label resolves; if nothing fails, that label is unpinned, so pin it.
4. Delete the `handleSessionPackExpired` call — the third test must fail. (This proves the new code did not displace the old behaviour.)
5. **Change the COMPLETED case's source argument from `"purchase"` to `"checkout_abandoned"`.** An existing test must fail. Step 5a touched a shared helper, and this is the mutation that proves the completed path still records a purchase — if nothing fails, the completed path's source was never pinned and now must be.

- [ ] **Step 8: Commit**

```bash
git add lib/db/contacts.ts lib/db/contact-detail.ts app/api/stripe/webhook/route.ts __tests__
git commit -m "feat(lead-engine): capture an abandoned coaching checkout as a lead

checkout.session.expired was already handled for session packs and did nothing
else. It now also records a contact event, which is what the abandoned-checkout
sequence enrols on.

A new source rather than funnel_checkout: that one has to keep meaning a
checkout that SUCCEEDED. Gap #14 is untouched. Gated on the existing
NON_COACHING_CHECKOUT_TYPES so a coaching sale means one thing in this route."
```

---

## Task 3: Tell interest apart from paid at the camp signup

**Files:**
- Modify: `app/api/events/[id]/signup/route.ts:78`
- Test: the events signup route suite

**Interfaces:**
- Consumes: nothing.
- Produces: contact events from the interest route carry `metadata.signup_type === "interest"`. Task 4 seeds `camp_clinic_deadline` with `trigger_filter` `{"signup_type": "interest"}` — the key and value must match exactly.

**Why this task exists, and it is the whole reason the sequence is buildable:** the interest route and the paid checkout route BOTH call `captureLead({ source: "event_signup" })` with **no metadata**. `enrollIfTriggered` matches `trigger_filter` by exact key equality against that metadata, so with `{}` on both sides a filter cannot separate them. A `camp_clinic_deadline` sequence built today would chase people who have already paid.

- [ ] **Step 1: Write the failing test**

```ts
  it("marks an interest signup so a sequence can tell it from a paid one", async () => {
    await postSignup({ eventId: "evt-1", parent_email: "a@example.com", parent_name: "A" })

    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "event_signup",
        metadata: expect.objectContaining({ signup_type: "interest" }),
      }),
    )
  })
```

- [ ] **Step 2: Run it and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__ -t "tell it from a paid one" --environment node
```

Expected: FAIL — no `metadata` key is passed at all today.

- [ ] **Step 3: Pass the metadata**

At `app/api/events/[id]/signup/route.ts:78`, extend the existing `captureLead` call. Read the values from the `signup` ROW just created, matching the comment already there about reading from the row rather than `parsed.data`:

```ts
      const contactId = await captureLead({
        source: "event_signup",
        email: signup.parent_email,
        phone: signup.parent_phone,
        name: signup.parent_name,
        businessId,
        // enrollIfTriggered matches a sequence's trigger filter against this
        // bag by exact key equality. Without signup_type, an interest signup
        // and a paid registration are indistinguishable, and a sequence that
        // chases people to sign up would chase the ones who already have.
        metadata: { signup_type: "interest" },
      })
```

**Do not** add `signup_type: "paid"` to the checkout route. Nothing reads it, and a value with no reader is the labelling gap this repo's conventions forbid.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run __tests__ -t "tell it from a paid one" --environment node
```

Expected: PASS.

- [ ] **Step 5: Mutate**

1. Change the value to `"paid"` — the test must fail.
2. Change the key to `signupType` — the test must fail. (Camel-case here would silently never match the filter.)
3. Remove `metadata` — the test must fail.

- [ ] **Step 6: Commit**

```bash
git add "app/api/events/[id]/signup/route.ts" __tests__
git commit -m "feat(lead-engine): mark a camp interest signup as interest

The interest route and the paid checkout route both recorded source
event_signup with no metadata, so a sequence trigger filter could not tell them
apart -- a camp chase sequence would have emailed people who had already paid.

Only the interest side is marked. Adding signup_type to the paid route would be
a value with no reader."
```

---

## Task 4: Migration `00255`, part one — the three new sequences

**Files:**
- Create: `supabase/migrations/00255_sequence_content_and_branching.sql`

**Interfaces:**
- Consumes: the exact source strings from Tasks 2 and 3 — `checkout_abandoned`, and `{"signup_type": "interest"}`.
- Produces: the file Task 5 appends to and Task 6 asserts over.

**Conventions, copied from `00218`/`00229`/`00253` — follow them exactly:**
- The business id literal is `'00000000-0000-0000-0000-000000000001'`, written inline. This is SQL, not a production TypeScript file.
- Bodies use dollar quoting: `$body$…$body$`, subjects `$subj$…$subj$`. No apostrophe escaping needed inside them.
- Every insert ends `ON CONFLICT … DO NOTHING` so the migration is re-runnable.
- Sequences seed `status = 'draft'`. Nothing sends until a human flips a row.

**Voice, taken from the copy already in production (`00253`):** open `Hi {{name}}`, short paragraphs, no exclamation marks, no hype, no emoji, plain words. Close with one simple ask, usually "reply to this email". Never claim a specific result. `{{name}}` and `{{sms_consent_url}}` are the ONLY placeholders the renderer substitutes — there is no variable for a camp name, date, price or product, so **no body may imply one**.

- [ ] **Step 1: Write the file header**

```sql
-- supabase/migrations/00255_sequence_content_and_branching.sql
-- Gaps #5, #6 and #7 of docs/full-engine-scope-vs-built.md, in one migration
-- because they share this file and the same body of copy.
--
-- Design: docs/superpowers/specs/2026-09-08-sequence-content-and-branching-design.md
--
-- WHAT IS NEW HERE, beyond copy:
--   * The FIRST sequence_steps.config write in this repository's history.
--     Migration 00254 gave the column a reader and its constraints; nothing
--     has ever written it. The tag step in abandoned_checkout is the first.
--   * The FIRST branch steps in production. branch_condition,
--     on_true_position and on_false_position have existed and worked since
--     00216 and no sequence has ever used them.
--
-- SEEDED AS 'draft', for the reason 00218, 00229 and 00253 all state: nothing
-- enrols and no copy reaches a real person until a human has read the wording
-- and flipped one row. THE COPY BELOW WAS DRAFTED, NOT AUTHORED BY DARREN.
-- Read it, change whatever does not sound like you, then activate. Do not
-- "helpfully" seed these active.
--
-- BRANCH ARMS MUST TERMINATE. A branch target is the only jump this engine
-- has; every other step advances to position + 1. An arm that runs off its own
-- end falls through into the OTHER arm's steps and the person receives both.
-- Each arm below therefore ends in its own 'stop'.
--
-- NO MERGE FIELDS BEYOND {{name}}. renderSequenceEmail substitutes exactly
-- {{name}} and {{sms_consent_url}}. There is no variable for a camp's name,
-- date or price, so the camp copy says "the camp you asked about" rather than
-- naming one. Using {{sms_consent_url}} in a body with no URL supplied makes
-- renderSequenceEmail THROW, so no body below uses it.
```

- [ ] **Step 2: Insert the three sequence rows**

```sql
INSERT INTO public.sequences (business_id, key, name, description, trigger_source, trigger_filter, status)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'abandoned_checkout',
    'Abandoned checkout',
    'Follows someone who started paying for coaching or a program and did not finish. Stripe only reports an abandoned checkout when the session expires, about 24 hours later, so the first message here is a day behind the event by construction. Excludes shop orders, event tickets and card-on-file setups.',
    'checkout_abandoned',
    '{}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'service_application_received',
    'Service application received',
    'Follows someone who submitted the enquiry form on a service page. They land on /application-received and, until this sequence is switched on, receive nothing at all -- the existing notification goes to the sales inbox, not to them. Step-Up submissions are excluded: those record a different source.',
    'inquiry',
    '{}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'camp_clinic_deadline',
    'Camp or clinic deadline',
    'Chases someone who registered interest in a camp or clinic and has not paid. Runs on relative waits from the moment they registered interest, not on the camp start date -- a run cannot know which camp it belongs to, so the copy never names one.',
    'event_signup',
    '{"signup_type": "interest"}'::jsonb,
    'draft'
  )
ON CONFLICT (business_id, key) DO NOTHING;
```

- [ ] **Step 3: Insert `abandoned_checkout` steps 0–7**

Structure from spec §4.4. Position 2 is the tag; the branch at 3 sends the texted arm to 4 and everyone else to 6; each arm ends in its own stop.

```sql
-- abandoned_checkout: 0 email, 1 wait 2d, 2 tag, 3 branch,
--   texted arm 4 sms -> 5 stop; emailed arm 6 email -> 7 stop.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   0, 'email', NULL,
   $subj$You left something half-finished$subj$,
   $body$Hi {{name}}

You started signing up and something got in the way. That happens — it is usually a question that did not have an obvious answer.

If it was the price, the commitment, or whether it is the right fit at all, tell me which and I will give you a straight answer. If it was just the timing, that is fine too.

Reply to this email and let me know.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   2, 'tag', NULL, NULL, NULL,
   $cfg${"tag": "abandoned-checkout"}$cfg$::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_consent", "channel": "sms"}$cond$::jsonb, 4, 6),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   4, 'sms', NULL, NULL,
   $body$Hi {{name}} — you started signing up and did not finish. If something was unclear, text back and a real person answers.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   6, 'email', NULL,
   $subj$Still worth a conversation$subj$,
   $body$Hi {{name}}

I will leave this one here.

If you want to talk it through before deciding anything, reply to this email and tell me what you are training for. No commitment, and no follow-up after this if you would rather leave it.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'abandoned_checkout'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;
```

- [ ] **Step 4: Insert `service_application_received` steps 0–5**

```sql
-- service_application_received: 0 email (immediate), 1 wait 2d, 2 email,
--   3 wait 4d, 4 email, 5 stop. No branch -- see the design's §6.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   0, 'email', NULL,
   $subj$We have your application$subj$,
   $body$Hi {{name}}

Thanks for sending this through. It has landed and a real person reads every one.

What happens next: I go through what you wrote, and if it looks like something we can genuinely help with, I will reply to set up a time to talk. If it is not a good fit, I will tell you that too rather than leave you waiting.

If anything has changed since you sent it, reply here and let me know.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   2, 'email', NULL,
   $subj$What the first conversation covers$subj$,
   $body$Hi {{name}}

While you are waiting, here is what the first conversation actually is, so it is not a mystery.

It is a straight talk about what you are training for, what has and has not worked, and anything that keeps breaking down. No assessment to prepare for and nothing to bring.

By the end of it you should know whether this is worth doing. If it is not, I will say so.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   3, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   4, 'email', NULL,
   $subj$Still want to talk?$subj$,
   $body$Hi {{name}}

I have not heard back, so this is the last one about your application.

If you still want to go through it, reply and we will find a time. If your plans changed, no reply needed — I will leave you alone.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'service_application_received'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;
```

- [ ] **Step 5: Insert `camp_clinic_deadline` steps 0–7**

Four touches over ten days. **No body names a camp, a date or a price** — there is no merge field for any of them.

```sql
-- camp_clinic_deadline: 0 email, 1 wait 2d, 2 email, 3 wait 4d, 4 email,
--   5 wait 4d, 6 email, 7 stop. Relative waits, NOT anchored to the camp
--   start date -- a run cannot know which camp it belongs to.
INSERT INTO public.sequence_steps
  (business_id, sequence_id, position, kind, wait_minutes, subject, body, config, branch_condition, on_true_position, on_false_position)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   0, 'email', NULL,
   $subj$About the camp you asked about$subj$,
   $body$Hi {{name}}

Thanks for putting your name down. Your place is not held yet — that happens when you register properly — but here is what it covers so you can decide.

It is a small group, coached in person, working on the things that actually limit an athlete rather than a general session everyone gets. If you have a specific problem you want looked at, bring it.

If you want the details again or have a question first, reply to this email.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   2, 'email', NULL,
   $subj$What a day there looks like$subj$,
   $body$Hi {{name}}

In case it helps you decide.

The day is mostly work, not talking. We look at how an athlete moves under load, fix the things that are cheap to fix on the spot, and give them the two or three things worth taking home. Nobody is standing around.

Parents are welcome to watch. Athletes usually leave knowing exactly what to work on, which is the part that lasts after the day ends.

Reply if you want to know whether it suits the athlete you have in mind.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   3, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   4, 'email', NULL,
   $subj$Places are limited$subj$,
   $body$Hi {{name}}

A quick heads up: places are capped so the coaching stays hands-on, and registering interest does not hold one.

If you want the spot, register properly and it is yours. If you have decided against it, that is completely fine — you can ignore this.

Reply if there is anything you still need to know first.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   5, 'wait', 5760, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   6, 'email', NULL,
   $subj$Last one about this$subj$,
   $body$Hi {{name}}

Last message about the camp — I will not keep bringing it up.

If the timing is wrong, tell me and I will let you know when the next one is instead. If you want a place, register and you are set.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'camp_clinic_deadline'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
ON CONFLICT (sequence_id, position) DO NOTHING;
```

- [ ] **Step 6: Read every body aloud**

Not optional and not ceremony. Check each one against the house rules: no jargon, no idiom a non-native reader would trip on, no exclamation marks, no claim of a specific result, no mention of a camp name, date or price. If a sentence needs a semicolon, split it.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00255_sequence_content_and_branching.sql
git commit -m "feat(lead-engine): seed the three missing sequences (gap #5)

Abandoned checkout, service application received, and camp or clinic deadline.
All three seed as draft -- the copy was drafted, not authored, and 00218's rule
is that a human reads the wording before anything sends.

Carries the first sequence_steps.config write in this repo's history (the tag
step) and the first branch steps in production. Each branch arm ends in its own
stop: a branch target is the engine's only jump, so an arm that runs off its
end falls through into the other arm."
```

---

## Task 5: Migration `00255`, part two — the quiz sequences

**Files:**
- Modify: `supabase/migrations/00255_sequence_content_and_branching.sql` (append)

**Interfaces:**
- Consumes: the file created in Task 4.
- Produces: the finished migration Task 6 asserts over.

**Two facts to check before writing a line:**
1. Each quiz sequence has exactly ONE step, at position 0, and **no `stop` step**. So positions 1–7 append cleanly and no existing position needs moving. (`00222` had to renumber a stop step when it inserted; this does not.)
2. Position 0's copy is live, reviewed wording from `00253`. **Do not rewrite it.**

- [ ] **Step 1: Append positions 1–7 for all four**

The arc is identical in all four; only the voice differs. Positions: `1 wait 2d`, `2 email`, `3 branch has_user → true 6, false 4`, `4 email` (prospect), `5 stop`, `6 email` (client), `7 stop`.

Write the four blocks in the same shape as Task 4's inserts. The per-sequence voice, taken from each sequence's own `description` and its `00253` body:

| Sequence | Who is reading | Position 2 says | Position 4 (prospect) | Position 6 (client) |
|---|---|---|---|---|
| `quiz_ceiling_breaker` | performing already, stuck | the limiter is rarely work rate — it is one or two qualities that stopped translating | offer to find which, on a call | bring it to the next session; no sales ask |
| `quiz_rebuilder` | hurt, or breaking down repeatedly | the site of pain is usually not the cause; load is going somewhere it should not | offer to talk through what recurs — **never a push at someone hurt** | tell your coach what recurs so the plan accounts for it |
| `quiz_aspiring_pro` | young, building toward something | the base has to be built before the sport demands it; skipping it gets expensive later | offer to say what to prioritise first | keep the base work in even when the sport gets busy |
| `quiz_parent_coach` | a parent or coach, about someone else | written in the third person about the athlete; group programs are not built for one athlete | offer to go through it together | how to support what the athlete is already doing |

**Voice rules that matter most here**, from `00253` which is the live copy:
- Never state a score, tier or archetype name — there is no merge field, and the body must read correctly whether they scored well or badly.
- `quiz_parent_coach` speaks about "the athlete", never "you", for the athlete's own qualities.
- `quiz_rebuilder` must not read as a sales push at someone who is injured.

Worked example — `quiz_ceiling_breaker`, positions 2 through 7 complete. Write
the other three sequences in exactly this shape, changing only the wording per
the table above.

```sql
  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   1, 'wait', 2880, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   2, 'email', NULL,
   $subj$The part most people train around$subj$,
   $body$Hi {{name}}

One thing worth saying after a result like yours.

When an athlete is already working hard and output stops climbing, adding more work usually is not the answer. One or two qualities have stopped feeding into the thing you actually do, and everything built on top of them is limited by that.

It is a specific problem, and it is fixable. It is just not fixed by training harder around it.$body$,
   '{}'::jsonb, NULL, NULL, NULL),


  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   3, 'branch', NULL, NULL, NULL, '{}'::jsonb,
   $cond${"kind": "has_user"}$cond$::jsonb, 6, 4),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   4, 'email', NULL,
   $subj$Which one is holding you back$subj$,
   $body$Hi {{name}}

If you want to know which of those qualities is the one actually costing you output, that is a short conversation rather than a long assessment.

Reply to this email and tell me what you are training for and what has plateaued. I will tell you where I would start.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   5, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   6, 'email', NULL,
   $subj$Worth raising at your next session$subj$,
   $body$Hi {{name}}

You are already training with us, so there is nothing to sign up for here.

Bring what the quiz flagged to your next session and we will look at it directly — it is more useful in front of someone than on a screen.$body$,
   '{}'::jsonb, NULL, NULL, NULL),

  ('00000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
   7, 'stop', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL, NULL)
```

- [ ] **Step 2: Pause the four**

Last statement in the file:

```sql
-- The four quiz sequences are ACTIVE in production and one email long. Adding
-- steps to a live sequence means the next person who takes the quiz receives
-- copy nobody has read -- which defeats the gate 00218, 00229 and 00253 all
-- describe. The owner's decision on 2026-09-08 was to pause them here and
-- re-activate after reading.
--
-- Safe mid-flight: enrollIfTriggered only reads status = 'active', so no NEW
-- run starts, and no run exists to strand (zero quiz runs, ever).
--
-- To switch them back on after reading the copy:
--     UPDATE public.sequences SET status = 'active' WHERE key LIKE 'quiz_%';
UPDATE public.sequences
SET status = 'paused', updated_at = now()
WHERE business_id = '00000000-0000-0000-0000-000000000001'
  AND key LIKE 'quiz_%'
  AND status = 'active';
```

The `AND status = 'active'` clause makes the statement idempotent and keeps it from resurrecting a sequence the owner has since archived.

- [ ] **Step 3: Read all twelve new bodies aloud**

Same check as Task 4 Step 6, plus: does the parent/coach copy ever slip into second person about the athlete's own body? Does the rebuilder copy ever push?

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00255_sequence_content_and_branching.sql
git commit -m "feat(lead-engine): give the four quiz sequences a real arc (gaps #6, #7)

Each goes from one email to eight steps, branching on whether the reader is
already a client -- an existing client must not be asked to book an intro call.

Position 0 is untouched: that is live, reviewed copy from 00253.

The four are paused in the same migration. They are active in production today,
so adding steps without pausing would send unread copy to the next person who
takes the quiz."
```

---

## Task 6: The migration test

**Files:**
- Create: `__tests__/migrations/00255_sequence_content_and_branching.test.ts`

**Interfaces:**
- Consumes: the finished migration file.
- Produces: nothing.

**Why a new file:** `__tests__/lib/lead-engine/seed-sequences.test.ts` reads migration `00218` off disk through a **hardcoded path** and asserts its structure. It will not cover `00255`. Copy the shape of `__tests__/migrations/00254_sequence_tag_stage_steps.test.ts` (80 lines), which reads real SQL off disk rather than a fixture — the point being that a mocked DAL test cannot verify anything about a migration.

- [ ] **Step 1: Write the test**

Parse the SQL text and assert structure. The arm-termination walk is the one that catches the error this design already made once.

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/00255_sequence_content_and_branching.sql"),
  "utf8",
)

describe("00255 seeds sequence content", () => {
  it("seeds all three new sequences as draft", () => {
    for (const key of ["abandoned_checkout", "service_application_received", "camp_clinic_deadline"]) {
      expect(SQL).toContain(`'${key}'`)
    }
    // No new sequence may be seeded active -- 00218's gate.
    expect(SQL).not.toMatch(/'(abandoned_checkout|service_application_received|camp_clinic_deadline)'[\s\S]{0,600}?'active'/)
  })

  it("pauses the four live quiz sequences", () => {
    expect(SQL).toMatch(/UPDATE public\.sequences[\s\S]*?SET status = 'paused'[\s\S]*?key LIKE 'quiz_%'/)
  })

  it("carries no placeholder copy", () => {
    expect(SQL.toLowerCase()).not.toContain("placeholder")
  })

  it("uses no merge field the renderer cannot substitute", () => {
    const fields = new Set(SQL.match(/\{\{[a-z_]+\}\}/g) ?? [])
    // {{sms_consent_url}} makes renderSequenceEmail THROW when no URL is
    // supplied, and nothing supplies one here.
    expect([...fields]).toEqual(["{{name}}"])
  })

  it("gives every tag step a tag in its config", () => {
    // 00254's sequence_steps_tag_needs_config rejects one without it, so a
    // miss fails the migration -- this catches it before that.
    const tagSteps = SQL.match(/'tag',[\s\S]{0,200}?\$cfg\$(.*?)\$cfg\$/g) ?? []
    expect(tagSteps.length).toBeGreaterThan(0)
    for (const step of tagSteps) expect(step).toContain('"tag"')
  })
})
```

- [ ] **Step 2: Add the branch-arm walk**

This is the assertion that matters most. Build a per-sequence map of `position → kind` and of each branch's two targets, then walk each arm forward following `position + 1` and fail if it reaches a position belonging to the sibling arm, or runs past the end without a `stop`.

Write a small parser over the `VALUES` tuples in the file — key on the `key = '<seq>'` sub-select that each tuple carries and the leading `<position>, '<kind>'` pair. Assert for every branch step:

1. both `on_true_position` and `on_false_position` resolve to a real position in the same sequence;
2. walking forward from each target reaches a `stop` **before** reaching the other target;
3. the two arms do not overlap.

- [ ] **Step 3: Run it**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__/migrations/00255_sequence_content_and_branching.test.ts
```

Expected: PASS.

- [ ] **Step 4: Mutate — and this is the important one**

Each mutation edits the migration, runs the test, confirms a FAILURE, then reverts:

1. Change `abandoned_checkout`'s branch `on_false_position` from 6 to 5. Arm-walk must fail (5 is the other arm's stop).
2. Change a branch target to 99. Target-resolution must fail.
3. **Delete position 5 (the texted arm's stop).** The arm now falls through into position 6 and the texted person also gets the email. The walk must fail. *If this mutation survives, the walk is not actually walking.*
4. Change `'paused'` to `'active'` in the UPDATE. The pause test must fail.
5. Remove `"tag"` from the tag step's config. The config test must fail.
6. Add `{{first_name}}` to any body. The merge-field test must fail.

- [ ] **Step 5: Commit**

```bash
git add __tests__/migrations/00255_sequence_content_and_branching.test.ts
git commit -m "test(lead-engine): assert 00255's structure, especially branch arms

seed-sequences.test.ts reads 00218 through a hardcoded path and does not cover
this file. The arm walk is the assertion that matters: a branch target is the
engine's only jump, so an arm that does not terminate falls into the other
arm's steps and the person gets both messages."
```

---

## Task 7: Apply to dev, verify against the real database, screenshot

**Files:** none — this is verification.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Confirm the migration number is still free**

```bash
ls supabase/migrations/ | tail -3
```

`00255` must be the only one. If another branch has taken it, renumber now — it is free before a push and painful after.

- [ ] **Step 2: Apply to DEV only**

Dev is `anjvztjiokcgiyhobknq`. **Production is `epzuvzkokzqtzomeyoha` and must not be touched** — its MCP is read-only by design, which is a backstop, not a licence to aim at it.

- [ ] **Step 3: Verify the rows landed, from the database rather than the file**

```sql
select s.key, s.status, s.trigger_source, s.trigger_filter,
       count(st.id) as steps,
       count(*) filter (where st.kind = 'branch') as branches,
       count(*) filter (where st.config <> '{}'::jsonb) as config_steps
from public.sequences s
left join public.sequence_steps st on st.sequence_id = s.id
group by s.id, s.key, s.status, s.trigger_source, s.trigger_filter
order by s.key;
```

Expected: twelve sequences; the three new ones `draft`; the four quiz ones `paused` with 8 steps each; `abandoned_checkout` with 8 steps, 1 branch, 1 config step.

- [ ] **Step 4: Prove the constraints actually bite**

A constraint that accepts everything is not a constraint. Attempt each of these against dev and confirm each is REJECTED, then confirm a valid row is ACCEPTED:

1. a `tag` step with `config = '{}'` — must violate `sequence_steps_tag_needs_config`;
2. a `branch` step with `branch_condition = NULL` — must violate `sequence_steps_branch_needs_condition`;
3. an `email` step with a null subject — must violate `sequence_steps_email_needs_body`.

Delete anything you insert.

- [ ] **Step 5: Screenshot `/admin/sequences`**

The three new sequences and the four newly-paused ones are visible on the reporting screen built in item #1. Drive the **real** app with Playwright — real route, real session, real data. Not a harness.

**The dev tenant default is not "Primary."** With no `djp_business` cookie, `resolveAdminTenant()` returns a seeded business holding no sequences, and the screen correctly renders "No sequences have been set up" — which reads exactly like a broken tenant predicate. Set the cookie first.

Do not pipe the dev server to `head`; redirect to a log file or it wedges and every route times out after appearing to work.

Annotations burned into the PNG, composed at the capture's exact pixel width, into `screenshots/sequence-content/`. Light mode only — the admin UI is light-only.

- [ ] **Step 6: The full gate**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__/lib/lead-engine/ __tests__/lib/automation/ __tests__/db/pipeline.test.ts __tests__/lib/db/ __tests__/migrations/ __tests__/api/admin/internal/
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run build
```

- tsc must be **238**, and the per-file SET must match `/tmp/claude-501/tsc-baseline-fileset.txt`. Diff the set, not the count.
- `00062.test.ts` (3/6) and `purchase-spine.test.ts` (1/11) are the known red baseline.
- `npm run build` must exit 0.

- [ ] **Step 7: Commit the screenshots**

```bash
git add screenshots/sequence-content/
git commit -m "docs(lead-engine): annotated screenshots of the new sequences on /admin/sequences"
```

---

## After all tasks

1. **Whole-branch review** on the most capable model, given **the spec and the plan**, not just the diff. The unique value of that review is the gaps BETWEEN task briefs — on the last branch it was the only thing that caught a dropped spec requirement after eight clean task reviews. Give it the deferred-minor list and ask it to trace one path end to end.
2. **Update §4 of `docs/full-engine-scope-vs-built.md`** — strike through #5, #6 and #7 the way #4 and #12 are struck, and correct #12's "Ships DORMANT" note, which stops being true the moment `00255` lands.
3. **Update `JOURNAL.md`** with a dated entry: what was built, mistakes made, lessons. Never commit it — it is gitignored.
4. **Write the owner's go-live list into the final report** (spec §11): re-activate the four quiz sequences after reading the copy; activate the three new sequences, which seed as `draft`; and **confirm `checkout.session.expired` is subscribed** on the Stripe webhook endpoint. That last one cannot be checked from here — the subscription list lives in the Stripe dashboard — and if it is not subscribed, `abandoned_checkout` never enrols anybody and nothing anywhere reports an error.
5. **Do not push, merge or deploy.** Report ready.
