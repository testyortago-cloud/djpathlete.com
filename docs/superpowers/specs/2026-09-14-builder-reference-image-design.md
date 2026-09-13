# Giving the page builder's AI eyes — Phase 1: a pasted reference design

**Date:** 2026-09-14
**Status:** approved, ready for planning
**Closes:** [`docs/builder-gaps.md`](../../builder-gaps.md) row **C3** ("Paste a reference design
or brand board image into chat")
**Does NOT close:** row **C4** (the model seeing its own rendered page) — that is Phase 2 and
is deliberately out of scope. See §9.
**Applies to:** both boards. `/admin/funnels/[id]/edit/[stepId]` and
`/admin/pages/[id]/edit/[stepId]` render the same `FunnelBuilder`, post to the same
`POST /api/admin/funnels/steps/[stepId]/build`, and share one prompt. One change covers both.

---

## 1. The problem, stated as the code states it

The 2026-09-13 build widened the design vocabulary from 12 page looks to a palette system, five
font pairings, density/width/rhythm and eight per-section knobs. The owner can now *ask* for a
look. What they still cannot do is **show** one.

Today the only way to communicate a visual direction is to type it:

> The build route takes text only.
> — [`docs/builder-gaps.md`](../../builder-gaps.md), row C3

Three code facts make that exact:

- **`ChatPane.tsx` has no attachment path of any kind.** No `onPaste`, no `<input type="file">`,
  no drag target. `onSend: (text: string) => void` is the entire outbound contract.
- **`buildMessageRequestSchema`** ([`lib/validators/funnel.ts:372`](../../../lib/validators/funnel.ts))
  is `{action?, message: string, revision: number}`. A body carrying anything else is rejected
  at the door.
- **`streamAgent` / `callAgent`** ([`lib/ai/anthropic.ts`](../../../lib/ai/anthropic.ts)) take
  `userMessage: string` and pass it to the AI SDK as `prompt: <string>`. There is no shape in
  which a non-text part could travel, even if the route wanted to send one.

So the owner's real reference — the competitor page they like, the brand board their designer
sent, the screenshot of the look they are chasing — has to be *described in prose* to a model
that would read the image far better than it reads the description. The model is multimodal;
the pipe is not.

### 1a. Why prose is a lossy channel here, specifically

The design vocabulary the 2026-09-13 build added is exactly the kind of thing an image answers
and a sentence does not. "Make it feel premium" has to become a palette, a font pairing, a
density, a width and a rhythm — five decisions the owner does not have names for. An image
carries all five at once and the model can name them itself.

---

## 2. What this build does

One sentence: **the owner pastes an image into the builder chat, the model reads it for design
direction, and what it took from it is written into the document so it survives later turns.**

Five changes, in dependency order:

1. **Transport** — `callAgent` / `streamAgent` gain an optional `images` argument and switch
   from `prompt: <string>` to the AI SDK's `messages: [...]` form when one is present (§3).
2. **Request** — `buildMessageRequestSchema` gains an optional `image` field: allowlisted media
   type, size cap. Never stored (§4).
3. **Client** — paste handler and file picker in `ChatPane`, downscaling in the browser to
   ≤1568px on the long edge before upload (§5).
4. **The durable note** — `theme.designNote`, a new OPTIONAL ≤400-char string on
   `sectionDocThemeSchema`, readable and editable in `ThemePanel` (§6).
5. **Prompt** — instructions in `SECTION_BUILDER_BLOCK_DESIGN` for what to read out of an
   image, what to write into `designNote`, and to say plainly in `reply` what could NOT be
   matched (§7).

**Done means:** a pasted image visibly changes the page the AI builds, and the direction it
took survives into later turns.

---

## 3. Transport — the image rides in the user message

### 3.1 The constraint that shapes everything else

`SECTION_BUILDER_BLOCK_A` + `SECTION_BUILDER_BLOCK_DESIGN` + Block B form the **cached system
prefix**. Anthropic's cache is a strict prefix match. The 2026-09-13 build already paid for
this lesson twice — the variation seed lives in Block C for exactly this reason, and
`prompt.test.ts` pins it — so it is restated here as a hard rule rather than re-derived:

> **The image goes in Block C, the user message. The system prompt must be byte-identical
> whether or not an image is attached.**

An image interpolated into, or even *mentioned by*, the system prompt would be a silent cache
invalidator on every turn of every page — including the overwhelming majority of turns that
carry no image at all. The prompt instructions in §7 are therefore written to be
*unconditionally present and conditionally relevant* ("when the owner attaches a reference
image…"), never conditionally rendered.

This is directly testable and §10 requires the test.

### 3.2 The shape

`callAgent` and `streamAgent` gain one optional option:

```ts
images?: ReadonlyArray<{ mediaType: string; data: string }>   // data: base64, no data: prefix
```

When absent, the call is **byte-identical to today's**: `prompt: userMessage`. When present, it
becomes:

```ts
messages: [{ role: "user", content: [
  { type: "text",  text: userMessage },
  { type: "image", image: <base64>, mediaType: <mediaType> },
] }]
```

`{type: "image", image, mediaType}` is the AI SDK v6 `ImagePart` shape, **verified against the
installed types** (`node_modules/@ai-sdk/provider-utils/dist/index.d.ts:568`, ai@6.0.97 /
@ai-sdk/anthropic@3.0.46) rather than recalled. The provider converts it to Anthropic's
`{type:"image", source:{type:"base64", media_type, data}}`.

Text part FIRST, image SECOND. Anthropic's own guidance is that an image placed before its
instructions reads better on some tasks, but here the text part is the whole turn context (the
document, the history, the owner's sentence) and the image is one supporting attachment; the
instruction "read the attached reference" needs to be in front of the model before the
attachment is. This is a judgement call, recorded so it can be revisited rather than
rediscovered.

### 3.3 The trap: `prompt` and `messages` are mutually exclusive AT THE TYPE LEVEL

The AI SDK's `Prompt` type (`node_modules/ai/dist/index.d.ts:677`) is a union whose branches
carry `messages?: never` and `prompt?: never`. So this does **not** compile:

```ts
// WRONG — will not typecheck, and the error is confusing
streamObject({ ...common, ...(images ? { messages } : { prompt: userMessage }) })
```

A conditional spread widens both keys to `string | undefined`, which matches neither branch.
The implementation must branch into **two complete call expressions**, or hoist the shared
options into a `const` and pass the prompt-or-messages key literally in each branch. Written
down because it costs a confusing half-hour otherwise.

### 3.4 What does NOT change

`structuredOutputMode: "jsonTool"`, the cache-control block on the system prompt, the retry
policy on `callAgent`, the deliberate absence of one on `streamAgent`, and every existing
caller. `images` is optional; every call site that does not pass it is untouched.

---

## 4. The request — transient means transient

### 4.1 The schema

`buildMessageRequestSchema` gains:

```ts
image: z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  data: z.string().min(1).max(BUILDER_REFERENCE_IMAGE_MAX_BASE64),
}).optional()
```

- **Allowlist, not a regex.** Four types, matching what Anthropic's vision endpoint accepts.
  Deliberately NOT the five `app/api/upload/funnel-image/route.ts` accepts: that route allows
  `image/avif`, which Anthropic does not take. Two lists that look alike and differ in one
  member is exactly the divergent-regex bug class this repo has shipped three times, so each
  list states in a comment what it is a list OF, and neither imports the other.
- **The cap is a NAMED constant** in `builder-config.ts`, alongside the builder's other
  tunables, never a bare literal. Sized in §5.3.
- **Optional**, so every existing `{message, revision}` body keeps working verbatim and the
  four-member `buildRequestSchema` union stays unambiguous — `image` appears on exactly one
  member and carries no `action` literal, so it cannot make a body match two members.

### 4.2 The image is never stored. Anywhere.

A brand board is private commercial material and a competitor screenshot is somebody else's
copyright. Neither becomes an object in our bucket or a row in our database.

Concretely, the image:

- is **not** passed to `appendTurn`. `funnel_step_turns` has a `message` text column; the row
  records the owner's typed sentence and nothing else.
- is **not** written to Firebase Storage. It does not go near `lib/funnel-storage.ts`, which
  exists to make funnel media **publicly readable forever** — precisely the wrong property.
- is **not** put in `theme.bg`, `heroMedia.src`, or any other document field. A document field
  would be published to anonymous visitors.
- is **not** logged. `ai_generation_log` and every `console.*` in the route get the text.

It exists as base64 in one request body, is handed to the model, and is garbage after the
response. §10 requires a test that asserts it does not reach the turn log.

**The cost of this choice, stated honestly:** the image is gone after the turn. Turn 5 cannot
re-examine it. That is what §6 exists to compensate for, and why the note is the load-bearing
half of this design rather than a nicety.

### 4.3 One image per turn

`images` on the transport is an array because the Anthropic content block list is one, and a
single-element array costs nothing extra. The request schema, the client and the prompt all
handle exactly **one**. Multiple references ("match this layout but that colour scheme") is a
different feature with its own interaction design — the model needs to be told which image is
which — and is explicitly not built here (§9).

---

## 5. The client — downscale in the browser

### 5.1 Why the browser

Claude downscales every image to ~1568px on the long edge before the model sees it. Sending
more pixels than that costs upload time and request size and buys **nothing** — the extra
pixels are discarded server-side.

This repo already reasons this way one directory over. `app/api/upload/funnel-image/route.ts`
insists the *client* supplies width and height, with the comment: "The browser already has the
decoded image, so it is the cheapest correct place to measure; the alternative is an
image-processing dependency on the server to re-derive what the picker already knew." The same
argument applies with more force to resizing: doing it server-side would mean a `sharp`-class
dependency in a Next.js route to produce an image the model was going to shrink anyway.

Typical saving on a 4K screenshot: ~10x.

### 5.2 How

`<canvas>`, no dependency:

1. `createImageBitmap(file)` (or an `<img>` + `decode()` fallback) to get real dimensions.
2. If `max(w, h) <= 1568`, keep the original bytes and media type — re-encoding a small PNG
   costs quality for nothing.
3. Otherwise scale by `1568 / max(w, h)`, draw to a canvas, and `toBlob("image/jpeg", 0.85)`.
   JPEG because a photographed/screenshotted reference is continuous-tone; the resulting media
   type is `image/jpeg` regardless of what went in.
4. Read to base64 and strip the `data:<type>;base64,` prefix — the wire format is bare base64.

**Transparency note, accepted deliberately:** a PNG with an alpha channel flattens onto black
when drawn to an untagged canvas and encoded as JPEG. The fix is one line — fill the canvas
with `#ffffff` before `drawImage` — and the implementation does that. A brand board with a
transparent background should read as ink-on-white, not ink-on-black.

### 5.3 The cap

After downscale, a 1568px JPEG at q0.85 is typically 150-400 KB binary (~200-540 KB base64).
`BUILDER_REFERENCE_IMAGE_MAX_BASE64 = 2_000_000` characters (~1.5 MB binary) sits well above
the realistic worst case and well below any platform body limit.

The client checks the ORIGINAL file size too, before decoding, against a separate looser bound
(10 MB), so dropping a 200 MB TIFF in fails immediately with a sentence instead of hanging the
tab on a canvas draw. Two bounds, two purposes, both named.

### 5.4 The UI

- **Paste** (`onPaste` on the composer textarea) is the primary path and the one the owner
  asked for. `event.clipboardData.files` / `.items` filtered to `type.startsWith("image/")`.
- **A file picker** beside Send — a small paperclip `Button` over a visually-hidden
  `<input type="file" accept="image/*">` — because paste does not exist on a tablet and is not
  discoverable on a desktop.
- **Drag-and-drop is NOT built.** Paste plus picker covers every device; a third path is a
  third set of states to get wrong.
- **A thumbnail chip above the composer** once an image is attached, with the file name, the
  post-downscale size, and a remove "×". The owner must be able to see what they attached and
  take it back before spending a turn.
- **One image replaces the previous one.** Attaching a second swaps it, with no error — the
  schema takes one, so the UI should never let a second accumulate and then be silently dropped.
- The chip **clears on send**, like the composer text. An image is attached to a TURN, not to
  the session; leaving it pinned would silently re-send it on every later turn, spending vision
  tokens the owner did not ask for and confusing "make the headline bolder" with a fresh brief.
- **The owner message in the transcript says an image was attached** — a small "Reference image
  attached" line under their text. Otherwise the transcript is a false record of the turn:
  re-reading it later, the owner sees a sentence that does not explain the page they got.
- Admin UI is **light-only**. No `.dark` variant.

### 5.5 Threading it through

`ChatPane`'s `onSend: (text: string) => void` becomes
`onSend: (text: string, image?: ReferenceImage) => void`. Every existing call site — the five
starter chips, the "Fix it for me" button, `Enter`, the Send button — passes text only and is
unchanged. `FunnelBuilder.send` gains the same optional second argument and puts it in the POST
body.

The starter chips deliberately do NOT carry the attachment: they are complete first messages in
their own right, and a chip that silently consumed a staged image would be surprising.

---

## 6. `theme.designNote` — the part that makes it stick

### 6.1 Why a stored note and not "just send the image again"

The image is transient (§4.2). Without a durable record, the reference influences exactly one
turn, and the owner's fifth follow-up ("make the headline bolder") is answered by a model that
has no idea a brand board was ever involved. The result would be a page that drifts back to the
builder's defaults over a conversation — which is the *original* complaint this whole line of
work exists to fix.

`buildTurnMessage` already sends the **whole document** on every turn. So anything written into
the document is automatically in front of the model forever, at no extra plumbing cost. The
document is the per-turn context; the note rides it for free.

### 6.2 The shape

```ts
designNote: z.string().max(400).optional()    // on sectionDocThemeSchema
```

**OPTIONAL, and this is not negotiable.** `SectionDoc` is stored JSON in
`funnel_steps.project_data` and `reassemble()` parses it on EVERY render, on both boards. A
required new key does not fail a migration — it fails every existing stored draft, permanently.
The 2026-09-13 build's five new theme keys are all optional for this reason and the comment on
`sectionDocThemeSchema` says so. §10 requires a test that a document without `designNote` still
parses.

**400 characters** is a paragraph: enough for "Warm sand palette, editorial serif headings,
generous spacing, wide full-bleed sections, photography-led" plus a sentence of intent. Short
enough that it cannot become a second document smuggled into the theme. It is a note, not a
brief.

**The delete sentinel comes free.** `sectionDocThemePatchSchema` is *derived* from
`sectionDocThemeSchema` — every key already optional there becomes `.nullable()` in the patch.
Adding an optional key to the stored schema automatically makes `{designNote: null}` a valid
`set_theme` op. No change needed, and a test should pin that it actually happened rather than
assuming the derivation covered it.

**Purely advisory.** No renderer reads it. `styles.ts`, `render.ts`, `resolve.ts` and the
publish gate are all untouched — the note changes what the MODEL does, never what the page
emits.

**Stated precisely, because the loose version of this sentence would age into being wrong:**
the note is never *rendered* to a visitor — `/go/<slug>` renders `funnel_step_versions.nodes`
and `.css` through `NodeRenderer` and does not read `project_data` at all. But `publishStep`
(`lib/db/funnels.ts:433`) DOES copy the whole document, note included, into
`funnel_step_versions.project_data`. So the note is a stored admin-side field that reaches an
immutable version row on publish; it is not visitor-visible content. That is an acceptable
property for a design note the owner wrote and can edit — and it is emphatically NOT the
property the *image* would have had, which is why §4.2 keeps the image out of the document
entirely rather than reasoning the same way about it.

### 6.3 In the panel

`ThemePanel` gets a full-width `<textarea>` labelled **"Design direction"** with the
hint *"What this page's look is based on. The AI reads this on every change."* — under the
existing four optional selects, above "Base theme".

- `maxLength={400}` on the control, matching the schema, so the owner is stopped by the input
  rather than by a validation error after the fact.
- Writes through the SAME `onChange(patch)` contract as every other control. This panel emits a
  theme patch and nothing else — `ThemePanel.tsx`'s own header comment forbids a second write
  path and this change must not introduce one.
- **Committed on blur, not per keystroke.** Every other control here is a `<select>` that fires
  once. A textarea firing `onChange` per character would be one `set_theme` op — one turn, one
  revision, one row in `funnel_step_turns` — PER LETTER. Local state while typing, one patch on
  blur (and only when the value actually changed).
- **Empty string clears it**, sending `null`, not `""`. An empty-but-present note is a field
  the model reads as "the direction is: nothing", which is not what an owner who cleared the box
  meant.

---

## 7. The prompt — read it, record it, and be honest about the gap

All of this goes in **`SECTION_BUILDER_BLOCK_DESIGN`**, never Block A (which is the
per-kind-duplication tripwire and has 62 characters of headroom) and never Block B (per-page).

### 7.1 What to read the image FOR

The vocabulary the document can actually express, and nothing else:

- **palette** — the reference's colours, as a named preset or a custom `{brand, accent, mode}`
- **font** — which of the five pairings the reference's type feels closest to
- **density** and **width** — how much air it uses, how wide it runs
- **rhythm** — whether sections alternate, band, or run flat
- **page recipe and section structure** — what the reference page is SHAPED like

### 7.2 Record what was taken

Write a short line into `theme.designNote` (via `set_theme`) saying what the reference gave the
page. The prompt must say **why**: the image is not kept, so the note is the only memory of it —
and later turns must respect it.

### 7.3 Say what could NOT be matched

In `reply`, plainly, both halves:

> "I matched the colours and the spacing. I couldn't match the overlapping headline — there's
> no way to express that here."

**This honesty is a deliberate product choice, chosen over silently approximating.** An owner
who is told the overlap is impossible can decide what to do; an owner shown a page that quietly
dropped it concludes the AI is bad at its job. `ChatPane`'s own header comment makes the same
argument about the diff receipt: the trust problem with a chat page-builder is epistemic.

The reply cap is `SECTION_BUILDER_MAX_REPLY_LENGTH` (1200) and is not raised — two extra
sentences fit.

### 7.4 Paying for the characters

Measured on this branch's base:

| Block | Length | Ceiling | Headroom |
|---|---|---|---|
| `SECTION_BUILDER_BLOCK_A` | 20,638 | 20,700 | 62 |
| `SECTION_BUILDER_BLOCK_DESIGN` | 3,202 | 3,400 | 198 |

198 characters will not be enough for §7.1-7.3. **The house procedure applies:** compact the
existing Block DESIGN prose first, measure the saving, then raise
`SECTION_BUILDER_BLOCK_DESIGN_MAX` by the measured remainder — never by a round number chosen in
advance — and write the reason into the test beside the existing raise notes, in the same style
as Block A's raise history. Report before and after.

Block A's ceiling is **not** touched. The two ceilings are deliberately separate constants
(`builder-config.ts` says why: Block A's exists as a tripwire against per-kind duplication, and
folding new vocabulary into it would turn a specific tripwire into a general one).

---

## 8. Data flow, end to end

```
owner pastes  ──> ChatPane: downscale ≤1568px, base64, stage as chip
                              │
                              ▼
              FunnelBuilder.send(text, image)
                  POST /api/admin/funnels/steps/[id]/build
                  { message, revision, image: {mediaType, data} }
                              │
                              ▼
              buildRequestSchema: allowlist + size cap
                              │
                appendTurn({ message })         ← TEXT ONLY. no image.
                              │
                              ▼
              buildSystemPrompt(...)            ← BYTE-IDENTICAL, image or not
              buildTurnMessage(...)             ← Block C text, unchanged shape
                              │
                              ▼
              streamAgent(system, turnMessage, schema, { images: [image] })
                  messages: [{role:"user", content:[text, image]}]
                              │
                              ▼
              model ──> ops incl. set_theme { palette, font, …, designNote }
                              │
                applyOps ──> project_data                ← the note persists
                              │
                              ▼
              every LATER turn: buildTurnMessage sends the whole doc,
              so designNote is in front of the model with no extra plumbing
```

---

## 9. What is explicitly NOT in this build

Each stays `open` in `docs/builder-gaps.md`:

- **Phase 2 — the model seeing its own rendered page** (row C4). Split off deliberately so
  Phase 1 can be used first. Research already done and recorded for whoever picks it up:
  `@vercel/og` is Satori and **cannot** render these pages (no CSS grid); the viable path is
  `puppeteer-core` + `@sparticuz/chromium` with `page.setContent(html + css)`, needing no URL
  and no auth. Blog posts citing a 50 MB function limit are stale — Vercel now allows 5 GB on
  Fluid Compute.
- **Pixel-matching.** The model maps a reference onto the typed vocabulary. It does not
  reproduce a layout.
- **Arbitrary CSS** (row C1). Unchanged: a CSS escape hatch lets preview and publish diverge.
- **Extracting or reusing photographs out of the reference.** No cropping the hero shot out of
  a competitor's page. Beyond the copyright problem, `heroMediaSchema.src` needs a URL that is
  public forever, and §4.2 is that we store nothing.
- **Multiple images per turn** (§4.3).
- **Storing the image** (§4.2), in any form, including a thumbnail.
- **Image generation or stock search** (row C8).
- **New section kinds** (row C2), multi-page turns (C5), funnel-structure edits (C6), custom
  web fonts (C7).

---

## 10. Testing

Targeted suites plus a build, per the standing instruction. No full-suite run.

**The tests that carry this build's actual claims:**

1. **The cached prefix is byte-identical with and without an image.**
   `buildSystemPrompt(input)` is unchanged by the feature, and Block DESIGN's new text is
   unconditional. Follows `prompt.test.ts`'s existing byte-stability idiom.
2. **The image does not reach the turn log.** Drive the real route with a body carrying an
   image; assert the `appendTurn` call's `message` is the owner's text and that the base64
   payload appears in NO argument to it.
3. **A document with no `designNote` still parses.** The stored-draft invariant. Use a real
   pre-existing document shape, not one minted to pass.
4. **`{designNote: null}` is a valid `set_theme` patch** — the derived delete sentinel actually
   covered the new key.
5. **`{designNote: "…401 chars"}` is rejected**, and 400 is accepted — the bound is probed at
   its edge, not merely "a long string fails".
6. **Transport shape:** with `images`, the SDK receives `messages` with a text part and an
   image part and NO `prompt`; without, it receives `prompt` and no `messages`. Assert the
   actual argument object, not that the call happened.
7. **Media type allowlist:** each of the four passes; `image/avif` and `text/html` are rejected.
   Derived from the allowlist constant, not a hand-listed table of "known-good pairs" — a
   hand-maintained pair table is where four unreadable-text bugs hid last session.
8. **Both size caps fire** — one base64 char over, and the client's original-file bound.
9. **`ChatPane`:** a paste event with an image stages a chip; send passes it to `onSend`; the
   chip clears after send; a second attachment replaces the first; remove clears it.
10. **`ThemePanel`:** the note renders, edits, commits ONE patch on blur (not per keystroke),
    and an emptied box sends `null`.

**Fixtures are validated against the real schema before the plan is trusted.** Plan-authored
fixtures are sketches: `hero` props take `headline` (not `heading`); a bullet item takes `title`
(not `text`). And `html.includes(text)` false-negatives when the text contains an apostrophe,
which `escapeHtml` encodes — nearly a fictional bug report last session.

**Real-app verification is required and a preview harness does not count.** Paste a real
reference image into the real builder chat at `/admin/funnels/<id>/edit/<stepId>`, on a real
dev server on a port that is not 3050 (another session's), and show the page changing because
of it. Annotated screenshots, markers burned into the PNGs, in `screenshots/<feature>/`.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A per-turn value leaks into the cached prefix and silently costs a full prefix write on every turn of every page | §3.1 forbids it; test 1 pins it; the existing `prompt.test.ts` suite already guards Block A against per-process values |
| The model writes a 400-char note on a turn that had no image, crowding the theme | Prompt scopes the note to a reference being attached; the owner can clear it in the panel; it is advisory and renders nothing |
| `designNote` drifts into a second brief that fights the owner's later instructions | 400-char cap; the owner can read and edit it in `ThemePanel`, which is the whole reason §6.3 exists |
| An owner expects pixel-matching and gets a vocabulary mapping | §7.3: the model says out loud what it could not match. This is the design, not a failure mode to hide |
| A large body slows or fails the request | Downscale in the browser (~10x), two named caps, and the client bound fails fast before decoding |
| Transparent PNG flattens to black | Canvas filled white before `drawImage` (§5.2) |
| The `prompt`/`messages` union produces a confusing type error | §3.3: branch into two call expressions, do not conditionally spread |

---

## 12. Decisions taken rather than asked

- **The note lives on `theme`, not on a new top-level `SectionDoc` field.** `theme` is where
  page-level design direction already lives, `sectionDocThemePatchSchema` derives its delete
  sentinel automatically, and `ThemePanel` already exists as the place to see and edit it. A new
  top-level field would need all three built from scratch.
- **400 characters, not 1000.** A note, not a brief. It is in the context of every future turn,
  so its cost is per-turn and permanent.
- **JPEG output from the downscale, not WebP.** Universally accepted by the vision endpoint;
  WebP's saving does not matter at this size.
- **Commit-on-blur for the note.** The alternative — a Save button — is one more control in a
  panel where every other control commits itself.
- **No drag-and-drop.** Paste plus picker covers every device (§5.4).
