# Click-to-Edit for AI-Built Funnel Pages — Implementation Plan (stages 0–3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can click any part of an AI-built funnel page and edit it — copy, images, section order, every prop the schema exposes — without the page changing engine, losing fidelity, or breaking the AI chat.

**Architecture:** The `SectionDoc` stays the single document. `reassemble(doc, { editable: true })` stamps `data-sec` / `data-edit` path anchors onto the existing server-rendered preview; the admin shell binds listeners directly onto the same-origin preview iframe's document; every gesture becomes a `SectionOp` and goes through the same `applyOps` → `appendTurn` path the AI chat uses, taking the same optimistic lock.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Zod v4, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-08-15-section-click-to-edit-design.md](../specs/2026-08-15-section-click-to-edit-design.md)

## Global Constraints

- **Never `data-djp-*` for edit anchors.** `filterAttrs` (`lib/funnels/compile/sanitize.ts`) `continue`s on that prefix *before* the plain `data-*` passthrough. It fails silently — the attribute simply is not there.
- **`editable` defaults to false.** Publish and `/go` output must stay byte-identical. A snapshot test pins this.
- **Ask the validator, never restate it.** Inspector fields are introspected from the registry's Zod schemas. No hand-written per-kind field table.
- **One write path.** Every mutation goes through `applyOps` then `appendTurn`. No second write into `project_data`.
- **Reference identity is a property of `applyOps`.** Never "fix" it by returning `safeParse` output.
- **Targeted tests only** (`npx vitest run <path>`), plus `npm run build` at the end. Never the full suite.
- **Stage explicit paths in commits.** `git add -A` is unsafe in this repo — the tree holds a bank CSV.
- **Never gate on a piped command's exit code.** Redirect to a file, capture `$?`.
- **No hardcoded colours or fonts in admin UI.** Semantic classes only. Page *content* styles are user data and exempt.

---

### Task 1: Close the blank canvas (Stage 0)

**Files:**
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/design/page.tsx`
- Modify: `components/admin/funnels/design/DesignEditor.tsx` (a second refusal reason)
- Test: `__tests__/components/admin/builder/design-route-guard.test.tsx`

**Interfaces:**
- Produces: `DesignEditor` accepts `blockedReason?: "section_doc" | "unreadable"`, replacing the boolean `treeInvalid`.

- [ ] **Step 1: Write the failing test**

Three cases, and the middle one is the defect:

```tsx
it("refuses to open a blank canvas over a page the AI built", async () => {
  // The whole bug: page_tree is null on every AI page, and the old fallback
  // was emptyPageTree() — a canvas whose first Save writes over the top of a
  // real page AND bumps the shared doc_revision.
  vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 4, treeInvalid: false })
  vi.mocked(getDraft).mockResolvedValue({ doc: aSectionDoc(), docInvalid: false, revision: 4 })

  render(await DesignPage({ params: Promise.resolve({ id: "f1", stepId: "s1" }) }))

  expect(screen.getByText(/built in the page builder/i)).toBeInTheDocument()
  expect(screen.queryByText(/^Section$/)).not.toBeInTheDocument()   // no palette
  expect(screen.getByRole("link", { name: /open the page builder/i })).toHaveAttribute(
    "href", "/admin/funnels/f1/edit/s1",
  )
})

it("still opens an empty canvas for a step that holds nothing at all", async () => {
  vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 0, treeInvalid: false })
  vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
  render(await DesignPage({ params: Promise.resolve({ id: "f1", stepId: "s1" }) }))
  expect(screen.getByText("Section")).toBeInTheDocument()           // palette is there
})

it("refuses a step holding a document it cannot read", async () => {
  vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 2, treeInvalid: false })
  vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 2 })
  render(await DesignPage({ params: Promise.resolve({ id: "f1", stepId: "s1" }) }))
  expect(screen.getByText(/cannot be read/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run __tests__/components/admin/builder/design-route-guard.test.tsx`
Expected: the first test fails — the palette renders.

- [ ] **Step 3: Implement**

The route reads both documents and decides from the pair. The decision table is
the spec's §9. `getDraft` is already imported by the sibling builder route.

- [ ] **Step 4: Run, and re-run the existing designer suite**

`npx vitest run __tests__/components/admin/builder/`

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/funnels/[id]/edit/[stepId]/design/page.tsx" components/admin/funnels/design/DesignEditor.tsx __tests__/components/admin/builder/design-route-guard.test.tsx
git commit -m "fix(funnels): the designer must not open a blank canvas over an AI page"
```

---

### Task 2: `editable` render mode and the anchor helper

**Files:**
- Modify: `lib/funnels/sections/render.ts` (RenderContext, helper, hero + bullets)
- Test: `__tests__/lib/funnels/sections/render-editable.test.ts`

**Interfaces:**
- Produces: `RenderContext.editable?: boolean`; `renderSection(section, { editable: true })` emits `data-sec` on the `<section>` and `data-edit="<propPath>"` on text nodes.

- [ ] **Step 1: Write the failing test**

The first test is the one that matters most — it is the guard against anchors
leaking into published HTML:

```ts
it("emits byte-identical HTML when editable is not set", () => {
  const section = heroFixture()
  expect(renderSection(section, {})).toBe(renderSection(section, { editable: false }))
  expect(renderSection(section, {})).not.toContain("data-edit")
  expect(renderSection(section, {})).not.toContain("data-sec")
})

it("anchors the headline to its prop path", () => {
  const html = renderSection(heroFixture(), { editable: true })
  expect(html).toContain('data-sec="h1"')
  expect(html).toMatch(/<h1 class="djp-hd" data-edit="headline">/)
})

it("anchors a repeating item by index", () => {
  const html = renderSection(bulletsFixture(), { editable: true })
  expect(html).toContain('data-item="0"')
  expect(html).toContain('data-edit="items.0.title"')
})

it("survives the compiler, which strips data-djp-* silently", () => {
  // The trap this repo already documents for data-h/data-align. If the anchor
  // prefix were ever changed to data-djp-edit, filterAttrs would drop it with
  // no error and click-to-edit would simply stop working.
  const { html, css } = reassemble(docWith(heroFixture()), { editable: true })
  const compiled = compileFunnelStep({ html, css })
  expect(compiled.ok).toBe(true)
  expect(JSON.stringify(compiled.nodes)).toContain("data-edit")
})
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run __tests__/lib/funnels/sections/render-editable.test.ts`

- [ ] **Step 3: Implement the helper and wire hero + bullets**

```ts
/**
 * ` data-edit="path"` when editing, "" otherwise — so a non-editable render is
 * byte-identical to what it was before this feature existed.
 *
 * NEVER `data-djp-edit`. `filterAttrs` strips that prefix before the plain
 * `data-*` passthrough ever runs, and does it silently.
 */
function editAttr(ctx: RenderContext, path: string): string {
  return ctx.editable ? ` data-edit="${escapeHtml(path)}"` : ""
}
```

`sectionOpenTag` takes `ctx` and appends `data-sec` the same way.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/render.ts __tests__/lib/funnels/sections/render-editable.test.ts
git commit -m "feat(funnels): an editable render mode that stamps prop paths onto the page"
```

---

### Task 3: Anchors for the remaining eight kinds, and placeholders for unset optionals

**Files:**
- Modify: `lib/funnels/sections/render.ts`
- Test: `__tests__/lib/funnels/sections/render-editable.test.ts` (extend)

**Interfaces:**
- Consumes: `editAttr` from Task 2.
- Produces: every text-bearing prop of all 10 kinds carries an anchor; unset optional text props render a placeholder carrying `data-edit` + `data-edit-empty`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(SECTION_KINDS)("anchors every text prop of a %s", (kind) => {
  const section = fixtureFor(kind)
  const html = renderSection(section, { editable: true })
  for (const path of textPathsOf(section)) {
    expect(html).toContain(`data-edit="${path}"`)
  }
})

it("gives an unset optional field a placeholder to click", () => {
  // Without an anchor there is no pixel to click, so an empty optional field
  // is unreachable forever. The source design calls this the single most
  // common "I can't edit this" bug.
  const hero = { ...heroFixture(), props: { ...heroFixture().props, sub: undefined } }
  const html = renderSection(hero, { editable: true })
  expect(html).toContain('data-edit="sub"')
  expect(html).toContain("data-edit-empty")
})

it("does not emit placeholders when not editing", () => {
  const hero = { ...heroFixture(), props: { ...heroFixture().props, sub: undefined } }
  expect(renderSection(hero, {})).not.toContain("djp-sub")
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement**

Add `optionalText(ctx, path, value, tag, className, placeholder)` — renders the
real value when set, the dimmed placeholder when editing and unset, and nothing
at all when not editing. Apply across proof, steps, testimonial, pricing, faq,
form, cta, footer.

- [ ] **Step 4: Run the whole sections suite**

`npx vitest run __tests__/lib/funnels/sections/`

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/render.ts __tests__/lib/funnels/sections/render-editable.test.ts
git commit -m "feat(funnels): anchor every editable prop, including the empty ones"
```

---

### Task 4: `fieldsForSection` — inspector fields introspected from the schemas

**Files:**
- Create: `lib/funnels/sections/fields.ts`
- Test: `__tests__/lib/funnels/sections/fields.test.ts`

**Interfaces:**
- Produces:

```ts
export type SectionFieldType =
  | "text" | "textarea" | "number" | "checkbox" | "select" | "cta" | "list" | "repeater"

export interface SectionField {
  /** Dot path relative to the section's props. */
  path: string
  label: string
  type: SectionFieldType
  optional: boolean
  options?: { id: string; label: string }[]
  /** repeater/list only. */
  min?: number
  max?: number
  /** repeater only — the fields of one item. */
  item?: SectionField[]
}

export function fieldsForSection(section: Section): SectionField[]
```

- [ ] **Step 1: Write the failing test — the invariant first**

```ts
it.each(SECTION_KINDS)("reaches every prop key the %s schema defines", (kind) => {
  // The guard that makes derivation trustworthy rather than merely clever.
  // A hand-written field table is exactly the "restate the rule" mistake that
  // has already cost this repo three bugs.
  const section = fixtureFor(kind)
  const covered = new Set(fieldsForSection(section).map((f) => f.path.split(".")[0]))
  for (const key of Object.keys(section.props)) {
    expect(covered).toContain(key)
  }
})

it("returns the branch matching the current discriminant", () => {
  const live = testimonialFixture("live")
  expect(fieldsForSection(live).map((f) => f.path)).toEqual(
    expect.arrayContaining(["source", "limit", "featuredOnly"]),
  )
  expect(fieldsForSection(live).map((f) => f.path)).not.toContain("quotes")

  const quoted = testimonialFixture("quote")
  expect(fieldsForSection(quoted).map((f) => f.path)).toContain("quotes")
})

it("carries the array bounds the schema declares", () => {
  const items = fieldsForSection(bulletsFixture()).find((f) => f.path === "items")
  expect(items).toMatchObject({ type: "repeater", min: 2, max: 6 })
})

it("reads a CTA as one field, not a raw union", () => {
  const cta = fieldsForSection(ctaFixture()).find((f) => f.path === "cta")
  expect(cta?.type).toBe("cta")
})

it("merges both halves of an intersection", () => {
  // form = { heading?, sub?, proofPoints? } & formIslandSchema
  const paths = fieldsForSection(formFixture()).map((f) => f.path)
  expect(paths).toEqual(expect.arrayContaining(["heading", "sub", "proofPoints", "formKey", "submitLabel"]))
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement the walker**

Unwrap `ZodOptional`/`ZodDefault`, recurse `ZodObject`, merge `ZodIntersection`,
select the branch of a `ZodDiscriminatedUnion` by the section's current value,
map `ZodArray` by element type, and special-case `ctaWithLabelSchema` by
identity so a CTA is one field rather than a walked union.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/fields.ts __tests__/lib/funnels/sections/fields.test.ts
git commit -m "feat(funnels): inspector fields derived from the schemas, so they cannot drift"
```

---

### Task 5: The edit route — the second non-AI write path

**Files:**
- Create: `app/api/admin/funnels/steps/[stepId]/edit/route.ts`
- Test: `__tests__/api/admin/funnels/edit-route.test.ts`

**Interfaces:**
- Produces: `PUT /api/admin/funnels/steps/[stepId]/edit`, body `{ ops: unknown[]; revision: number }`, responding `{ revision, doc, receipt }` / 400 / 409 / 422.

- [ ] **Step 1: Write the failing tests**

```ts
it("applies a batch and returns the new revision", async () => { /* 200, revision + 1 */ })

it("409s on a stale revision without touching the document", async () => {
  // A PageTree/SectionDoc is a full snapshot: a lost update is not a merge
  // conflict, it is a page silently reverting to whatever the other tab had.
  const res = await PUT(req({ ops: [moveOp()], revision: 2 }), ctx)
  expect(res.status).toBe(409)
  expect(await res.json()).toMatchObject({ code: "stale_revision", currentRevision: 5 })
  expect(appendTurn).not.toHaveBeenCalled()
})

it("rejects the whole batch when one op is bad, and writes nothing", async () => {
  const res = await PUT(req({ ops: [goodOp(), { op: "update_section" }], revision: 1 }), ctx)
  expect(res.status).toBe(422)
  expect(appendTurn).not.toHaveBeenCalled()
})

it("refuses a step whose stored document cannot be read", async () => {
  // Editing a legacy GrapesJS step must not mean starting a fresh document
  // over the top of the owner's page.
  vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 3 })
  expect((await PUT(req({ ops: [goodOp()], revision: 3 }), ctx)).status).toBe(422)
  expect(appendTurn).not.toHaveBeenCalled()
})

it("is closed to a non-admin", async () => { /* 403, nothing written */ })
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement**

Guard with `canAccessAdminPath`, wrap in `withAudit({ action: "funnel.updated",
category: "admin_write" })`. Read the draft, refuse `docInvalid`, `applyOps`,
`appendTurn` with `role: "owner"` and a message summarised from the receipt
(`"Hero — headline"`), map `stale_revision` to 409.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/funnels/steps/[stepId]/edit/route.ts" __tests__/api/admin/funnels/edit-route.test.ts
git commit -m "feat(funnels): edit a page without paying for a model turn"
```

---

### Task 6: Selection — clicking the page selects a section

**Files:**
- Create: `components/admin/funnels/builder/useCanvasSelection.ts`
- Modify: `components/admin/funnels/builder/PreviewPane.tsx` (edit mode, selection outline)
- Test: `__tests__/components/admin/builder/canvas-selection.test.tsx`

**Interfaces:**
- Produces: `useCanvasSelection({ frameRef, enabled, onSelect })`; PreviewPane accepts `editable`, `selectedId`, `onSelectSection`.

- [ ] **Step 1: Write the failing test**

```tsx
it("selects the section under the pointer, most specific first", () => {
  // Single click selects and NEVER fires a side effect. The source design
  // shipped image-before-text precedence first and made a full-bleed hero
  // unselectable — every pixel of the first screen opened the image picker.
  const onSelect = vi.fn()
  const doc = mountFrameWith(`<section data-sec="h1"><h1 data-edit="headline">Hi</h1></section>`)
  renderHook(() => useCanvasSelection({ frameRef: refTo(doc), enabled: true, onSelect }))
  doc.querySelector("h1")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  expect(onSelect).toHaveBeenCalledWith({ sectionId: "h1", path: "headline" })
})

it("binds nothing when edit mode is off", () => { /* onSelect never called */ })

it("does not follow a link inside the page while editing", () => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  doc.querySelector("a")!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement**

The hook attaches to `frame.contentDocument` on load and on every src change,
walks up from `event.target` to the nearest `[data-edit]` then `[data-sec]`, and
returns a cleanup that removes the listeners. Selection chrome is a class the
hook toggles on the iframe document, styled by a small stylesheet the preview
route injects only in edit mode.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/builder/useCanvasSelection.ts components/admin/funnels/builder/PreviewPane.tsx __tests__/components/admin/builder/canvas-selection.test.tsx
git commit -m "feat(funnels): click the page to select what you want to change"
```

---

### Task 7: The inspector, and the section toolbar

**Files:**
- Create: `components/admin/funnels/builder/SectionInspector.tsx`, `components/admin/funnels/builder/fields/*.tsx`
- Modify: `components/admin/funnels/FunnelBuilder.tsx` (mount inspector, send ops)
- Modify: `lib/funnels/sections/registry.ts` (`SectionDef.defaults`, for "add section")
- Test: `__tests__/components/admin/builder/section-inspector.test.tsx`

**Interfaces:**
- Consumes: `fieldsForSection` (Task 4), the edit route (Task 5), selection (Task 6).
- Produces: `SectionDef.defaults: unknown` — a props object satisfying that kind's schema; `nextSectionId(doc, kind): string`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows exactly the selected section's fields", () => { /* hero fields, not bullets' */ })

it("sends an update_section op when a field changes", async () => {
  await user.clear(screen.getByLabelText("Headline"))
  await user.type(screen.getByLabelText("Headline"), "New")
  await user.tab()
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/funnels/steps/s1/edit",
    expect.objectContaining({
      body: JSON.stringify({ ops: [{ op: "update_section", id: "h1", props: { headline: "New" } }], revision: 4 }),
    }),
  )
})

it("carries the revision the last save returned, not the one it mounted with", async () => {
  // Two saves in quick succession must send the revision the FIRST came back
  // with, or the second 409s against work it already owns.
})

it("refuses to delete the last section", () => {
  // sectionDocSchema bounds sections at 1..24, so a delete that empties the
  // page is rejected at save time — visually deleting it first and failing
  // afterwards is the wrong order to find out.
})

it.each(SECTION_KINDS)("offers a %s whose defaults satisfy its own schema", (kind) => {
  expect(SECTION_REGISTRY[kind].schema.safeParse({
    id: "x1", kind, variant: SECTION_REGISTRY[kind].variants[0],
    style: {}, props: SECTION_REGISTRY[kind].defaults,
  }).success).toBe(true)
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement**

Render `SectionField[]` as inputs; commit on blur/change as one `update_section`
op. Toolbar buttons emit `move_section`, `remove_section`, and `add_section`
(duplicate = `add_section` with `nextSectionId` and cloned props). Revision is
held in a ref, updated from each response.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/builder/SectionInspector.tsx components/admin/funnels/builder/fields lib/funnels/sections/registry.ts components/admin/funnels/FunnelBuilder.tsx __tests__/components/admin/builder/section-inspector.test.tsx
git commit -m "feat(funnels): an inspector whose fields come from the schema that validates them"
```

---

### Task 8: Inline text editing (Stage 2)

**Files:**
- Create: `components/admin/funnels/builder/useInlineEdit.ts`
- Test: `__tests__/components/admin/builder/inline-edit.test.tsx`

**Interfaces:**
- Produces: `useInlineEdit({ frameRef, enabled, onCommit })`, `onCommit({ sectionId, path, value })`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("commits on Enter and cancels on Escape", () => { /* two cases, one op, none */ })

it("starts a placeholder empty and restores it on Escape", () => {
  // Otherwise Enter on an untouched placeholder commits the literal words
  // "Add a subheading" as the owner's copy.
  const el = doc.querySelector('[data-edit-empty]')! as HTMLElement
  el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
  expect(el.textContent).toBe("")
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  expect(el.textContent).toBe("Add a subheading")
  expect(onCommit).not.toHaveBeenCalled()
})

it("commits the text, never the markup", () => {
  // contenteditable will happily accept a paste full of tags. The document
  // stores plain strings; the renderer owns every tag on the page.
  el.innerHTML = 'New <b onclick="x()">copy</b>'
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
  expect(onCommit).toHaveBeenCalledWith({ sectionId: "h1", path: "headline", value: "New copy" })
})

it("does not commit when nothing changed", () => { /* no op, no revision bump */ })
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement**

Double-click sets `contentEditable`, selects contents, remembers the original.
Enter/blur commits `innerText` trimmed; Escape restores. Text wins over an
enclosing image slot.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/builder/useInlineEdit.ts __tests__/components/admin/builder/inline-edit.test.tsx
git commit -m "feat(funnels): type on the page itself"
```

---

### Task 9: Image slots (Stage 3)

**Files:**
- Modify: `lib/funnels/sections/render.ts` (`data-edit-image` on hero media)
- Create: `components/admin/funnels/builder/ImageSlotDialog.tsx`
- Test: `__tests__/components/admin/builder/image-slot.test.tsx`

**Interfaces:**
- Consumes: the existing admin upload path.
- Produces: an `update_section` op setting `media`, including `w`/`h`, which `heroMediaSchema` requires.

- [ ] **Step 1: Write the failing tests**

```tsx
it("opens the picker on a double-clicked image slot", () => { /* dialog opens */ })

it("writes width and height, which the schema requires", async () => {
  // heroMediaSchema demands positive integer w/h. Omitting them makes the op
  // fail post-merge validation with a message about a field the owner never saw.
  await choose(anUpload({ width: 1200, height: 800 }))
  expect(lastOp()).toMatchObject({ props: { media: { kind: "image", w: 1200, h: 800 } } })
})

it("keeps text editing ahead of the image slot", () => {
  // A headline lying on a hero photo must edit, not swap the photo.
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/render.ts components/admin/funnels/builder/ImageSlotDialog.tsx __tests__/components/admin/builder/image-slot.test.tsx
git commit -m "feat(funnels): swap a photo by double-clicking it"
```

---

### Task 10: Verification

- [ ] Targeted suites, exit code captured from the command and not from a pipe:

```bash
npx vitest run __tests__/lib/funnels/sections/ __tests__/components/admin/builder/ __tests__/api/admin/funnels/ > verify.txt 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " verify.txt
```

- [ ] `npm run build > build.txt 2>&1; echo "EXIT=$?"` — must be 0. Confirm
  `✓ Compiled successfully`; "Failed to collect page data" is a data fetch, not
  a compile error, and has already produced one false alarm in this repo.
- [ ] Confirm the published output is unchanged: the Task 2 byte-identity test
  is the proof, and it must still be green.
- [ ] `rm -f verify.txt build.txt`

## Post-implementation, requires the owner

1. Review the branch state on `main` (committed, unpushed).
2. Decide Stage 4 (`SectionDoc` → `PageTree` + the missing tree publish half).
3. No migration in this plan — every column it touches already exists.
