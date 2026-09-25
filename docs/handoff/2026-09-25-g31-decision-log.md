# SDD ledger — plan: docs/superpowers/plans/2026-09-24-funnel-tenancy.md

Spec: docs/superpowers/specs/2026-09-24-funnel-tenancy-design.md (read; binding authority)
Branch: worktree-g31-funnel-tenancy, base 534c21b4
Constraint from owner: do NOT push or merge. Two pushes are owed and both are theirs.

## Pre-flight conflict scan

### Pairs sharing a file or interface

| Pair | Produced → consumed | Found |
|---|---|---|
| T1 → T2,T3,T4,T5 | `business_id` column | clean — T1 ships first, all four predicate on it |
| T1 → T3 | composite FKs replacing simple ones → the leads embed | clean — T1 drops each simple FK, which is what keeps the embed resolvable |
| T2 → T6 | `getPublishedStep(businessId,…)`, `listPublishedFunnelSteps(businessId)` | clean |
| T2 → T7 | `listFunnels(businessId)`, `updateFunnel(businessId,…)` for the cron | clean |
| T2 → T9 | `listPublishedFunnelSteps` predicate → its SINGLETON comment retires | clean — ordered 2 before 9 |
| T5 → T6 | `findRelevantLeadMagnet` is reached from a PUBLIC component | clean — T6 supplies the Host tenant |
| T5 → T7 | lead-magnet admin routes | clean |
| T8 → T9 | `loadCatalogues(businessId)` → its frozen-list entry removed | clean — ordered 8 before 9 |
| T2,T4 → T8 | `preview-render.ts` calls both the DAL and `loadCatalogues` | clean |
| T6 ↔ T7 | **CONFLICT** — T6 claims `/api/funnels/preview-submit`; spec D6 puts draft-preview surfaces on the ADMIN boundary | ruled, see R1 |

### Each task against itself

| Task | Self-consistent? |
|---|---|
| T1 | **No** — its automated test asserts SQL *text*, but Review Focus #2 (the cascade) cannot be proved by text. Ruled, see R2 |
| T2 | yes — 18 named readers, tests assert the predicate VALUE, permissive control present |
| T3 | yes — embed assertion and tenant assertion both present |
| T4 | yes — names verified against the files |
| T5 | yes — corrected during plan self-review; says outright that no slug reader exists |
| T6 | see R1 |
| T7 | yes — cron iterates businesses, test pins both tenants |
| T8 | yes |
| T9 | yes — re-measures the constant count rather than asserting it |
| T10 | **Gap** — may need the platform business id; a literal would breach a Global Constraint. Ruled, see R3 |

### Rulings before execution

Ruling: `/api/funnels/preview-submit` resolves through the ADMIN boundary and moves from Task 6 to Task 7 — spec D6 puts both draft-preview surfaces there, the route is only ever reached from an admin/staff preview page, and the spec is the binding authority over the plan. Costs if wrong: a preview test-run resolves the wrong tenant for an owner previewing on an unclaimed host; recoverable by moving it back, and it writes nothing either way.

Ruling: Review Focus #2 (ON DELETE CASCADE survives the FK replacement) is proved by Task 1 Step 6 against the dev clone, not by the text assertion. The text assertion stays as a cheap guard against someone deleting the clause while editing, but it cannot catch a constraint that failed to apply. Step 6 must record its result in the ledger. Costs if wrong: a cascade silently becomes a foreign-key violation and `deleteFunnel` starts failing at runtime with nothing red at build time.

Ruling: Task 10's verification script resolves the platform business id via `platformBusinessId()` or by reading `businesses`, never a literal — a literal would add a `SINGLETON_BUSINESS_ID` reference in `*.ts` and breach a Global Constraint. Costs if wrong: the constant count rises from 5 to 6 and the progress bar the repo tracks moves backwards.

Ruling: the migration is applied to the DEV CLONE only (`anjvztjiokcgiyhobknq`), dry-run first. `SUPABASE_ACCESS_TOKEN` in `.env.local` is ACCOUNT-level and can reach production — `SUPABASE_PROJECT_REF` is the only thing keeping it off prod, so it is set explicitly on every invocation and never inherited. Costs if wrong: a schema change reaches production unsupervised, which is the one class of action the owner withheld.

## Task log

Task 1: implementer DONE_WITH_CONCERNS (commits e9936ddc..28cf7f27).
  Ruling: the implementer's SQL correction stands. The plan told it to
  `drop index public.lead_magnets_slug_key`; that object is a UNIQUE CONSTRAINT
  (00112) and Postgres refuses DROP INDEX on a constraint-owned index, so the
  migration would have failed — on PRODUCTION, where it has not run yet.
  Verified against prod myself rather than taking the report's word: prod's
  pg_constraint holds lead_magnets_slug_key (contype 'u'), while funnels_slug_key
  appears ONLY in pg_indexes. The two really are different kinds of object and
  the plan conflated them, because pg_indexes lists constraint-backed indexes
  too. Costs if wrong: none — the corrected form is strictly more permissive
  (`drop constraint if exists`) and prod-verified.
  Open gap for review: the test does not pin the `drop constraint` spelling, so
  a future edit could reintroduce the failing form.
  Note: scripts/migrations/apply.mjs cannot run against the dev clone at all —
  public.repo_migrations does not exist there. Pre-existing, not this task's.
  Task 1: review — spec MET, 0 Critical, 1 Important, 3 Minor.
  Task 1: minor (deferred): test is static text-matching only; 00276/00277 pair
    stripped-text assertions with a live half that exercises behaviour. The live
    proof here was done by hand (Step 6) rather than captured as a repeatable
    test. Inherited from the plan's own Step 3 code, not an implementer choice.
  Task 1: minor (not a defect): the platform UUID literal appears in the test
    file; CLAUDE.md's own inventory command excludes __tests__/, and 50+ existing
    test files do the same. No action.
  Task 1: minor (not a defect): count assertions go red if the migration gains an
    8th table — that is the intended behaviour, not a gap. No action.
  Task 1: fix round 1/5 dispatched — pin the `drop constraint` spelling, and
    prove the new assertion can fail (flip SQL broken -> RED -> back -> GREEN).

Ruling (applies to Tasks 2-7): the branch does NOT typecheck between Task 2 and
Task 7, by construction. Task 2 changes `lib/db/funnels.ts` signatures while its
41 importers still call the old arity, and the callers are not fixed until Tasks
6 and 7. This is the plan working as designed, not breakage. Consequences I am
binding every dispatch and review to:
  - each task's OWN targeted test file must pass, and that is the per-task gate;
  - `npx tsc --noEmit` is NOT a gate until Task 7 completes, and is then run
    again at the end against the baseline per-file set;
  - a reviewer reporting "the build is broken" during Tasks 2-6 is observing the
    design, and I will adjudicate it as such rather than sending it to a fixer.
Considered and rejected: restructuring the plan to convert each DAL together
with its callers, which would keep the branch green throughout. It would mean
rewriting the task boundaries mid-flight for a branch that is never pushed in an
intermediate state, and the end state is identical. Costs if wrong: an actual
compile error introduced during Tasks 2-6 hides among the expected ones until
Task 7 — mitigated by running tsc at Task 7 and diffing the per-file SET against
the recorded baseline, which names every file rather than counting errors.
  Task 1: dev clone verified by me directly, not taken from the report —
    7 business_id columns, 5 funnel composite FKs all cascading, 0 old slug
    objects, 2 new per-tenant slug indexes, 0 NULL business_id on funnels.
    My first probe reported SIX composite FKs; the extra was
    event_signups_event_business_fkey from 00252, which `like '%_business_fkey'`
    also matches. The probe over-matched, the schema was right — a mismatch is
    evidence about the probe before it is evidence about the deployment.
  Task 1: fix round 1/5 (1 addressed, 0 open; commit f7ca32fa). Both regressions
    pinned; the implementer proved each assertion load-bearing with its own named
    mutant, including reinserting the broken line beside the correct one to show
    the negative assertion is not redundant.
Task 1: complete (commits 39266a40..f7ca32fa, review clean). PUSH 1 CONTENT.

Task 2: implementer DONE_WITH_CONCERNS (commit 6d6f59c2). 20 functions converted,
  own suite 6/6 with two live mutations proving it non-vacuous.
  CORRECTION TO THE REPORT, measured by me: the implementer reported "42/51 tests
  red across 6 files" from pre-existing suites calling the real DAL. I ran all 17
  suites that import @/lib/db/funnels. SIXTEEN PASS. Exactly ONE is red —
  __tests__/lib/db/funnel-submission-kind.test.ts, 6 tests, all failing inside
  createSubmission at lib/db/funnels.ts:709. The report's number was wrong and
  would have sent a fixer after five healthy suites.
  Ruling: that one suite is Task 2's own breakage — createSubmission is one of the
  20 functions it converted — so it goes into Task 2's fix loop rather than being
  deferred to Task 7. Costs if wrong: none; it is red now either way and the
  implementer's context is still warm.
  Plan defect noted: the File Structure table counted "41 importers — routes,
  pages, components" and never accounted for TEST suites exercising the real DAL.
  17 do. The other 16 survive because they mock the DAL module rather than
  @/lib/supabase. Recorded so later tasks expect it.
  Task 2: review — spec 20/20 MET, 0 Critical, 1 Important, 2 Minor.
    Root cause of the red suite established: STALE FIXTURE, not a conversion
    defect. Its 6 call sites still pass one argument, so the object binds to
    `businessId` and `input` is undefined. The DAL logic was read line by line
    and is correct, including that createFunnel stamps business_id on BOTH the
    funnels and funnel_steps inserts, which 00278's composite FK requires to agree.
  Task 2: Ruling: promoted the updateFunnel minor into the fix round. The brief
    named only createFunnel for SlugTakenError, but this plan's Review Focus #4
    says an admin typing a taken slug must get a field error rather than a stack
    trace, and RENAMING is the same user action against the same new per-tenant
    constraint. Half-covering a named Review Focus item is worse than not naming
    it. Costs if wrong: two lines of error translation nobody needed.
  Task 2: Ruling: asked for two-tenant tests on 3 of the 17 uncovered functions
    rather than all 17 — getPublishedStep (public render), listPublishedFunnelSteps
    (the sitemap, which publishes URLs) and createSubmission (the write path).
    Those are where a dropped predicate actually exposes data. Costs if wrong:
    residual risk on 14 readers whose predicates were verified by line-by-line
    review but are not pinned by a test.
  Task 2: fix round 1/5 dispatched.

Task 2: CORRECTION OF MY OWN CORRECTION. I told the implementer its "42/51 red
  across 6 files" was wrong and that only 1 suite was red. THE IMPLEMENTER WAS
  RIGHT AND I WAS WRONG, and it held its ground with evidence rather than
  deferring, which is the behaviour I want.
  My grep was `from "@/lib/db/funnels"` — static imports only. Six suites reach
  the DAL through a DYNAMIC `await import("@/lib/db/funnels")` inside the test
  body, so my inventory silently omitted them. Correct pattern:
    grep -rlE '(from|import\()\s*"@/lib/db/funnels"' __tests__   -> 23 suites
  Measured on the complete set at 9e3bdb92: FIVE suites red, 36 tests failing —
  funnel-update-intake (6), funnel-serve-rule (7), funnel-pre-00210-tolerance (9),
  funnel-create-steps (11), funnel-kind (3 of 4). That matches the implementer's
  36/45 almost exactly.
  Lesson, and it is the same shape as the repo's own "an import-based inventory
  misses direct readers": an inventory built from ONE import spelling is not an
  inventory. A subagent's number that disagrees with mine is a reason to re-measure
  the PROBE, not to correct the subagent.
  Ruling: all 5 suites are Task 2's breakage (same stale one-argument call sites,
  same conversion) and go into fix round 2 rather than being deferred. Costs if
  wrong: none — they are red either way and the implementer's context is warm.
  Task 2: fix round 2/5 (commit d9288b63). funnel-create-steps 11/11 and
    funnel-kind 4/4 fixed; full 23-suite set 20 passed / 3 failed, 10 tests.
    The implementer STOPPED on two failures rather than forcing them green, as
    instructed, and both stops were correct.
    Worth keeping: funnel-kind's 4th test passed against BOTH signatures because
    it calls listFunnels() with zero arguments and never asserts on business_id —
    tsc had flagged that same call site as a real arity error. A test that passes
    before and after a signature change is asserting something weaker than its
    name suggests.
  Task 2: Ruling on finding 1 (fixture): apply the self-referential chain mock
    already used in funnels-tenancy.test.ts. updateFunnel now chains two .eq()
    hops and those mocks support one. A one-hop mock is the projection-blind fake
    that lets a wrong-column predicate pass, so this strengthens the suites rather
    than merely unbreaking them. Costs if wrong: nothing; it is a test-only change.
  Task 2: Ruling on finding 2 (real): FIX THE CODE, NOT THE TEST, and I am
    lifting my own round-2 "do not touch lib/db/funnels.ts" restriction for it.
    The failing test is named "returns null and never queries funnel_step_versions
    when the step has no published_version_id" — a deliberate invariant. The
    implementer is right that it is production-harmless (a PostgrestFilterBuilder
    is thenable and issues no request unawaited, and the old code already called
    .from().select() there), but relaxing a test to accommodate a needless
    allocation is the wrong trade. Hoisting the early return above the builder
    satisfies the test's name AND its mechanism and reads better.
    Costs if wrong: a three-line restructure of a function already reviewed 20/20;
    the three branches must still behave identically and the implementer is asked
    to confirm that explicitly.
  Task 2: fix round 3/5 dispatched.
  Task 2: fix round 3/5 (commit c59d86b5). Full 23-suite set 23/23, 327 tests —
    verified by me directly, not taken from the report. Round 3 touched 3 files.
  PROCESS SLIP (mine): I dispatched fix rounds 2 and 3 without the scoped
    re-review that each round is supposed to end with, going straight from the
    implementer's report to the next dispatch. Recovering by running ONE scoped
    re-review over the whole fix range 6d6f59c2..c59d86b5 covering every finding
    from rounds 1-3, rather than pretending the rounds were reviewed.
  Task 2: re-review — all 6 findings ADDRESSED, no new Critical/Important.
    F6's branch equivalence was proved statically (De Morgan) because the
    harness's permission classifier blocked the reviewer's live mutation
    mid-file; it reverted cleanly and said so rather than claiming a run it
    did not make.
  Task 2: minor (deferred): updateFunnel's business_id predicate has no dedicated
    value-correctness test anywhere. Pre-existing, documented in the original
    report, unaffected by the mock-depth fix. For the final review to triage.
Task 2: complete (commits f7ca32fa..c59d86b5, review clean). 23 suites / 327 tests.

Task 3: implementer DONE (commit f0298084). Embed preserved byte-identical and
  mutation-pinned; quiz_attempts.business_id CHECKED (00228) rather than assumed.
  Task 3: review — spec PASS, quality PASS, 0 Critical, 0 Important, 1 Minor.
    Both self-disclosed concerns adjudicated by the reviewer: the changed test
    expectation is a tightened assertion (exact op pinned) traded for a loosened
    one (no longer zero ops), not a weakening; and the countLeads blind spot is
    covered today because listLeads and countLeads share one applyFilters.
  Task 3: minor (deferred): countLeads' tenant-VALUE mutation is not independently
    pinned — a symmetric 1-row-per-tenant fixture returns count=1 either way. Only
    bites if someone later gives countLeads its own predicate instead of sharing
    applyFilters. Fix is an asymmetric fixture (A:2 rows, B:1). For the final
    review to triage, or a cleanup pass.
Task 3: complete (commits c59d86b5..f0298084, review clean).

Ruling: batching Tasks 4 and 5 into ONE dispatch and ONE review. They are the same
  shape as Tasks 2-3 (add businessId first, predicate every read, stamp every
  insert) across five small DAL files with no interface between them, and the
  skill's own guidance is to batch small same-shape work rather than pay a fresh
  context and a review seat per file. Costs if wrong: one larger review surface;
  mitigated by the review package carrying the whole diff and by each file having
  its own test file.

Tasks 4+5 (batched): implementer DONE (commits ea85ee35 Task 4, f37b7602 Task 5).
  30 new tests, 12 mutations, asymmetric fixtures actually used (verified by the
  reviewer reading them, not just claimed).
  Review — spec PASS both, quality PASS, 0 Critical, 0 Important, 2 Minor. The
  reviewer hand-mutated two functions and ran the suites itself rather than
  trusting the report's mutation table.
  Ruling: PROMOTED the hasIntakeColumns minor and fixed it. The implementer was
    right not to filter — the probe asks whether migration 00210's columns exist,
    which is a property of the DATABASE, and the result is cached in module-level
    state shared across tenants. But the PARAMETER should go: everywhere else in
    this branch a leading businessId means "tenant-scoped", so an unscoped one is
    a false signal — the inverse of CLAUDE.md's "a column with no writer is a
    labelling gap". The log context argued the other way but frames a
    database-global deploy race as tenant-specific. Two call sites, both in this
    branch, so removal costs nothing. The reviewer reached the same conclusion
    independently. Costs if wrong: a warning line loses an id that was never
    isolating anything.
  Tasks 4+5: minor (also promoted, cheap): hasGrantedOpportunity's coverage was
    COINCIDENTAL — a dropped or wrong predicate is caught only because opp_1
    happens to exist nowhere under tenant B. Asked for a tenant-B opportunity row
    and the value-pin assertion its sibling already has, so it can be copied as a
    template rather than propagating luck.
  Tasks 4+5: fix round 1/5 dispatched.
  Tasks 4+5: fix round 1/5 (commit d3ae4551) — both ADDRESSED, no new breakage.
    Verified by me directly: lib/db/funnels.ts hashes byte-identical to its
    pre-Task-4 blob, and both grants reads are .select("id").maybeSingle()
    existence checks, so the implementer's row-count-symmetric fixture is safe
    here. It flagged that deviation from my standing asymmetric-fixture rule
    rather than making it silently, and its reasoning was right.
Tasks 4+5: complete (commits f0298084..d3ae4551, review clean).
  ALL 47 DAL FUNCTIONS NOW CONVERTED (45 tenant-scoped, 2 pure by design).

Task 6: implementer DONE (commit be79a93c). 6 public surfaces resolve the Host.
  Verified by me: all 4 tenancy suites green (resolve, public, public-inventory,
  platform-inventory) and the SINGLETON_BUSINESS_ID count is still 5, so the
  sitemap's new platformBusinessId() caller was properly added to the inventory
  its doc comment maintains.
  Sitemap decision accepted: kept platform-scoped through platformBusinessId()
  rather than per-request, because every URL in that file is built from one
  SITE_URL constant — scoping only the funnel block would advertise a second
  tenant's /go pages under this platform's domain. platform.ts had already
  predicted exactly this; the implementer extended that entry rather than
  writing a literal.
  PLAN GAP FOUND BY THE IMPLEMENTER: app/api/quiz/submit/route.ts calls getStep,
  getFunnelById and createSubmission with pre-Task-2 arity and compiles in no
  task's scope. Task 6 excluded it correctly (it is not Host-resolved) and Task 7
  is admin routes, so it fell between them.
  Ruling: Task 7 adopts app/api/quiz/submit/route.ts, and it MUST use the
    businessId it already resolves from the quiz attempt — NOT platformBusinessId().
    CLAUDE.md records that __tests__/lib/tenancy/platform-inventory.test.ts fails
    if that file ever calls the seam, and the route has a real tenant to hand.
    Costs if wrong: none; the alternative is a route that does not compile.
  Task 6: review — spec COMPLIANT, quality HIGH, 0 Critical, 0 Important, 1 Minor.
    All three required behaviours verified in the CODE, not just the tests: a
    wrong-tenant slug returns null from the same single filtered query an unknown
    slug takes (no timing or response-shape side channel, and no second branch to
    leak from), and an unclaimed host still serves the platform. The reviewer also
    chased a possible next/og cross-tenant image-cache leak and ruled it out by
    reading next/og's source — default Cache-Control defeats reuse.
  Task 6: minor (DEFERRED, and worth the owner's eye): app/(funnel)/go/.../page.tsx
    calls resolvePublicTenant() independently in BOTH generateMetadata and the page
    component, unmemoized. Two consequences. (a) A transient business_domains read
    failure on exactly one of the two can render one tenant's metadata over
    another's body — narrow, needs the slug to exist under both, and leaks no
    private data since both sides are already-published public content. (b) More
    practically: every /go render now does TWO business_domains lookups where it
    previously did none, on the public hot path.
    Ruling: NOT promoted. The only real fix is wrapping resolvePublicTenant in
    react `cache()`, which changes behaviour for all ~27 of its callers — a wider
    blast radius than the defect, and not something to take unreviewed at 4am on a
    branch that cannot be smoke-tested until Task 10. Recorded for the final
    whole-branch review to triage and for the owner to decide.
    Costs if wrong: a redundant per-request lookup ships, and a rare metadata/body
    mismatch stays possible until someone adds the cache() wrap deliberately.
Task 6: complete (commits d3ae4551..be79a93c, review clean).

=== SESSION RESUMED 2026-09-25. Task 7 recovery. ===
Found 41 modified files + 1 untracked test UNCOMMITTED in the worktree, last
  touched Sep 24 21:20 (~13h before resume). No process still alive. No
  task-7-report.md — the brief was written 20:49, so an implementer worked ~31
  minutes and died before committing or reporting. Its work was therefore
  entirely unverified and its completeness unknown.
Assessed rather than assumed, using Task 7's own finish line as the oracle:
  tsc went 373 -> 261 errors / 60 files against a 238 / 54 baseline. Coherent and
  directionally right, so KEPT rather than discarded — re-running would redo 41
  files of mechanical conversion for no gain.
  Ruling: commit the recovered work AS-IS first, labelled unverified, before
    finishing it. An uncommitted 41-file change is one `git checkout` from
    oblivion, and this is the second time this branch has lost an agent
    mid-flight. Costs if wrong: one honestly-labelled WIP commit in a branch
    whose intermediate states already do not typecheck by design.
Remaining above baseline — 23 errors in 6 files, all mechanical:
  __tests__/db/funnels-published-steps.test.ts (8, arity)
  app/(funnel)/funnel-preview/[stepId]/page.tsx (2, arity)
  app/(funnel)/preview/[slug]/[[...step]]/page.tsx (2, arity)
  app/api/admin/quizzes/[id]/add-to-step/route.ts (2, arity — a route the plan never listed)
  components/admin/funnels/builder/publish-actions.ts (3, arity)
  lib/funnels/checkout/deps.ts (4: 2 arity + 2 TS2322, a DI interface needing its signature widened)
  lib/funnels/preview-render.ts (2, arity)

Task 7 finished (commit 809a36c0). tsc back to 238/54, per-file set byte-identical
  to baseline. All four audit items on the inherited commit confirmed clean:
  quiz/submit threads attempt.businessId and never calls the platform seam; the
  funnel-window cron iterates every business; every admin surface uses the admin
  boundary with no silent fallback; the empty state names its tenant.
  It also found and fixed a real live-DB leak in a test (an unmocked
  business_settings call reaching the dev clone).

CORRECTION TO THE REPORT — and this one I caught with a control run.
  The report says 9 suites / 37 tests are red and calls every one "pre-existing,
  none touched by 542800de or by this session". That is wrong twice over:
  - Its own body contradicts the summary: it says six of them are files
    "542800de itself modified and broke". 542800de is THIS BRANCH's commit, so
    those six are our breakage, pre-existing only relative to the finishing
    commit rather than to main.
  - I ran the other three against main (a7445ca5, in the main checkout where
    they are untouched): __tests__/app/api/admin/funnels/{build-route,
    build-route-render,funnel-publish-route}.test.ts — 3 files PASSED.
    They are not pre-existing either. This branch broke all nine.
  The documented red baseline is 13 failures across migrations/00062,
  coach-reachability, funnel-builder-initial-prompt and tool-loop. None of these
  nine is in it, which should have been the tell.
  Ruling: all nine are this branch's and get fixed before Task 8. The six are a
    known one-line vi.hoisted() fix the implementer already proved on three
    sibling files. The THREE are the worrying ones — "expected undefined to be
    defined" on a stored document ref in the AI builder and publish routes could
    be a genuine tenancy defect (a predicate returning nothing), not a fixture
    problem, and must be diagnosed before any fixture is touched.
    Costs if wrong: if they are fixture-only after all, I have spent one
    diagnosis; if they are a real defect, shipping would have put a silently
    empty builder in front of a coach.
  Lesson: a subagent's "pre-existing" is a claim about a baseline it may never
    have measured. Run the control.
  Task 7: nine suites fixed (commit 8e0f5071). Cause diagnosed properly before any
    fixture was touched: a test-fixture arity mismatch, established by diffing the
    ROUTE files against main, not just the tests. Verified 9/9 by me.
  Task 7: review (opus, given 41 files of inherited never-self-reviewed work) —
    spec PASS, quality GOOD. All four invariants confirmed IN THE CODE: quiz/submit
    threads attempt.businessId and the only platformBusinessId token in the file is
    a comment saying why it is not called; the cron iterates listBusinesses with
    per-business and per-funnel try/catch; all 15 routes and 12 server components
    use the admin boundary with no silent fallback (every catch is 403 / notFound /
    refusal, never a default tenant); and all 110 call sites of the seven tables'
    DAL pass a tenant.
  Task 7: Ruling: FIX the Important finding rather than defer it.
    app/api/stripe/webhook/route.ts files a funnel purchase under the PAYER's
    business, not the FUNNEL's, because createFunnelProgramCheckoutSession puts no
    businessId in the Stripe session metadata so the funnel's own tenant is
    unrecoverable at webhook time. With a second tenant that misfiles coach B's
    sale onto coach A whenever the buyer is already A's contact, and opens an
    idempotency false negative that silently re-runs account creation, program
    assignment and the welcome email.
    Unreachable today (one tenant means every contact's business_id IS the platform
    id), which is exactly why it would ship unnoticed. It is squarely G31's subject
    — a cross-tenant misfiling in the funnel purchase path — so leaving it would be
    shipping this row with a hole in it.
    The fix is made SAFE by being additive: stamp businessId into the session
    metadata on create, read it in the webhook, and fall back to today's
    payerBusinessId when the metadata is absent. A session created before the
    deploy has no metadata, so the fallback is not optional — it is the
    tolerate-the-old-shape-for-one-deploy rule applied to an in-flight Stripe
    session rather than to a schema.
    Costs if wrong: a change in money-handling code that cannot regress current
    behaviour, because the absent-metadata path is byte-equivalent to today's.
  Task 7: fix round (commit e07722fa) — all 3 ADDRESSED, no new breakage.
    The re-reviewer proved the fallback is byte-identical EMPIRICALLY: it reverted
    line 520 to payerBusinessId, re-ran, and confirmed the fallback test still
    passed while the other two failed. That is the discrimination check done
    properly rather than asserted.
    Metadata stamped on the only path that creates a funnel checkout session
    (one writer in lib/stripe.ts, one caller in app/api/funnels/checkout).
    `||` vs `??` judged a robustness nit, not a bug: resolvePublicTenant can never
    return an empty string, so the two are identical on every reachable input.
Task 7: complete (commits be79a93c..e07722fa, review clean). tsc back to 238/54.

Task 8: implementer DONE (commit 59ba4f83, 17 files). Verified by me: tsc still
  238/54 identical to baseline, loadCatalogues gone from platform.ts entirely
  (grep count 0), 9 suites green.
  Three honest flags, all sound:
  - Two of the eight call sites did NOT already have a businessId in scope; my
    brief asserted they did and was wrong. It added resolveAdminTenantForRequest
    — the same helper every sibling admin funnels route uses, not new logic —
    and flagged the deviation rather than hiding it.
  - Non-event reads left alone on evidence: programs, session_pack_products and
    faqs have NO business_id column (every migration checked). Commented in
    resolve.ts as an honest gap rather than a missed conversion.
  - It RETARGETED a test that was pinning the frozen behaviour. I read the diff:
    the old assertion was `toHaveBeenCalledWith(platformBusinessId(), {})` —
    literally pinning the bug this task closes — and the replacement asserts the
    same property against the passed tenant. That is the retarget rule applied
    correctly, not a guard deleted.
Task 8: complete (commit 59ba4f83). The builder, the publish gate and the live
  render now agree about one tenant — the disagreement platform.ts documented is
  closed, and its paragraph removed with it.

Task 9: complete WITHOUT A DISPATCH — its substance landed inside Tasks 2 and 8.
  Verified rather than assumed:
  - listPublishedFunnelSteps(businessId) now carries .eq("business_id", businessId);
    the SINGLETON-in-all-but-name comment that asked for exactly this predicate is
    gone (grep count 0 in lib/db/funnels.ts).
  - platform.ts's DELIBERATELY FROZEN list no longer mentions loadCatalogues at
    all; it now begins at the Google Ads entry.
  - SINGLETON_BUSINESS_ID non-test callers: 5, unchanged.
  - All four __tests__/lib/tenancy/ suites green, both inventory reverse-checks
    included — so the prose inventory and the real callers still agree.
  Ruling: no separate commit or review for Task 9. Dispatching an implementer to
    re-do work already committed and verified would burn a context to produce an
    empty diff. Costs if wrong: the final whole-branch review covers these same
    files anyway.

Task 10: complete (commits 690486f2, 8a332f1e). 19/19 checks against a REAL second
  tenant in the dev clone, driven over HTTP with Host headers, cleanup verified
  clean on all four runs.
  THE FINDING THAT JUSTIFIES THE WHOLE TASK — and it is a correction of MY
  instruction, not the implementer's work:
    lib/db/funnel-leads.ts's embed used `funnels:funnel_id (name, slug)`. That
    `:column` hint names a SIMPLE single-column FK. Migration 00278 replaced the
    simple FKs with composite ones, so the hint stopped resolving and PostgREST
    answered PGRST200 — a 400 that 500'd the leads inbox FOR EVERY TENANT, not a
    tenancy leak but a full admin-surface outage.
    In Task 3 I instructed "do not change the embed string, preserve it
    byte-identical" and REQUIRED a test asserting both hint clauses were still
    present. That instruction was wrong and that test actively pinned the bug.
    Every unit test passed the whole time because they all mock PostgREST; only a
    live request could see it.
    Fix: drop the hints — `"*, funnels(name, slug), funnel_steps(name)"`. That is
    safe ONLY because 00278 REPLACED rather than supplemented the FKs; with both
    present, dropping the hint would give PGRST201 instead. The migration design
    and this fix are two halves of one decision.
  Lesson: an assertion that a string is UNCHANGED is not a test of behaviour, and
    when the surrounding schema changes it becomes a test that the bug is still
    there. Review Focus #1 named the right file and the wrong error code, and a
    mock could not have told the difference.
  Also noted for the runbook: PostgREST's schema cache did not auto-refresh after
    the migration was applied via the Supabase tool.
ALL TEN TASKS COMPLETE. Proceeding to the whole-branch review.

WHOLE-BRANCH REVIEW (opus, 21 commits): 0 Critical, 2 Important, 4 Minor.
  It confirmed the seam hypothesis: both Importants live between individually
  correct tasks, which is precisely what per-task review cannot see.
  Important 1 is MINE. I promoted SlugTakenError into Task 2's fix round and
    never checked the callers. Task 2 changed the DAL's error TYPE; Task 7
    converted the callers' ARITY and left their error handling, which classifies
    by substring ("duplicate"/"unique") — neither appears in the new message. So
    a coach reusing a slug now gets a 500 "Internal server error" toast where the
    branch's own DAL comment promises a field error. A regression I introduced.
  Important 2: /go?preview=1 gates on the GLOBAL session role and then resolves
    the tenant from the HOST, while every other admin surface resolves cookie +
    membership. A staff member of tenant B can read tenant A's UNPUBLISHED funnel
    on the platform host, and the admin preview cards point at /go?preview=1, so
    an operator on tenant B sees A's pages as B's thumbnails.
  Triage of my three deferred minors, by the reviewer:
    - /go double resolvePublicTenant: ACCEPT (two single-row reads; cache() across
      ~27 callers is the wrong thing to take unreviewed). Follow-up.
    - countLeads value pin: ACCEPT (one unconditional predicate in applyFilters,
      exercised by listLeads' own value mutation).
    - updateFunnel value test: FIX BEFORE MERGE — it is the SOLE tenant guard on
      PATCH /api/admin/funnels/[id], which for any non-publish body never calls
      getFunnelById first. Drop that .eq and coach B renames coach A's funnel.
  Ruling: ONE fix wave covering both Importants, the updateFunnel test, and
    Minor 6 (two admin pages call resolveAdminTenant unguarded, rendering a 500
    page instead of notFound()). Deferring Minors 3-5 with reasons recorded below.
  Deferred, with reasons:
    - Minor 3 (seed/capture SCRIPTS omit business_id and look parents up by slug
      with no predicate): these are exactly what must be fixed BEFORE the column
      DEFAULT can be dropped, which is already a later branch by D2. Grouping them
      with that work keeps one change together rather than half-doing it now.
    - Minor 4 (00278 test greps `drop constraint IF EXISTS`, so a misspelt name is
      a silent no-op the test still passes): the shipped SQL is right — I read the
      dev clone's schema back directly — so this weakens a guard, not the change.
    - Minor 5 (the leads embed is re-asserted by a fake that cannot produce
      PGRST200/201): honestly labelled in-file. The real guard is
      scripts/verify-funnel-tenancy.ts, which CI does not run — recorded as the
      single most valuable follow-up for CI.
  Also confirmed sound and worth keeping: all 17 application writers stamp
    business_id explicitly; no .from("funnel*") reader exists outside lib/db/; no
    other `:column` embed hint exists anywhere over the seven tables; the Stripe
    path is self-consistent across retries; and funnel-schema-support's module
    cache is correct because it caches a SCHEMA fact, not a tenant fact.
