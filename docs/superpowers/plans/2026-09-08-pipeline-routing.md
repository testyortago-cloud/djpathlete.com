# Pipeline Routing Implementation Plan (gap #8, phase 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every booking, payment and quiz result landing on the Coaching board. Seed two more boards and route events to the right one.

**Scope note — this is PHASE 1 of gap #8, deliberately.** The brief calls routing "the hard half" and the board editor "the easy half", and that is correct. This plan does routing and seeding only. **The board editor gets its own plan** once routing is real, because an editor for boards nothing routes to is a screen with no consequence. Do not build it here.

**Architecture:** One pure `routeToPipeline(subject)` in `lib/lead-engine/pipeline-route.ts` — pure so the whole routing table is a unit test with no mocks. Its input is assembled at each call site, because `PipelineEvent` does not carry the discriminating fact (spec §3.0). Migration `00257` seeds two boards. Refunds are deliberately NOT routed by subject (spec §3.1).

**Tech Stack:** TypeScript, Supabase/Postgres, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-pipeline-boards-and-routing-design.md` — **read §3.0 and §3.1 before writing any code.** They correct two things the earlier 2026-09-01 design got wrong, and one of them (a pure `routeToPipeline(event)`) would compile, pass its tests, and silently route everything to the default.

**Branch base:** cut from `feat/contact-sources`, NOT `main`. Both branches modify `app/api/stripe/webhook/route.ts`; cutting from main guarantees a conflict there.

## Global Constraints

- **Node 24.** `source ~/.nvm/nvm.sh && nvm use` before any vitest or tsc. **Route suites need `--environment node`** or they report "no tests" — a known trap here, not a missing file.
- **`tsc --noEmit` baseline is exactly 238 errors / 54 files.** Per-file baseline at the ABSOLUTE path `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/baselines/tsc-ce6f2aba-perfile.txt`. Diff the per-file SET, never the count.
- **Pre-existing RED, not yours:** `__tests__/migrations/00062.test.ts` 3/6 and `__tests__/api/spine/purchase-spine.test.ts` 1/11 on a clean checkout.
- **Do NOT `prettier --write` a file you did not create.** A deletion in a pre-existing file is the tell.
- **Never add a `SINGLETON_BUSINESS_ID` reference.** Every new read and write carries a tenant predicate.
- **No brand names under `lib/lead-engine/`.**
- **Copy is for a non-programmer.** The Pipeline page says "pipeline", "card", "stages" — it does NOT say "board". Match the screen that exists. No "opportunity".
- **`00256` is claimed by gap #11. This plan uses `00257`.** Re-check `ls supabase/migrations/ | tail` at branch time — numbers collide silently and git merges the collision clean.
- **Code must tolerate the old schema for one deploy.**
- **No AI attribution.** Check after EVERY commit with the STRICT pattern: `git log <base>..HEAD --format=%B | grep -ciE "^Co-Authored-By:|Generated with \[Claude|🤖"` must print 0. A plain `-i claude` matches the words "CLAUDE.md" and false-positives.
- **Plan-authored code is a sketch.** Where it disagrees with the real types, the real types win — say so rather than casting the error away.

---

### Task 1: `routeToPipeline`, and the refund decision

**Files:**
- Create: `lib/lead-engine/pipeline-route.ts`
- Test: `__tests__/lib/lead-engine/pipeline-route.test.ts`

**Interfaces produced:**
- `type RoutingSubject = { event: PipelineEvent["kind"]; checkoutType?: string | null; serviceType?: string | null }`
- `routeToPipeline(subject: RoutingSubject): string`
- `const CAMPS_CLINICS_KEY = "camps_clinics"`, `const ASSESSMENT_KEY = "assessment"` (re-export `DEFAULT_PIPELINE_KEY` rather than redefining "coaching").

**READ THE SPEC'S §3.0 FIRST.** A pure `routeToPipeline(event: PipelineEvent)` cannot work: a `payment` event carries only `amountCents`, `currency`, `occurredAt`, and `event_signup` / `inquiry` are not `PipelineEvent` kinds at all. Such a function would compile, pass a green suite, and silently return the default for everything — today's behaviour wearing a new function's clothes. The discriminating fact lives at the call site: `session.metadata?.type` for a checkout, `inquiries.service_type` for an inquiry.

**The routing table:**

| Subject | Board |
|---|---|
| `event: "booking"` | `coaching` |
| `event: "payment"`, `checkoutType: "event_signup"` | `camps_clinics` |
| `event: "payment"`, any other or absent `checkoutType` | `coaching` |
| `event: "quiz_result"` | `coaching` |
| `serviceType: "assessment"` (however it arrives) | `assessment` |
| anything unmatched | `coaching` |

**Keep the fallback.** An unroutable event lands on Coaching — it must not throw and must not vanish. `PipelineNotConfiguredError` already exists for the genuinely-broken case; an unroutable event is a different, softer thing.

**Programme and shop purchases stay on `coaching`, and that is CORRECT, not a gap** — 17 of the 23 priced programmes are private subscriptions named after individual athletes, i.e. coaching sales (spec §2).

- [ ] **Step 1: Write the failing tests.** One test per row of the table above, asserting WHICH key comes back — not merely that a string came back. Plus: an unknown `checkoutType` falls back to `coaching`; an unknown `event` kind falls back to `coaching`; `checkoutType: null` and `checkoutType: undefined` behave identically (absent and empty are the same answer here, unlike `parseStageConfig`'s `pipeline` field — say so in a comment so the asymmetry is deliberate rather than accidental).
- [ ] **Step 2: Run, watch fail.** `npx vitest run __tests__/lib/lead-engine/pipeline-route.test.ts`
- [ ] **Step 3: Implement.** Pure. No IO, no DAL import. Type-only import from `pipeline-move.ts`.
- [ ] **Step 4: Run, watch pass.**
- [ ] **Step 5: DECIDE AND DOCUMENT THE REFUND CASE — this is the task's real content.**

Spec §3.1: `applyPipelineEvent` resolves the existing card with `readMostRecentOpportunity(contactId, pipelineId, …)`, scoped to ONE pipeline, and a refund event carries nothing saying which board the original payment landed on. So a camp payment on `camps_clinics` whose refund routes to `coaching` **finds no won card and silently does nothing.** Unreachable today because everything is on Coaching; a second board is exactly what makes it reachable.

Read `applyPipelineEvent`'s refund branch and `readMostRecentWonOpportunity` in `lib/db/pipeline.ts`, then choose ONE and write the reasoning into the module header:
  (a) `routeToPipeline` refuses to answer for `event: "refund"` (return type widens, callers must resolve the board from the existing card); or
  (b) the refund path searches every active pipeline for the contact's most recent won card.
**Whichever you choose, write a test that refunds a payment which landed on a NON-DEFAULT board and asserts the refund reaches it.** A test only covering a Coaching refund proves nothing about the hazard.

- [ ] **Step 6: Mutate.** Commit first. For each: apply, run, record the ACTUAL per-test vitest output, revert. Strip ANSI with `sed 's/\x1b\[[0-9;]*m//g'`. Do NOT chain an assertion and a test run with `&&`.

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | `"event_signup"` case returns `coaching` | the camps row |
| M2 | the default arm returns `camps_clinics` | every fallback test |
| M3 | drop the `serviceType` branch | the assessment row |
| M4 | make `quiz_result` return `assessment` | the quiz row |
| M5 | the refund behaviour you chose, inverted | the non-default-board refund test |

- [ ] **Step 7: Commit** as `feat(pipeline): a pure routing function, and a decided refund path`.

---

### Task 2: Migration `00257` — seed two boards

**Files:**
- Create: `supabase/migrations/00257_pipeline_boards.sql`
- Test: `__tests__/migrations/00257_pipeline_boards.test.ts`

**Seed exactly two boards: Camps & Clinics and Assessment. Do NOT seed Programs & Products** — spec §2.2 argues it at length and it is a controller ruling the owner may reverse; do not quietly reinstate it.

**Each board needs at least one `open`, at least one `won` and at least one `lost` stage** or `decideMove` throws at RUNTIME (`pipeline-move.ts:112-113` and `:118-119` — spec §4.1). Give each board exactly one `won` and exactly one `lost`: the lookup is `.find()`, so a second `won` does not throw, it silently picks whichever comes first — an order-dependent choice of where a paid card lands.

Respect `pipeline_stages_key_per_pipeline UNIQUE (pipeline_id, key)`, `pipeline_stages_position_per_pipeline UNIQUE (pipeline_id, position)` and `pipeline_stages_thresholds_ordered` (amber ≤ red). Every row carries `business_id`. Seed idempotently (`ON CONFLICT DO NOTHING`) and prove it by running twice.

Stage names are for a coach, not a developer.

- [ ] **Step 1:** Write the migration.
- [ ] **Step 2:** Write the test, reading the file off disk. `__tests__/lib/lead-engine/seed-sequences.test.ts` reads `00218` via a HARDCODED path and will NOT cover this. Model it on `__tests__/migrations/00256_sequence_management.test.ts`. Assert each board has exactly one `won` and one `lost` and at least one `open`; scope every text assertion to the SQL, never the header prose.
- [ ] **Step 3:** Apply to **DEV ONLY** through the `mcp__supabase__*` tools (load via ToolSearch). **NEVER call `mcp__supabase-prod__*`.** Then read it back from the database: both boards present, stage kinds correct, `business_id` set. Run twice to prove idempotence. Delete any probe rows and **COUNT** to confirm — an empty MCP response is not proof of a delete.
- [ ] **Step 4:** **Re-check the deployed function, not the migration ledger.** Supabase keys a migration on its version NUMBER, not content, so if you edit this file after applying it the database keeps the old version silently. Verify with a direct read.
- [ ] **Step 5: Commit** as `feat(pipeline): 00257 seeds the camps and assessment boards`.

---

### Task 3: Pass the board at every call site

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`, `lib/bookings/ingest.ts`, `app/api/quiz/submit/route.ts`, `lib/automation/pipeline-reconcile.ts`
- Test: the existing suites for each, plus new routing assertions

Today: `lib/bookings/ingest.ts:311`, `app/api/quiz/submit/route.ts:280`, `app/api/stripe/webhook/route.ts:237` and `:496` pass **no** `pipelineKey`; `pipeline-reconcile.ts` hardcodes `DEFAULT_PIPELINE_KEY`.

For each, assemble a `RoutingSubject` from what that call site already has — the webhook has `session.metadata?.type` in scope (gap #14's `checkoutContactSource` uses the same discriminator) — and pass `pipelineKey: routeToPipeline(subject)`.

**`pipeline-reconcile.ts` is the subtle one.** It replays bookings and payments and currently reconciles against ONE pipeline. If events now land on three boards, a reconciler that only looks at Coaching will "repair" nothing for the other two — or worse, create a duplicate card on Coaching for something already on Camps. **Read it before changing it and state in your report what it does after this change.** The cron is off in production (`cron_pipeline_reconcile_enabled` has no row), so this is not live — say so rather than treating it as urgent.

- [ ] **Step 1:** Failing tests per call site asserting WHICH key is passed.
- [ ] **Step 2–4:** fail → implement → pass. Run the CONSUMERS' suites, not just your own.
- [ ] **Step 5:** Mutate each call site's subject assembly separately.
- [ ] **Step 6: Commit** as `feat(pipeline): route each event to its own board`.

---

## Verification before this phase is called done

1. Targeted suites only: `__tests__/lib/lead-engine/`, `__tests__/db/pipeline.test.ts`, `__tests__/api/`, `__tests__/migrations/00257_pipeline_boards.test.ts`.
2. `npx tsc --noEmit` — diff the per-file error SET against the baseline.
3. `npm run build` — exit 0.
4. Strict attribution grep prints 0.
5. `git diff --stat` shows no deletions in files you did not create.
