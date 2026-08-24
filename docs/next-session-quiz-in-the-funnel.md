# Next session — put the quiz inside its funnel

Paste the block below as the first message of a new session. Everything under
"Context you do not need to rediscover" was measured on 2026-08-24, not guessed.

---

## The prompt

> Finish putting the Athlete Quiz inside the funnel that uses it. Two pieces,
> both already decided — don't re-open the design:
>
> **1. The quiz is edited from its funnel, not from a separate sidebar screen.**
> Today `/admin/funnels/quizzes` is its own top-level item. A funnel that uses a
> quiz should surface that quiz on the funnel's own page, so you reach it from
> the thing it belongs to.
>
> **2. A completed quiz becomes a lead on that funnel.** Today it doesn't. The
> Leads screen reads `funnel_submissions`; a finished quiz writes a contact, a
> consent row, a timeline event and a pipeline card, but no submission — so
> somebody who completes the quiz never appears under that funnel's Leads.
> Quiz completions should show there alongside form fills, distinguishable from
> them.
>
> Read `docs/next-session-quiz-in-the-funnel.md` first — it has the measured
> facts, the traps, and the verification bar. Follow the repo's normal workflow:
> plan it, TDD it, mutate every test before believing it, and verify by driving
> the real app rather than by asserting it works.

---

## Context you do not need to rediscover

### Where things stand

`main` is at `1d2cd052`, pushed and deployed. Two merges landed on 2026-08-24
evening: the Athlete Quiz plus the quiz funnel creator (`ff6f64bd`, with
migrations `00228`/`00229` applied to production), and chat markdown
(`b3ae5950`). The quiz page itself was then fixed (`1d2cd052`) — see below.

A working quiz exists on the **dev copy** at `/go/athlete-quiz`, published,
running the real `rpi_athlete_quiz` (32 questions, 4 branches, 4 tiers).
Production has the tables but **no quiz data** — both seed scripts refuse any
project that is not the dev copy.

### The two facts that make this tractable

1. **The island already has its funnel.** `FunnelRenderContext` in
   `components/funnels/islands/index.tsx` carries `funnelId`, `funnelSlug`,
   `stepId`, `stepSlug`, `isPreview` and `testRun` to every island, `QuizIsland`
   included. It simply never passes them on.
2. **The quiz submit does not.** `app/api/quiz/submit/route.ts` accepts
   `quizId`, `attemptId`, `answers`, name/email/phone, consent, `website`,
   `elapsedMs`, `attributionSessionId` — and nothing about the funnel.

So the chain to build is: `QuizIsland` → `QuizRunner` → the submit body → a
`funnel_submissions` write. `FunnelForm.tsx` already does exactly this and is
the precedent to copy — it takes `funnelId`/`stepId` as props and posts them.

### Things that will bite you

- **`testRun` must not write.** The full-screen draft preview (`/preview/<slug>`)
  sets `FunnelRenderContext.testRun`, and the rule for that surface is zero
  writes — no submission, no lead, no contact. `/api/quiz/preview-submit`
  already exists for it. Whatever you add to the live submit must not appear on
  the preview path. There is a test asserting the preview route's source
  contains no write path; keep it true.
- **The stylesheet is baked into published version rows.** A change to
  `lib/funnels/sections/styles.ts` reaches a live page only when that funnel is
  re-published. There is no cache to blame.
- **The builder hides Publish when the DOCUMENT is unchanged**, so a CSS-only
  change cannot be published through the button. `POST
  /api/admin/funnels/<id>/publish` takes no body and does the job.
- **The publish button's label changes**: "Publish funnel" on a draft funnel,
  plain "Publish" once it is live. Match both.
- **Playwright clicks before hydration.** The builder's Publish renders enabled
  before React attaches its handler, so an early click is a real click that does
  nothing and Playwright reports success. Wait ~5s after `networkidle`, then
  assert the OUTCOME in the database rather than trusting the click.
- **`SECTION_CSS` blocks are template literals.** A backtick inside a comment
  closes the string and breaks the module. Every existing comment in that file
  writes bare class names and uses `--` instead of an em dash for this reason.
- **Do not commit the peer session's uncommitted work.** The main checkout
  carries ~15 files from another session: a server-side "way forward" CTA
  (`tools.ts`, `route.ts`, `prompt.ts`, `ask.test.ts`) and a legal/A2P bundle
  (`docs/compliance/*`, `.env.example`, `scripts/publish-*.mjs`). Several of
  those publish production legal pages or act on the Twilio campaign. Stage by
  feature; check each file's diff actually concerns what you were asked for.

### What was just fixed, so you don't undo it

`lib/funnels/quiz-funnel-doc.ts` no longer emits a hero. Measured before the
fix, at 1440x900: the page was 1038px in a 900px viewport, so the quiz was
already on screen; the hero's "Start the quiz" scrolled 138px and started
nothing, because starting is a state inside the island that no anchor can reach.
A test now asserts the document contains **no CTA at all** — the decoy is
impossible by construction. Do not add a hero back.

The quiz section is a card on a `muted` band that carries the fold
(`min-height: 78vh; display: grid; align-content: center` — grid, not flex: a
flex section is a row and put the card beside the empty heading block).

### Still open on the look, if asked

The page is still lighter than it should be. A dark treatment needs the quiz's
own controls to inherit the section tone: `.djp-quiz-input`, `.djp-quiz-option`
and the shared `.djp-control` rules set `color: var(--foreground)` and
`background: var(--background)` outright, so `tone: "dark"` repaints the band
and leaves the answers unreadable. That is shared CSS the **form island** uses
too, so it needs its own change and its own contrast tests —
`render.test.ts` already has a tone-contrast suite to extend.

### The verification bar in this repo

- `npx tsc --noEmit` must stay at **exactly 251** errors. A falling count hides
  new errors too.
- **14 tests are red on `main` and none are yours**: SetupPanel (7),
  report-shell (5), receipt-row-editor (1), funnel-island-traits (1). Twelve of
  them are one missing line in `vitest.config`:
  `environmentOptions: { jsdom: { url: "http://localhost:3050" } }`.
- Targeted runs only — `npx vitest run <path>`. Not the full suite.
- `npm run lint` does not work (Next 16 removed `next lint`). `tsc --noEmit`
  plus `npm run build` is the whole gate.
- **Never run `npm run build` while `npm run dev` is running** — they share
  `.next`, and a screenshot taken during a build photographs a stale bundle.
  That cost a run on 2026-08-24: a fix that was already committed appeared
  broken.
- Mutate every test before believing it, and check the mutation's diff does what
  its label says — editing a comment is not a mutation.
- Screenshots must be the real app on the real route, annotations burned into
  the PNG. `scripts/capture-quiz-funnel-creator.ts` is a working harness to copy:
  it refuses any project but the dev copy and asserts the funnel actually went
  live, because the first run of it produced a beautifully annotated 404.

### Open decisions that are NOT yours

These are Darren's and should not be invented: the quiz's scoring (every weight
and tier band, currently reconstructed defaults), the four archetype sequences'
copy (seeded `draft`), the tier CTAs, and whether the new quiz runs in parallel
with GoHighLevel or replaces it.
