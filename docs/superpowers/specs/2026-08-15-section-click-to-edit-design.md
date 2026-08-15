# Click-to-edit for AI-built funnel pages — design

**Status:** design, approved for implementation planning
**Date:** 2026-08-15
**Supersedes nothing.** Implements the mechanism of
[2026-08-15-sites-funnels-builder-design.md](../plans/2026-08-15-sites-funnels-builder-design.md)
§7.2, §8 and §9 over the engine this repo already has, rather than porting that
document's platform.

---

## 1. The defect this starts from

An owner builds a page in the AI builder. It is good. They click the designer
button on the funnel board to tweak it, and get **a blank canvas**.

Nothing is broken in the way it looks. Two editors exist over two different
document formats, and a step's page lives in exactly one of them:

| Editor | Column | Format |
|---|---|---|
| AI builder (`/edit/[stepId]`) | `funnel_steps.project_data` | `SectionDoc` — a flat array of 10 typed section kinds |
| Visual designer (`/edit/[stepId]/design`) | `funnel_steps.page_tree` | `PageTree` — section → row → column → element |

`design/page.tsx` reads `page_tree`, finds null on every AI-built page, and
falls back to `emptyPageTree()`. That is the blank canvas.

**Two consequences make this worse than a cosmetic bug.**

1. **It is a live data-loss path.** Both editors bump the same
   `funnel_steps.doc_revision` (deliberately — one lock, two writers). Pressing
   Save on that blank canvas writes an empty `page_tree` *and* advances the
   revision, so the owner's next AI chat turn 409s against a page that now looks
   empty to one editor and full to the other.
2. **The designer cannot publish at all.** `compilePageTree` has no caller
   outside its own test file. Task 12 of the visual-builder plan ("publish what
   it made") shipped its entry-point half and not its publish half.

## 2. What we are building instead

The owner edits the AI page **in place, on the real rendered page**, and the AI
chat keeps working beside it. No format conversion, no fidelity loss, no second
document.

The governing idea is the source design's §2, and it already describes this
repo:

> Content is JSON. The renderer is a pure function from JSON to an HTML string.
> In editor mode it stamps JSON paths onto DOM nodes. The canvas reports intent;
> it never owns state.

## 3. Why we port the mechanism and not the platform

[The source design](../plans/2026-08-15-sites-funnels-builder-design.md)
describes a white-label agency product: `agencies` / `accounts` / `sites` /
`pages` tables, tenancy, custom domains, its own renderer, its own schema. Built
as written it would stand up a **third** page engine beside the SectionDoc
engine and the Craft tree.

Its own appendix names that as the source repo's largest avoidable mistake:
*"The source has three editors over two content models. Port only the
signature/click-to-edit path."*

Almost every piece it specifies already exists here under a different name:

| Source design | This repo |
|---|---|
| `PageContent` + Zod | `SectionDoc` / `sectionDocSchema` (10 kinds, not 7) |
| `render(content, brand, theme, { editable })` | `reassemble()` → `renderSection()` |
| `data-edit` path anchors | **new** — §5 below |
| srcdoc iframe canvas | `PreviewPane` — same-origin, double-buffered, scroll-preserving |
| `applyTransform(content, path, value)` | `applyOps()` |
| save with re-validation | `appendTurn()` |
| section inspector | **new** — §6 below |
| publish | `renderDocForPublish` + the publish route, unchanged |

**Not ported:** §4 tenancy, §5 tables, §6.2 SiteChrome, §11 image pipeline, §13
serving. The funnels subsystem already owns those jobs for a single operator.

### 3.1 One place we improve on the source

The source spends ~700 lines of untyped vanilla JS on an injected canvas runtime
and calls it "the honest cost" (§8.5): no type checking, no syntax highlighting,
**no backticks anywhere inside the template literal**.

We pay none of it. The source's canvas is a `srcdoc` iframe with no framework
inside, so it *must* inject a runtime and invent a `postMessage` protocol. Our
canvas is a real Next.js route (`/funnel-preview/[stepId]`) in a **same-origin**
iframe with `allow-same-origin allow-scripts`. The parent already reaches into
`contentWindow` (PreviewPane reads `scrollY` for its double buffer), so the
parent's own typed React code can bind listeners directly onto
`iframe.contentDocument`.

No runtime, no protocol, no template literal, and the backtick hazard the source
warns about never arises.

## 4. Architecture

```
                    SectionDoc  (funnel_steps.project_data)
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
   AI chat turn                      click / inspector edit
   (build route,                     (NEW edit route,
    model call)                       no model call)
        │                                   │
        └──────────► applyOps(doc, ops) ◄───┘
                          │
                    appendTurn(doc, expectedRevision)   ← one optimistic lock
                          │
                    project_data + doc_revision
                          │
                 reassemble(doc, { editable })
                          │
              ┌───────────┴───────────┐
       editable: false          editable: true
       (publish, /go)           (preview iframe only)
```

Both writers converge on `applyOps` and `appendTurn`. That is the whole
concurrency story: a click and a chat turn are the same kind of event, take the
same lock, and produce the same receipt.

`applyOps` was written for this. Its docblock already says so:

> `rawOps` is deliberately `unknown` rather than `SectionOp[]`: this function is
> the one place ops get validated, so it must be safe to call with whatever a
> model (**or, on the inspector path, a hand-built request body with no AI
> involved at all**) actually sent.

## 5. Editable render mode — the path anchors

`RenderContext` gains one optional flag. `editable: true` changes nothing
visually; it adds attributes.

| Attribute | On | Value |
|---|---|---|
| `data-sec` | every `<section>` | the section id |
| `data-edit` | a text-bearing node | `<prop path>`, e.g. `headline`, `items.0.title` |
| `data-edit-empty` | an unset optional field's placeholder | — |
| `data-item` | a repeating item's wrapper | the item index |

Paths are **relative to the section's own props** and the section id is carried
separately, rather than one absolute `sections.2.items.0.title` string. Section
ids are stable and index positions are not: a `move_section` renders every
absolute path stale, and `update_section` addresses sections by id anyway.

### 5.1 Three rules that are not stylistic

- **Never `data-djp-*`.** `filterAttrs` strips that prefix from every non-island
  element *before* the plain `data-*` passthrough runs, silently. The section
  renderer already documents this for `data-h`/`data-align`; the same trap
  applies here.
- **Public renders emit none of these.** `editable` defaults to false, so
  publish and `/go` are byte-identical to today. A snapshot test pins that.
- **Unset optional fields get a placeholder anchor.** An absent `sub` renders as
  a dimmed "Add a subheading" carrying `data-edit` and `data-edit-empty`. The
  source design calls this "the single most common *I can't edit this* bug", and
  it is correct: without an anchor there is no pixel to click, so an empty
  optional field is unreachable forever.

## 6. The inspector — fields derived, never declared

The inspector's fields are **introspected from each kind's Zod schema**, not
hand-written per kind.

This repo has shipped three bugs from restating a validation rule instead of
calling the thing that owns it, and a hand-written field table is exactly that
shape of mistake: the day someone widens `bulletItemSchema`, the inspector keeps
offering the old fields and the new one is uneditable, silently.

`lib/funnels/sections/fields.ts` exposes:

```ts
fieldsForSection(section: Section): FieldGroup[]
```

It walks the kind's `propsSchema` against the section's **current props** — the
current value is required, because `testimonial` and `faq` are discriminated
unions and which branch's fields apply depends on the value of `source`.

Mapping:

| Zod | Field |
|---|---|
| `ZodString` | `text` (`textarea` past a length threshold) |
| `ZodNumber` | `number` |
| `ZodBoolean` | `checkbox` |
| `ZodEnum` | `select` |
| `ZodOptional` / `ZodDefault` | unwrap, mark optional |
| `ZodArray<ZodObject>` | repeater — add / remove / reorder, bounds from `min`/`max` |
| `ZodArray<ZodString>` | string list, same bounds |
| `ZodIntersection` | merge both sides' fields |
| `ZodDiscriminatedUnion` | the branch matching the current discriminant, plus a select to switch branch |
| `ctaWithLabelSchema` | a dedicated CTA editor (label + target kind + target value) |

`CtaTarget` gets a hand-built editor rather than a generic union walk. It is the
one field whose validity is not local: a `{kind:"program", ref:"…"}` is only
publishable if the name resolves to exactly one row, and the inspector should
say so at edit time rather than at publish time.

An invariant test asserts that for every kind, every key in the props schema is
reachable through some field. That is the guard that makes derivation
trustworthy rather than merely clever.

## 7. Gestures

Taken from the source design §8.3, including the mistake it records:

- **Single click selects** the most specific thing under the pointer, and never
  fires a side effect.
- **Double click edits.** Text goes `contenteditable`; an image slot opens the
  picker. **Text wins over an enclosing image slot**, so a headline lying on a
  hero photo edits rather than swapping the photo.
- **Escape cancels, Enter/blur commits.**
- **Placeholder editing starts empty**, and remembers its text so Escape can
  restore it. Otherwise Enter on an untouched placeholder commits the literal
  words "Add a subheading" as the owner's copy.

The source shipped image-before-text precedence first and made the hero
unselectable — a full-bleed hero is one image slot, so every pixel of the first
screen opened the picker. We start at click-selects.

## 8. The write path

`PUT /api/admin/funnels/steps/[stepId]/edit`, body `{ ops, revision }`.

- Guarded by `canAccessAdminPath`, wrapped in `withAudit({ action:
  "funnel.updated", category: "admin_write" })`, like every sibling route.
- `applyOps` validates. Any invalid op rejects the **whole batch**; the stored
  document is untouched.
- `appendTurn` writes with the compare-and-swap. A stale revision is a **409**
  carrying the current revision, never a blind retry — a lost update here is a
  page reverting, not a merge conflict.
- The turn is logged with `role: "owner"` and a human summary derived from the
  op's own `DiffReceipt` ("Hero — headline"), so the chat transcript stays an
  honest record of everything that changed the page, whether a model or a click
  did it.

Refusing `docInvalid` is mandatory: a step holding legacy GrapesJS state must
not be "edited" into a fresh document over the top of the owner's page.

## 9. Stage 0 — the blank canvas, closed first

Independent of everything above, and shipped first because it is a live
data-loss path.

`design/page.tsx` currently opens `emptyPageTree()` whenever `page_tree` is
null. It must instead branch on what the step actually holds:

| `page_tree` | `project_data` | Behaviour |
|---|---|---|
| valid tree | anything | designer opens on it (today's behaviour) |
| null | valid `SectionDoc` | **refuse** — explain the page is an AI page and link to its editor |
| null | invalid / legacy | **refuse** — today's `treeInvalid` screen wording |
| null | null | empty canvas — arriving here *is* the decision to build visually |

Refusing rather than converting is deliberate at this stage: conversion is Stage
4, it is one-way, and it is held (§11).

## 10. Testing

Following the source design's §20 — a small list that catches silent failures —
plus this repo's own hard-won ones.

| Test | Catches |
|---|---|
| Render every kind with `editable: false`, snapshot | anchors leaking into published HTML |
| Every text field in a fixture has a reachable `data-edit` | unreachable copy |
| Unset optional field renders a placeholder anchor | the "I can't edit this" bug |
| `data-djp-edit` would be stripped — assert the chosen prefix survives `compileFunnelStep` | the reserved-prefix trap, which fails silently |
| `fieldsForSection` covers every schema key, for all 10 kinds | inspector/schema drift |
| Discriminated-union kinds return the branch matching current props | editing a `live` testimonial as if it were `quote` |
| Edit route with a stale revision → 409, document unchanged | lost updates |
| Edit route on a `docInvalid` step → refused, nothing written | overwriting a legacy page |
| An op batch with one bad op → whole batch rejected | half-applied edits |
| Design route on a SectionDoc step → refuses, no empty tree offered | the Stage 0 defect regressing |

Two repo-specific rules apply to all of it: assertions must be able to fail
(this repo's dominant defect is tests that pass without verifying their claim),
and a test that renders markup must assert against the classes the markup
actually emits.

## 11. Scope and staging

| Stage | Content | State |
|---|---|---|
| 0 | Close the blank canvas | in scope |
| 1 | Editable render mode, anchors, selection, inspector, edit route | in scope |
| 2 | Inline text editing on the page | in scope |
| 3 | Image slots and the picker | in scope |
| 4 | `SectionDoc` → `PageTree` conversion + the missing tree publish half | **held** |

Stage 4 is held on the owner's decision. It is the stage with the worst payoff —
the tree engine has 7 element types and inline styles only, so a converted page
returns visibly poorer than the AI's version — and §3 of the owner's own source
design argues against investing further in Craft.js at all. Stage 0 keeps the
designer safe in the meantime rather than deleting it. Re-opening Stage 4 is
cheap and better-informed after Stage 2 ships.

## 12. Explicitly out of scope

- Tenancy, agencies, sub-accounts, custom domains.
- A second content schema or a second renderer.
- Any change to `/go` serving, the publish gate, or `compileFunnelStep`.
- Deleting the Craft designer. It stays, reachable, for blank pages.
