# Funnel Create Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help the owner fill the New funnel dialog — an AI interview that produces a plan, worked examples plus their own funnels, and a build overlay that fills the preview pane.

**Architecture:** Two stateless AI calls (`callAgent`) behind two admin routes; a pure sanitiser that filters the model's plan through the SAME `FUNNEL_TEMPLATES.asks` array the dialog and validator read, so the AI meets exactly the constraints a human does. Examples are a code registry beside the template registry. The overlay change is layout-only in two files.

**Tech Stack:** Next.js 16 App Router, Zod, `lib/ai/anthropic.ts` (`callAgent`), Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-16-funnel-create-assist-design.md`

## Global Constraints

- **Never restate a rule.** Import `FUNNEL_TEMPLATES`, `getTemplate`, `MAX_FUNNEL_STEPS`, `ENTRY_STEP_SLUG` from `lib/funnels/templates.ts`; `FUNNEL_GOALS`, `FUNNEL_SLUG_PATTERN` from `lib/validators/funnel.ts`; `slugify` from `lib/funnels/slug.ts`.
- **`lib/funnels/ai-plan.ts` must stay pure** — no I/O, no catalogue read, no SDK. The catalogue match happens in the route and is passed in as a list of allowed names.
- **`lib/ai/models.ts` may not grow imports** (a test walks the real import graph). Import model ids from there, the provider from `lib/ai/anthropic.ts`.
- `@testing-library/user-event` is not a dependency — use `fireEvent`.
- `git add -A` is unsafe here (bank CSV in tree). Stage explicit paths.
- **After deleting any app route, `rm -rf .next` before trusting a build** — stale per-route type validators survive the file, and "Compiled successfully" is an earlier stage, not the verdict. Check the exit code.
- Targeted test runs only: `npx vitest run <path>`. Build is a separate gate.
- **Any test that passes on its first run gets its implementation mutated to prove it can fail.**

---

### Task 1: The plan sanitiser (pure)

**Files:** Create `lib/funnels/ai-plan.ts`; Test `__tests__/lib/funnels/ai-plan.test.ts`

**Interfaces:**
- Produces `sanitiseFunnelPlan(raw: RawFunnelPlan, opts: { allowedOfferNames: string[] }): FunnelPlan | null`
- `FunnelPlan = { template, name, steps: {name,slug,goal}[], audience: string|null, offer: {kind,ref}|null, description: string|null }`

- [ ] **Step 1: Write the failing tests** — unknown template → null; dates on a `leads` plan dropped; duplicate/blank step slugs repaired; first step forced to `index`; >MAX_FUNNEL_STEPS truncated; unknown step goal → null but plan survives; offer not in `allowedOfferNames` → dropped; offer matched case-insensitively on trimmed name.
- [ ] **Step 2: Run** `npx vitest run __tests__/lib/funnels/ai-plan.test.ts` — expect FAIL, module not found.
- [ ] **Step 3: Implement.** Filter every intake field through `getTemplate(raw.template)?.asks`; return null only when the template is unknown (everything else repairs).
- [ ] **Step 4: Run** — expect PASS. Then mutate the `asks` filter and confirm the dates test fails.
- [ ] **Step 5: Commit.**

---

### Task 2: The two AI calls

**Files:** Create `lib/ai/funnel-interview.ts`; Test `__tests__/lib/ai/funnel-interview.test.ts`

**Interfaces:**
- `interviewQuestions(brief: string): Promise<InterviewQuestion[]>` — `{ id, question, hint, placeholder }`, 3-5 of them, Haiku.
- `draftFunnelPlan(brief: string, answers: {question,answer}[]): Promise<RawFunnelPlan>` — Sonnet.

- [ ] **Step 1: Write the failing tests** — mock `callAgent`; assert Haiku for questions and Sonnet for the plan (a swapped model is a silent cost/quality regression); assert the brief and every answer reach the user message; assert the plan schema's template enum is derived from `FUNNEL_TEMPLATES` (add a template, the enum grows).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Prompts state the six templates and their step plans so the model chooses rather than invents.
- [ ] **Step 4: Run** — expect PASS, mutate the model constants to confirm.
- [ ] **Step 5: Commit.**

---

### Task 3: The two routes

**Files:** Create `app/api/admin/funnels/ai/interview/route.ts`, `app/api/admin/funnels/ai/plan/route.ts`; Test `__tests__/api/funnels/ai-plan-route.test.ts`

- [ ] **Step 1: Write the failing tests** — 403 for non-admin on both; 400 on an empty brief; offer ref absent from the catalogue is dropped from the response; `loadCatalogues` throwing still returns a plan (with no offer) rather than 500.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `auth()` + `canAccessAdminPath`, then call Task 2, then `sanitiseFunnelPlan` with `allowedOfferNames` from `loadCatalogues().offer[template.offerKind]`, wrapped so a throw degrades to `[]`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 4: Examples registry

**Files:** Create `lib/funnels/examples.ts`; Test `__tests__/lib/funnels/examples.test.ts`

**Interfaces:** `FUNNEL_EXAMPLES: readonly FunnelExample[]` — `{ template, name, slug, steps, audience, description, whyItWorks }`

- [ ] **Step 1: Write the failing tests** — every example's `template` resolves via `getTemplate`; its step slugs match that template's step slugs (an example cannot demonstrate a plan the template does not produce); every template has at least one example; slugs pass `FUNNEL_SLUG_PATTERN`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** one worked example per template, `as const satisfies`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 5: The two dialogs

**Files:** Create `components/admin/funnels/AskAiDialog.tsx`, `components/admin/funnels/ExamplesDialog.tsx`; Modify `CreateFunnelDialog.tsx`, `FunnelBoard.tsx`; Test `__tests__/components/admin/funnel-create-assist.test.tsx`

**Interfaces:**
- Both dialogs take `onApply(plan: FunnelPlan) => void` — **one apply path**, so there is a single way anything writes to the dialog's fields.
- `CreateFunnelDialog` gains `ownExamples?: OwnExample[]` (`{ id, name, template, stepNames, live }`), derived in `FunnelBoard` from the `pages`/`funnels` it already has. No new query.

- [ ] **Step 1: Write the failing tests** — Ask AI: brief → questions → plan → **Use this** fills name/template/steps/audience/description; **Discard** leaves every field untouched; an API failure shows the message and leaves the dialog usable. Examples: **Start from this** fills the fields; **Copy this structure** takes the plan but NOT the name or slug (they must stay unique); the own-funnels section is absent when there are none.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Trigger row under the dialog header: "Not sure where to start? [See examples] [Ask AI]".
- [ ] **Step 4: Run** — expect PASS; mutate the Discard path to confirm it can fail.
- [ ] **Step 5: Commit.**

---

### Task 6: The overlay fills the pane

**Files:** Modify `components/admin/funnels/FunnelBuilder.tsx:1391` area, `components/admin/funnels/builder/GenerationStage.tsx`; Test `__tests__/components/admin/funnel-build-overlay.test.tsx`

- [ ] **Step 1: Write the failing tests** — the stage wrapper is not capped at `max-w-md`; the scrim is retained; `motion-reduce` survives on the spinner; a `hero` section still renders its own shape and not the default block.
- [ ] **Step 2: Run** — expect FAIL on the width assertion.
- [ ] **Step 3: Implement.** Wrapper → full width with `max-w-5xl` and stretched height; scale `Bar`/`Cell`/`Pill` and card padding up for the larger canvas; hero gets a taller block.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 7: Verification

- [ ] `npx vitest run __tests__/lib/funnels/ __tests__/lib/ai/ __tests__/api/funnels/ __tests__/components/admin/`
- [ ] `rm -rf .next && npm run build`; confirm **exit code 0**, not just "Compiled successfully".
- [ ] Journal + memory; leave the branch committed and unpushed.

## Self-Review

**Spec coverage:** §1 Ask AI → Tasks 1, 2, 3, 5. §2 Examples → Tasks 4, 5. §3 overlay → Task 6. Testing table → distributed. No gaps.

**Placeholders:** Task step 3s describe implementations in prose rather than full code. Accepted: each is a mechanical application of a pattern already in the repo (`hook-suggestion.ts` for the AI helper, `offers/route.ts` for the guarded route, `templates.ts` for the registry, `CreateFunnelDialog` for the dialog), and the tests above each pin the behaviour. The one genuinely novel decision — the `asks` filter as the AI's constraint — is written out in the spec.

**Type consistency:** `FunnelPlan` is produced by Task 1 and consumed by Tasks 3 and 5. `RawFunnelPlan` is produced by Task 2 and consumed by Tasks 1 and 3. `onApply(plan: FunnelPlan)` is the same signature in both dialogs.
