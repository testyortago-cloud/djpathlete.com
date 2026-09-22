> ## PARKED 2026-09-23 — read this before acting on anything below
>
> **The code for this design was built and is NOT merged.** It lives on the local
> branch `funnel-step-roles` (15 commits, tip `b2ea2e2e`, last touched 2026-08-17).
> This document and its sibling are on `main`; the code deliberately is not.
>
> **Why it was parked, measured 2026-09-23 rather than guessed:**
> - The branch is **961 commits behind `main`** and `git merge-tree` reports
>   **15 conflicts**.
> - Its migration is **`00211_funnel_step_role.sql`, and `00211` is already taken**
>   on `main` by `00211_lead_inquiries_click_ids.sql`. Supabase keys on the version
>   NUMBER, and 00211 is recorded as applied — so that migration would never run,
>   silently, and every code path expecting `funnel_steps.role` would ship against
>   a schema without the column.
> - **G31 rewrites the same files.** It adds `business_id` to `funnel_steps` and six
>   sibling tables plus a tenant predicate on every reader in `lib/db/funnels.ts`.
>   Landing step roles first means doing that conflict work twice.
>
> **The decision: re-implement from this plan AFTER G31, do not rebase.** The branch
> is 5,077 lines, but only **1,236 of them are code** and 28 are the migration — the
> rest is this design (2,107) and its tests (1,706). Rebuilding ~1,200 lines against a
> funnel subsystem that already has its tenancy shape is cheaper and safer than
> resolving 15 conflicts across 961 commits of drift and then re-tenanting the result.
>
> **Two things to take from the branch when you do, because it is their only copy:**
> 1. **The 1,706 lines of tests.** They encode the behaviours this spec argues for.
> 2. The migration body — the SQL is sound, only its NUMBER is wrong. Take the next
>    free number, checked against `main` AND every live worktree, because numbers
>    collide silently across sessions.
>
> **Do not delete the branch** until its tests have been harvested. Every reference
> to "migration 00211" below is stale by number and correct by content.

---

# Funnel step roles — a page is shaped by its job, not by its container

**Date:** 2026-08-16
**Status:** approved (design part 1 approved in chat; part 2 decided under
autonomous mode and recorded here)
**Branch:** `funnel-step-roles`

---

## The report

> "I noticed that landing pages examples and funnels are identical and also the
> generated pages, can you review it. Funnels are different than landing page
> prompt am i right? Like the layout of it should be different"

Both halves are true, and they have different causes. The examples are a
copy-paste; the generated pages are an architectural gap. Fixing only the first
would leave every funnel still producing landing pages.

## What is actually wrong (investigation, not theory)

### 1. `PAGE_EXAMPLES` is `FUNNEL_EXAMPLES` with the step lists removed

[`lib/funnels/examples.ts`](../../../lib/funnels/examples.ts) declares both
sets. Four of the five page examples share a name, a slug and a
**character-identical** `audience` string with their funnel counterpart:

| goal | funnel example | page example |
|---|---|---|
| leads | Free Trial Week / `free-trial-week` | same name, same slug, same audience |
| booking | Free Consult / `free-consult` | same name, same slug, same audience |
| program | Off-Season Block / `off-season-block` | same name, same slug, same audience |
| session_pack | Ten-Session Pack / `ten-session-pack` | same name, same slug, same audience |
| event | Summer Camp 2026 | Spring Skills Clinic — the only one that differs |

The file's own header says *"A page is not a one-step funnel and its examples
are not one-step funnel examples."* Four of five are exactly that.

`examples.test.ts` asserts goal coverage, length bounds and slug shape. Nothing
asserts the two sets differ, so this was never going to go red.

This matters beyond the modal: "Start from this" writes `description` into the
create dialog, and that description is the brief every step builds from.
Identical examples guarantee identical first drafts.

### 2. There is one page-builder prompt and it is a landing-page prompt

`SECTION_BUILDER_BLOCK_A` is a frozen module-level const — correctly, because it
is the Anthropic cache prefix and interpolating anything into it would be a
silent, permanent cache miss. Every page in the product gets the same 16KB, and
what that 16KB says is capture-page doctrine (`LEADGEN_RULES`):

- the `form` section goes FIRST, `variant: "split"`
- proof near the top
- six to nine sections
- one offer, one action
- *"Every page ends with a way to act — a cta, a form, or a pricing section"*

Correct for a landing page and for a funnel's entry step. Wrong for a checkout,
wrong for a booking page, actively harmful on a confirmation page.

### 3. The step's job never reaches the builder

`BuilderCatalogueInput` carries `catalogue`, `faqPageKeys`, `stepSlugs`,
`nextStepSlug` — and nothing else. `loadPageContext` in the build route never
reads `step.goal`; the string `goal` does not appear in that route at all.

The only funnel-aware thing in the whole prompt is the "Joining this page to the
next one" block, which tells the model **where to link**, not **what kind of
page to write**. That was the 2026-08-16 connections work. It solved connection.
It did not solve shape.

### 4. The one place the job appears is turn one, and only turn one

`creationPrompt()` emits `Its job: capture leads — a form that lands in your
inbox`. It is a user message, it fires once, and it only fires for a page that
has never been touched. On every later turn the model is back to believing it is
on a landing page.

### 5. Confirmation steps get nothing at all

Every template gives its confirmation step `goal: null` — correctly, since it
sells nothing. So `creationPrompt` emits no job line for it. A confirmation
page's total context is the word "Thank you" in its name, against 16KB
instructing it to open with a form and end with a call to action.

### 6. The review panel is landing-page-only too

`critics.ts` opens *"You are reviewing a landing page…"* and one of its three
lenses is `conversion`, which asks "what is this page's ONE job and does every
part serve it" and weighs *what is missing* as heavily as what is present. Run
against a confirmation page it will reliably report a missing offer, a missing
price and a missing CTA — and the reviser will act on it. Left alone, the review
stage undoes the prompt fix on the very next turn.

## Why goal + position cannot substitute for a role

The obvious cheap fix is to derive shape from `step.goal`. It does not work:

```
program template:   Offer(goal=program, pos 0)   Checkout(goal=program, pos 1)
event template:     Details(goal=event, pos 0)   Payment(goal=event, pos 2)
```

Both pairs are identical on `goal`. Only `position` separates them, and position
is exactly what changes when somebody inserts a step — silently re-roling every
page after it. Deriving from template + slug fails differently: the AI create
assist re-slugs every step it renames (`sanitiseFunnelPlan`), and `AddStepDialog`
lets an owner rename by hand.

So the role is **stored**. This is the same argument migration 00205 makes in its
own header for storing `kind` rather than deriving it from step count.

---

## The design

### §1 `lib/funnels/roles.ts` — the vocabulary

A new leaf module. Types only, no `lib/db`, no `lib/ai`, no runtime client —
same constraint `templates.ts` documents, because the step-settings control is a
client component and imports it directly.

| role | what the page is |
|---|---|
| `pitch` | Sells the offer. Hero-led, long-form, proof high. |
| `capture` | Collects details. Form-first, `split` variant. |
| `checkout` | Takes payment for something already decided on. |
| `booking` | Gets a time on the calendar. |
| `confirmation` | The visitor has already acted. Says what happens next. |

Each entry carries `value`, `label`, `hint` (for the select) and `brief` (one
line, rendered into Block B).

`FUNNEL_TEMPLATES` gains `role` per `TemplateStep`, `satisfies`-checked against
this list, so a template naming a role that does not exist is a compile error —
exactly as `goal` is today:

```
leads         capture, confirmation
program       pitch, checkout, confirmation
session_pack  pitch, checkout, confirmation
event         pitch, capture, checkout, confirmation
booking       pitch, booking, confirmation
scratch       null                    ← its whole hint is "no assumptions"
```

**`null` is a value, not a gap.** Every step created before this ships has it. It
means *"unspecified — treat this as a pitch or capture page"*, which is precisely
today's behaviour, and it is what keeps old pages opening the way they always
did. It must never be rendered as an absent field: a missing line reads to a
model as something it is free to guess at. Same reasoning `buildCatalogueBlock`
already applies to `nextStepSlug`.

**Landing pages derive, they do not store.** `kind: "page"` maps `funnel.goal` →
`leads: capture`, everything else → `pitch`. A landing page has exactly one job
and its goal *is* that job, so there is nothing to store and nothing to keep in
sync. This is also the safety property: `pitch` and `capture` are the two roles
today's rules already address, so landing-page output is unchanged **by
construction**, and that is testable.

### §2 Storage — migration 00211

```sql
ALTER TABLE public.funnel_steps
  ADD COLUMN IF NOT EXISTS role text
    CHECK (role IN ('pitch','capture','checkout','booking','confirmation'));
```

Nullable, no default, no backfill. Additive, per
`.github/workflows/apply-migrations.yml`.

**The deploy race is already solved here and the solution is reused, not
reinvented.** `hasIntakeColumns` in `lib/db/funnel-schema-support.ts` probes for
00210 with asymmetric caching (`true` forever, `false` for 30s) and fails toward
"absent". 00211 needs its own probe in that same file — a step insert writing
`role` against a database fifteen seconds behind would 500 every funnel *and*
every landing page create, because `CreatePageDialog` calls the same
`createFunnel`.

Degraded means `role` is dropped from the insert. That is a step with
`role: null`, which is today's behaviour. Not a special mode.

A separate probe rather than widening `INTAKE_PROBE_COLUMN`: 00210 and 00211 are
different migrations and can land apart, so one flag answering for both would be
wrong in whichever direction it guessed.

`updateStepSchema` gains `role`, its enum derived from the registry.

### §3 The prompt

`LEADGEN_RULES` becomes `{ roles, text }[]` — authored once, each rule naming
the roles it governs, exactly as approved. Three new rules are added
(`checkout`, `booking`, `confirmation`) and the existing six are tagged.

**The rules render into Block B, filtered to this page's role — not into Block
A, tagged.** This is a deviation from the approved sketch, made for a measured
reason found while planning:

*Block A is not a shared cache prefix.* `callAgent` puts exactly ONE
`cache_control` breakpoint, and it sits at the end of the WHOLE system string
(`lib/ai/anthropic.ts:108-118`) — there is no breakpoint between A and B.
Anthropic caching is a strict prefix match, so the cached unit is A+B, which
varies per page. Two different pages have never shared a cache read. What
freezing Block A actually buys is stability across *turns of the same page* —
which Block B has too, since every field in it is stable for a page's life.

So moving the rules from A to B costs nothing in cache terms, and buys three
things:

1. **The model never sees a rule that does not apply.** Strictly better than
   tagging, which asks it to filter — and which would have meant a confirmation
   page reading the form-first rule and being trusted to skip it.
2. **It resolves the ceiling honestly.** Block A stands at 15,954 characters
   against a hard 16,000 assertion — **46 characters of headroom**. Role
   doctrine for five roles is ~1,300 characters. It does not fit, and the only
   things large enough to cut for it are the section-kind catalogue (generated)
   and the eight op-mechanics rules (hard-won bug fixes, including the 842-char
   tone rule). Tightening prose to buy 1,300 characters would have meant
   damaging those. Moving the block instead *shrinks* Block A to ~13,900.
3. **Fewer tokens per call, not more**, since only one role's rules are sent.

Block A keeps everything else and stays one module-level const, so the `toBe`
reference-identity test and the 16k ceiling test both still hold — with room.

The three-block header comment in `prompt.ts` is corrected as part of this: it
currently claims Block A is "cached, BUILT ONCE AT MODULE LOAD" in a way that
reads as cross-page sharing, and that is not what the single breakpoint does.

**Block B** gains one section naming the role, its brief, and the rules that
govern it. Role is stable for a page's life, so Block B stays cacheable — the
same property `nextStepSlug` already has, and adding a step already perturbs
that.

For `role: null` Block B renders the `pitch` + `capture` union — today's rule
set, which is today's behaviour for a page that predates this change.

**Threading is nearly free.** `BuilderCatalogueInput` gains
`role: StepRole | null`, required rather than optional, following the reasoning
already written on `nextStepSlug`: a forgotten argument becomes a compile error
instead of a page that silently stops being told what it is. The build route
already loads the full step row (`build/route.ts:553`), so `step.role` costs zero
extra queries.

`creationPrompt` is **not** changed. Its "Its job:" line is tuned, shipped
behaviour, and with the role in Block B on every turn it is no longer carrying
the weight it was.

### §4 The review

`ReviewInput` and `runCritics` both gain `role: StepRole | null`, required.

Two changes to `critics.ts`:

1. `SHARED_ENVELOPE` stops asserting "You are reviewing a landing page" and
   states the page's role instead.
2. `CRITICS` gains `roles` per lens, and `runCritics` filters. `conversion` does
   not run on `confirmation` — there is nothing to convert, and its explicit
   instruction to weigh what is *missing* as heavily as what is present makes it
   the single most destructive lens to point at a thank-you page. `art` and
   `copy` run on everything: a flat, badly written confirmation page is still
   flat and badly written.

**`auditDoc` is role-aware too, and an earlier draft of this spec was wrong to
say otherwise.** That draft claimed the auditor's findings were "role-neutral
properties of the document" — written from the list of audit *codes* rather than
from the rules themselves. Three of them are landing-page doctrine expressed
deterministically:

| Auditor rule | Enforces | What the prompt now says |
|---|---|---|
| `proof-below-fold` (`audit.ts:475-491`) | severity **high** when the page has no proof at all | a confirmation page is told "**NO proof**" |
| `section-count` (`audit.ts:264`) | `SECTION_COUNT_MIN = 6`, every document | checkout/booking "three to five", confirmation "two to four" |
| `cta-divergence` (`audit.ts:440-452`) | ONE OFFER, every document | confirmation is never told ONE OFFER |

The reviser acts on findings, so leaving these role-blind means a correctly
built confirmation page earns a permanent high-severity finding every turn and
gets padded back into a landing page. Nothing goes red; the page just churns
forever. `audit-prompt-agreement.test.ts` names this exact failure mode in its
header as the thing it exists to prevent — and it could not catch it, because
its invariant ("the concept appears somewhere in `LEADGEN_RULES`") stopped being
equivalent to "the page was told this" the moment the rules became
role-partitioned.

So: `auditDoc(doc, role)`; section-count bounds move onto the role registry so
the prompt text and the auditor read the same numbers rather than two copies;
`proof-below-fold` and `cta-divergence` are suppressed for the roles never told
them; and the agreement test's invariant becomes per-role — for every role an
auditor rule applies to, the concept must be reachable through
`craftRulesFor(role)`.

`tone-run`, `pad-monotony`, `align-thrash` and `markdown-leak` genuinely are
role-neutral — properties of rhythm and formatting, not of what a page is for.
They keep applying to every role. The original claim was right about these four
and wrong about the other three.

### §5 The control

The role is written by the template at creation and needs to be changeable: a
step added by hand has none, the AI assist can rename a step out of recognition,
and an owner may simply disagree.

- **`AddStepDialog`** gains a role select, so a hand-added step gets one at
  birth. Defaults to unspecified.
- **`StepRail`** shows each page's role as a small label on its row — the rail
  exists to answer "is this connected?" by looking, and "what is each page for?"
  is the same question about the same object. On the row for the page currently
  open, that label is a select. One control, in context, no new surface, and no
  select on rows the owner is not working on.

The rail only renders when a funnel has more than one page, so a landing page
never sees this — correct, since its role is derived and there is nothing to set.

### §6 The examples

`PAGE_EXAMPLES` is rewritten from scratch. Not reworded — the current entries
were reworded once already and that is how they ended up sharing slugs.

Constraint the new set must satisfy, and a test will enforce: **no page example
shares a `slug`, a `name` or an `audience` with any funnel example.** A funnel
example teaches sequence; a page example teaches what one page can carry alone.
Where a funnel splits a job across pages, the page example has to make the
trade-off visible in `whyItWorks`.

---

## Testing

Every claim below is a mutant this design expects a test to kill.

| # | Test | Mutant it kills |
|---|---|---|
| 1 | Landing-page prompt for each goal is unchanged in effect | A Block A edit that silently re-shapes shipped landing pages |
| 2 | `role: null` renders as an explicit "unspecified" line, never omitted | Old pages losing all guidance because no rule names their role |
| 3 | Every role in the registry is named by at least one rule | A role added with no doctrine — a page told nothing |
| 4 | `SECTION_BUILDER_BLOCK_A.length < 16_000` still holds | Paying for new rules by breaching the token budget |
| 5 | `SECTION_BUILDER_BLOCK_A` is still reference-identical across reads | A `buildBlockA()` refactor that destroys the per-turn prefix |
| 6 | Block B states the role for every role AND for null | A missing line the model is free to guess at |
| 6a | Block B for `confirmation` contains the confirmation rule and NOT the form-first rule | A filter that renders every rule regardless of role |
| 6b | Block B for `null` renders exactly the pitch+capture union | Old pages losing or gaining doctrine they had yesterday |
| 6c | Block A contains none of the leadgen rule text | Rules left in both places, drifting apart |
| 7 | Template step roles are all valid registry values | A template naming a role that does not exist |
| 8 | `conversion` critic does not run on `confirmation` | The review undoing the prompt fix on the next turn |
| 9 | `art` and `copy` DO run on `confirmation` | Over-correcting into no review at all |
| 10 | `createFunnel` omits `role` when 00211 is absent, still inserts the step | A migration race 500ing every create, funnels and pages alike |
| 11 | `createFunnel` writes `role` when 00211 is present | A tolerance path that never turns off |
| 12 | The 00211 probe is independent of the 00210 probe | One flag answering for two migrations that can land apart |
| 13 | No page example shares slug/name/audience with a funnel example | The duplication returning by reword |
| 14 | `updateStepSchema` accepts every registry role and rejects others | A select offering a value the API refuses |

Verification is targeted suites plus `tsc --noEmit` against the recorded
baseline, per the repo's standing instruction. Not a full-suite run.

## Explicitly out of scope

- **A role-aware publish gate** (blocking a confirmation page that carries a
  lead form). Real value, its own failure modes; the prompt change should be
  proven first.
- **Backfilling roles onto existing funnels.** Leaving them `null` means they
  keep today's exact behaviour, which is this repo's usual choice for old rows.
- **`creationPrompt`.** Tuned and shipped; Block B now covers what it was
  approximating.
- **The four genuinely role-neutral audit rules** (`tone-run`, `pad-monotony`,
  `align-thrash`, `markdown-leak`). The other three are in scope — see §4.
