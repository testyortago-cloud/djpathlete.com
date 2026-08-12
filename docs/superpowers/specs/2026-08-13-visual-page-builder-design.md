# Visual page builder — stages 1 & 2

**Date:** 2026-08-13
**Status:** Approved (design), implementation pending
**Branch:** `feat/page-builder`
**Scope:** Stage 1 (document model + compiler) and Stage 2 (editor MVP)

## Problem

The funnel system can only be edited by talking to it. The AI section builder
produces good pages, but there is no way to nudge a heading four pixels, split a
row into two columns, or drop a button exactly where you want it. Darren wants
what GoHighLevel gives him: a canvas he drags things onto.

There was a drag canvas — GrapesJS — and it was deleted in `ac1f7946`. Its
commit message is the design brief for this one. GrapesJS went because it fought
the app rather than because dragging was wrong: the CSP forced `cssIcons: ""` so
every toolbar button rendered as a blank square, it silently discarded every
island setting typed into it, ~230 of its 359 lines were adaptation scar tissue,
and it cost 13 MB. **A replacement must be React-native, must treat islands as
first-class, and must not ship a second styling engine.**

## What already exists

This is not a from-zero build. Already present and reusable:

| Asset | Role here |
| --- | --- |
| `FunnelNode` (`text \| el \| island`) + `NodeRenderer` | The published format and its renderer. Unchanged. |
| `htmlToNodes`, `safeUrl`, `safeStyle` (`compile/sanitize.ts`) | The security primitives element compilers call. |
| 6 islands: `form`, `checkout`, `event`, `booking`, `testimonials`, `faq` | The dynamic elements in the palette. |
| `ISLAND_TRAITS` (`lib/funnels/island-fields.ts`) | Settings-panel field metadata, preserved from the GrapesJS deletion "to become Stage 2's section-inspector metadata". |
| `funnel_step_versions`, publish/rollback, `?preview=1` iframe | Publishing. Unchanged. |
| `doc_revision` optimistic lock | Two-tab safety. Reused. |
| `@dnd-kit`, TipTap | Already dependencies. |

**Prod currently holds zero funnels** (verified 2026-08-12 while applying
`00205`). There is no legacy content to migrate, which is why the model changes
now rather than later.

## Design

### 1. `PageTree` — the draft document

`SectionDoc` is a flat array of ten fixed section kinds. That is the wrong shape
for a builder whose whole point is arbitrary composition, so stage 1 introduces a
recursive tree in `lib/funnels/tree/`.

```
PageTree  { v: 1, engine: "tree", theme: PageTheme, sections: Section[] }
  Section { id, style: BoxStyle, rows: Row[] }
    Row   { id, style: BoxStyle, layout: RowLayout, columns: Column[] }
      Column  { id, style: BoxStyle, elements: Element[] }
        Element = Heading | Text | Image | Button | Divider | Spacer | Island
```

`RowLayout` is `"1" | "1-1" | "1-1-1" | "1-1-1-1" | "1-2" | "2-1"`. **Column
count is derived from the layout, never stored beside it** — a `columns.length`
that disagreed with `layout` would be a document that renders differently from
how it validates, and there would be no correct way to resolve it. The schema
refines `columns.length === segmentsOf(layout)`.

`BoxStyle` is one shape at every level:

```ts
interface BoxStyle {
  padding?: Sides          // { top, right, bottom, left } — CSS length strings
  margin?: Sides
  background?: { color?: string; image?: string }
  border?: { width?: string; style?: "solid"|"dashed"|"dotted"; color?: string }
  radius?: string
  align?: "left" | "center" | "right"
  maxWidth?: string
}
```

Text-bearing elements add `TypeStyle` (`fontSize`, `fontWeight`, `lineHeight`,
`color`, `letterSpacing`). Every value is a raw CSS string **validated per
property** — a colour must parse as a colour, a length as a length — with brand
tokens offered as presets in the pickers. Free values are deliberate: `/go/`
pages are campaign pages that must be able to match the ad that points at them,
and that trade-off was settled when the drag canvas was first chosen.

IDs are short and stable (`s1`, `r2`, `c3`, `e4`) and are also anchor targets,
matching the convention `SectionDoc` already uses.

### 2. `ElementDef` — one definition, two consumers

This is the load-bearing idea, and the thing most likely to be got wrong.

The canvas shows React components. The published page renders `FunnelNode`s.
If those are written as two separate implementations, they drift, and the moment
they drift "what you see is what you get" becomes false in a way nobody notices
until a customer sees the page. This repo has shipped that class of bug before
from twin code paths.

So each element type is defined exactly once, in `lib/funnels/tree/elements/`:

```ts
interface ElementDef<K extends ElementKind, P> {
  kind: K
  label: string                              // palette + inspector
  icon: LucideIcon                           // palette
  defaultProps: P                            // what dropping one gives you
  propsSchema: z.ZodType<P>                  // validation
  fields: FieldSpec[]                        // the settings panel
  Render: (args: { props: P; style: BoxStyle }) => ReactElement   // CANVAS
  compile: (args: { props: P; style: BoxStyle }) => FunnelNode    // PUBLISH
}
```

`Render` and `compile` are two halves of one definition and are tested against
each other: for every element, at its defaults and at a populated fixture, the
compiled node must render to the same markup the canvas component produces.
That round-trip test is the guarantee, not the comment above it.

Island elements do not re-declare their fields — `fields` comes from
`ISLAND_TRAITS`, which is already derived from the schemas the compiler
validates against, so an island can never offer a setting publish would reject.

### 3. Compiling

`compilePageTree(tree): { nodes: FunnelNode[]; problems: string[] }` in
`lib/funnels/tree/compile.ts`.

It walks the tree and calls each element's `compile`. It does **not** route
through `compileFunnelStep`: that function's job is parsing an untrusted HTML
string, and a typed tree has no HTML to parse. Sections, rows and columns become
`el` nodes with inline `style` attributes; islands become `island` nodes.

Two places take untrusted input, and both call the existing primitives rather
than restating their rules:

- **Rich text** (`Heading`, `Text`) holds TipTap HTML. It compiles through
  `htmlToNodes`, which is exactly the allowlisting sanitiser it was built to be.
  This is the only path by which free HTML can reach a published page.
- **URLs** (`Image.src`, `Button.href`) go through `safeUrl`.

Inline styles go through `safeStyle`.

**v1 emits no stylesheet.** Every style is an inline `style` attribute, which
`NodeRenderer` already converts via `styleStringToObject`. That is sufficient for
desktop-only and removes a whole subsystem from stage 2. Stage 4 (responsive)
cannot use inline styles for media queries and will need a CSS-emitting path plus
`scopeCss`; that is a known and accepted stage-4 cost, noted here so it is not a
surprise.

### 4. The editor

Craft.js (`@craftjs/core`, MIT, peer range includes React 19 — verified against
this tree's React `^19.0.0`) owns **only the editing session**: nested drag,
selection, drag handles, undo/redo. It is not a document format and not a
styling engine.

`PageTree` remains the persisted truth. Craft's serialized state is converted to
`PageTree` on save and validated by the schema; the schema, not Craft, decides
what a legal document is.

Layout at `/admin/funnels/[id]/edit/[stepId]/design`:

```
┌──────────┬────────────────────────────┬──────────────┐
│ palette  │          canvas            │  inspector   │
│ Layout   │  ┌──────────────────────┐  │  (selected   │
│  Section │  │ section              │  │   node)      │
│  Row     │  │ ┌────────┬─────────┐ │  │              │
│ Basic    │  │ │ column │ column  │ │  │  Content     │
│  Heading │  │ └────────┴─────────┘ │  │  Style       │
│  Text …  │  └──────────────────────┘  │              │
│ Dynamic  │                            │              │
│  Form …  │  Section › Row › Column › Heading         │
└──────────┴────────────────────────────┴──────────────┘
```

The canvas renders in-document, wrapped in `#djp-funnel-root`, so page styles
stay confined by the same prefix the published stylesheet uses. The residual
risk runs the other way — the admin app's base layer inheriting into the canvas
and making it look subtly unlike production. Mitigated by a reset boundary on the
canvas wrapper, and by keeping the existing `?preview=1` iframe reachable as the
pre-publish truth check. This is honestly a fidelity *approximation*, not a
guarantee; the iframe is the guarantee.

Text elements edit inline on the canvas with TipTap, as GHL does.

### 5. Persistence

- New nullable `page_tree jsonb` column on `funnel_steps`, beside `project_data`.
  Nothing existing is touched or migrated; a step has a `SectionDoc`, a
  `PageTree`, or neither.
- New route `PUT /api/admin/funnels/steps/[stepId]/tree`, taking
  `{ tree, revision }` and reusing the existing `doc_revision` optimistic lock so
  a second tab still cannot clobber a first. `applyOps` is currently reachable
  only through the AI build route, so this is the first non-AI write path.
- Publish reuses `renderDocForPublish`'s shape: compile the tree, write a
  `funnel_step_versions` row. Rollback and `/go/` are untouched.

**Which editor a step opens in** is decided by the columns, not by a mode flag:
`page_tree` present → the design editor; otherwise → the existing chat builder.
A flag would be a third thing that can disagree with the two columns.

**Yesterday's create hand-off is unchanged.** `CreatePageDialog` still routes new
landing pages into the AI builder with the first prompt firing — that flow works
and nothing here improves it. The design editor is entered deliberately, via a
"Design" action on the card and a link from the builder. Stage 5, which puts the
AI onto `PageTree`, is where the two flows converge; making them converge now
would mean rewriting the AI ops layer before a single element has been dragged.

### 6. The v1 palette

**Layout:** Section, Row (6 layouts), Column.
**Basic:** Heading, Text, Image, Button, Divider, Spacer.
**Dynamic:** the 6 existing islands, fields from `ISLAND_TRAITS`.

### 7. Out of scope

Stage 3 style inspector (full spacing/background/border/typography UI — v1 ships
the inspector shell with content fields and a minimal style section), stage 4
responsive overrides, stage 5 AI on `PageTree`, stage 6 templates and saved
sections. No video or icon element: a video embed needs a new `frame-src` host in
`next.config.mjs`, which is invisible to tests unless asserted in config.

## Testing

| Test | Guards |
| --- | --- |
| `PageTree` schema: valid trees pass, `columns.length ≠ layout` fails | The one invariant that has no correct resolution |
| Round-trip fidelity, per element, defaults + populated | `Render`/`compile` drift — the WYSIWYG guarantee |
| Rich text compiles through `htmlToNodes` (a `<script>` in TipTap output is stripped) | The only free-HTML path |
| `safeUrl` applied to `Image.src` / `Button.href` (`javascript:` rejected) | URL injection |
| Island `fields` come from `ISLAND_TRAITS`, not a copy | Settings the schema would reject |
| Craft state → `PageTree` serialization | The editor/persistence boundary |
| Save route: stale `revision` 409s | Two-tab clobber |

Every test names the mutant it kills. A test that passes without verifying its
claim is the dominant defect class in this repo.

## Risks

1. **Scale.** Stages 1+2 are the largest single piece of work in this app. The
   spec is deliberately staged so stage 1 is verifiable headlessly before any
   editor exists.
2. **Canvas fidelity** (§4) — approximation, with the iframe as the check.
3. **Two document models coexist** until stage 5 migrates the AI onto `PageTree`.
   Accepted deliberately: `SectionDoc` pages keep working untouched, and no page
   is ever half-migrated. The cost is a second publish path until stage 5.
