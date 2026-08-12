# Visual Page Builder Implementation Plan (stages 1 & 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GHL-style drag-and-drop page builder — section → row → column → element — persisted as a validated `PageTree` and published through the existing `FunnelNode` renderer.

**Architecture:** `PageTree` is a recursive typed draft document. Each element type is defined once as an `ElementDef` whose `Render` (canvas) and `compile` (publish) halves are tested against each other, so WYSIWYG is enforced rather than asserted. Craft.js owns only the editing session; the Zod schema decides what a legal document is. Publishing compiles the tree straight to `FunnelNode`s — no HTML round-trip — with rich text and URLs passing through the existing sanitiser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Zod, `@craftjs/core` (MIT), TipTap, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-08-13-visual-page-builder-design.md](../specs/2026-08-13-visual-page-builder-design.md)

## Global Constraints

- **Reuse the security primitives; never restate them.** Rich text → `htmlToNodes`. URLs → `safeUrl`. Inline styles → `safeStyle`. All from `lib/funnels/compile/sanitize.ts`.
- **Island settings come from `ISLAND_TRAITS`** (`lib/funnels/island-fields.ts`). Never hand-write island fields.
- **No hardcoded colours or fonts in admin UI.** Semantic classes only. (Page *content* styles are user data and are exempt — that is the whole point of the builder.)
- **Column count is derived from `RowLayout`.** Never stored twice.
- **v1 emits no stylesheet.** Styles are inline `style` attributes.
- **Targeted tests only** (`npx vitest run <path>`), plus `npm run build` at the end. Never the full suite.
- **Stage explicit paths in commits.** `git add -A` is unsafe in this repo.
- **Never gate on a piped command's exit code.** Redirect to a file and capture `$?`.

---

### Task 1: Install Craft.js and prove it mounts under React 19

**Files:**
- Modify: `package.json`
- Create: `__tests__/components/admin/builder/craft-mounts.test.tsx`

**Interfaces:**
- Produces: `@craftjs/core` available; a proven-working minimal `<Editor>` mount.

- [ ] **Step 1: Install**

```bash
npm install @craftjs/core@^0.2.12 --no-audit --no-fund
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/components/admin/builder/craft-mounts.test.tsx`:

```tsx
// Craft.js declares React ^19 in its peer range, but a peer range is a claim,
// not a proof. GrapesJS also "supported" this app until its icons rendered as
// blank squares under our CSP. This test is the proof, and it runs before a
// single element is built on top of the assumption.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Editor, Frame, Element, useNode } from "@craftjs/core"

function Box({ children }: { children?: React.ReactNode }) {
  const { connectors } = useNode()
  return (
    <div ref={(ref) => { if (ref) connectors.connect(ref) }} data-testid="box">
      {children}
    </div>
  )
}
Box.craft = { displayName: "Box" }

describe("@craftjs/core under React 19", () => {
  it("mounts an editor and renders a connected node", () => {
    render(
      <Editor resolver={{ Box }}>
        <Frame>
          <Element is={Box} canvas>
            <Box />
          </Element>
        </Frame>
      </Editor>,
    )
    expect(screen.getAllByTestId("box").length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run it**

Run: `npx vitest run __tests__/components/admin/builder/craft-mounts.test.tsx`
Expected: PASS. **If it fails, STOP and report** — the editor engine choice is invalidated and the spec needs revisiting before any more work.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json __tests__/components/admin/builder/craft-mounts.test.tsx
git commit -m "chore(builder): craft.js, and a test that it actually mounts under React 19"
```

---

### Task 2: `PageTree` types and schema

**Files:**
- Create: `lib/funnels/tree/types.ts`, `lib/funnels/tree/schema.ts`
- Test: `__tests__/lib/funnels/tree/schema.test.ts`

**Interfaces:**
- Produces:
  - `ROW_LAYOUTS`, `type RowLayout`, `segmentsOf(layout: RowLayout): number[]`
  - `BoxStyle`, `TypeStyle`, `Sides`
  - `ELEMENT_KINDS`, `type ElementKind`
  - `PageTree`, `Section`, `Row`, `Column`, `Element` types
  - `pageTreeSchema`, `emptyPageTree(): PageTree`

- [ ] **Step 1: Write types**

Create `lib/funnels/tree/types.ts`:

```ts
// lib/funnels/tree/types.ts — the draft document a visual page is edited as.
//
// SectionDoc is a FLAT array of ten fixed section kinds, which is the right
// shape for a builder that writes whole sections and the wrong shape for one
// where the owner drags a button into the left half of a row. Hence a tree.
//
// The published format is unchanged: this compiles to FunnelNode.

export const ROW_LAYOUTS = ["1", "1-1", "1-1-1", "1-1-1-1", "1-2", "2-1"] as const
export type RowLayout = (typeof ROW_LAYOUTS)[number]

/**
 * The flex ratios a layout expands to. THE COLUMN COUNT IS DERIVED FROM HERE
 * AND IS NEVER STORED BESIDE IT: a `columns.length` that disagreed with
 * `layout` would be a document that renders differently from how it validates,
 * and there is no correct way to resolve that disagreement.
 */
export function segmentsOf(layout: RowLayout): number[] {
  return layout.split("-").map((segment) => Number(segment))
}

export interface Sides {
  top?: string
  right?: string
  bottom?: string
  left?: string
}

export interface BoxStyle {
  padding?: Sides
  margin?: Sides
  background?: { color?: string; image?: string }
  border?: { width?: string; style?: "solid" | "dashed" | "dotted"; color?: string }
  radius?: string
  align?: "left" | "center" | "right"
  maxWidth?: string
}

export interface TypeStyle {
  fontSize?: string
  fontWeight?: string
  lineHeight?: string
  color?: string
  letterSpacing?: string
}

export const ELEMENT_KINDS = [
  "heading",
  "text",
  "image",
  "button",
  "divider",
  "spacer",
  "island",
] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]

export interface PageTheme {
  tone: "light" | "dark"
  accent: "accent" | "primary"
  radius: "sharp" | "soft" | "round"
}

export interface ElementNode {
  id: string
  kind: ElementKind
  style: BoxStyle
  type?: TypeStyle
  props: Record<string, unknown>
}

export interface Column {
  id: string
  style: BoxStyle
  elements: ElementNode[]
}

export interface Row {
  id: string
  style: BoxStyle
  layout: RowLayout
  columns: Column[]
}

export interface Section {
  id: string
  style: BoxStyle
  rows: Row[]
}

export interface PageTree {
  v: 1
  engine: "tree"
  theme: PageTheme
  sections: Section[]
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/funnels/tree/schema.test.ts`:

```ts
// The tree's one un-resolvable invariant is layout-vs-column-count. Everything
// else can be defaulted or clamped; that one cannot, because either answer
// changes what the page looks like.

import { describe, it, expect } from "vitest"
import { pageTreeSchema, emptyPageTree } from "@/lib/funnels/tree/schema"
import { segmentsOf } from "@/lib/funnels/tree/types"

function tree(layout: string, columnCount: number) {
  return {
    v: 1,
    engine: "tree",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "s1",
        style: {},
        rows: [
          {
            id: "r1",
            style: {},
            layout,
            columns: Array.from({ length: columnCount }, (_, i) => ({
              id: `c${i + 1}`,
              style: {},
              elements: [],
            })),
          },
        ],
      },
    ],
  }
}

describe("pageTreeSchema", () => {
  it("accepts a row whose column count matches its layout", () => {
    expect(pageTreeSchema.safeParse(tree("1-1", 2)).success).toBe(true)
  })

  it("REJECTS a row whose column count contradicts its layout", () => {
    // MUTANT KILLED: omitting the refine. A 3-column row labelled "1-1" would
    // validate, then render two columns and silently drop the third's content.
    const parsed = pageTreeSchema.safeParse(tree("1-1", 3))
    expect(parsed.success).toBe(false)
  })

  it("rejects an unknown layout", () => {
    expect(pageTreeSchema.safeParse(tree("1-1-1-1-1", 5)).success).toBe(false)
  })

  it("emptyPageTree() is itself valid", () => {
    // MUTANT KILLED: a starter document the schema refuses — the editor would
    // fail to save the moment it was opened on a new page.
    expect(pageTreeSchema.safeParse(emptyPageTree()).success).toBe(true)
  })

  it("segmentsOf derives the column count", () => {
    expect(segmentsOf("1-2")).toEqual([1, 2])
    expect(segmentsOf("1-1-1")).toHaveLength(3)
  })
})
```

- [ ] **Step 3: Run it — expect failure (module missing)**

Run: `npx vitest run __tests__/lib/funnels/tree/schema.test.ts`

- [ ] **Step 4: Write the schema**

Create `lib/funnels/tree/schema.ts`:

```ts
import { z } from "zod"
import { ROW_LAYOUTS, ELEMENT_KINDS, segmentsOf, type PageTree, type RowLayout } from "./types"

const cssLength = z.string().max(40)
const cssColor = z.string().max(60)

const sidesSchema = z
  .object({
    top: cssLength.optional(),
    right: cssLength.optional(),
    bottom: cssLength.optional(),
    left: cssLength.optional(),
  })
  .strict()

export const boxStyleSchema = z
  .object({
    padding: sidesSchema.optional(),
    margin: sidesSchema.optional(),
    background: z.object({ color: cssColor.optional(), image: z.string().max(600).optional() }).strict().optional(),
    border: z
      .object({
        width: cssLength.optional(),
        style: z.enum(["solid", "dashed", "dotted"]).optional(),
        color: cssColor.optional(),
      })
      .strict()
      .optional(),
    radius: cssLength.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    maxWidth: cssLength.optional(),
  })
  .strict()

export const typeStyleSchema = z
  .object({
    fontSize: cssLength.optional(),
    fontWeight: z.string().max(20).optional(),
    lineHeight: z.string().max(20).optional(),
    color: cssColor.optional(),
    letterSpacing: cssLength.optional(),
  })
  .strict()

const idSchema = z.string().min(1).max(24)

export const elementSchema = z
  .object({
    id: idSchema,
    kind: z.enum(ELEMENT_KINDS),
    style: boxStyleSchema,
    type: typeStyleSchema.optional(),
    // Per-kind props are validated by the element registry (Task 3), which owns
    // the schemas. Validating them twice, in two places, is how the two drift.
    props: z.record(z.string(), z.unknown()),
  })
  .strict()

export const columnSchema = z
  .object({ id: idSchema, style: boxStyleSchema, elements: z.array(elementSchema).max(50) })
  .strict()

export const rowSchema = z
  .object({
    id: idSchema,
    style: boxStyleSchema,
    layout: z.enum(ROW_LAYOUTS),
    columns: z.array(columnSchema).min(1).max(4),
  })
  .strict()
  .refine((row) => row.columns.length === segmentsOf(row.layout as RowLayout).length, {
    message: "columns must match the row layout",
    path: ["columns"],
  })

export const sectionSchema = z
  .object({ id: idSchema, style: boxStyleSchema, rows: z.array(rowSchema).max(30) })
  .strict()

export const pageTreeSchema = z
  .object({
    v: z.literal(1),
    engine: z.literal("tree"),
    theme: z
      .object({
        tone: z.enum(["light", "dark"]),
        accent: z.enum(["accent", "primary"]),
        radius: z.enum(["sharp", "soft", "round"]),
      })
      .strict(),
    sections: z.array(sectionSchema).max(30),
  })
  .strict()

export function emptyPageTree(): PageTree {
  return { v: 1, engine: "tree", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] }
}
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx vitest run __tests__/lib/funnels/tree/schema.test.ts`

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/tree/types.ts lib/funnels/tree/schema.ts __tests__/lib/funnels/tree/schema.test.ts
git commit -m "feat(builder): a page is a tree, and a row's columns cannot contradict its layout"
```

---

### Task 3: The `ElementDef` contract and the style compiler

**Files:**
- Create: `lib/funnels/tree/style.ts`, `lib/funnels/tree/element-def.ts`
- Test: `__tests__/lib/funnels/tree/style.test.ts`

**Interfaces:**
- Consumes: `BoxStyle`, `TypeStyle` (Task 2); `safeStyle` from `@/lib/funnels/compile/sanitize`.
- Produces:
  - `styleToCss(box: BoxStyle, type?: TypeStyle): string` — an inline style string, already `safeStyle`-checked
  - `interface ElementDef<P>` as in the spec
  - `type AnyElementDef`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/funnels/tree/style.test.ts`:

```ts
// Styles are the one part of this document that is genuinely user-authored free
// text, so they are the one part that must go through the existing sanitiser
// rather than being trusted because we built the object it came from.

import { describe, it, expect } from "vitest"
import { styleToCss } from "@/lib/funnels/tree/style"

describe("styleToCss", () => {
  it("expands sides into longhand properties", () => {
    const css = styleToCss({ padding: { top: "10px", bottom: "20px" } })
    expect(css).toContain("padding-top:10px")
    expect(css).toContain("padding-bottom:20px")
    expect(css).not.toContain("padding-left")
  })

  it("emits background colour and image", () => {
    const css = styleToCss({ background: { color: "#ff0000", image: "https://x.test/a.png" } })
    expect(css).toContain("background-color:#ff0000")
    expect(css).toContain("background-image:url(")
  })

  it("strips a declaration the sanitiser rejects", () => {
    // MUTANT KILLED: building the style string by concatenation and trusting it
    // because we built it. `safeStyle` exists precisely because a colour field
    // is a text input and a text input takes anything.
    const css = styleToCss({ background: { color: "url(javascript:alert(1))" } })
    expect(css).not.toContain("javascript:")
  })

  it("returns an empty string for an empty style", () => {
    expect(styleToCss({})).toBe("")
  })

  it("merges type styles for text elements", () => {
    const css = styleToCss({}, { fontSize: "32px", color: "#111" })
    expect(css).toContain("font-size:32px")
    expect(css).toContain("color:#111")
  })
})
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/lib/funnels/tree/style.test.ts`

- [ ] **Step 3: Implement `styleToCss`**

Create `lib/funnels/tree/style.ts`:

```ts
// lib/funnels/tree/style.ts — BoxStyle/TypeStyle -> an inline style string.
//
// v1 emits NO STYLESHEET: every style is an inline `style` attribute, which
// NodeRenderer already turns back into a React style object. That is enough for
// desktop-only and removes a whole subsystem from stage 2. Stage 4 (responsive)
// cannot express media queries inline and will need a real CSS emitter plus
// scopeCss — a known, accepted cost recorded in the spec.

import { safeStyle } from "@/lib/funnels/compile/sanitize"
import type { BoxStyle, Sides, TypeStyle } from "./types"

function sides(prefix: string, value: Sides | undefined, out: string[]): void {
  if (!value) return
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const v = value[side]
    if (v) out.push(`${prefix}-${side}:${v}`)
  }
}

/**
 * The result is passed through `safeStyle`, the same allowlist the published
 * HTML path uses. Every value here originated in a text input, so "we built
 * this object" is not a reason to trust its contents.
 */
export function styleToCss(box: BoxStyle, type?: TypeStyle): string {
  const out: string[] = []

  sides("padding", box.padding, out)
  sides("margin", box.margin, out)

  if (box.background?.color) out.push(`background-color:${box.background.color}`)
  if (box.background?.image) out.push(`background-image:url(${box.background.image})`)
  if (box.border?.width) out.push(`border-width:${box.border.width}`)
  if (box.border?.style) out.push(`border-style:${box.border.style}`)
  if (box.border?.color) out.push(`border-color:${box.border.color}`)
  if (box.radius) out.push(`border-radius:${box.radius}`)
  if (box.align) out.push(`text-align:${box.align}`)
  if (box.maxWidth) out.push(`max-width:${box.maxWidth}`)

  if (type?.fontSize) out.push(`font-size:${type.fontSize}`)
  if (type?.fontWeight) out.push(`font-weight:${type.fontWeight}`)
  if (type?.lineHeight) out.push(`line-height:${type.lineHeight}`)
  if (type?.color) out.push(`color:${type.color}`)
  if (type?.letterSpacing) out.push(`letter-spacing:${type.letterSpacing}`)

  if (out.length === 0) return ""
  return safeStyle(out.join(";")) ?? ""
}
```

- [ ] **Step 4: Write the `ElementDef` contract**

Create `lib/funnels/tree/element-def.ts`:

```ts
// The load-bearing contract of this feature.
//
// The canvas shows React components; the published page renders FunnelNodes.
// Written as two implementations they drift, and the moment they drift WYSIWYG
// is false in the way nobody notices until a customer sees the page. So an
// element is defined ONCE and the two halves are tested against each other
// (see __tests__/lib/funnels/tree/fidelity.test.tsx).

import type { ReactElement } from "react"
import type { z } from "zod"
import type { LucideIcon } from "lucide-react"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import type { BoxStyle, ElementKind, TypeStyle } from "./types"

export interface FieldSpec {
  name: string
  label: string
  type: "text" | "richtext" | "number" | "checkbox" | "select" | "json" | "url"
  options?: { id: string; label: string }[]
}

export interface ElementRenderArgs<P> {
  props: P
  style: BoxStyle
  type?: TypeStyle
}

export interface ElementDef<P = Record<string, unknown>> {
  kind: ElementKind
  label: string
  icon: LucideIcon
  /** What dropping one onto the canvas gives you. Must satisfy propsSchema. */
  defaultProps: P
  propsSchema: z.ZodType<P>
  /** The inspector's Content tab. Islands take these from ISLAND_TRAITS. */
  fields: FieldSpec[]
  /** What the CANVAS shows. */
  Render: (args: ElementRenderArgs<P>) => ReactElement
  /** What gets PUBLISHED. */
  compile: (args: ElementRenderArgs<P>) => FunnelNode
}

export type AnyElementDef = ElementDef<never>
```

- [ ] **Step 5: Run the style test — expect PASS**

Run: `npx vitest run __tests__/lib/funnels/tree/style.test.ts`

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/tree/style.ts lib/funnels/tree/element-def.ts __tests__/lib/funnels/tree/style.test.ts
git commit -m "feat(builder): one element definition, with the canvas and the published page as its two halves"
```

---

### Task 4: The six basic elements + the fidelity harness

**Files:**
- Create: `lib/funnels/tree/elements/heading.tsx`, `text.tsx`, `image.tsx`, `button.tsx`, `divider.tsx`, `spacer.tsx`, `index.ts`
- Test: `__tests__/lib/funnels/tree/fidelity.test.tsx`

**Interfaces:**
- Consumes: `ElementDef` (Task 3), `styleToCss` (Task 3), `htmlToNodes`/`safeUrl` from sanitize.
- Produces: `ELEMENT_REGISTRY: Record<ElementKind, AnyElementDef>`, `getElementDef(kind)`.

- [ ] **Step 1: Write the fidelity harness first**

Create `__tests__/lib/funnels/tree/fidelity.test.tsx`:

```tsx
// THE WYSIWYG GUARANTEE.
//
// Every element is rendered twice — once as the canvas component, once by
// compiling it to a FunnelNode and rendering that through the real published
// renderer — and the two must produce the same markup. Without this the two
// halves of ElementDef drift and the canvas quietly stops predicting the page.

import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ELEMENT_REGISTRY } from "@/lib/funnels/tree/elements"
import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import type { ElementKind } from "@/lib/funnels/tree/types"

const context = { funnelBasePath: "/go/x", stepSlug: "index" } as never

/** A populated fixture per kind, so the test covers more than empty defaults. */
const POPULATED: Partial<Record<ElementKind, { props: Record<string, unknown> }>> = {
  heading: { props: { html: "<h2>Real headline</h2>", level: 2 } },
  text: { props: { html: "<p>Some <strong>copy</strong>.</p>" } },
  image: { props: { src: "https://example.test/a.png", alt: "A" } },
  button: { props: { label: "Go", href: "/contact" } },
  divider: { props: {} },
  spacer: { props: { height: "40px" } },
}

describe("canvas and published output agree", () => {
  for (const kind of Object.keys(POPULATED) as ElementKind[]) {
    it(`${kind}: defaults render identically`, () => {
      const def = ELEMENT_REGISTRY[kind]
      const args = { props: def.defaultProps as never, style: {} }
      const canvas = renderToStaticMarkup(def.Render(args))
      const published = renderToStaticMarkup(
        <NodeRenderer nodes={[def.compile(args)]} context={context} />,
      )
      expect(published).toBe(canvas)
    })

    it(`${kind}: populated props render identically`, () => {
      const def = ELEMENT_REGISTRY[kind]
      const args = { props: POPULATED[kind]!.props as never, style: { padding: { top: "8px" } } }
      const canvas = renderToStaticMarkup(def.Render(args))
      const published = renderToStaticMarkup(
        <NodeRenderer nodes={[def.compile(args)]} context={context} />,
      )
      expect(published).toBe(canvas)
    })
  }
})

describe("element safety", () => {
  it("strips a script from rich text on compile", () => {
    // MUTANT KILLED: passing TipTap HTML through as a text node or, worse, as
    // dangerouslySetInnerHTML. Rich text is the ONLY free-HTML path into a
    // published page.
    const def = ELEMENT_REGISTRY.text
    const node = def.compile({
      props: { html: "<p>ok</p><script>alert(1)</script>" } as never,
      style: {},
    })
    expect(JSON.stringify(node)).not.toContain("script")
  })

  it("rejects a javascript: href on a button", () => {
    const def = ELEMENT_REGISTRY.button
    const node = def.compile({
      props: { label: "x", href: "javascript:alert(1)" } as never,
      style: {},
    })
    expect(JSON.stringify(node)).not.toContain("javascript:")
  })
})
```

- [ ] **Step 2: Run it — expect failure (registry missing)**

Run: `npx vitest run __tests__/lib/funnels/tree/fidelity.test.tsx`

- [ ] **Step 3: Implement the elements**

Each file follows this shape. `heading.tsx`:

```tsx
import { z } from "zod"
import { Heading1 } from "lucide-react"
import { htmlToNodes } from "@/lib/funnels/compile/sanitize"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import type { ElementDef } from "../element-def"
import { styleToCss } from "../style"

const propsSchema = z.object({
  html: z.string().max(2000),
  level: z.number().int().min(1).max(6),
})
type HeadingProps = z.infer<typeof propsSchema>

/**
 * Rich text is stored as TipTap HTML and compiled through `htmlToNodes` — the
 * allowlisting sanitiser the published path already uses. The canvas half must
 * therefore render the SAME sanitised nodes, not the raw html, or the two
 * halves disagree the moment someone pastes markup.
 */
function nodesFor(html: string): FunnelNode[] {
  return htmlToNodes(html).nodes
}

export const headingDef: ElementDef<HeadingProps> = {
  kind: "heading",
  label: "Heading",
  icon: Heading1,
  defaultProps: { html: "<h2>Your headline</h2>", level: 2 },
  propsSchema,
  fields: [
    { name: "html", label: "Text", type: "richtext" },
    {
      name: "level",
      label: "Level",
      type: "select",
      options: [1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), label: `H${n}` })),
    },
  ],
  Render: ({ props, style, type }) => {
    const css = styleToCss(style, type)
    return renderNodes(nodesFor(props.html), css)
  },
  compile: ({ props, style, type }) => ({
    t: "el",
    tag: "div",
    attrs: styleToCss(style, type) ? { style: styleToCss(style, type) } : {},
    children: nodesFor(props.html),
  }),
}
```

**`renderNodes` is a shared canvas helper** — create `lib/funnels/tree/elements/render-nodes.tsx`:

```tsx
// The canvas half of every rich-text element renders the SAME FunnelNodes the
// published half compiles to, through the SAME renderer. That is what makes the
// fidelity test able to pass at all — and what stops it being a test that
// compares two hand-written approximations of each other.

import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import type { FunnelRenderContext } from "@/components/funnels/islands"

const CANVAS_CONTEXT = { funnelBasePath: "", stepSlug: "" } as unknown as FunnelRenderContext

export function renderNodes(children: FunnelNode[], css: string) {
  return (
    <NodeRenderer
      nodes={[{ t: "el", tag: "div", attrs: css ? { style: css } : {}, children }]}
      context={CANVAS_CONTEXT}
    />
  )
}
```

Write `text.tsx` (same shape, `<p>` default, no `level`), `image.tsx` (`src` through
`safeUrl`, `alt`, emits `img`), `button.tsx` (`label`, `href` through `safeUrl`,
emits `a`), `divider.tsx` (emits `hr`), `spacer.tsx` (`height`, emits a `div`
with `height` in its style).

Then `index.ts`:

```ts
import type { ElementKind } from "../types"
import type { AnyElementDef } from "../element-def"
import { headingDef } from "./heading"
import { textDef } from "./text"
import { imageDef } from "./image"
import { buttonDef } from "./button"
import { dividerDef } from "./divider"
import { spacerDef } from "./spacer"
import { islandDef } from "./island"

export const ELEMENT_REGISTRY = {
  heading: headingDef,
  text: textDef,
  image: imageDef,
  button: buttonDef,
  divider: dividerDef,
  spacer: spacerDef,
  island: islandDef,
} as unknown as Record<ElementKind, AnyElementDef>

export function getElementDef(kind: ElementKind): AnyElementDef {
  return ELEMENT_REGISTRY[kind]
}
```

- [ ] **Step 4: Run the fidelity test — expect PASS**

Run: `npx vitest run __tests__/lib/funnels/tree/fidelity.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/tree/elements __tests__/lib/funnels/tree/fidelity.test.tsx
git commit -m "feat(builder): six elements, and a test that the canvas predicts the page"
```

---

### Task 5: The island element

**Files:**
- Create: `lib/funnels/tree/elements/island.tsx`
- Test: `__tests__/lib/funnels/tree/island-element.test.ts`

**Interfaces:**
- Consumes: `ISLAND_TRAITS` (`lib/funnels/island-fields.ts`), `ISLAND_NAMES` (`lib/funnels/islands.ts`).
- Produces: `islandDef`, `fieldsForIsland(name: IslandName): FieldSpec[]`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/funnels/tree/island-element.test.ts`:

```ts
// ISLAND_TRAITS was deliberately kept when the GrapesJS editor was deleted, to
// become exactly this. Hand-writing island fields here would recreate the bug
// its own comments describe: a control the schema rejects, or a default with no
// control at all.

import { describe, it, expect } from "vitest"
import { fieldsForIsland } from "@/lib/funnels/tree/elements/island"
import { ISLAND_TRAITS } from "@/lib/funnels/island-fields"
import { ISLAND_NAMES } from "@/lib/funnels/islands"

describe("island element fields", () => {
  it("takes its fields from ISLAND_TRAITS, not a copy", () => {
    // MUTANT KILLED: a hand-written field list that drifts from the traits the
    // compiler validates against.
    for (const name of ISLAND_NAMES) {
      const fields = fieldsForIsland(name)
      expect(fields.map((f) => f.name)).toEqual(ISLAND_TRAITS[name].map((t) => t.name))
    }
  })

  it("compiles to an island node carrying its props", () => {
    const { islandDef } = require("@/lib/funnels/tree/elements/island")
    const node = islandDef.compile({
      props: { name: "form", islandProps: { formKey: "waitlist" } },
      style: {},
    })
    expect(node).toMatchObject({ t: "island", name: "form" })
  })
})
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/lib/funnels/tree/island-element.test.ts`

- [ ] **Step 3: Implement**

Create `lib/funnels/tree/elements/island.tsx`. `fieldsForIsland` maps
`ISLAND_TRAITS[name]` onto `FieldSpec` (trait `type` values are already
`text|number|checkbox|json|select`, which `FieldSpec` covers). `compile` emits
`{ t: "island", name, props }`. `Render` renders the same island node through
`NodeRenderer` so the canvas shows the real island.

- [ ] **Step 4: Run — expect PASS. Then commit**

```bash
git add lib/funnels/tree/elements/island.tsx __tests__/lib/funnels/tree/island-element.test.ts
git commit -m "feat(builder): islands are elements, and their settings come from the traits kept for this"
```

---

### Task 6: `compilePageTree`

**Files:**
- Create: `lib/funnels/tree/compile.ts`
- Test: `__tests__/lib/funnels/tree/compile.test.ts`

**Interfaces:**
- Produces: `compilePageTree(tree: PageTree): { nodes: FunnelNode[]; problems: string[] }`

- [ ] **Step 1: Write the failing test**

Cover: a section/row/column wrapper structure is emitted; a `1-2` row emits flex
ratios 1 and 2; an unknown element kind becomes a `problem` rather than throwing;
an empty tree compiles to an empty node list without error.

```ts
it("gives a 1-2 row columns with flex 1 and 2", () => {
  // MUTANT KILLED: emitting equal columns for every layout, which makes the
  // layout picker decorative.
  const { nodes } = compilePageTree(treeWithRow("1-2"))
  const flat = JSON.stringify(nodes)
  expect(flat).toContain("flex:1")
  expect(flat).toContain("flex:2")
})

it("reports an unknown element kind instead of throwing", () => {
  // MUTANT KILLED: letting a bad node take down publish. A page with one broken
  // element must still tell the owner WHICH element.
  const { problems } = compilePageTree(treeWithBadElement())
  expect(problems.join(" ")).toMatch(/unknown element/i)
})
```

- [ ] **Step 2: Implement, run, commit**

```bash
git add lib/funnels/tree/compile.ts __tests__/lib/funnels/tree/compile.test.ts
git commit -m "feat(builder): compile a tree straight to the published node format"
```

---

### Task 7: Migration + DAL

**Files:**
- Create: `supabase/migrations/00206_funnel_step_page_tree.sql`
- Modify: `lib/db/funnel-builder.ts` (add `getPageTree`, `savePageTree`)
- Test: `__tests__/lib/db/funnel-page-tree.test.ts`

- [ ] **Step 1: Migration**

```sql
-- A visual page's draft document. Nullable and beside project_data rather than
-- replacing it: a step has a SectionDoc, a PageTree, or neither, and WHICH
-- COLUMN IS POPULATED is what decides which editor opens it. A mode flag would
-- be a third thing that can disagree with the two columns.
ALTER TABLE public.funnel_steps
  ADD COLUMN IF NOT EXISTS page_tree jsonb;

COMMENT ON COLUMN public.funnel_steps.page_tree IS
  'Draft PageTree for the visual builder. Null = this step is not a visual page.';
```

- [ ] **Step 2: DAL with the optimistic lock**

`savePageTree(stepId, tree, expectedRevision)` must make the revision check part
of the write (`.eq("doc_revision", expectedRevision)`), exactly as `appendTurn`
does, and return a `stale_revision` result rather than throwing.

- [ ] **Step 3: Test, run, commit**

```bash
git add supabase/migrations/00206_funnel_step_page_tree.sql lib/db/funnel-builder.ts __tests__/lib/db/funnel-page-tree.test.ts
git commit -m "feat(builder): a page tree column, and a save that cannot clobber another tab"
```

---

### Task 8: The save route

**Files:**
- Create: `app/api/admin/funnels/steps/[stepId]/tree/route.ts`
- Test: `__tests__/api/admin/funnels/tree-route.test.ts`

`PUT` taking `{ tree, revision }`. Validates with `pageTreeSchema`, 400 on
invalid, **409 on stale revision**, 200 with the new revision otherwise. Wrapped
in `withAudit({ action: "funnel.updated", category: "admin_write" })` and guarded
with `canAccessAdminPath`, matching every other admin funnel route.

```bash
git commit -m "feat(builder): the first write path into a funnel that is not the model"
```

---

### Task 9: Editor shell — canvas, palette, drag

**Files:**
- Create: `app/(admin)/admin/funnels/[id]/edit/[stepId]/design/page.tsx`
- Create: `components/admin/funnels/design/DesignEditor.tsx`, `Canvas.tsx`, `Palette.tsx`, `craft-nodes.tsx`
- Test: `__tests__/components/admin/builder/design-editor.test.tsx`

`craft-nodes.tsx` wraps each `ElementDef.Render` in a Craft node (`useNode`,
`connectors.connect/drag`) plus `CraftSection`/`CraftRow`/`CraftColumn` canvas
containers. The editor is `"use client"`; the route is a server component that
loads the step, parses `page_tree` (falling back to `emptyPageTree()`), and hands
it down.

Tests: the palette lists every registry element; dropping is exercised via
Craft's `actions.add` rather than synthetic drag events (jsdom cannot do real
drag), asserting the tree gains a node.

```bash
git commit -m "feat(builder): a canvas you can put things on"
```

---

### Task 10: Selection, inspector, breadcrumb

**Files:**
- Create: `components/admin/funnels/design/Inspector.tsx`, `Breadcrumb.tsx`, `fields/*.tsx`
- Test: `__tests__/components/admin/builder/inspector.test.tsx`

The inspector renders `FieldSpec[]` from the selected node's `ElementDef` —
`text`/`number`/`checkbox`/`select`/`json`/`url` inputs, plus a minimal Style
section (padding, background colour, align). Full styling is stage 3.

Test: selecting a node shows exactly its def's fields; editing a field updates
the tree; the island inspector shows the `ISLAND_TRAITS` fields.

```bash
git commit -m "feat(builder): an inspector whose fields come from the element that owns them"
```

---

### Task 11: Inline text editing + save

**Files:**
- Create: `components/admin/funnels/design/InlineText.tsx`
- Modify: `DesignEditor.tsx` (save button, dirty state, revision handling)
- Test: `__tests__/components/admin/builder/inline-text.test.tsx`, `design-save.test.tsx`

TipTap bound to the selected heading/text element, writing back `props.html`.
Save serializes Craft state → `PageTree`, validates, `PUT`s, and on 409 tells the
owner another tab changed the page rather than silently overwriting.

```bash
git commit -m "feat(builder): type on the page, and save what you typed"
```

---

### Task 12: Entry points and publish

**Files:**
- Modify: `components/admin/funnels/PreviewCard.tsx` (a "Design" action), `FunnelBoard.tsx`
- Modify: `components/admin/funnels/builder/publish-actions.ts` (publish a tree)

Publishing a tree compiles it and writes a `funnel_step_versions` row through the
existing path. `/go/` is untouched.

```bash
git commit -m "feat(builder): reach the designer, and publish what it made"
```

---

### Task 13: Verification

- [ ] Targeted suites:

```bash
npx vitest run __tests__/lib/funnels/tree/ __tests__/components/admin/builder/ __tests__/lib/db/funnel-page-tree.test.ts __tests__/api/admin/funnels/tree-route.test.ts __tests__/components/admin/funnel-builder.test.tsx > verify.txt 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " verify.txt
```

- [ ] `npm run build > build.txt 2>&1; echo "EXIT=$?"` — must be 0. Confirm
  `✓ Compiled successfully` appears; "Failed to collect page data" is a data
  fetch, not a compile error, and has already produced one false alarm here.
- [ ] `rm -f verify.txt build.txt`

## Post-implementation, requires the owner

1. **Apply `00206` to prod** via `mcp__supabase__apply_migration`. Additive and
   nullable, so it is safe ahead of the code.
2. Review and merge `feat/page-builder`.
3. Stages 3–6 remain: full style inspector, responsive, AI on `PageTree`,
   templates.
