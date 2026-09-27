# Lead engine — the owner's answers of 2026-09-27 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the chat lead follow-up, the 14/7/3/1 camp countdown, an email-permission tick on the funnel, quiz and application forms, the coach's own booking link in the application auto-reply, and four small admin fixes.

**Architecture:** Sequence content changes ship as one idempotent, shape-guarded migration (`00281`) that also re-issues the starter-set seed function so new businesses get the same shelf. The email tick mirrors the existing SMS tick on each form, end to end (island → route → `recordConsent`). The auto-reply reads the existing per-business Calendly resolver.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (plpgsql migrations), Vitest, React Testing Library, Zod.

**Spec:** `docs/superpowers/specs/2026-09-27-lead-engine-owner-answers-design.md` — read it first; every piece of copy is quoted there verbatim and must be used verbatim.

## Global Constraints

- Work only in `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/lead-engine-owner-answers` (branch `worktree-lead-engine-owner-answers`). Never `cd` out of it.
- Node 24: prefix commands with `PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"`.
- Tests are TARGETED BY FILE: `npx vitest run <file> <file>`. Never the full suite, never a whole directory.
- Type check: `npx tsc --noEmit -p tsconfig.json`, then compare per-file against the baseline `/private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/333b122a-6f11-4161-8ca5-32209873554a/scratchpad/tsc-baseline-perfile.txt` (238 errors / 54 files). No new file may appear, no count may grow.
- NEVER use `git stash` in any form. To prove a test RED, write the test first and run it before the implementation exists.
- Commit messages carry NO `Co-Authored-By`, no "Generated with", no AI attribution of any kind.
- Never read or write production (`epzuvzkokzqtzomeyoha`). The dev clone is `anjvztjiokcgiyhobknq`.
- Copy is quoted in the spec. Use it character for character. Texts: plain ASCII, no `{{name}}`, no "Reply STOP" (00272's rules).
- Every insert into a tenanted table names `business_id` explicitly (the column defaults to the platform).
- No new `SINGLETON_BUSINESS_ID` reference.
- A consent-row failure must never fail a submission; the lead is already saved.

## Review Focus

1. **A run mid-way through the camp sequence when 00281 applies** — a run whose next step is the "Last one" email must not get it twice, and one whose next step is the 3-day email must get the NEW 3-day email. (Task 1 tests both.)
2. **A business whose camp or chat copy does not match the known shape** (edited in the editor) — the migration skips it with a NOTICE and never aborts for everyone else. (Task 1.)
3. **A chat lead already inside another sequence** — must get the chat follow-up (so the coach is told), superseding the older run. (Task 1.)
4. **A funnel form with no email field, or a blank business display name** — no email tick is shown and no consent row is filed; the submission still succeeds. (Task 2.)
5. **The Calendly read throws while an applicant waits** — the auto-reply still sends, with no button and the reply-to sentence. (Task 3.)

---

### Task 1: Migration 00281 — chat lead follow-up, camp 14/7/3/1, and `ai_chat` supersedes

**Files:**
- Create: `supabase/migrations/00281_chat_follow_up_and_camp_countdown.sql`
- Create: `__tests__/migrations/00281_chat_follow_up_and_camp_countdown.test.ts`
- Modify: `lib/lead-engine/enroll.ts` (`IS_SUPERSEDING_SOURCE.ai_chat` → `true`, with a comment)
- Modify: `__tests__/lib/lead-engine/enroll.test.ts` (pin it)
- Modify (retarget, never delete): any migration test whose LIVE half reads the dev clone's `camp_clinic_deadline` shape or the starter set's sequence count — at least check `__tests__/migrations/00279_business_starter_set.test.ts`, `00269_camp_deadline_counts_down.test.ts`, `00272_sequence_text_steps.test.ts`, `00255_sequence_content_and_branching.test.ts`, `00270_camp_deadline_description.test.ts`, `__tests__/lib/lead-engine/sequence-sms-copy.test.ts`, `__tests__/lib/lead-engine/seed-sequences.test.ts`.

**Interfaces:**
- Produces: sequence key `chat_lead_follow_up` (trigger `ai_chat`, draft) on every business; `camp_clinic_deadline` ends `wait{days_before_anchor:3}` · email "Three days to go" · `wait{days_before_anchor:1}` · email "Last one about this" · stop.

- [ ] **Step 1: Read before writing.** Read the spec §1–§2; `supabase/migrations/00279_business_starter_set.sql` in full (its header's FUTURE COPY MIGRATIONS paragraph is an instruction to you); `00271_service_application_alert.sql` and `00272_sequence_text_steps.sql` (position park, shape guards, in-flight run moves, NOTICE-and-skip, scoped verification); `00268` (anchored waits carry no minutes); `lib/lead-engine/enroll.ts` lines 60–200 (G14 superseding + the cooldown forgiveness narrowing).

- [ ] **Step 2: Write the failing static test** `__tests__/migrations/00281_chat_follow_up_and_camp_countdown.test.ts`, in the style of `00279_business_starter_set.test.ts` (read the file, extract the JSON literals). Assert at least:
  - the file re-issues `seed_business_starter_set` WHOLE (`create or replace function public.seed_business_starter_set`) and it contains every key 00279's version contains plus `chat_lead_follow_up` (derive 00279's key list by parsing `00279_business_starter_set.sql`, do not hard-code eleven);
  - the chat sequence JSON: `trigger_source` `ai_chat`, cooldown 30, steps in order `alert, email, wait(2880), email, wait(1440), sms, stop`, with the spec's subjects/bodies exactly;
  - the text body is ASCII, has no `{{`, no "STOP", and is ONE segment with the opt-out sentence appended — use the same `countSmsSegments` + `SMS_OPT_OUT_SENTENCE` imports `sequence-sms-copy.test.ts` uses;
  - the starter camp JSON's tail is `wait{days_before_anchor:3}, email("Three days to go"), wait{days_before_anchor:1}, email(<the starter's own "Last one about this" subject>), stop`, and the new email body is the spec's exactly;
  - the migration restates the grants 00279 section 5 restates (revoke from anon/authenticated, as 00279 does);
  - there is no `status` literal `'active'` for the new sequence anywhere (it must seed as draft).
  Run it: `npx vitest run __tests__/migrations/00281_chat_follow_up_and_camp_countdown.test.ts` → FAIL (file missing).

- [ ] **Step 3: Generate the migration.** Write a throwaway node script in `tmp/` (never committed) that reads `00279_business_starter_set.sql`, extracts the full `create or replace function public.seed_business_starter_set ... $function$;` block VERBATIM, and emits `00281_...sql` with:
  1. A header: what it does, which businesses it touches (every business's `camp_clinic_deadline` of the recognised shape; every business gets a draft `chat_lead_follow_up`), why the chat follow-up is a draft (00229's rule), why the camp's approved "Last one about this" email stays last (spec §2).
  2. The extracted `seed_business_starter_set` with (a) the camp sequence JSON's tail edited to the new shape (new email uses `{{first_name}}`, as every starter email does), and (b) one new `perform public.seed_starter_sequence(p_business_id, $seq$ {...} $seq$::jsonb);` for `chat_lead_follow_up` appended before the function's final `end;`. JSON: `"key":"chat_lead_follow_up"`, `"name":"Chat Lead Follow-Up"`, the spec's description, `"trigger_source":"ai_chat"`, `"trigger_filter":{}`, `"reenrol_cooldown_days":30`, steps `{"kind":"alert","subject":…,"body":…}`, `{"kind":"email",…}`, `{"kind":"wait","wait_minutes":2880}`, `{"kind":"email",…}`, `{"kind":"wait","wait_minutes":1440}`, `{"kind":"sms","body":…}`, `{"kind":"stop"}`. Check how 00279 encodes an `alert` step and a `sms` step in its own JSON and copy that encoding.
  3. The grants restatement exactly as 00279 section 5 does it for `seed_business_starter_set`.
  4. A `DO $$ … $$` block converting EXISTING `camp_clinic_deadline` sequences, per business:
     - Load its steps ordered by position. Recognise the shape: the last three steps are `wait` with `config->'wait_until'->>'days_before_anchor' = '3'`, then `email`, then `stop` (at max position), and NO step has `days_before_anchor = '1'`. Otherwise `RAISE NOTICE` and skip. (Already converted → skip, so the migration is idempotent.)
     - Let p = the anchor-3 wait's position. Park the email and stop: `UPDATE … SET position = position + 1000 WHERE sequence_id = … AND position IN (p+1, p+2)`; then set them to p+3 and p+4. Insert the new email at p+1 (`business_id` = the sequence's, subject/body from the spec with `{{first_name}}`) and `wait` at p+2 with `wait_minutes = NULL`, `config = '{"wait_until":{"days_before_anchor":1}}'`.
     - Runs: `UPDATE sequence_runs SET current_position = p+4 WHERE sequence_id = … AND current_position = p+2`. Runs at p+1 stay (they now get the new 3-day email).
     - Collect converted ids; at the end, for converted ones only, assert positions are contiguous `0..n-1` and the tail is the new shape, else `RAISE EXCEPTION`.
  5. A backfill: `SELECT public.seed_business_starter_set(id) FROM public.businesses;` — every business gains a draft `chat_lead_follow_up` (existing keys untouched; seed functions skip existing keys).
  Hand-check the generated SQL's diff against 00279's function: the ONLY differences inside the function must be the camp tail and the appended chat block.

- [ ] **Step 4: Run the static test** → PASS. Fix the migration, never the test's expectations of the spec's copy.

- [ ] **Step 5: `ai_chat` supersedes.** In `lib/lead-engine/enroll.ts` set `ai_chat: true` in `IS_SUPERSEDING_SOURCE`, moved into the `true` group with a comment: leaving details in the chat and asking to be contacted is the same kind of act as the application form; with `false`, a chat lead already inside another sequence would be refused the chat follow-up, and its first step is the only thing that tells the coach. Add to `enroll.test.ts`, next to the existing superseding tests: an `ai_chat` event for a contact with an active `newsletter_welcome` run enrols into `chat_lead_follow_up` and exits the older run with `superseded` (write it first, run it RED against `ai_chat: false`, then flip). Re-read the cooldown-forgiveness code (`hasRunFinishedWithin` callers and the "forgiveness is narrowed to triggers that do not themselves supersede" comment) and make sure its tests still describe the truth now that `ai_chat` supersedes; add one case if the narrowing now applies to `ai_chat`.

- [ ] **Step 6: Apply to the dev clone ONLY.** Copy only the new file into a temp dir and dry-run first:
```bash
mkdir -p tmp/mig281 && cp supabase/migrations/00281_chat_follow_up_and_camp_countdown.sql tmp/mig281/
SUPABASE_PROJECT_REF=anjvztjiokcgiyhobknq MIGRATIONS_DIR=tmp/mig281 DRY_RUN=true node --env-file=.env.local scripts/migrations/apply.mjs
SUPABASE_PROJECT_REF=anjvztjiokcgiyhobknq MIGRATIONS_DIR=tmp/mig281 node --env-file=.env.local scripts/migrations/apply.mjs
```
Read back with a service-role select on the dev clone: Primary (`00000000-0000-0000-0000-000000000001`) has `chat_lead_follow_up` with status `draft` and 7 steps; its `camp_clinic_deadline` has 12 steps with the new tail; every other business also has a draft `chat_lead_follow_up`. Then run `npm run test:integration:drift` and `npm run test:integration:selects` (both read-only against the dev clone) and paste their summary lines.

- [ ] **Step 7: Add the live half** to the 00281 test (gated exactly like 00279's: refuse any URL not containing the dev ref): `create_business` a throwaway business (name sorting last, like 00279's), assert it has twelve draft sequences including `chat_lead_follow_up` with 7 steps and a camp sequence of the new shape, delete it in `afterAll`. Also a live run-move check: on a throwaway business, create a `camp_clinic_deadline` in the OLD shape by hand (copy the pre-00281 tail), one run at p+1 and one at p+2, execute the migration's DO block again via the same Management API path (it is idempotent and only converts recognised shapes), and assert the runs landed at p+1 and p+4. If executing the DO block from a test is impractical, extract it into a `plpgsql` function created by the migration (`convert_camp_countdown(p_sequence_id uuid)`) called by the DO block, and call that function from the test via `rpc` — then revoke it from anon/authenticated like every other function here.

- [ ] **Step 8: Retarget stale tests.** Run every test file listed under **Files** above. Any whose live half now sees the new shape or a twelfth sequence: retarget the assertion to what is now true and say why in a comment ("00281 added …"); never delete a test, never loosen one to `toBeGreaterThan`. Run them again → PASS.

- [ ] **Step 9: Mutants.** Make each change, run the 00281 test (and enroll test), confirm RED, restore exactly: (a) chat sequence status `active`; (b) run move p+2→p+4 removed; (c) shape guard removed (a skipped shape gets converted); (d) `ai_chat: false`. Report each.

- [ ] **Step 10: tsc per-file compare, then commit.**
```bash
git add supabase/migrations/00281_chat_follow_up_and_camp_countdown.sql __tests__/migrations/00281_chat_follow_up_and_camp_countdown.test.ts lib/lead-engine/enroll.ts __tests__/lib/lead-engine/enroll.test.ts <retargeted tests>
git commit -m "feat(lead-engine): chat lead follow-up (G18) and camp 14/7/3/1 (G11), migration 00281"
```

---

### Task 2: Email-permission tick on the funnel, quiz and application forms (decision 7)

**Files:**
- Create: `lib/lead-engine/email-consent-wording.ts`
- Create: `__tests__/lib/lead-engine/email-consent-wording.test.ts`
- Modify: `components/funnels/islands/FormIsland.tsx`, `components/funnels/islands/FunnelForm.tsx`, `app/api/funnels/submit/route.ts`
- Modify: `components/funnels/islands/QuizIsland.tsx` (and whatever renders its details gate), `app/api/quiz/submit/route.ts`
- Modify: `components/public/InquiryForm.tsx`, `components/public/InquiryFormClient.tsx`, `app/api/inquiry/route.ts`, and any other form component that posts to `/api/inquiry` and already shows the SMS tick (check `StepUpInquiryForm*`; only if it posts to `/api/inquiry`)
- Test: extend `__tests__/components/funnels/form-island-sms-consent.test.tsx` (or a sibling `form-island-email-consent.test.tsx`), `__tests__/components/public/InquiryFormClient.test.tsx`, `__tests__/components/public/InquiryForm.test.tsx`, the quiz island test that covers its gate, `__tests__/api/quiz-submit.test.ts`, the funnels submit route test that covers SMS consent, the inquiry route test that covers SMS consent (`__tests__/api/spine/inquiry-spine.test.ts` or the file that tests `recordInquirySmsConsent`), `__tests__/lib/lead-engine/no-brand-literals.test.ts` (must still pass).

**Interfaces:**
- Produces:
```ts
// lib/lead-engine/email-consent-wording.ts
export function renderEmailConsentWording(displayName: string): string {
  return `Yes, ${displayName} can email me training tips, news and offers. I can unsubscribe at any time.`
}
export function hasEmailConsentDisplayName(displayName: string | null | undefined): displayName is string {
  return Boolean(displayName?.trim())
}
```
- Wire fields: funnel form FormData field `email_consent` ("on"), JSON `email_consent: boolean` to `/api/funnels/submit`; quiz JSON `emailConsent: boolean`; inquiry JSON `email_consent: boolean` (match each route's existing SMS field naming: `sms_consent` → `email_consent`, `smsConsent` → `emailConsent`). All optional, default `false`.

- [ ] **Step 1:** Read the SMS tick end to end on each surface: `lib/lead-engine/sms-consent-wording.ts` (header!), `FormIsland.tsx` 30–80, `FunnelForm.tsx` 180–210 and 335–356, `recordFunnelSmsConsent` in `app/api/funnels/submit/route.ts` (~380–420), the quiz island's SMS tick and `app/api/quiz/submit/route.ts` ~480–510, `InquiryFormClient.tsx`'s SMS tick and `recordInquirySmsConsent` in `app/api/inquiry/route.ts` ~490–540.
- [ ] **Step 2:** Write `email-consent-wording.test.ts` (exact sentence for "Acme Coaching"; blank/whitespace/null/undefined → false; a name → true) → RED → create the file with the header comment mirroring `sms-consent-wording.ts`'s (why a parameter, why the blank gate, the two call sites that must agree) → GREEN.
- [ ] **Step 3 (funnel):** Tests first: FormIsland/FunnelForm renders an UNTICKED `email_consent` checkbox labelled with the rendered sentence under every `type="email"` field, reusing `.djp-field[data-djp-field-type="checkbox"]`; no tick when the display name is blank; no tick on a form without an email field. Submit route: `email_consent: true` + a valid email files `recordConsent({ channel: "email", granted: true, source: <the route's existing SMS consent source>, wordingShown: renderEmailConsentWording(settings.display_name), ip, userAgent })`; `false` or absent files nothing; blank display name files nothing; a `recordConsent` rejection does not change the response status. RED → implement (a `recordFunnelEmailConsent` beside `recordFunnelSmsConsent`, same fire-and-forget + catch shape) → GREEN. FormIsland fetches business settings only when a `tel` field exists today — widen that condition to `tel` OR `email`.
- [ ] **Step 4 (quiz gate):** same pattern, tests first, in the quiz island and `/api/quiz/submit` (`emailConsent`).
- [ ] **Step 5 (application form):** same pattern, tests first, in `InquiryForm`/`InquiryFormClient` (the tick sits beside the Email field, unticked) and `/api/inquiry` (`email_consent`).
- [ ] **Step 6:** Run every test file named above plus any suite importing a changed module (`grep -rl "<module path>" __tests__`) → PASS. `no-brand-literals.test.ts` → PASS.
- [ ] **Step 7: Mutants:** (a) checkbox `defaultChecked={true}`; (b) route files the row when `email_consent` is false; (c) wording relayed from the client instead of re-rendered; (d) blank-name gate removed. Each RED, restore.
- [ ] **Step 8:** tsc per-file compare; commit `feat(lead-engine): email-permission tick on the funnel, quiz and application forms (decision 7)`.

---

### Task 3: The application auto-reply links the coach's own booking page (G30 carried clause)

**Files:**
- Modify: `lib/email/lead-alerts.ts` (`sendInquiryAutoReply`, delete `PLATFORM_BOOKING_LINK` and its comment block)
- Modify: `__tests__/lib/email/lead-alerts.test.ts`
- Modify: `__tests__/lib/lead-engine/no-brand-literals.test.ts` (remove the allowlist entry for `PLATFORM_BOOKING_LINK`; ratchets fail on stale entries)

**Interfaces:**
- Consumes: `calendlyBookingOfferForBusiness(businessId: string): Promise<{ config: CalendlyConfig | null; schedulingUrl: string | null }>` from `lib/calendly/config-for-business.ts` (throws when it cannot tell whose calendar it is).

- [ ] **Step 1:** Read `sendInquiryAutoReply` (~556–640), the file header's G30 paragraph (~40–61), `config-for-business.ts` header and `calendlyBookingOfferForBusiness`, and how the chat builds its prefilled slot links (`lib/lead-engine/chat/tools.ts`, search `name=` / `prefill`). If a prefill helper exists, reuse it for `name`/`email`; if not, use the plain URL (do not invent one).
- [ ] **Step 2: Tests first** in `lead-alerts.test.ts` (mock `@/lib/calendly/config-for-business`): (a) resolver returns `schedulingUrl: "https://calendly.com/coach-b/consult"` → the sent HTML contains that URL and "Schedule Your Consultation" and does NOT contain `leadconnectorhq`; (b) `schedulingUrl: null` → no button, the HTML contains "Reply to this email and we'll find a time.", the email is still sent; (c) resolver throws → same as (b), still sent, the error is logged, not thrown; (d) the business id passed to the resolver is the one the function was called with. RED.
- [ ] **Step 3:** Implement: resolve inside a try/catch (log `[email] inquiry auto-reply: could not read the booking page for business <id>` on failure), render `ctaButton(url, "Schedule Your Consultation")` only with a URL; without one, replace the "The next step is to schedule a consultation call…" paragraph with "The next step is a short consultation call. Reply to this email and we'll find a time." Remove `PLATFORM_BOOKING_LINK`. GREEN.
- [ ] **Step 4:** Run `lead-alerts.test.ts`, `no-brand-literals.test.ts`, and every suite importing `lib/email/lead-alerts` or `lib/email` that mocks `sendInquiryAutoReply` (`grep -rl "sendInquiryAutoReply" __tests__`) → PASS.
- [ ] **Step 5: Mutants:** (a) always use the fallback (no button); (b) rethrow the resolver error; (c) pass a hard-coded business id. Each RED, restore.
- [ ] **Step 6:** tsc per-file compare; commit `fix(lead-engine): the application auto-reply links the coach's own booking page (G30)`.

---

### Task 4: Small admin fixes

**Files:**
- Modify: `components/admin/businesses/BusinessSettingsForm.tsx`; Test: `__tests__/components/admin/business-settings-form.test.tsx`
- Modify: `components/admin/admin-nav.ts`; Test: `__tests__/components/admin/admin-nav.test.ts`
- Modify: `app/(admin)/admin/settings/page.tsx`; Test: add a small render/source test only if a settings-page test already exists; otherwise a source-level test in `__tests__/app/admin/settings-page-links.test.ts` asserting the Configuration list has `{ label: "Business Settings", href: "/admin/businesses" }`.

- [ ] **Step 1:** Tests first. Settings form: labels "Start sending at" and "Stop sending at" (the inputs keep `id`/`name` `quiet_hours_start`/`quiet_hours_end`); hint text exactly: "Follow-up emails and texts only go out between these hours, in each person's own time zone when we know it, otherwise this business's. Use the hour of the day, from 0 (midnight) to 23 (11pm): 8 and 21 means 8am until 9pm."; daily-limit hint exactly: "The most follow-up messages (emails and texts together) one person can be sent in a day, across all sequences." Nav: a "Campaign Revenue" item, href `/admin/insights/campaign-revenue`, in the Business section immediately after Analytics, in BOTH `contentStudioEnabled` variants, and `filterNavForActor` hides it from an actor the registry refuses (check what `canAccessPath` answers for that path for a staff actor and pin that). Settings page: the Business Settings link. RED.
- [ ] **Step 2:** Implement; pick a Lucide icon already imported where possible. GREEN. Update any existing test that pinned the old labels/hints (retarget, with the reason in the test name).
- [ ] **Step 3:** Run the three test files plus every suite importing `admin-nav` (`grep -rl "admin-nav" __tests__`) → PASS.
- [ ] **Step 4:** tsc per-file compare; commit `fix(admin): quiet-hours labels say what they do; Campaign Revenue and Business Settings are reachable`.

---

### Task 5: Ledger, screenshots, journal (orchestrator)

- [ ] Update `docs/lead-engine-gaps-to-ship-2026-09-19.md` (spec §6) — every status edited in BOTH places it lives (the row and the scoreboard).
- [ ] Superseded banner on `docs/lead-engine-audit-2026-09-13.md`.
- [ ] Annotated screenshots of every changed screen into `screenshots/lead-engine-owner-answers/` (dev clone, real routes, `scripts/_annotate-lib.mjs`, light only): the Sequences list with the draft Chat Lead Follow-Up; its editor; the camp sequence's new tail; the funnel form, quiz gate and application form with the email tick; the settings form's new labels; the sidebar with Campaign Revenue; the Settings page link. Plus the auto-reply email rendered to PNG if a renderer can be called without sending.
- [ ] Whole-branch review by an independent reviewer (diff as a file; Read/Grep only); act on findings.
- [ ] Final gates: tsc per-file identical to baseline; `npm run build` exit 0 (after `rm -rf .next`); selects + drift on the dev clone.
- [ ] Journal entry; report. Merge/push/deploy only on the owner's word.
