# Creating a quiz funnel from the funnel creator — design

**Date:** 2026-08-24
**Status:** approach and both scope decisions approved in chat; §§1–8 written
under the autonomous trigger ("yes do it now goodnight") and flagged for review
on return.
**Branch:** `feat/quiz-funnel-creator`, cut from `feat/athlete-quiz` at
`c0c49c51`.
**Parent:** `docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md`
**Supersedes nothing.** It closes two items that spec's own handover left open.

---

## 0. Why this exists

The Athlete Quiz was rebuilt as a funnel citizen: a `quiz` section kind in the
registry, an island, a renderer, a publish gate, a scoring engine, an admin
editor, and a real published page at `/go/athlete-quiz`. Everything except the
one place an owner would actually go to make one.

`docs/athlete-quiz-handover.md` names both halves of the gap itself:

> **5. A button for `add-to-step`.** The route exists and is tested; nothing in
> the admin calls it yet. […] Worth pairing with the broader gap it exposed:
> this app has no add-a-section UI for ANY kind.

> **4. `saveQuizDefinition` updates only.** Adding and removing questions
> through the editor is not built; it brings its own ordering and orphan
> problems, and a half-built version would let a save silently drop an option a
> live page shows.

So today a quiz funnel can be brought into existence exactly two ways: run
`scripts/seed-athlete-quiz-funnel.ts` against the dev clone, or `curl` the
`add-to-step` endpoint. Neither is a product. And a second quiz cannot be made
at all — `lib/db/quizzes.ts` has `getQuizDefinition`, `listQuizzes` and
`saveQuizDefinition`, and no `createQuiz`.

The handover's open item 6 says the Rotational Reboot mini-quiz is "a SECOND
quiz, buildable in the editor with no new code." **That claim is wrong**, and
finding out why is what this spec is for: with no create path and an
update-only save, the editor cannot bring a second quiz into being or give it
a single question.

### The two decisions taken in chat

1. **Picking "Quiz" clones a whole working quiz under a new name** — router,
   branches, questions, options, tiers, profiles — rather than making a blank
   shell. You get a quiz funnel that already passes its gate, then rewrite the
   copy into what you actually meant.
2. **The editor learns to add and delete questions and options.** Without it a
   clone is a quiz you can reword but not reshape, which is not a quiz you own.

---

## 1. What the owner does

`/admin/funnels` → **New funnel** → template **Run a quiz**.

The dialog asks what every template asks (name, URL, audience) plus one new
control: **Copy questions from**, a picker whose first and default entry is the
built-in Athlete Quiz blueprint, followed by any quiz already in the database.

On **Create**:

1. A new quiz is inserted, named after the funnel, cloned from the chosen
   source, `status: "draft"`.
2. A new funnel is inserted with one step, `index`, whose page is already
   written: hero → quiz → footer, the quiz section pointing at the new quiz's
   id.
3. The owner lands in **the quiz editor**, not the page builder. The copy in
   the questions is what needs changing first; the page around it is three
   sections that already read correctly.

From there the existing flow takes over unchanged: edit, activate (the gate
runs), publish the funnel, and the quiz answers at `/go/<slug>`.

### Why the editor and not the page builder

Every other template drops the owner on a blank step for the AI page builder to
fill. A quiz funnel arrives with its page already written, so the builder has
nothing to do that matters. What is unwritten is the twelve questions, and
those are not the builder's to write — `quizDef.description` in the section
registry tells the model in capitals never to author a `quizId`, and the same
reasoning applies to the quiz's contents.

---

## 2. The funnel template

A seventh entry in `FUNNEL_TEMPLATES` (`lib/funnels/templates.ts`):

```ts
{
  value: "quiz",
  label: "Run a quiz",
  hint: "Questions, a score, a routed result",
  steps: [{ name: "Quiz", slug: ENTRY_STEP_SLUG, goal: null }],
  asks: ["audience", "quiz"],
  offerKind: null,
}
```

**One step, not three.** The intro, the gate and the result are all states of
the quiz island inside the one page — `QuizRunner` walks them client-side. A
`thank-you` step would be a page the visitor never reaches.

**`goal: null`, and that is not an oversight.** `FUNNEL_GOALS` is documented as
a list where "every value except `leads` names a CTA target
`lib/funnels/sections/registry.ts` already resolves". A quiz is not a CTA
target, so adding `quiz` to `FunnelGoal` would put a value in an enum whose
whole contract is that it resolves to something. The step's job is expressed
where it belongs: in the `quiz` section written onto its page.

**`asks: [..., "quiz"]`** adds a fifth member to `TemplateAsk`. That array is
already the single mechanism deciding which fields the dialog renders AND which
fields `createFunnelSchema` accepts, so the picker and the server rule stay one
statement.

**No `notify`.** The Red/Orange operator alert is sent by
`lib/quizzes/alert.ts` to `settings.reply_to` from business settings, not to a
funnel's `notify_emails`. Asking for lead recipients here would store an
address nothing on the quiz path reads — the exact failure the template
docblock was written to prevent.

### `quiz` is the first REQUIRED ask

Every existing ask is optional: an event funnel with no dates is a funnel
someone will date later. A quiz funnel with no quiz is different — the section
would carry `quizId: ""`, which fails `quizIslandSchema` at publish, so the
owner would create a funnel that cannot go live and only find out at the end.

The wire shape is one field, because the quiz's name is not a second question:

```ts
quiz: { copyFrom: "builtin:rpi" } | { copyFrom: "<uuid>" }
```

The clone is named after the funnel. Asking for a separate quiz name would be
asking the owner to name the same thing twice at the moment they have the least
reason to distinguish them, and the name is editable in both places afterwards.

So `createFunnelSchema` gains both directions:

- a `quiz` payload on a template that does not ask for it → refused, like every
  other conditional field;
- **the `quiz` template with no `quiz` payload → also refused.** This is new
  behaviour with no precedent in the file, and §7 pins both halves.

---

## 3. `createQuizFrom` — the missing create path

```ts
// lib/db/quizzes.ts
export async function createQuizFrom(input: {
  source: QuizDefinition
  name: string
}): Promise<{ id: string; key: string }>
```

**It takes a `QuizDefinition`, not a source id.** That one choice makes the same
function serve both sources the picker offers:

- an existing quiz — `getQuizDefinition(uuid)`
- the built-in blueprint — `toDefinition(RPI_ATHLETE_QUIZ)`, which
  `lib/quizzes/seed/rpi-athlete-quiz.ts` already exports for its gate test

It also keeps the function honest about what it is: an inserter of a definition,
with no opinion about where the definition came from and no database read of
its own to get it.

### The key

`quizzes` carries `UNIQUE (business_id, key)`. The clone's key is
`slugify(name)`, suffixed `-2`, `-3`, … until it does not collide. Child keys
(`quiz_branches.key`, `quiz_tiers.key`, `quiz_profiles.key`) are unique per
quiz, so the clone keeps them verbatim.

### The remapping is the whole job

Six inserts in dependency order, each building an old-id → new-id map the next
one reads:

| Order | Table | Remapped from the map |
|---|---|---|
| 1 | `quizzes` | — |
| 2 | `quiz_branches` | `quiz_id` |
| 3 | `quiz_profiles` | `quiz_id` |
| 4 | `quiz_questions` | `quiz_id`, `branch_id` |
| 5 | `quiz_options` | `question_id`, `routes_to_branch_id`, `profile_id` |
| 6 | `quiz_tiers` | `quiz_id` |

A missed remap does not fail loudly. An option still routing to the **source**
quiz's branch produces a clone whose own branches are unreachable — which
`quizGate` catches with *"Branch X is unreachable: no router option routes to
it"*, but only when someone tries to activate it. §7 pins the remapping
directly rather than trusting the gate to notice.

### `seed_marker` is copied, not cleared

The marker means "these numbers were reconstructed, not recovered", and it
drives the editor's banner. A clone of the blueprint inherits invented weights
and invented tier cutoffs, so it inherits the warning. Clearing it on copy would
launder a guess into a decision. It clears the same way it always did: the first
time a human saves the quiz.

### Status is `draft`

A clone is not active, even when its source is. `quizGate` will pass on it
immediately — it is a copy of something that passes — but activation stays the
owner's deliberate act, and the funnel's own publish gate refuses a section
pointing at a non-active quiz.

---

## 4. Creation writes the entry step's page

`createFunnel` has never written `project_data`; steps are inserted empty and
the AI page builder fills them. The quiz template changes that for its one step.

### One insert, not two

The alternative — create the funnel, then `PUT` the section onto it — is two
writes from one button, and a failure on the second leaves a quiz funnel whose
page has no quiz. So `CreateFunnelInput`'s planned steps gain an optional
`projectData`, carried into the existing `funnel_steps` insert. The page and the
step are the same row and arrive together.

**`projectData` is server-derived and never client-supplied.**
`createStepPlanSchema` is untouched, so a hand-crafted POST cannot hand the
server a `SectionDoc`; the route builds it from the clone's id. A
client-supplied document would walk straight past everything the section
grammar exists to enforce.

### The document

The same three sections `scripts/seed-athlete-quiz-funnel.ts` publishes today,
because a page assembled a different way from the one that was screenshotted
proves nothing about it:

```
hero (centered)  — headline, sub, CTA anchored to the quiz section
quiz (boxed)     — quizId = the clone, submitLabel "See my result"
footer (simple)  — business name, one line, legal
```

Built by a new pure module `lib/funnels/quiz-funnel-doc.ts` so the route, the
tests and any future caller share one definition of what a quiz page is.

### Ordering and the orphan

The quiz must exist before the document can name it, so the order is: clone,
then insert the funnel. If the funnel insert throws, the route deletes the
clone it just made — a best-effort compensating delete, logged on failure. The
worst case is a draft quiz in the list that nobody asked for, which is visible
and deletable, rather than a funnel with a hole in it, which is neither.

---

## 5. The editor learns to add and delete

`saveQuizDefinition`'s docblock currently says "UPDATES ONLY — no inserts, no
deletes", and gives the reason: "a half-built version of it here would let a
save silently drop an option a live page is already showing." That reason is
right, and it is the rule this section is built around rather than an obstacle
to it.

### The rule: nothing anyone has answered is ever destroyed

Answers live in `quiz_attempts.answers`, a jsonb array of
`{questionId, optionId}` with no foreign keys — so the database will happily
let a delete orphan them. What protects a past result is that
`raw_score`, `max_score` and `score` are frozen on the attempt: a structural
edit can never rewrite what somebody was told in March. What is NOT protected is
naming: a report that maps an answer back to its prompt finds a hole.

| Action | Never answered | Answered by somebody |
|---|---|---|
| Delete a question | Deleted, with its options | **Retired** — `is_active = false` |
| Delete an option | Deleted | **Save refused**, naming it and the count |

**The asymmetry is deliberate.** A question has a retired state that the whole
system already honours — the walk skips inactive questions, and `quizGate`
ignores them, which is why an inactive question cannot block activation.
An option has no such column, and adding one to `quiz_options` for this is a
migration that buys a state nothing else understands. So an answered option is
refused instead, with a message the owner can act on: *"14 people picked this
answer. Retire the question instead of removing the answer."*

Referencing is computed by reading `answers` for this quiz's attempts and
scanning it in JS. That is a full read of one column for one quiz, which is
cheap at today's volumes and honest about being O(attempts); a jsonb GIN index
is the fix the day it stops being.

### The editor needs its own read

**Found while planning, and it silently defeats both halves above.**
`getQuizDefinition` filters out inactive questions — the `.filter((row) =>
row.is_active !== false)` inside `assemble`. The editor page reads through it.
So a question added inactive vanishes on reload, and a question retired by the
rule above vanishes with no way back. Neither failure says anything.

So `lib/db/quizzes.ts` gains `getQuizDefinitionForEditor`, identical except
that it keeps inactive questions, and the editor page and the PATCH route's
response read through it. `getQuizDefinition` is left exactly as it is: its
filter is what stops the public walk offering a retired question, and that is a
safety property, not an inconvenience.

**Named, not parameterised.** An options bag on the existing function would let
a caller on the public path reach inactive questions by forgetting an argument.

`quizGate` does its own `isActive` filtering, so handing it the wider
definition changes no verdict.

### Adding

- **A question** is appended at `max(position) + 1` globally (positions are
  global across the quiz, not per branch), on whichever branch tab is open —
  the *Everyone* tab means `branch_id = null`. It arrives **inactive**, with two
  options labelled "Option 1" and "Option 2" at weight 0.
- **An option** is appended to its question at weight 0 with no profile vote and
  no route.

**Inactive-on-arrival is what makes this safe.** A new question is invisible to
the walk and to the gate until the owner turns it on, so a half-typed question
cannot reach a visitor and cannot break a live quiz — and the moment it IS
turned on, the gate's existing "fewer than two options" and "router option
routes nowhere" blockers apply to it like any other.

### Ids come from the client

The editor generates a `crypto.randomUUID()` for each new row so it can render
it immediately and let its options reference it before any round trip. The
server inserts that id verbatim. Every insert is scoped to the quiz being
edited, exactly as every update already is, so a payload naming another quiz's
parent writes nothing.

### Payload

`QuizSaveInput` and the `PATCH /api/admin/quizzes/[id]` body both gain:

```ts
addQuestions?: { id, branchId, position, prompt, helpText, isActive,
                 options: { id, position, label, weight,
                            routesToBranchId, profileId }[] }[]
addOptions?:   { id, questionId, position, label, weight,
                 routesToBranchId, profileId }[]
deleteQuestionIds?: string[]
deleteOptionIds?:   string[]
```

Applied in the order: refuse-checks → inserts → updates → deletes. Inserts
before updates so a new row can be edited in the same save; deletes last so a
refusal costs nothing already written.

The response reports what the rule did:
`{ retiredQuestionIds: string[] }`, which the editor surfaces as *"Question 4
has answers, so it was retired rather than removed."*

### The gate still runs afterwards

Unchanged and load-bearing: the PATCH route writes the children, re-reads the
quiz, gates the result, and only then flips `status`. Structural edits go
through that same sequence, so adding a question with one option cannot produce
an active quiz that fails mid-walk.

---

## 6. What is deliberately NOT in this

- **No add-a-section palette.** The handover names it as the broader gap and it
  is a real one, but it is a builder-wide feature about every section kind, and
  it was explicitly not what was asked for here.
- **No `add-to-step` button.** Superseded for the create path — a quiz funnel
  now arrives with its quiz already on the page. The route stays as the way to
  put a quiz onto a funnel that already exists, and wiring a button to it
  remains open.
- **No adding or deleting branches, tiers or profiles.** A clone arrives with
  four branches, four tiers and five profiles, all editable. Changing how many
  there are is a bigger question — branch keys are a contract that sequences
  filter on, and tier bands must tile 0–100 with no gap — and does not block
  owning the questions.
- **No reuse of `createQuizFrom` inside `scripts/seed-athlete-quiz.ts`.** The
  script is idempotent-by-key and updates in place on re-run; the new function
  always inserts. Merging them means giving one of them the other's semantics,
  which is a refactor this work does not need.
- **No dark mode.** The admin UI is light-only by construction.

### A consequence worth naming

A clone keeps its branch keys, and the four archetype sequences enrol on those
keys. So a cloned quiz's Rebuilder result enrols into the **same** Rebuilder
sequence as the original. That is judged correct — the archetype is the
archetype, not the quiz — but it means two quiz funnels share downstream email,
and renaming a branch key in a clone silently stops its enrolment. Flagged for
Darren rather than designed around.

---

## 7. Testing

Every test below is mutated before it is believed.

**`createQuizFrom`** — the remapping, directly: a clone's options route to the
CLONE's branch ids and vote for the CLONE's profile ids, never the source's.
Plus: key collision suffixes; `seed_marker` carried across; status `draft` even
from an active source; the clone passes `quizGate` when its source does.

**The template** — the existing registry test picks up the seventh entry;
add that `quiz` asks `quiz`, asks neither `offer` nor `notify`, and has exactly
one step whose slug is `ENTRY_STEP_SLUG`.

**The validator** — both directions of the new required ask: a `quiz` payload on
the `leads` template is refused; the `quiz` template with no `quiz` payload is
refused. And the Zod-4 trap this file has already been bitten by: a `steps: []`
body must still be a clean 400, not a 500 from inside `superRefine`.

**The create route** — a quiz-template POST produces a step whose `project_data`
parses against the section grammar and contains a `quiz` section whose `quizId`
is the id of a quiz that now exists; a non-quiz POST still writes
`project_data: null`, byte for byte as before; and a funnel insert failure
deletes the clone.

**`lib/funnels/quiz-funnel-doc.ts`** — the built document validates against
`sectionDocSchema`, and its hero CTA anchors to the id the quiz section actually
carries. (A hero pointing at a section id that is not on the page is a dead
button on a live page — the failure this repo has logged before.)

**`saveQuizDefinition`** — add a question with its options in one save; add an
option to an existing question; delete an unanswered question and its options;
retire an answered question instead of deleting it; refuse a save that deletes
an answered option, having written nothing.

**The PATCH route** — the refusal is a 400 naming the option, the retirement is
reported in the response, and a structural edit still cannot produce an active
quiz that fails its gate.

**Screenshots** — the real dialog on the real route, the real editor, and the
created funnel's page at its real URL. Annotations burned into the PNGs.

---

## 8. Risks

1. **`feat/athlete-quiz` is unmerged and was being committed to tonight.** This
   branch forks it at `c0c49c51`. If that branch moves, this one rebases; if it
   is abandoned, this work goes nowhere on its own, because every line of it
   depends on the quiz subsystem existing.
2. **`createFunnel` gains a write it never had.** The non-quiz path must be
   unchanged, and §7 pins that rather than assuming it.
3. **The reference scan is O(attempts).** Named in §5 with the fix.
4. **The seeded RPI quiz and the built-in blueprint are now two ways to the same
   questions.** The picker shows both, labelled, and the built-in is the
   default — copying a pristine original is more often what is wanted than
   copying somebody's half-edited one.
