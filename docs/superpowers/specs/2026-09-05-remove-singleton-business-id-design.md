# Removing `SINGLETON_BUSINESS_ID` from production code

**Status:** designed 2026-09-05 on an autonomous run (owner away; the brief runs through to "FINISH BY"). Not yet built. Decisions the owner did not get to rule on are collected in §10 for review on return.
**Date:** 2026-09-05
**Branch:** `feat/remove-singleton-business-id`, cut from `origin/main` @ `0cb030a9` (the brief said `cbf5ffeb`; origin had moved one commit). Worktree at `../djpathlete-singleton-removal`.
**Standing constraint:** CLAUDE.md, "Where this product is going". The singleton count reaching zero is the progress bar; adding a reference is moving backwards.
**Seam inventory:** [lib/tenancy/platform.ts](../../../lib/tenancy/platform.ts). Every call site that cannot resolve a tenant goes through `platformBusinessId()` and is listed there under the shelf that names WHY.

---

## 0. The measurement, and what it actually counts

The brief's command, run against `origin/main`:

```
git grep -l SINGLETON_BUSINESS_ID origin/main -- '*.ts' '*.tsx' \
  | sed 's#^origin/main:##' | grep -v '^__tests__/\|^scripts/' | wc -l
```

gives **25**. Three things about that number, established by reading every file rather than trusting the grep:

1. **One of the 25 is a test file.** `functions/src/ads/__tests__/dal.test.ts` survives the filter because `^__tests__/` only matches the top-level directory. The true production count is **24**. This spec reports both numbers throughout so the before/after is comparable with the brief.
2. **Ten of the 24 reference the constant in a comment only.** Every one of the brief's group (b) — the five admin surfaces — already calls `resolveAdminTenant()` / `resolveAdminTenantForRequest()`; what the grep found is their doc comments explaining *why* they do. The same is true of `app/api/stripe/webhook/route.ts`, `lib/tenancy/resolve.ts`, `lib/lead-engine/capture.ts`, `lib/lead-engine/import.ts` and `lib/bookings/ingest.ts`. This is the "text assertions must exclude prose" note paying out again: a file-level grep cannot tell a default from a sentence about a default.
3. **The code references are in 14 files:** nine DAL modules carrying 29 defaulted `businessId` parameters, and five seams. The work is in the *callers* of those 29 functions, most of which are not in the 25 at all.

So the honest breakdown of the 25:

| Kind | Files | What removing it takes |
|---|---|---|
| DAL default parameter (code) | 9 | remove the default; make every caller supply a tenant |
| Seam (code, by design) | 5 | an inventory entry, and in two cases a substitution for `platformBusinessId()` |
| Comment only | 10 | rewrite where the sentence describes a default this branch removes |
| Test file miscounted | 1 | none — report it |

---

## 1. Classification of all 25

Derived from the call graphs in §5, not from filenames. Where it disagrees with the brief's grouping, the reason is given.

| # | File | Reference | Group | Action |
|---|---|---|---|---|
| 1 | `lib/db/contacts.ts` | 4 defaults: `upsertContactIdentity`, `recordContactEvent`, `getContactUserId`, `findContactByIdentifiers` | (a) | remove defaults; `businessId` required in both input types |
| 2 | `lib/db/contact-tags.ts` | 4 defaults: `listTags`, `addTag`, `removeTag`, `tagsForContacts` | (a) | remove defaults; every production caller already passes one (`listTags` has no production caller — §10.9) |
| 3 | `lib/db/contact-consents.ts` | 3 defaults: `suppress`, `unsuppress`, `isSuppressed`; `recordConsent` input optional | (a) | remove; **7 `recordConsent` callers omit it** (§5) |
| 4 | `lib/db/contact-detail.ts` | 1 default: `getContactById` | (a) | remove; both callers pass |
| 5 | `lib/db/pipeline.ts` | 8 defaults: `resolvePipeline`, `readMostRecentOpportunity`, `readMostRecentWonOpportunity`, `highestRecordedRefundAmount`, `applyPipelineEvent`, `listReconciledSourceIds`, `moveOpportunityManually`, `readBoard` | (a) | remove; every caller passes except `applyPipelineEvent` in quiz/submit |
| 6 | `lib/db/sequences.ts` | 4 defaults: `claimDueRuns`, `loadRunContext`, `recordSend`, `listSequences` | (a) | remove; every caller passes |
| 7 | `lib/db/businesses.ts` | 1 default: `getBusinessSettings` | (a) | remove; **15 files call it with no argument** (§5) |
| 8 | `lib/lead-engine/enroll.ts` | 2 defaults: `enrollIfTriggered`, `enrolContactManually` | (a) | remove; `enrolContactManually`'s one caller omits it (→ #16) |
| 9 | `lib/lead-engine/capture.ts` | comment; `CaptureLeadInput.businessId?` optional | (a) | make required; **7 callers omit it** (§5) |
| 10 | `lib/lead-engine/import.ts` | comment only | (a) | rewrite the comment (it describes the default this branch removes); `ctx.businessId` is already required |
| 11 | `lib/bookings/ingest.ts` | comment only | (a) | rewrite the comment; `businessId` is already required |
| 12 | `app/(admin)/admin/contacts/page.tsx` | comment only; code resolves via `resolveAdminTenant` | (b) — **already done** | rewrite the comment ("the default stays for the other callers" becomes false) |
| 13 | `app/(admin)/admin/contacts/[id]/page.tsx` | comment only; code resolves | (b) — already done | rewrite |
| 14 | `app/api/admin/contacts/[id]/tags/route.ts` | comment only; code resolves | (b) — already done | rewrite |
| 15 | `app/api/admin/pipeline/move/route.ts` | comment only; code resolves | (b) — already done | rewrite |
| 16 | `app/api/admin/sequences/enrol/route.ts` | comment only — **but the code omits `businessId`** on `enrolContactManually` | (b) — **the one live gap** | `resolveAdminTenantForRequest` threaded through; `NoAccessibleBusinessError` → 403 |
| 17 | `app/api/stripe/webhook/route.ts` | comment only; the pipeline half resolves from the contact row | (c) per brief — **partly wrong**: `tryCaptureLeadFromCheckout` calls `captureLead` with no tenant | narrower-variant seam: the contact row resolved earlier in the same handler first, `platformBusinessId()` only for a first-time payer |
| 18 | `app/api/public/invite/[token]/claim/route.ts` | code: `invite.business_id ?? SINGLETON_BUSINESS_ID` | (c) | substitute `platformBusinessId()`; listed under CORRECT BY CONSTRUCTION (a plain `/admin/team` invite *is* an invite to the platform's business) |
| 19 | `lib/db/google-ads-accounts.ts` | code: `getActiveGoogleAdsAccounts`'s default; one comment | (c) frozen | default becomes `= platformBusinessId()`; the five ads callers are **not touched** (INVARIANTS); listed under DELIBERATELY FROZEN |
| 20 | `lib/tenancy/platform.ts` | the seam | (c) | inventory rewritten to name every new caller by shelf |
| 21 | `lib/tenancy/resolve.ts` | comment only — history of the fallback migration 00246 removed | (c) | **left as is.** The sentence is true history, the file is not otherwise touched |
| 22 | `lib/lead-engine/constants.ts` | the definition | (c) | left |
| 23 | `functions/src/lib/tenancy-constants.ts` | twin definition | (c) | left; `functions/` cannot import `lib/` |
| 24 | `functions/src/ads/dal.ts` | twin default | (c) | left; same reason, and its one caller is the nightly cron that does not iterate businesses |
| 25 | `functions/src/ads/__tests__/dal.test.ts` | **test file** | — | none; miscounted by the filter |

**Expected end state by the brief's exact command: 6** (#20, #21, #22, #23, #24, #25). By true production count: 5, of which one (#21) is a history comment and four are the seam and its twins.

---

## 2. What "done" looks like

1. No function under `lib/` defaults its tenant. Every `businessId` parameter on the 29 functions in #1–#8 is required, and so are `CaptureLeadInput.businessId`, `RecordContactEventInput.businessId`, `UpsertContactIdentityInput.businessId`, the `businessId` on `recordConsent`/`addTag`/`removeTag`/`applyPipelineEvent`/`moveOpportunityManually`/`recordSend`/`enrollIfTriggered`/`enrolContactManually`'s inputs. The single exception is #19, whose default is routed through the seam and inventoried as frozen.
2. Every caller supplies a tenant from one of exactly three sources (§3).
3. `lib/tenancy/platform.ts` names every `platformBusinessId()` caller by shelf, and `grep -rn "platformBusinessId()" app lib components` matches the inventory one-for-one.
4. The `tsc --noEmit` error **set** is byte-identical to the 251-line baseline at `../tsc-base-singleton-removal-2026-09-05.txt` (outside the repo, because it must not be committed).
5. `npm run build` is green.
6. Every converted entry point has a test asserting **which** business reached the DAL, with a value that is not the platform id wherever the design says the tenant comes from a row.

---

## 3. The design: one resolution per entry point, from one of three sources

**Rule.** An entry point (route handler, server component, page) resolves its tenant **once**, at the top, and threads that value through every DAL call it makes. Nothing calls `platformBusinessId()` twice in one file, and no DAL function is called with a tenant the entry point did not resolve itself. A file that today calls `getBusinessSettings()`, `captureLead()` and `recordConsent()` three separate ways ends up with `const businessId = …` once and three calls that pass it.

**The three sources, in order of preference.** The first that applies wins; a caller must not drop to a lower one because it is easier.

| Source | When | Examples |
|---|---|---|
| **Session** — `resolveAdminTenant()` / `resolveAdminTenantForRequest(req)` | the caller has an admin/staff session | #12–#16 |
| **A row that already carries the tenant** | the request names a row with a `business_id`, written by something that resolved it properly | `conversation.business_id` (ask/capture), the contact row (stripe webhook's pipeline half), `coach_calendar_connections` (Calendly webhook), **`quiz_attempts.business_id`** (quiz/submit — new in this branch) |
| **`platformBusinessId()`** with an inventory entry | no session, no row | every public lead-capture form, the marketing pages, the four SMS-consent server components, funnels/submit (funnels carry no `business_id`), events (same) |

**Why not a `resolvePublicTenant()` helper now.** Considered and rejected. A zero-argument helper that returns `platformBusinessId()` today and reads the `Host` header in phase 4 would make phase 4 a one-function change instead of a ~14-file sweep, and would cost nothing. But (a) the brief directs seams through `platform.ts` so the inventory stays the single truthful list, (b) its eventual signature depends on phase-4 decisions nobody has made (does a server component resolve from `headers()`? does a route take the request?), and (c) an abstraction over one implementation is the thing CLAUDE.md says not to build early. Recorded here so phase 4 knows the sweep is `grep -rn "platformBusinessId()"` and the inventory's CANNOT RESOLVE YET shelf.

**Ordering: callers before defaults.** Every caller is converted to pass a tenant *while the defaults still exist*, one entry point at a time. Then the defaults are removed in one mechanical pass, and `tsc` proves no caller was missed — a compile error at that point is a caller the sweep skipped, which is exactly the signal wanted. This is the inverse of "remove the default, then chase the compile errors", which the brief warns ships a compile-error wave and which would also leave the branch un-buildable between tasks.

---

## 4. Contract changes on the DAL side

All mechanical; listed so the final pass is a checklist rather than a hunt.

| File | Function | Change |
|---|---|---|
| `lib/db/contacts.ts` | `upsertContactIdentity` | `UpsertContactIdentityInput.businessId: string` (required); drop `?? SINGLETON_BUSINESS_ID` |
| | `recordContactEvent` | `RecordContactEventInput.businessId: string`; drop the fallback |
| | `getContactUserId` | `businessId: string` |
| | `findContactByIdentifiers` | `businessId: string` in args |
| `lib/db/contact-tags.ts` | `listTags`, `tagsForContacts` | `businessId: string` |
| | `addTag`, `removeTag` | input `businessId: string`; drop the fallback |
| `lib/db/contact-consents.ts` | `recordConsent` | input `businessId: string`; drop the fallback |
| | `suppress`, `unsuppress`, `isSuppressed` | `businessId: string` |
| `lib/db/contact-detail.ts` | `getContactById` | `businessId: string` |
| `lib/db/pipeline.ts` | all eight | `businessId: string`; `applyPipelineEvent` and `moveOpportunityManually` inputs required |
| `lib/db/sequences.ts` | all four | `businessId: string`; `recordSend` input required |
| `lib/db/businesses.ts` | `getBusinessSettings` | `businessId: string` |
| `lib/lead-engine/enroll.ts` | `enrollIfTriggered` | args `businessId: string` |
| | `enrolContactManually` | `opts.businessId: string` — `opts` stops being optional |
| `lib/lead-engine/capture.ts` | `captureLead` | `CaptureLeadInput.businessId: string`; the doc comment stops naming the removed default |
| `lib/funnels/capture-contact.ts` | `captureContactFromSubmission` | input gains `businessId: string`, passed to `recordContactEvent` |
| `lib/lead-engine/email.ts` | `sendSequenceEmail` | `settings: BusinessSettings` required; the `?? getBusinessSettings()` fallback is deleted. Its one caller (`sequence-tick-runner.ts:563`) already passes it — the fallback is dead code that carried a tenant default |
| `lib/db/quizzes.ts` | `getAttempt` | selects `business_id` and returns `businessId: string` on the row. Additive; the other consumer (`quiz/progress`) ignores it |
| `lib/db/google-ads-accounts.ts` | `getActiveGoogleAdsAccounts` | default becomes `= platformBusinessId()`; nothing else in the file or in `lib/ads/` changes |
| `app/api/public/invite/[token]/claim/route.ts` | — | `invite.business_id ?? platformBusinessId()`; import swapped |

After the final pass, `git grep SINGLETON_BUSINESS_ID -- lib app components` must match only `lib/lead-engine/constants.ts`, `lib/tenancy/platform.ts` and the history comment in `lib/tenancy/resolve.ts`.

---

## 5. Resolution on the caller side

Every production call site that omits a tenant today, and where it gets one from. Line numbers are as of `0cb030a9`.

### 5.1 Public lead-capture routes → `platformBusinessId()` (CANNOT RESOLVE YET)

Each resolves once at the top of the handler with the seam comment, then threads.

| Route | Calls that gain the tenant |
|---|---|
| `app/api/contact/route.ts` | `captureLead` :61 |
| `app/api/shop/leads/route.ts` | `captureLead` :46 |
| `app/api/newsletter/route.ts` | `getBusinessSettings` :38, `captureLead` :73, `recordConsent` :86 |
| `app/api/inquiry/route.ts` | `captureLead` :149, `getBusinessSettings` :427, `recordConsent` :432 |
| `app/api/events/[id]/signup/route.ts` | `captureLead` :70, `getBusinessSettings` :138, `recordConsent` :143 |
| `app/api/events/[id]/checkout/route.ts` | `captureLead` :94, `getBusinessSettings` :153, `recordConsent` :158 |
| `app/api/funnels/submit/route.ts` | `captureContactFromSubmission` :143, `getBusinessSettings` :338, `recordConsent` :343 |
| `app/api/ask/config/route.ts` | `getBusinessSettings` :62 |

Funnels and events carry no `business_id` on any table (checked: no funnel or event migration mentions the column), so there is no row to inherit from; these are honest seams until those subsystems are scoped, which is not this task.

### 5.2 Public pages and server components → `platformBusinessId()` (CANNOT RESOLVE YET)

| File | Call |
|---|---|
| `app/(marketing)/ask/page.tsx` | `getBusinessSettings` :49 |
| `app/(marketing)/camps/[slug]/page.tsx` | `getBusinessSettings` :69 |
| `app/(marketing)/clinics/[slug]/page.tsx` | `getBusinessSettings` :60 |
| `components/public/InquiryForm.tsx` | `getBusinessSettings` :44 |
| `components/public/StepUpInquiryForm.tsx` | `getBusinessSettings` :15 |
| `components/funnels/islands/FormIsland.tsx` | `getBusinessSettings` :51 |
| `components/funnels/islands/QuizIsland.tsx` | `getBusinessSettings` :44 |

All four components read settings only to render SMS-consent wording, and each already pairs with a route in §5.1 that files the consent row — the two must resolve the same tenant or the wording shown and the wording filed can disagree. Both go through the same seam, so they cannot.

### 5.3 A row that carries the tenant

| File | Source | Calls |
|---|---|---|
| `app/api/quiz/submit/route.ts` | **`attempt.businessId`** from the widened `getAttempt` | `recordContactEvent` :244, `applyPipelineEvent` :270, `getBusinessSettings` :285 and :310, `recordConsent` :317 |
| `app/api/ask/capture/route.ts` | `conversation.business_id` — already in scope, already passed to `captureLead` and `getBusinessSettings` | `recordConsent` :374 **omits it today**: a latent inconsistency where the settings are read for one business and the consent row is filed under the default |

The quiz attempt was created under a business by `quiz/progress` (today `platformBusinessId()`, in phase 4 whatever the Host resolves to), so the submit inheriting it is a real resolution, not a seam — and it is what keeps the attempt, the contact, the pipeline card and the consent row on the same tenant by construction rather than by four defaults happening to agree.

### 5.4 The narrower variant: a real lookup first, the seam only as fallback

| File | Change |
|---|---|
| `app/api/stripe/webhook/route.ts` | `tryCaptureLeadFromCheckout` takes the `contact` the handler resolved via `findContactWithBusinessByIdentifiers` a few lines earlier, and passes `contact?.businessId ?? platformBusinessId()`. A repeat payer's capture lands on their own business; only a first-time payer — for whom one Stripe account serving every business genuinely carries no tenant — falls to the platform |

### 5.5 Session

| File | Change |
|---|---|
| `app/api/admin/sequences/enrol/route.ts` | `resolveAdminTenantForRequest(request)` after the role check; `NoAccessibleBusinessError` → 403 (same shape as the pipeline move route); `businessId` passed to `enrolContactManually`. The route is admin-only, so `isOperator` is always true and `businessId` is the cookie's choice or the first business — **the same resolution the contact-detail page used to populate the sequence picker**, so the key the operator picked and the key the route looks up are scoped identically. The header comment's "FOLLOW-UP, NOT YET DONE" paragraph is deleted; the route's own reasoning replaces it |

### 5.6 Frozen, by invariant

`getActiveGoogleAdsAccounts()` is called with no argument at `app/api/admin/ads/diagnose/route.ts:61`, `lib/ads/agent.ts:259` and `:367`, `lib/ads/ga4-audiences.ts:69`, `lib/ads/conversions.ts:418`. None is touched. The default they rely on now spells `platformBusinessId()` and the five are listed in the inventory's DELIBERATELY FROZEN shelf, next to the existing `upsertGoogleAdsAccount` entry that already explains why the ads subsystem is scoped as a unit or not at all.

---

## 6. `lib/tenancy/platform.ts` — the inventory after this branch

The four shelves stay. Each gains entries; nothing is removed. The additions, by shelf:

- **CANNOT RESOLVE YET** — the eight routes in §5.1 and the seven files in §5.2, described as "the public lead-capture surfaces and the server components that render their consent wording", with the file list, and the note that funnels and events carry no `business_id` to inherit.
- **CORRECT BY CONSTRUCTION** — the invite claim route's plain-team-invite branch (#18): an invite with no `business_id` is a `/admin/team` invite, which is by definition onto the platform's own business.
- **NARROWER VARIANT** — the Stripe webhook's capture half (§5.4).
- **DELIBERATELY FROZEN** — `getActiveGoogleAdsAccounts`'s default and its five callers (§5.6).
- A closing note that `functions/src/lib/tenancy-constants.ts` and `functions/src/ads/dal.ts` are twins that cannot import this file, so a reader grepping for the constant will find them there and should not count them as inline literals.

The inventory is reconciled against `grep -rn "platformBusinessId()" app lib components` in the final task, and a structural test pins that: every file the grep finds must be named in `platform.ts`'s comment. That test is deliberately a *prose* assertion on a comment — the inventory's value is that it is complete, and nothing else enforces completeness.

---

## 7. Comment rewrite rule

Ten of the 25 name the constant only in prose. The rule, so the count cannot be gamed by rewording and cannot be inflated by leaving stale sentences either:

> A comment that names `SINGLETON_BUSINESS_ID` is rewritten **if the file is touched by this branch and the sentence describes the default-parameter mechanism this branch removes** — present or past tense, because after this branch there is no such mechanism in the codebase for the sentence to point at. It is rewritten to state the current contract (the tenant is required and where this caller gets it). A file this branch does not touch keeps its comment even when it names the constant.

Under that rule #10–#17 are rewritten (all touched, all describe the default), and #21 stays (`resolve.ts` is untouched; its sentence is history about migration 00246's fallback, which is a different mechanism).

---

## 8. Testing

- **Every new test file starts with `// @vitest-environment node` on line 1.** jsdom cannot start a worker in this repo; a test without the pragma reports "no tests", which is visually identical to passing. Every run must show a **non-zero** test count, and the count is recorded in the task's report.
- **Callers: assert WHICH business, not that one arrived.** For a `platformBusinessId()` seam, the DAL mock is asserted to have received exactly `"00000000-0000-0000-0000-000000000001"`. For a row-sourced tenant (quiz/submit, ask/capture, stripe), the fixture row carries a **different** id (e.g. `"…0002"`), and the test asserts that id reached every DAL call — a test that used the platform id here would pass for the seam and the resolution alike. For the enrol route, `resolveAdminTenantForRequest` is mocked to return a non-platform id and the test asserts it reached `enrolContactManually`; a second test makes it throw `NoAccessibleBusinessError` and asserts 403.
- **Stripe: both branches.** Known contact on business `…0002` → `captureLead` receives `…0002`; no contact → receives the platform id. Without the second the first proves nothing about the fallback.
- **The DAL side is proven by `tsc`**, not by new tests: once the defaults are gone, any caller still omitting the tenant is a compile error, and the set comparison against the baseline is the assertion. Existing DAL suites are retargeted where they called a function without a tenant, not deleted.
- **The inventory test** (§6): reads `platform.ts`, greps the tree for `platformBusinessId()`, asserts every file found is named in the comment.
- **Verification gates:** targeted vitest per task with counts; `tsc` set comparison; `npm run build`; the singleton count re-measured with the brief's exact command.

---

## 9. Out of scope, each for a reason

| Not done | Why |
|---|---|
| Phase 4 Host-header resolution | its own phase; this branch leaves it a single grep |
| Giving funnels, events, products a `business_id` | subsystem scoping; "every new table gets `business_id`" is a rule for new tables, retrofitting three subsystems is not a side effect of a parameter sweep |
| Scoping any ads reader, restoring the `ads` permission | INVARIANTS; `docs/superpowers/plans/2026-09-04-ads-owner-only.md` |
| The `functions/` twins | cannot import `lib/`; the nightly cron does not iterate businesses; changing that is a Firebase-side design |
| `hasConsent(contactId, channel)` having no tenant predicate | `contact_id` is a UUID primary key already resolved by tenant upstream; not a leak, and not a default |
| Fixing the jsdom worker breakage | the owner's call, per the brief; raised in the report, not taken on |
| Deleting `listTags` (no production caller) | test-covered, one-line default removal is enough; deleting an export is a separate decision (§10.9) |

---

## 10. Decisions made without the owner — review these

1. **Autonomous-mode reading of the brief.** The brief prescribes the full arc through "FINISH BY" and the session is flagged non-interactive; treated as "proceed until the end" per the global autonomous-mode rule. Nothing is pushed or merged.
2. **`invite/claim` is changed, not just inventoried.** The brief lists it as (c) "not a change". The substitution `SINGLETON_BUSINESS_ID` → `platformBusinessId()` is byte-identical in behaviour and is exactly what `platform.ts` asks of every caller ("calls this instead of writing the constant inline"). Leaving a raw literal in a route while the inventory claims to be complete would make the inventory false.
3. **`google-ads-accounts.ts`'s default is respelled, its callers are not touched.** Same reasoning; the INVARIANT is about scoping ads *readers*, and this reader's filtering logic is unchanged. Flagged because the brief put the file in (c) as a whole.
4. **quiz/submit inherits the attempt's business** rather than calling the seam. This is the one place a public route has a row to inherit from, and it is the stronger design: four writes stay on one tenant by construction. It widens `getAttempt`'s select by one column.
5. **`sendSequenceEmail`'s settings fallback is deleted** as dead code, rather than given a tenant. One caller, and it passes settings.
6. **No `resolvePublicTenant()` helper** (§3). Recorded so phase 4 does not think it was overlooked.
7. **Comment rewrite rule** (§7): touched-and-describes-the-default. `resolve.ts` stays and is counted in the final number honestly.
8. **Ordering: callers first, defaults last** (§3), so the branch builds at every commit and the compile step is the proof of completeness.
9. **`listTags` kept.** No production caller, but it is test-covered and plausibly the tags route's next reader; deleting an export is not this sweep's job.
10. **The enrol route's tenant is the operator's *selected* business, not "every business".** An admin enrolling contacts from the detail page of business B, with the cookie set to B, enrols into B's sequence. Before this branch the same click looked the key up under the platform business — the "silent success on a colliding seeded key" the route's own comment warned about.
11. **`ask/capture`'s marketing-consent row moves onto the conversation's tenant.** The route already read `business_settings` for `conversation.business_id` to build the wording; it filed the consent row under the DAL default, so wording-shown and wording-filed could name different businesses the moment a conversation is created under anything but the seam. Counted as the fourth behaviour change in §11 rather than left implicit.

---

## 11. Risks

- **Test churn.** 32 test files reference the constant and ~48 import an affected DAL module. Tests that *call* a function without a tenant become `tsc` errors (the include covers `__tests__/**`); tests that *assert* `toHaveBeenCalledWith` without `businessId` become runtime failures. Both are the intended signal; each module's task retargets its own suites. The risk is volume, not subtlety.
- **Behaviour changes, all four deliberate and all tenant-correct:** the enrol route (§10.10); the Stripe capture for a known contact of a non-platform business now files under that business; quiz/submit follows the attempt; and `app/api/ask/capture/route.ts` now files the marketing-consent row under `conversation.business_id` (it read settings for that business but filed the row under the default). The last one is identical today because every conversation is created under the seam (`app/api/ask/route.ts:379`), for the same reason quiz/submit is. Everything else is byte-identical today because every default resolved to the same value.
- **The inventory growing from ~10 callers to ~25** is the honest cost of making the public surface's tenant decision greppable. It is listed by shelf and by file, so phase 4's sweep is the CANNOT RESOLVE YET shelf and nothing else.
