# The Athlete Quiz, rebuilt in the funnel builder — handover

**Branch:** `feat/athlete-quiz`, based on `ec3acb16`. **Not pushed, not merged, not
deployed.** Everything below is committed and green, waiting on a go-ahead.

**Date:** 2026-08-24
**Spec:** `docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md`
**Plan:** `docs/superpowers/plans/2026-08-23-athlete-quiz-funnel.md`
**Screens:** `screenshots/athlete-quiz/index.html`

---

## What it does

A visitor answers a router question, is sorted into one of four archetypes, walks
that archetype's questions, hands over their details, and gets a scored readout.
The score opens a pipeline card and emails Darren when it is Red or Orange, and
enrols the contact into one of four archetype sequences.

It is a **funnel block**, not a bespoke page: `quiz` is the seventh island and
the eleventh section kind, so it drops onto any funnel page at `/go/<slug>`.

This is the last piece the Lead Engine status report named as blocking the
GoHighLevel switch-over.

---

## Three steps to serve a request

| # | Step | Why |
|---|---|---|
| 1 | **Seed a quiz** — `npx tsx scripts/seed-athlete-quiz.ts .env.prod --execute --allow-non-clone` | The RPI quiz as 32 questions and 129 options. Additive and idempotent: it never overwrites an edit. |
| 2 | **Activate it** in `/admin/funnels/quizzes` | It cannot activate until `quizGate` passes. The blockers are listed on screen. |
| 3 | **Put the block on a page** and publish | The publish gate refuses a page whose quiz is missing, draft, or cannot score. |

Nothing else is required. There is no feature flag and no env var: a quiz that is
not active renders nothing, and a page with no quiz block is unaffected.

---

## What is enforced, and how

Each row is a structural control, and each was proven by removing it and watching
a test go red.

| Rule | What actually enforces it |
|---|---|
| The browser cannot forge a result | It is never given a weight. `publicQuizDefinition` builds the public object field by field — never clone-and-delete — and a test walks the whole serialised object for banned keys AND banned values, so a rename leaks nothing either |
| A `score` in the request body is ignored | The submit route never reads one and the schema never declares it, so Zod strips it before the handler runs |
| A visitor cannot choose their own archetype | The branch is derived from the router ANSWER, server-side. The request body has nowhere to name one |
| A forged option id scores nothing AND stores nothing | `scoreQuiz` ignores it; `sanitiseAnswers` keeps it out of `quiz_attempts.answers`, which an operator reads and a report counts |
| A page cannot collect answers it cannot score | `unresolvedQuizzes` is a publish BLOCKER — missing, not active, or gate-failed |
| A disabled Activate button is not the control | The save route runs the same `quizGate`, against the quiz AS IT WILL BE after the save |
| A preview writes nothing | Its own route, admin/staff only, and a test reads the source for twelve write paths |
| "The alert was sent" means somebody was told | `sendQuizAlert` returns real delivery and the attempt records `failed` when the mailer is unconfigured |
| Red opens a card, Green does not | `decideMove` owns it. An unknown tier is not actionable — a renamed band goes quiet rather than guessing |

---

## What the screenshots found that the tests did not

All three were found by opening a PNG under a fully green suite. Unit tests
written from a guard's own perspective see the true positives; driving the real
app is what surfaces the false ones.

1. **The question counter promised a total it could not know.** Before the router
   is answered the walk is the six shared questions, so it read "Question 1 of 6";
   one click later, "Question 2 of 13". Every test asserted *which* question was
   shown and none looked at the counter. It now shows no total until the branch
   is known.
2. **A Red result had no call to action.** The most urgent tier gave the athlete
   nowhere to go, because the seed left `ctaLabel` null on all four tiers. Every
   tier now carries one.
3. **"Active" and "cannot be activated yet" appeared side by side.** Editing a
   live quiz is deliberately allowed — blocking it would make a broken one
   impossible to repair — so the editor now says the quiz is LIVE and these
   changes would break it for visitors.

---

## Five things you should know

**1. Every number in the seeded quiz is invented.** The GHL export contains the
201 custom-field definitions, so the prompts and option labels are verbatim. All
twelve quiz workflows exported as bare metadata — **the weights, the tier cutoffs
and the routing rules are gone.** What is seeded is a documented, defensible
default, marked by `SEED_MARKER` so the list and the editor both say so on
screen. Correcting them is Darren's, and the marker clears when he saves.

**2. The plan's own test could not fail.** It specified "a perfect walk scores
100" to catch a weight typo. That is tautological — the best walk picks each
question's max-weight option and `maxScore` sums those same weights, so it is
`max/max` by construction. Replaced by a test asserting the 3/2/1/0 ladder
directly, which is the only thing that kills a `3→2` typo.

**3. The design was wrong about how an island reaches a page.** It says adding
`quiz` to `ISLAND_NAMES` "offers it in the builder automatically". It does not:
`reassemble` builds page HTML only from `doc.sections`, so an island with no
section kind emitting it can never appear. `quiz` is now the eleventh section
kind. Note the union has NO exhaustiveness check — `sectionSchema` is a
`z.discriminatedUnion` over an array literal, so omitting a member compiles
clean and fails at runtime. Every other per-kind table is a `Record<SectionKind, …>`
and caught its own omission at compile time.

**4. Editing a live quiz can break it.** The gate blocks activation, not editing —
that is deliberate, since blocking edits would make a broken quiz unfixable. The
protection is the wording in the editor, not a refusal.

**5. Four sequences are seeded as drafts with placeholder copy**, and every body
says "PLACEHOLDER COPY — not reviewed" in its first line, so a flip made without
a copy pass is visible in the inbox rather than only in a migration comment.

---

## Found in passing — not this branch's to fix

1. **The AI page-builder prompt is over its size ceiling, and was before this
   branch.** `prompt.test.ts` asserts `SECTION_BUILDER_BLOCK_A` stays under
   17,000 characters; at this branch's base it is **17,033** with ten kinds.
   Adding an eleventh cannot get under it. The quiz description is written short
   for that reason, but the block now sits at 17,440. Compacting prose I did not
   author is a separate change.
2. **`funnel-island-traits.test.ts` has one pre-existing failure** (`form.eventId`),
   confirmed at base by stashing. The plan's "pre-existing failures" note omits
   both this and the prompt ceiling; the Stage 3 handover had the first one right.
3. **`@dnd-kit` is not used by the funnel step builder**, though the plan cites it
   as precedent. Question reordering uses buttons instead — keyboard-operable for
   free, and directly testable.
4. **`saveQuizDefinition` updates only.** Adding and removing questions through
   the editor is not built; it brings its own ordering and orphan problems, and a
   half-built version would let a save silently drop an option a live page shows.

---

## Open for Darren

1. **The scoring.** Every weight and every band. This is the one that matters.
2. **The four sequences' copy**, then flipping them from draft.
3. **Whether the quiz replaces the GHL one now or runs in parallel.** The
   switch-over is parallel-run then disable, not a cutover.
4. **The tier CTAs** — currently `/contact` for Red and Orange, `/online` for
   Yellow, `/assessment` for Green.
5. **The Rotational Reboot mini-quiz** is a SECOND quiz, buildable in the editor
   with no new code. It is deliberately not seeded: it is a separate product
   funnel and seeding it uninvited would put a quiz on the list nobody asked for.

---

## Verification

- **Targeted suites across everything touched: green.** The quiz suites alone are
  ~150 tests; the funnel, lead-engine, component and API suites all pass.
- **`npx tsc --noEmit` — 251, exactly the baseline** measured on this branch's
  base, with zero errors in any quiz file. The one error Task 7 deliberately
  created (a non-exhaustive island switch) is closed.
- **`npm run build` — green**, with `/admin/funnels/quizzes`,
  `/admin/funnels/quizzes/[id]`, `/api/quiz/progress`, `/api/quiz/submit` and
  `/api/quiz/preview-submit` all present.
- **Migrations `00228` and `00229` applied to the dev clone** and read back.
- **The quiz was seeded, published and driven end to end** at `/go/athlete-quiz`.
  Read back through the DAL it re-passes its gate, the router resolves to all four
  branches, and every branch runs 0 (red) to 100 (green) over maxima of 21, 17,
  18 and 12 — which is precisely why the score normalises rather than totalling.
- **The served page was checked for leaks by hand**: `weight`, `minScore`,
  `maxScore`, `profileId`, `seedMarker`, the profile keys and the tier copy are
  all absent from the HTML. `routesToBranchId` is present, as designed.
- **Nine annotated screenshots**, driven through the real app on the real routes.
- **Pre-existing failures, confirmed identical at base:** `prompt.test.ts` size
  ceiling (1) and `funnel-island-traits.test.ts` (1).

**Every test in this branch was mutated before it was believed** — roughly 90
mutations across scoring, the gate, the public shape, the seed, the section kind,
the publish gate, all three API routes, the pipeline rule, the alert, the runner,
the list and the editor. Four survived and are recorded as equivalent mutants or
as gaps that were then closed with a new test.
