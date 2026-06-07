# Unified Program Creator — Pricing & Access

**Status:** Design / brainstormed — pending plan
**Date:** 2026-06-07
**Owner:** solo (commit to `main`)
**Related:** `payment_gate_not_required_bug` (auto-memory), JOURNAL 2026-06-07 diagnosis entry

---

## 1. Problem

Creating and pricing a program is fragmented across three surfaces, and the AI builder — the most-used path — touches none of them:

- **AI Program Builder** ([components/admin/AiProgramChatDialog.tsx](../../../components/admin/AiProgramChatDialog.tsx)) generates a program and silently auto-assigns it with **no** pricing, audience, or week-access. Price defaults to free/ungated.
- **Manual "Add Program"** ([components/admin/ProgramFormDialog.tsx](../../../components/admin/ProgramFormDialog.tsx)) collects pricing in a wizard Step 2 and audience in Step 3 — *before any weeks exist*.
- **Week Access Control** ([components/admin/WeekAccessPanel.tsx](../../../components/admin/WeekAccessPanel.tsx)) sets per-week locks per client, on the program detail page.

This fragmentation is also the **root cause of the live payment-gate bug**: paid programs are assigned with `payment_status = "not_required"` instead of `"pending"`, so the client gate (which only blocks `"pending"`) never fires. Two divergent assignment code paths cause it — one ([functions/src/ai/orchestrator.ts](../../../functions/src/ai/orchestrator.ts) ~L960) omits `payment_status` entirely, falling back to the DB default `'not_required'`.

## 2. Goals

1. **One place** to set everything about money & access for a program — used identically by the AI builder, the manual creator, and the program detail page.
2. **The AI builds, then prices.** After generation, hand off into the same pricing surface instead of shipping ungated.
3. **Make "priced + gated" the default** — impossible to create a paid program that isn't gated.
4. **Support the agreed money model:** entry price (free / one-time / subscription) **+** optional per-week premium add-ons, set once on the program with per-client overrides. Free entry + paid weeks must work (free intro that upsells).
5. **Enforce payment server-side**, not just in the UI — revenue integrity that holds at scale.
6. **Don't disrupt anything live.** Additive migration; no existing client loses access without an explicit decision.

### Non-goals

- Redesigning the exercise/week **builder** itself ([components/admin/ProgramBuilder.tsx](../../../components/admin/ProgramBuilder.tsx)).
- Changing Stripe products/checkout mechanics beyond wiring the new fields. The existing checkout ([app/api/stripe/checkout/route.ts](../../../app/api/stripe/checkout/route.ts)) and webhook ([app/api/stripe/webhook/route.ts](../../../app/api/stripe/webhook/route.ts)) stay.
- Per-week **subscription** pricing. Premium weeks are one-time add-ons only; subscriptions apply to whole-program entry.

## 3. Money model (agreed)

**Entry** unlocks all *included* weeks:
- **Free** → `payment_status = not_required`, included weeks open on assignment.
- **One-time** → `pending` until paid (→ `paid`).
- **Subscription** → `pending` until subscribed (→ `subscription_active`), may expire.

**Premium weeks** are optional one-time add-ons layered on top, independent of entry type (so Free entry + paid weeks is valid). Defined once on the program; each assigned client gets their own access rows seeded from that default, individually overridable.

## 4. Architecture

Five units, each with one job:

### 4.1 `program_week_pricing` table (new) — the program-level template
Holds which weeks are premium and their default price, per program.

```
program_week_pricing
  id            uuid pk
  program_id    uuid fk -> programs(id) on delete cascade
  week_number   int  not null            -- 1-based
  price_cents   int  not null check (price_cents > 0)
  created_at, updated_at
  unique (program_id, week_number)
```

- Presence of a row = that week is premium. Absence = included.
- Chosen over a JSON column on `programs` for scale: indexable/joinable for revenue reporting (consistent with existing `revenue_snapshots` / attribution analytics).
- DAL: `lib/db/program-week-pricing.ts` (service-role, matches existing DAL pattern). Functions: `getPremiumWeeks(programId)`, `setPremiumWeeks(programId, [{week_number, price_cents}])` (replace-all), `deletePremiumWeek(programId, week)`.
- **Entry pricing is unchanged** — stays on `programs` (`payment_type`, `price_cents`, `billing_interval`, `is_public`). The sheet writes these via the existing program PATCH.

### 4.2 `assignProgram()` service (new) — the single assignment path  *(the core fix)*
One function every caller must use to assign a program to a client. Lives in `lib/db/assignments.ts` (or `lib/services/assign-program.ts`).

**Signature:** `assignProgram({ programId, userId, startDate, notes?, complimentary? }) -> ProgramAssignment`

**Logic:**
1. Load program (`payment_type`, `price_cents`, `duration_weeks`) + premium weeks via `getPremiumWeeks`.
2. Skip if an `active` assignment already exists (current dedupe behavior).
3. Compute `payment_status`:
   - `free` **or** `complimentary` → `not_required`
   - `one_time` → `pending`
   - `subscription` → `pending`
4. Insert the assignment with `payment_status` set **explicitly** (never rely on the column default).
5. Seed `program_week_access` for weeks `1..duration_weeks`:
   - premium week → `access_type='paid'`, `payment_status='pending'`, `price_cents` from template
   - otherwise → `access_type='included'`, `payment_status='not_required'`
6. Fire `sendProgramReadyEmail` (non-blocking).

**Replaces:**
- The inline logic in [app/api/admin/programs/[id]/assign/route.ts](../../../app/api/admin/programs/[id]/assign/route.ts) (currently hardcodes week_access to `included`/`not_required`).
- The auto-assign block in [functions/src/ai/orchestrator.ts](../../../functions/src/ai/orchestrator.ts) (removed — see 4.4).

> **Why this is the scalability lever:** every future entry point (bulk assign, promo, referral) calls one function, so the divergent-path bug class cannot recur.

### 4.3 `PricingAccessSheet` component (new) — the one surface
`components/admin/PricingAccessSheet.tsx`, used in three places. Sections, top to bottom:
- **Coach instructions** — a "How this works" 3-step guide (💡 box).
- **How clients get in** — Free / One-time / Subscription segmented control + price + billing interval (when subscription). Hidden price for Free.
- **Weeks** — a strip of all weeks; tap to toggle premium + set price. Pre-filled with AI/heuristic suggestions (see 4.4).
- **Visibility** — Private / Public store.
- **Client-sees preview** — live plain-English summary of what the client pays and unlocks.
- **Publish** — saves program pricing (PATCH program) + premium weeks (`setPremiumWeeks`); when invoked with a target client, calls `assignProgram()`.

**Props:** `{ program, mode: "create" | "edit", assignToClientId?: string, onPublished }`.
No "Skip" escape hatch — publishing is always a deliberate choice (even if that choice is Free). Re-openable anytime from the program page to edit.

### 4.4 AI builder handoff
- **Orchestrator** ([functions/src/ai/orchestrator.ts](../../../functions/src/ai/orchestrator.ts)): remove the auto-assign + `createWeekAccessRecords` block. Generation creates the **program only**; assignment now happens at sheet publish. Applies to both the chat path (`generate-chat`) and direct generate.
- **Premium-week suggestion (optional, simple v1):** derive from periodization — e.g. flag the peak/overload block — or leave empty. Surface as a suggestion the coach accepts/edits; never auto-charged. Can be upgraded to an AI-emitted field in `ai_generation_params` later.
- **Dialog** ([components/admin/AiProgramChatDialog.tsx](../../../components/admin/AiProgramChatDialog.tsx)): the `program_created` result card's primary CTA becomes **"Set pricing & access"**, which swaps the dialog to `PricingAccessSheet` (same swap pattern already used for `AssignProgramDialog`), pre-filled, then **Publish & assign** to the chat's client.

### 4.5 Manual creator
[components/admin/ProgramFormDialog.tsx](../../../components/admin/ProgramFormDialog.tsx): drop the pricing fields from Step 2 and the whole Step 3 (Audience). Wizard becomes **Info → Schedule**. On create, the program is saved **private/unlisted** (`is_public=false`), then `PricingAccessSheet` opens (mode `create`); visibility is set when the coach publishes. Pricing + visibility + premium weeks now live in the sheet, identical to the AI path. (AI-generated programs are already created private, so both paths match.)

## 5. Client-side gate (full scope)

### 5.1 Visible pay prompt (new)
Today a `pending` assignment is silently filtered out ("No active programs"). Add a **`PendingPaymentCard`** surfaced on:
- [app/(client)/client/dashboard/page.tsx](../../../app/(client)/client/dashboard/page.tsx)
- [app/(client)/client/workouts/page.tsx](../../../app/(client)/client/workouts/page.tsx)

For each `active` assignment with `payment_status === "pending"`, render a "Payment required — complete to unlock" card linking into the existing checkout ([ClientBuyButton](<../../../app/(client)/client/programs/[id]/ClientBuyButton.tsx>)). Per-week locked weeks already have lock UI in [components/client/WorkoutTabs.tsx](../../../components/client/WorkoutTabs.tsx); it now actually triggers because `assignProgram` seeds premium weeks as `pending`/`paid`.

### 5.2 Server-side enforcement (new)
Add a shared guard `assertAssignmentPayable(userId, assignmentId, weekNumber?)` and call it in:
- [app/api/client/workouts/log/route.ts](../../../app/api/client/workouts/log/route.ts) — reject logging against a `pending` assignment / locked week.
- [app/api/client/workouts/complete-week/route.ts](../../../app/api/client/workouts/complete-week/route.ts) — reject advancing past a locked week.

This closes the UI-only gap: access is enforced at the source of truth regardless of client.

## 6. Data flow (happy path, AI + one-time + premium W5–6)

1. Coach chats → AI generates program (no assignment).
2. Coach clicks **Set pricing & access** → sheet pre-filled (One-time suggested, W5–6 premium).
3. Coach sets entry $285, confirms W5–6 @ $40 → **Publish & assign to Sara**.
4. Sheet: PATCH program pricing + `setPremiumWeeks` → then `assignProgram` → assignment `payment_status='pending'`; week_access W1–4 included/not_required, W5–6 paid/pending.
5. Sara's dashboard shows **PendingPaymentCard** ($285) → checkout → webhook flips assignment → `paid`; W1–4 unlock.
6. Sara later buys W5 → per-week checkout → that week_access → `paid`.
7. Workout APIs allow logging only for unlocked weeks.

## 7. Impact on existing data (safety)

- **Programs:** none — new table empty for all, so no premium weeks; pricing untouched.
- **Existing assignments:** none — new logic runs only on *new* assignments; existing `program_week_access` rows untouched.
- **The 3 paid-but-ungated assignments** (Sid's $285, Luca $280, "Aean Gabrielle" $1000 = test acct): **grandfather** — they are already `not_required` (free access), so the safe decision is to **leave them as-is** (optionally annotate `notes`). No client loses access. They remain legacy exceptions; all *future* paid assignments gate correctly.

> Net: the only behavior changes apply to programs/assignments created after ship. Nothing live flips automatically.

## 8. Phasing (solo-friendly, same spec)

1. **Phase 1 — Creator + correct assignment:** `program_week_pricing` + `assignProgram()` + `PricingAccessSheet` + AI/manual wiring + orchestrator stops auto-assigning. *Ships the fix: new paid programs are gated.*
2. **Phase 2 — Visible pay prompt:** `PendingPaymentCard` on dashboard/workouts so gated clients can pay where they look.
3. **Phase 3 — Server-side enforcement:** payment guard on workout APIs.

Phases 1→3 are sequential; after Phase 1, paid programs are `pending` and only payable via program-detail Buy Now until Phase 2 — keep the gap short.

## 9. Error handling

- `assignProgram` is transactional in spirit: if week_access seeding fails after the assignment insert, surface the error and leave the assignment for retry (or wrap in a single RPC if practical). Never leave an assignment with no week_access.
- Sheet publish is idempotent: re-publishing edits pricing/weeks; re-assigning an already-active client is skipped.
- Validation: premium week numbers must be within `1..duration_weeks`; price > 0; subscription requires billing interval (reuse [lib/validators/program.ts](../../../lib/validators/program.ts)).

## 10. Testing

- **Unit (`assignProgram`):** payment_status matrix (free/one_time/subscription × complimentary); week_access seeding from premium template (incl. free-entry-plus-premium); dedupe of active assignments.
- **Unit (DAL):** `program_week_pricing` set/replace/get; cascade on program delete.
- **Component:** `PricingAccessSheet` preview text per entry type; premium toggle; Free hides price but keeps weeks.
- **API:** `assertAssignmentPayable` blocks log/complete-week for pending/locked; allows for not_required/paid.
- **Integration:** AI generate → publish → assignment is `pending` and hidden→prompted; checkout webhook → unlocked.

## 11. Open questions

1. **Client-facing note** — coach instructions are in-sheet (done). Do we also want a per-program client-facing note ("weeks 5–6 unlock the peak phase")? *Leaning: defer.*
2. **AI premium-week suggestion** — heuristic (periodization-based) for v1, or wait for an AI-emitted field? *Leaning: heuristic v1.*
3. **`assignProgram` location** — extend `lib/db/assignments.ts` vs new `lib/services/assign-program.ts`. *Leaning: new service file for clarity; it orchestrates two tables + email.*
