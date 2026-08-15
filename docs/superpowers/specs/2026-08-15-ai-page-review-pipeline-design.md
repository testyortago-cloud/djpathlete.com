# AI page review pipeline — design

**Date:** 2026-08-15
**Status:** Approved for planning
**Supersedes nothing.** Extends the builder shipped in
`docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md` and
`docs/superpowers/specs/2026-08-15-section-click-to-edit-design.md`.

---

## 1. The problem, measured

The owner's report was that AI-built landing pages are "boring", have "a lot of
formatting issues" and "a lot of look off spacing". All three are reproducible
against real production data rather than being matters of taste.

Both AI-built pages in production were read out of `funnel_steps.project_data`.
The most recent (`d4b1633b-478d-42f2-bab4-705fc06c8c7d`, 8 sections, updated
2026-08-15) resolves to this rhythm:

| # | id | kind | tone | pad | align | headline |
|---|----|------|------|-----|-------|----------|
| 1 | hero | hero | dark | roomy | center | xl |
| 2 | proof | proof | *(default)* | normal | center | — |
| 3 | what-you-get | bullets | *(default)* | normal | left | lg |
| 4 | how | steps | muted | normal | left | lg |
| 5 | voices | testimonial | *(default)* | normal | center | — |
| 6 | questions | faq | *(default)* | normal | left | lg |
| 7 | book | cta | accent | roomy | center | lg |
| 8 | footer | footer | *(default)* | tight | center | — |

Three defects fall out of that table.

### 1.1 "Spacing looks off" is a missing boundary, not a padding value

Sections 2 and 3 both render `data-tone="default"`. So do 5 and 6.
`styles.ts` gives each section `padding-block: 3rem` and there is **no
rule of any kind between sections** — no `border-top`, no adjacent-sibling
selector, verified by grep. Two same-tone neighbours therefore paint as one
continuous white block with a 6rem void floating in the middle of it, and the
reader cannot tell where one idea ends and the next begins.

This is not a tuning problem. Reducing `padding-block` would make every section
cramped without restoring the boundary.

### 1.2 "Boring" is one padding value repeated

Six of eight sections are `pad: normal`. The rhythm knob exists, is described
in the prompt, and the model picks a single value for the entire middle of the
page. Combined with 1.1 the page has two visual events (the dark hero and the
accent CTA) separated by five interchangeable bands.

### 1.3 "Formatting issues" is alignment without intent

Alignment runs center → center → left → left → center → left → center → center.
Every flip is defensible in isolation; together they read as inconsistency
rather than as a deliberate change of pace.

### 1.4 Rules the prompt already states and nothing enforces

`LEADGEN_RULES` (`prompt.ts`) tells the model that proof goes near the top, that
every CTA points at one place, and that a campaign page must never use a live
FAQ. Every rule in that array is advice; nothing gates any of it.

**The production page happens to satisfy those three** — its proof strip is at
position 2, both CTAs target `booking`, and its FAQ is `source: "inline"`. That
is the argument for enforcing them, not against: the rules held on this page by
the model's good judgement alone, and nothing would have said a word if they had
not. The audit codes for them (§4.3) will correctly stay silent on the fixture,
which is exactly what makes the fixture worth having — see §10.2.

Note also what is deliberately *not* a rule: the page's `testimonial` uses
`source: "live"`, and that is correct. The prompt explicitly prefers live
testimonials over authored copies when the owner already has the content. Only
the live *FAQ* is campaign-hostile, because the site-wide FAQ answers "what is
DJP Athlete" rather than an objection to this offer.

---

## 2. Goal and non-goals

**Goal.** A review stage that runs after a page is built, finds the defects
above (and their copy-level equivalents), and fixes them — with the owner able
to see what it caught and undo it in one click.

**Non-goals, deliberately.**

- New section kinds or variants. The reviser chooses among 10 kinds, 2–3
  variants each and 4 style knobs; some of "boring" is vocabulary rather than
  judgement. Expanding the vocabulary is the *next* lever and keeping it out is
  what makes this shippable.
- Media / image selection.
- Any change to the publish compiler (`lib/funnels/compile/`, frozen).
- The parked Craft.js designer (`lib/funnels/tree/parked.ts`).

---

## 3. Decisions taken with the owner

| Decision | Choice | Consequence |
|---|---|---|
| When it runs | Automatically on a **first draft / rewrite** (`set_page`), plus an on-demand **Polish page** button | A one-line edit turn never pays the latency |
| What it may change | **Full authority** — layout, style and copy, on every run | Mitigated by §6: review is its own turn, so undo is one click |
| Pipeline shape | Deterministic auditor → 3 parallel critics → 1 reviser → deterministic re-audit gate | §4 |

---

## 4. Architecture

```
build turn → applyOps → appendTurn(source:'ai')     ← page is saved and safe
                              ↓
                     auditDoc(doc)  ── deterministic findings, no model
                              ↓
              ┌───────────────┼───────────────┐     parallel
        art director     copywriter     conversion
              └───────────────┼───────────────┘
                              ↓  mergeFindings — dedupe by (code, sectionIds)
                     reviser (Opus) → SectionOp[]
                              ↓  applyOps — the real one, transactional
                     auditDoc(doc') ── the gate
                              ↓
                  appendTurn(source:'review')        ← its own undo point
```

### 4.1 Module layout

A new directory `lib/funnels/sections/review/`. `sections/` is already ~6,500
lines across 12 files; review is a distinct responsibility with its own
dependency shape and does not belong inside it.

| file | contents | may import |
|---|---|---|
| `findings.ts` | `Finding`, `Severity`, the code union, `mergeFindings` | nothing but `zod` — leaf |
| `audit.ts` | `auditDoc(doc): Finding[]` — pure, no model, no IO | `registry`, `doc`, `findings` |
| `critics.ts` | the three critic prompts, `runCritics()` | `lib/ai/anthropic`, `findings` |
| `reviser.ts` | reviser prompt, `runReviser()` → `SectionOp[]` | `apply` (for `opSchema`), `findings` |
| `pipeline.ts` | `reviewDoc()` — orchestration, error containment, timeouts | all of the above, `apply` |

`findings.ts` must stay a leaf. `build-stream.ts` (imported by the browser
bundle) will carry a `finding` event, and `builder-config.ts` already documents
what happens when a "leaf" quietly acquires the Anthropic SDK: it made
`reassemble()` un-importable in the browser and forced a whole stage to route
through a server action.

### 4.2 The `Finding` type — one shape, four producers, one consumer

```ts
type FindingSource = "audit" | "art" | "copy" | "conversion"
type Severity = "high" | "medium" | "low"

interface Finding {
  code: string            // closed union for audit codes; "copy-*" etc. for critics
  severity: Severity
  sectionIds: string[]    // [] means the whole page
  issue: string           // one sentence: what is wrong
  suggestion: string      // one sentence: what to do instead
  source: FindingSource
}
```

The critics are schema-constrained to return exactly this shape, so the reviser
reads a single list and does not care which producer found what. `mergeFindings`
dedupes on `(code, sorted sectionIds)` keeping the highest severity, and orders
high → low so a truncated list loses the least important entries.

### 4.3 The deterministic auditor

| code | severity | fires when |
|---|---|---|
| `tone-run` | high | ≥2 adjacent sections share an **effective** tone |
| `pad-monotony` | medium | ≥4 consecutive sections share a `pad`, or ≤1 distinct value across ≥5 sections |
| `align-thrash` | medium | alignment changes ≥3 times across the page |
| `headline-scale` | medium | the hero is not the largest headline, or body sections show no hierarchy |
| `markdown-leak` | high | `**`, `__`, backticks, or a leading `#` / `- ` / `1. ` in any string prop |
| `proof-below-fold` | high | the first `proof` or `testimonial` sits past the halfway index |
| `cta-divergence` | high | more than one distinct CTA target across the page |
| `live-faq-on-campaign` | high | an `faq` section with `source: "live"` |
| `copy-echo` | medium | the same normalised sentence appears in two sections |
| `headline-punctuation` | low | a trailing `.` on a headline or heading field |
| `length-strain` | low | a copy field within 5% of its schema maximum |
| `section-count` | low | fewer than 6 or more than 9 sections |

**Effective tone must be read through `sectionForPage`** (`doc.ts:103`), never
re-implemented. On a page whose `theme.tone` is `"dark"`, that function promotes
every untoned section to `"dark"` at render time. An auditor that reads
`section.style.tone` directly sees four distinct `undefined`s and reports
nothing, while the page renders as four identical dark bands. This is the
`ask_the_validator_never_restate_it` failure mode in its exact form: two copies
of one rule, one of which is wrong.

**`length-strain` derives its caps from the registry schemas**, the same way
`prompt.ts` derives `UUID_FIELD_PATHS` — never a hand-typed table of maximums.

**`copy-echo` must exclude CTA labels.** The production page uses "Book your
consultation" as both the hero and the closing CTA label, and that repetition is
*required* by `LEADGEN_RULES`' one-offer-one-action rule. A naive
same-string-twice check would flag the page for obeying the prompt. It compares
prose fields only — `headline`, `sub`, `heading`, `intro`, `body`, `blurb`.

#### 4.3.1 The audit ↔ prompt cross-reference

`proof-below-fold`, `cta-divergence` and `live-faq-on-campaign` are code
restatements of prose that already exists in `LEADGEN_RULES`. Prose cannot
generate code, so the duplication is unavoidable — but it must be *detectable*.

A test holds an explicit `Record<AuditCode, number>` mapping each enforced code
to its index in the exported `LEADGEN_RULES` array, and asserts that index still
exists and still contains the keyword the rule is about. Deleting or rewriting a
prompt rule then turns the test red instead of leaving an enforcement rule
silently arguing with the instruction that produced it.

### 4.4 The critic panel

Three critics, run in parallel, each given the document, the deterministic
findings (so none of them spends tokens rediscovering that six sections share a
padding value), and a lens the other two cannot cover:

| critic | asks | model |
|---|---|---|
| Art director | Where does the page go flat? Tone runs, band rhythm, alignment intent, variant monotony | Sonnet |
| Copywriter | Does this headline say anything? Jargon, repetition, the coach's own voice | Sonnet |
| Conversion strategist | One offer one action, proof placement, unhandled objections, friction | Sonnet |

Three *distinct* lenses is the load-bearing part of the design. Three critics
sharing one prompt would report the same finding three times and feel thorough
while adding nothing.

Sonnet rather than Opus because a critic emits findings, not ops — nothing it
returns has to satisfy a validator. This mirrors the house pattern in
`lib/agents/self-critique.ts`, which runs a cheap second-pass critic after an
expensive main call.

### 4.5 The reviser

One Opus call. It receives the document and the merged findings and returns
`{ summary, ops }` where `ops` is validated by the **imported** `opSchema` from
`apply.ts` — never a second Zod copy of the op grammar. `prompt.ts` already
carries the reasoning: this repo has shipped three separate bugs from restating
a schema instead of importing it.

Ops are applied with the real `applyOps`, which is transactional — either the
whole batch lands or none of it does. A rejected batch is retried **once** with
the validation errors appended, matching the builder's existing retry, and then
abandoned.

`applyOps` returns a `DiffReceipt` carrying `isRewrite` and per-section change
entries. The receipt, not the model's own claim, is what the review turn reports
to the owner.

### 4.6 The gate

`auditDoc` runs again on the revised document. A reviser that fixed a tone run
by introducing a new one is caught for free. Findings that survive are recorded
on the turn and shown, not silently dropped — a gate that hides what it could
not fix reads as a gate that found nothing.

Round count is `SECTION_REVIEW_MAX_ROUNDS` in `builder-config.ts`, **set to 1**.
Turning this into an iterate-until-clean loop is then a one-line change backed
by evidence rather than a guess; subjective copy tends to oscillate between
rounds rather than converge, so the loop is not taken on spec.

---

## 5. The stylesheet defect

Four rules in `styles.ts`, one per tone:

```
.djp-s[data-tone="X"] + .djp-s[data-tone="X"] { border-top: 1px solid <token>; }
```

`render.ts:295` **always emits resolved defaults**, so every section carries a
literal `data-tone` attribute even when the AI set no tone. The adjacent-sibling
selector therefore matches real rendered output rather than a hypothetical.

**The divider colour must be an explicit token pair per tone, not
`currentColor`.** `render.test.ts`'s tone-contrast harness resolves colours by
token; a `currentColor` divider is *unmodelled* by it, so it would pass the
suite while being invisible to the only test that checks tone rendering.

Belt and braces with §4.3: the auditor stops the model creating same-tone
neighbours, and the CSS keeps the page legible when one slips through. A
published `funnel_step_versions` row freezes HTML **and** CSS, so this change
cannot repaint any live page — the two existing pages take it up on their next
publish. That is what makes it safe to ship without a flag.

---

## 6. Where the review turn lives

The review runs **after the build turn has committed**, as a second appended
turn — not inside the build turn.

Two consequences, both intended:

1. **A review that throws cannot cost the owner their page.** The built document
   is already written and the revision already advanced. Every failure path in
   §8 degrades to "you have the page the builder made".
2. **The polish gets its own undo point.** `revertToRevision` already powers
   "Go back to here" on every restorable turn. Because the review is a separate
   turn carrying its own document, undoing *only* the polish is one click. This
   is the mitigation for the full-authority decision in §3: the reviser may
   rewrite a headline the owner liked, and getting it back must not require
   retyping it.

### 6.1 Migration 00209

`funnel_step_turns.source` has a CHECK constraint of exactly
`('ai','inspector','revert')` (verified against production). A review turn needs
`'review'` added:

```sql
alter table funnel_step_turns drop constraint funnel_step_turns_source_check;
alter table funnel_step_turns add constraint funnel_step_turns_source_check
  check (source = any (array['ai','inspector','revert','review']));
```

`TurnSource` in `lib/db/funnel-builder.ts:75` gains the same member.

00207 and 00208 are both already applied in production (`repo_migrations`
checked), so nothing is queued in front of this. Pushing to `main` auto-applies
it; the migration is additive and backwards-compatible, so ordering against the
deploy is not load-bearing here.

---

## 7. Streaming and UX

`BUILD_PHASES` gains two entries after `checking`:

| phase | label |
|---|---|
| `reviewing` | Reviewing the page |
| `polishing` | Applying improvements |

`BUILD_PHASE_LABELS` is a `Record<BuildPhase, string>`, so adding a phase
without a label is a compile error rather than a blank pill in the UI.

A new stream event carries each catch as it lands:

```ts
| { type: "finding"; finding: Finding }
```

The panel adds 30–40 seconds to a first draft. Streaming the findings is what
makes that time legible instead of dead air — the owner watches six specific
problems get named. `BuildStreamEvent` is a discriminated union consumed by a
decoder that drops frames it cannot parse, so an older client meets a `finding`
event and ignores it rather than breaking.

The **Polish page** button sits in the builder alongside the chat input and is
disabled while a turn is in flight.

---

## 8. Failure handling

Review is strictly non-fatal. None of these emit a `fail` event:

| failure | behaviour |
|---|---|
| A critic throws or returns unparseable output | dropped; the other two proceed |
| All three critics fail | the deterministic findings alone go to the reviser |
| The reviser throws | build turn stands; a note is appended, no review turn |
| `applyOps` rejects the batch | one retry with errors appended, then abandon |
| The whole stage exceeds `SECTION_REVIEW_TIMEOUT_MS` | abandoned; build turn stands |
| `appendTurn` loses the compare-and-swap race | the owner edited while review ran — their edit wins, review is discarded |

The last row matters: review is a *background improvement*, and a background
improvement must never beat a human who was typing at the same moment.

### 8.1 Rate limiting

An automatic review is part of the build turn the owner already paid a slot for
and consumes none of its own. A **Polish page** press is a distinct user action
and consumes one slot from `SECTION_BUILDER_RATE_LIMIT_MAX`.

---

## 9. Configuration

New constants in `builder-config.ts`, following that file's existing
one-const-one-doc-comment shape:

| constant | value | why |
|---|---|---|
| `SECTION_REVIEW_MAX_ROUNDS` | 1 | §4.6 |
| `SECTION_REVIEW_CRITIC_MODEL` | Sonnet | critics emit findings, not ops |
| `SECTION_REVIEW_CRITIC_MAX_TOKENS` | 2_000 | a findings list, not a document |
| `SECTION_REVIEW_REVISER_MAX_TOKENS` | 14_000 | matches `SECTION_BUILDER_EDIT_MAX_TOKENS` — a reviser may legitimately rewrite every section, and on Opus 5 `max_tokens` buys thinking and output from the same purse |
| `SECTION_REVIEW_TIMEOUT_MS` | 90_000 | whole stage, wall clock |
| `SECTION_REVIEW_MAX_FINDINGS` | 24 | what reaches the reviser after merge |

No feature flag. The project rule is that flags guard money and mass-email risk;
this guards neither, and `SECTION_REVIEW_MAX_ROUNDS: 0` is already an off switch
if one is ever wanted in a hurry.

---

## 10. Testing

The defect class this repo keeps shipping is a green test that never verified
its claim. The suite is built to fail on the known-bad input first.

1. **The production document is a checked-in fixture, and the auditor must FIRE
   on it — with the exact expected set, not merely "something".** Computed by
   hand against the real document: `tone-run` twice (`proof`+`what-you-get`, and
   `voices`+`questions`), `pad-monotony` once (five consecutive `normal`), and
   `align-thrash` once (four alignment changes across eight sections). An
   auditor returning clean on the page that motivated the work is worthless, so
   this assertion is the point of the suite, not a supplement to it.
2. **The same fixture must NOT fire the four codes it does not violate** —
   `cta-divergence` (both CTAs target `booking`), `live-faq-on-campaign` (the
   FAQ is `inline`), `proof-below-fold` (the proof strip is at position 2), and
   `section-count` (8 is within 6–9). Asserting the exact set in both directions
   is what separates a rule set that discriminates from one that just fires on
   everything — an auditor that flags all twelve codes on every page would pass
   assertion 1 while being useless.
3. **A hand-built good document must return zero high-severity findings.**
   Score the known-good baseline before trusting the metric.
4. **Effective-tone coverage:** a dark-themed doc whose sections set no tone must
   raise `tone-run`, proving the auditor went through `sectionForPage` rather
   than reading `style.tone`.
5. **Reviser ops go through the real `opSchema` and the real `applyOps`** — a
   stubbed applier would pass on ops the builder would reject.
6. **A critic returning garbage does not take the turn down**, and all three
   failing still produces a review from the deterministic findings.
7. **CSS:** the four divider selectors exist *and* match markup that
   `renderSection` actually emits — asserted against rendered output, not against
   a hand-written selector string. The existing tone-contrast suite must stay
   green.
8. **The audit ↔ `LEADGEN_RULES` cross-reference** of §4.3.1.
9. **Prompt cache integrity:** `SECTION_BUILDER_BLOCK_A` must remain
   reference-identical (`toBe`). Nothing in this work may interpolate into it.

Verification is targeted suites plus `npm run build` — not a full-suite run.

---

## 11. Risks

| risk | mitigation |
|---|---|
| The reviser overwrites copy the owner wrote | §6 — its own turn, one-click undo. Accepted explicitly in §3 |
| +30–40s on a first draft | Streamed findings (§7); edit turns never pay it (§3) |
| Critics agree with each other and add nothing | Three enforced-distinct lenses (§4.4); the gate measures whether findings actually fell |
| The vocabulary ceiling — pages still read samey | Named as the next lever and scoped out (§2). The gate's surviving-findings record is the evidence for whether it is the real cap |
| Cost per first draft roughly triples | Critics are Sonnet; only the reviser is Opus |

---

## 12. Open question for implementation

Whether `auditDoc` should also run on **publish** as a warning surface (not a
block). The data is already there and `publishGate` already exists. Deliberately
left out of this design: it changes the publish path, which is frozen, and it
can be added later without touching anything specified here.
