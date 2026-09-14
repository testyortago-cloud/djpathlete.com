# Giving the page builder's AI eyes — Phase 2: the model sees its own page

**Date:** 2026-09-14
**Status:** approved, ready for planning
**Closes:** [`docs/builder-gaps.md`](../../builder-gaps.md) row **C4** ("Have the model see its own
rendered page")
**Phase 1** (the owner pasting a REFERENCE image in) shipped 2026-09-14 in merge `3b9f406e`;
its spec is [`2026-09-14-builder-reference-image-design.md`](./2026-09-14-builder-reference-image-design.md),
whose §9 scoped this out deliberately so Phase 1 could be used first.
**Applies to:** both boards. `/admin/funnels/[id]/edit/[stepId]` and
`/admin/pages/[id]/edit/[stepId]` share one builder, one build route and one review stage.

---

## 1. The problem, stated as the code states it

The review stage runs three critics over every first draft. One of them is the art director,
and its brief opens:

> YOUR LENS: how the page LOOKS as somebody scrolls it. Nobody else is looking at this.
> — [`critics.ts`](../../../lib/funnels/sections/review/critics.ts)

It is then handed `JSON.stringify(doc, null, 2)` and nothing else.

So the one reviewer whose entire job is the page's appearance has never seen the page. It
infers appearance from style knobs — `tone`, `pad`, `align`, `headline` — and reasons about
whether they vary. That catches monotony. It cannot catch anything that only exists once the
browser has laid the page out:

- a section that renders as an **empty coloured band** because its `source:"live"` catalogue
  returned nothing
- text at a size or colour that is **unreadable on the ground it lands on**
- a list whose items **wrap ragged** because two of five are long enough to centre-wrap and
  three are not
- a heading and its content separated by a **dead column** of empty page
- anything that **overflows, collides or crops**

Every one of those is well-formed JSON. The document is not wrong; the *render* is.

### 1a. Two of them are on a real page right now

Rendering step `7f5da342` (Summer Speed Camp, the page Phase 1 was verified against) at
1200px wide shows both failure modes in one screen: the pricing card's five bullets are ragged
(two centre-wrapped, three left-aligned), and the FAQ heading sits at the far left with its
content indented to the middle, leaving a dead left column. Nothing in that document reads as
wrong.

---

## 2. What this build does

One sentence: **before the review runs, the page is rendered to images, and the art director
is handed the pictures instead of guessing from the style knobs.**

Five changes, in dependency order:

1. **A browser** — `lib/funnels/browser.ts`, which resolves a headless Chrome and returns
   `null` rather than throwing when it cannot (§4).
2. **A renderer** — `lib/funnels/render-image.ts`, which turns a `SectionDoc` into base64 PNG
   tiles and never throws (§5).
3. **The critic panel** — `runCritics` gains an optional `images`, and the art director alone
   receives them (§6).
4. **The pipeline** — `reviewDoc` threads `images` through (§7).
5. **The route** — `runReviewStage` renders before it reviews, on both the automatic path and
   the Polish button (§8).

**Done means:** the art director files a finding about something that is invisible in the
document, and the reviser acts on it, demonstrated in the real app.

---

## 3. What Phase 1 already built, and is reused verbatim

**The transport is done. Do not rebuild it.** `callAgent` and `streamAgent`
([`lib/ai/anthropic.ts`](../../../lib/ai/anthropic.ts)) take
`images?: readonly AgentImage[]` where `AgentImage = {mediaType, data}` and `data` is BARE
base64 — no `data:` prefix. When present the call switches from `prompt:` to the AI SDK
`messages:` form via `promptOrMessages`, which already handles the multi-image case (it maps
over the array) and already documents the two traps: the `prompt`/`messages` union cannot be
conditionally spread, and a zero-length array must read as "no image".

`runCritics` calls `callAgent`, so it inherits all of this for free. **This phase adds no
transport code whatsoever.**

### 3.1 The cached prefix rule still holds, and this design never goes near it

Anthropic's cache is a strict prefix match, so anything per-turn in a system prompt is a
silent cache invalidator. Phase 1's rule was: the image goes in the user message, never the
system prompt. That is exactly what `promptOrMessages` does, so it holds here unchanged.

**And the two nearly-full ceilings are not touched at all.** They guard
`SECTION_BUILDER_BLOCK_A` (20,670 / 20,700 — 30 chars) and `SECTION_BUILDER_BLOCK_DESIGN`
(4,433 / 4,500 — 67 chars), both measured on this branch's base. Those constants cover the
**builder's** cached prefix. The critics' prompts live in `critics.ts`, are passed to
`callAgent` as its `system` argument, and are under no ceiling test — verified by grepping
`__tests__` for `BLOCK_A_MAX` / `BLOCK_DESIGN_MAX` consumers.

**So there is no prose to compact and no ceiling to raise in this phase.** That is a genuine
benefit of putting the feature in the review stage rather than the builder turn, and it is
recorded here so nobody "helpfully" moves it later without knowing what it costs.

---

## 4. The browser — `lib/funnels/browser.ts`

### 4.1 Two environments, one driver

`puppeteer-core` in both, because two drivers would mean two sets of behaviour to keep in
step:

| Where | Executable |
|---|---|
| Vercel / Lambda (`process.env.VERCEL` or `AWS_LAMBDA_FUNCTION_NAME`) | `@sparticuz/chromium`'s `executablePath()`, with its `args` and `headless` |
| Local dev / test | A discovered Chrome: `PUPPETEER_EXECUTABLE_PATH`, then the known macOS/Linux install paths |

`@sparticuz/chromium` ships a **Linux** binary, so it cannot run on the developer's Mac. The
split is not a preference; it is the only arrangement that works in both places.

Both packages are compatible with this repo's `engines.node: "24.x"`
(`@sparticuz/chromium@153` requires `^22.17.0 || >=24.0.0`; `puppeteer-core@25` requires
`>=22.12.0`). That pin is load-bearing and must not be relaxed to satisfy a dependency.

### 4.2 It returns `null`, it does not throw

```ts
export async function launchRenderBrowser(): Promise<RenderBrowser | null>
```

No browser is a **normal outcome**, not an error: a dev machine with no Chrome, a platform
that will not launch one, a cold start that ran out of room. Every one of those must end as a
review that runs on JSON exactly as it does today.

### 4.3 It is imported dynamically

`await import("puppeteer-core")` at the point of use, never a top-level import. The build
route is the hottest route in the builder and most of its turns never render anything.

---

## 5. The renderer — `lib/funnels/render-image.ts`

```ts
export interface RenderedPage {
  images: AgentImage[]          // [overview, slice 1..N], bare base64 PNG
  width: number
  height: number
  truncated: boolean            // page was taller than MAX_TILES * TILE_HEIGHT
  typographyFaithful: boolean   // see 5.3
  dynamicRegions: string[]      // see 5.7 — added 2026-09-14 after the task-8 run
  error: string | null          // set when images is empty. NEVER thrown.
}

export async function renderDocToImages(
  doc: SectionDoc,
  ctx: { funnelBasePath?: string; brandKit: BrandKit | null },
): Promise<RenderedPage>
```

**It never throws.** Same promise as `reviewDoc`, for the same reason: it runs after the
owner's page is already saved, so there is no failure in it worth showing them an error for.

### 5.1 The wrapper is not optional, and forgetting it renders an unstyled page

`reassemble()` returns `{html, css}` where **every CSS selector is scoped to
`#djp-funnel-root`** (`lib/funnels/compile/css-scope.ts`, `FUNNEL_ROOT_ID`), and the html it
returns starts at `<div class="djp-page">`. The wrapper is supplied by the host page — all
three render routes do it (`/go`, `/preview`, `/funnel-preview`).

This was found the expensive way while designing this spec: the first render omitted the
wrapper, all 237 CSS rules loaded and matched nothing, and the result was a screenshot of
completely unstyled HTML that looked like a catastrophically broken page. **Had that reached
the critic it would have reported a page-wide disaster on a page that was fine, and the
reviser would have rewritten a good document to fix it.**

So the markup this module builds is fixed and tested:

```html
<!doctype html><html><head><meta charset="utf-8">{fonts}<style>{css}</style></head>
<body style="margin:0"><div id="djp-funnel-root">{html}</div></body></html>
```

A test asserts a known selector actually matches after render — presence of the wrapper is
checked by its *effect* (a computed `--djp-maxw`), not by string-matching the template.

### 5.2 Resolution is already done — do not redo it

`runReviewStage` is handed `doc`, which is `resolution.doc`: already through
`loadCatalogues → resolveDoc`. The renderer takes that document and calls `reassemble` (5ms
measured) with the same `{funnelBasePath, brandKit}` the route already computed.

**It must not call `resolveDoc` itself.** A second resolution against a catalogue read at a
different moment is how preview and publish start disagreeing, which
[`lib/funnels/preview-render.ts`](../../../lib/funnels/preview-render.ts) opens by calling
this subsystem's worst failure mode.

**A corollary that matters for the demo:** an *unresolved* `source:"live"` section renders as
an empty band. That is a real defect when the catalogue genuinely has nothing, and a phantom
one when the renderer skipped resolution. Rendering the already-resolved document is what
keeps the difference meaningful.

### 5.3 Fonts — faithful where it can be, honest where it cannot

The funnel stylesheet only ever names `var(--font-lexend-exa)` etc.; the actual faces come
from `next/font/google` in `app/layout.tsx`, stamped on `<body>`. A standalone render has
neither, and the failure is **silent and total**: with `--font-lexend-exa` undefined, the
whole `font-family` declaration is invalid at computed-value time and the heading falls back
to **Times New Roman**. Measured: page height moved 5042 → 5242px between the two states, so
this changes layout, not just letterforms.

The module therefore injects a Google Fonts `<link>` for the three faces plus a `:root` block
defining the three variables, waits for `document.fonts.ready`, and then **probes** that the
families actually loaded.

`typographyFaithful` is that probe's answer, and it is reported rather than assumed.

**AMENDED 2026-09-14, after the task-8 verification run: the probe asks about the faces the
page USES, not all three.** The first implementation was
`families.every((f) => document.fonts.check(…))`, and a browser downloads a webfont only when
something on the page asks for it — only the `clean` pairing names Lexend Exa — so the flag
read false on every render whose typography was perfectly correct (measured on a real
document: Exa false, Deca true, Mono true, on a page whose type was right), and the critic was
told the type was a fallback face when it was not. The probe now walks the text nodes, reads
the computed `font-family` each one is rendered in, and asks the FontFaceSet whether each
downloadable family named there has a face with status `loaded`. `document.fonts.check` alone
cannot answer this: it returns TRUE for a family that is not in the set at all, so the
no-egress degrade below — the one case this flag exists to report — would have read as
faithful. Both directions are pinned by the real-browser suite, with the font supplied as a
`data:` URI so neither test can pass because Google Fonts happened to answer.

**That link is an outbound network dependency at render time, and it is allowed to fail.** The
wait is bounded by `SECTION_RENDER_TIMEOUT_MS` — never an unbounded `networkidle`, which in a
sandboxed container with no egress would hang the render rather than degrade it. If the fonts
do not arrive, the page still renders (in the fallback faces), `typographyFaithful` is false,
and the critic is told not to read anything into the type. Self-hosting the three faces was
considered and rejected for this phase: `next/font` emits them under hashed
`/_next/static/media/` filenames that a function cannot address without build-time plumbing,
and the fallback path above already fails soft.

**Three of the five pairings can never be faithful, and this is by design, not a bug to fix.**
`FONT_STACKS` in `doc.ts` maps `bold → "Arial Narrow", "Helvetica Neue Condensed", "Roboto
Condensed", ui-sans-serif`, `editorial → ui-serif, Georgia, serif` and
`athletic → ui-rounded, system-ui`. Those are *system* faces, chosen precisely so a funnel page
triggers no font download. They resolve differently on Linux, macOS and Windows — so there is
no single render that is "what the page looks like", and shipping extra faces into the
container would make the render agree with *nobody*.

**The consequence is a prompt instruction, not a code change:** the critic is told the picture
is authoritative for layout, spacing, colour, contrast, empty regions and overflow, and
approximate for typeface, and that it must not file findings about which typeface was used.

### 5.4 Tiles, because a whole page is illegible

Measured on the real 10-section page: 1200 × 5242. Claude downscales to ~1568px on the long
edge, so a single full-page image arrives as **359 × 1568** — headlines survive, body copy is
about 4px, and a critic reading it would be guessing.

So the page is sliced into tiles whose long edge stays **under** 1568, which means they are
not downscaled at all:

| Image | Size | ~Tokens |
|---|---|---|
| overview (full page, downscaled by Anthropic) | 359 × 1568 | ~750 |
| slice 1..3 | 1200 × 1400 | ~2,240 each |
| slice 4 | 1200 × 1042 | ~1,667 |

≈ **9,100 vision tokens** for this page, on a stage that already makes four model calls. The
overview earns its ~750 because rhythm — "where does the page go flat" — is the art director's
actual question and is easier to answer from one image than from four stitched mentally.

Every number above is a named constant in `builder-config.ts`
(`SECTION_RENDER_VIEWPORT_WIDTH`, `SECTION_RENDER_TILE_HEIGHT`, `SECTION_RENDER_MAX_TILES`,
`SECTION_RENDER_TIMEOUT_MS`, `SECTION_RENDER_ENABLED`), never a bare literal. A page longer
than `MAX_TILES × TILE_HEIGHT` sets `truncated`, and the critic is told the page was cut off
rather than being left to conclude the page ends there.

### 5.5 Timing

Measured locally (Playwright chromium, same engine): `reassemble` 5ms, launch ~700ms cold /
~65ms warm, `setContent` 500-710ms, each screenshot ~140ms. About **1.5s** for a four-tile
page. `SECTION_RENDER_TIMEOUT_MS` bounds it; the review's own budget is
`SECTION_REVIEW_TIMEOUT_MS` (90s) and the route's is `maxDuration = 300`.

### 5.6 Nothing is stored

The images exist as base64 in memory, are handed to the model, and are garbage after the call.
Not `funnel_step_turns`, not Firebase Storage, not the document, not a log.

Unlike Phase 1 there is **no copyright argument** — this is our own render of the owner's own
page. The reasons are different and worth stating so nobody "fixes" this later by reasoning
from Phase 1's rationale: the images are large, and they are reproducible from the document at
any time, so storing them buys a debugging convenience at a per-review storage cost and one
more write that can fail on a turn that otherwise succeeded.

### 5.7 The islands are not in the picture, and the critic has to be told

**ADDED 2026-09-14, after the task-8 verification run. This is the most important paragraph in
§5.** `reassemble()` emits every interactive region as an EMPTY placeholder div that only the
real page fills — `renderIsland()` in `render.ts`, reached for the form section
UNCONDITIONALLY, for `source:"live"` testimonials and FAQs, for checkout / event / booking CTAs
and for the quiz. `renderDocToImages` screenshots with `setContent` and runs no scripts, so
every one of those is genuinely blank in the picture.

Told nothing, the art director reported them — correctly, from what it could see — as
high-severity empty bands, and the reviser **acted**: it replaced a working live testimonial
feed carrying a real athlete's quote with a testimonial it invented, attributed to a named
person with an invented 40-yard-dash time, and described that to the owner as a fix. A
fabricated endorsement, on a real coaching page. That is §11's "the critic reports a disaster
on a good page" risk, realised through a door this spec did not anticipate: §5.1 guarded the
CSS wrapper and §5.3 guarded the fonts, and nothing guarded the islands.

So `RenderedPage` carries `dynamicRegions: string[]` — `section-id (what it is)`, e.g.
`proof (a live testimonial feed)` — and `renderNote()` renders it into the art critic's user
message in plain words: these regions are interactive, a browser fills them in when a visitor
loads the page, they look blank here, do not report them as empty and do not invent content
for them. When a page has none, the note says the opposite, so a genuinely empty band is still
reportable.

**The list is scanned out of the emitted HTML** (`islandsBySection`, keyed on
`data-djp-island`), never re-derived by walking `doc.sections`. Which sections hold an island
depends on a `source:"live"` discriminant on two kinds, a CTA's target kind on several more,
and validation passing inside `renderIslandIfValid`; a second implementation of those rules
would be right the day it was written and silently wrong afterwards — which is this bug's own
class. `scripts/_render-islands.ts` reads the same function, so the verification tooling and
the prompt cannot disagree.

---

## 6. The critic panel — one lens gets eyes

### 6.1 The art director, not a fourth critic

`critics.ts` opens with a thesis: "THE LENSES ARE THE DESIGN. THREE CRITICS SHARING ONE BRIEF
ARE ONE CRITIC." A new picture-only critic would share the art director's brief almost exactly
— both answer "how does this page look" — which is the duplication that file exists to
prevent. The art director has been answering its own question with the wrong input; this gives
it the right one.

Its brief is rewritten to lead with what only the picture shows (empty regions, unreadable
text, ragged wrapping, collisions, dead space, crops) while keeping the rhythm and monotony
material it already does well.

**The rewrite is constrained by tests that already exist**, and they are not obstacles to route
around — each encodes a failure the panel has already had. `critics.test.ts` requires every
brief to match `/other two reviewers/i` (so the panel cannot degenerate into three general
critics), to match `/empty list/i` (so a critic cannot start always finding three things), and —
if it lists section kinds in the form `kinds are: <list>.` — to name only kinds in
`SECTION_KINDS`. The new brief keeps all three properties.

### 6.2 This amends a documented invariant, deliberately

`runCritics` today says:

> Identical ON PURPOSE, beyond saving the obvious: the lens lives entirely in the system
> prompt, so the only variable between the three calls is the instruction. If two critics ever
> return the same finding, that is genuine agreement between two perspectives rather than an
> artefact of one having been shown more of the page than the other.

After this change the three calls are **no longer identical**. That comment must be updated in
the same commit, not left to contradict the code.

The reasoning for the amendment: the artefact the comment guards against is giving one critic
**more of the same** information, which manufactures false agreement. This gives one critic a
**different modality matched to its lens** — the copywriter reading a picture of prose would be
strictly worse off, and the offer critic has no use for it. Cross-lens agreement between the
art director and the copywriter remains meaningful because they are still answering different
questions.

### 6.3 Shape

```ts
export async function runCritics(
  doc: SectionDoc,
  auditFindings: Finding[],
  images?: readonly AgentImage[],
): Promise<CriticPanelResult>
```

`CriticLens` gains `seesRender: boolean`, true for `art` alone — so which critic gets pictures
is a property of the lens table, not an `if (critic.source === "art")` buried in the fan-out.
Omitted `images` is byte-for-byte today's behaviour, and a test pins that.

### 6.4 The brief is unconditionally PRESENT and conditionally RELEVANT

**AMENDED 2026-09-14, after the task-8 verification run.** The art brief opened "YOU HAVE
PICTURES. Screenshots … are attached", which is a **static string on the lens table** and is
therefore sent on every art call — including every degrade this design deliberately builds for
(no browser, launch failure, screenshot failure), where nothing is attached at all. It
confabulated: on one real document with no render, **5 of 5** art findings cited "the
screenshot" and described colours, gaps and spacing nobody had shown the model.

This is §3.1's own rule, not a style preference: the system prompt is a CACHED PREFIX, the
cache is a strict prefix match, and a sentence that is only true on some turns is per-turn
content. So the brief now says "WHEN SCREENSHOTS OF THE PAGE ARE ATTACHED, a note at the end
of the message says so…", and the assertion that pictures exist this turn lives only in
`renderNote()`, in the user message, where the per-turn content already is. A test walks every
picture-claim in the art brief and fails any that is not inside a conditional clause.

---

## 7. The pipeline

`ReviewInput` gains `images?: readonly AgentImage[]`, passed to `runCritics`. `reviewDoc`'s
no-throwing-path promise and its `SECTION_REVIEW_MAX_ROUNDS < 1` kill switch are untouched.

The renderer is **not** called from inside `reviewDoc`. `reviewDoc` receives images; the route
produces them. That keeps the pipeline free of a browser dependency and keeps it testable
without one.

---

## 8. The route

Inside `runReviewStage`, before `reviewDoc`:

```
emit({type:"phase", phase:"reviewing"})
   |
   +-- renderDocToImages(doc, {funnelBasePath, brandKit})    <-- new, ~1.5s, never throws
   |
   +-- reviewDoc({doc, images, onFinding})
```

`runReviewStage` is shared by **both** paths — the automatic review (`mode:"apply"`, line
~1758) and the Polish button (`mode:"propose"`, line ~1111) — so one insertion covers both.

**No new stream phase.** `BUILD_PHASES` is
`["reading","planning","writing","checking","reviewing","polishing"]` and has four consumers
(`FunnelBuilder.tsx`, `GenerationStage.tsx`, the guide page, the route). Widening a union for a
sub-step of a phase that already exists would cost four files and a set of consumer suites to
buy a label. The render is part of reviewing, and it is reported as reviewing.

**A render failure is not a review failure.** `renderDocToImages` returning `error` means
`reviewDoc` is called with no images, which is today's behaviour. It is `console.warn`ed, never
emitted — on the automatic path the owner has a page and telling them a background improvement
was slightly less informed reads as a failure of the thing that worked.

---

## 9. Data flow, end to end

```
build turn commits; `result` emitted        <-- owner already has their page
            │
            ▼
shouldReview({rewrotePage, requested})       <-- unchanged: first drafts + Polish
            │
            ▼
runReviewStage
   │
   ├── launchRenderBrowser()  ──► null ──────────────► images = []   (today's behaviour)
   │        │
   │        ▼
   │   reassemble(doc, {funnelBasePath, brandKit})     <-- 5ms, already-resolved doc
   │   wrap in #djp-funnel-root + font link
   │   setContent → fonts.ready → probe → slice
   │        │
   │        ▼
   │   RenderedPage { images, typographyFaithful, truncated, dynamicRegions }
   │
   ▼
reviewDoc({doc, images})
   │
   ├── auditDoc(doc)                     <-- deterministic, unchanged
   ├── runCritics(doc, audit, images)
   │      ├── art      ← system + JSON + PICTURES
   │      ├── copy     ← system + JSON
   │      └── offer    ← system + JSON
   ├── mergeFindings
   └── runReviser(...)                   <-- ops only. Never sees the pictures.
```

The reviser deliberately does not see them: it acts on findings, which the critics have already
made specific, and the Opus budget is spent on producing valid ops against a ten-kind registry.

---

## 10. Testing

Targeted suites plus a build, per the standing instruction. No full-suite run.

**The tests that carry this build's actual claims:**

1. **The wrapper is present and the CSS actually matches.** Render a real document and assert a
   computed value that only a matched rule can produce (`--djp-maxw`), not that the template
   string contains an id. This is the test that would have caught the unstyled-page bug in §5.1.
2. **Fonts: the probe reports honestly.** With the font variables defined, `typographyFaithful`
   is true; with them suppressed, it is false AND the render still succeeds. Both directions —
   an absence assertion needs a presence control.
3. **Tiling maths at the edges**, as a pure function: a page shorter than one tile yields one
   slice; a page exactly `N × TILE_HEIGHT` yields N, not N+1; a page one pixel over yields N+1;
   a page over `MAX_TILES × TILE_HEIGHT` sets `truncated` and yields exactly `MAX_TILES`.
4. **`renderDocToImages` never throws.** A launcher that throws, one that returns null, and a
   page that throws mid-screenshot each produce `{images: [], error: <string>}`.
5. **Only the art critic gets pictures.** Assert the actual argument object of each `callAgent`
   call: `art` receives `images` with N entries; `copy` and `offer` receive `options` with no
   `images` key. Not "the call happened".
6. **No images means byte-identical behaviour.** `runCritics(doc, audit)` with no third
   argument produces the same three `callAgent` argument objects as today.
7. **A render failure leaves the review exactly as today** — `reviewDoc` still returns the same
   findings, and the turn still commits.
8. **Bare base64, no `data:` prefix** — the wire format Phase 1's transport requires. Probe the
   actual first characters, since a `data:` prefix would be accepted by the type and rejected by
   the provider.
9. **The images do not reach the turn log.** Drive `runReviewStage` and assert no argument of
   `appendTurn` contains the base64 payload. Same idiom as Phase 1's test.
10. **`CriticLens.seesRender` is true for exactly one lens**, derived from the table rather than
    hand-listed, so adding a fourth critic cannot silently start sending it pictures.

**Fixtures are validated against the real schema before the plan is trusted.** Plan-authored
fixtures are sketches — `hero` props need `headline` AND `primaryCta`, a bullet item takes
`title`. The document used for render tests is pulled from a real stored `project_data`, not
minted.

**Browser-dependent tests are separated from pure ones.** The tiling maths, the template
assembly and the failure paths are testable with an injected fake launcher and must not need a
browser. Only a small number of tests launch a real Chrome, and they skip (loudly, with a
printed reason — never silently) when none is available.

**Real-app verification is required and a preview harness does not count.** Drive the real
builder on a real dev server on a port that is not 3050, get a real review to run, and show the
art director filing a finding that names something invisible in the document. Annotated
screenshots with markers burned into the PNGs, in `screenshots/builder-self-render/`.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **The dependency breaks the Vercel build, and this cannot be verified from here.** Vercel CLI and the MCP connector both 403 on the `darren-pauls-projects` scope in this environment | Stated plainly in the report rather than assumed away. A runtime flag cannot protect against a build-time failure; the owner must watch the first deploy. Everything downstream of the dependency fails soft |
| The render shows a page the owner would never see (missing wrapper, missing fonts) and the critic reports a disaster on a good page | §5.1's effect-based test; §5.3's `typographyFaithful` probe; the prompt tells the critic what the picture is and is not authoritative for |
| Chromium cold start or bundle size slows the hottest builder route | Dynamic `import()`; the render only runs on turns that already earn a review (first drafts and Polish), never on ordinary edits |
| Vision tokens make the review materially dearer | ~9,100 tokens on a stage already making four calls, on the Sonnet critic rather than the Opus reviser; `MAX_TILES` bounds the worst case; the existing `tokensUsed` accounting already reports it |
| A long page is silently cut off and the critic concludes the page ends there | `truncated` is reported to the critic in words |
| Giving one critic more input manufactures false cross-lens agreement | §6.2: a different modality matched to a lens, not more of the same information. The comment stating the old invariant is updated in the same commit |
| The renderer drifts from what publish ships | It renders the already-resolved document with the same `{funnelBasePath, brandKit}` the route computed, and never re-resolves (§5.2) |

---

## 12. What is explicitly NOT in this build

- **Mobile / multi-viewport rendering.** Most landing-page traffic is mobile and this renders
  desktop only. Doubling the images doubles the cost, and the layout defects this is built to
  catch show at both widths. Deferred, deliberately, not forgotten.
- **The builder model seeing the page on ordinary edit turns.** Chosen against: it would put a
  render and vision tokens on every "make the headline bolder".
- **The reviser seeing the page** (§9).
- **Storing the render** in any form (§5.6).
- **Pixel-diffing between revisions**, or any before/after comparison.
- **Rendering on the publish path** as a gate.
- **Shipping extra font faces into the container** to make `bold` / `editorial` / `athletic`
  render "correctly" — there is no correct (§5.3).
- Everything Phase 1 excluded that remains excluded: multiple reference images, arbitrary CSS
  (C1), new section kinds (C2), multi-page turns (C5), custom web fonts (C7), image generation
  (C8).

---

## 13. Decisions taken rather than asked

- **The art director gets eyes; no fourth critic** (§6.1).
- **Tiles plus an overview, not one full-page image** — measured illegibility at 359px wide
  (§5.4).
- **No new stream phase** — four consumers, to buy a label for a sub-step of a phase that
  already exists (§8).
- **`puppeteer-core` for both environments**, with only the executable differing (§4.1).
- **The renderer lives outside `reviewDoc`**, so the pipeline keeps no browser dependency (§7).
- **Typeface fidelity is out of scope and the critic is told so**, rather than chased with
  bundled fonts that would match no real visitor (§5.3).
