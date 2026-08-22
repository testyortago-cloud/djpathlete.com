# Full-screen draft preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner open an unpublished landing page or funnel full screen at `/preview/<slug>`, walk it step to step, and submit its forms as a test that writes nothing.

**Architecture:** A new `(funnel)`-group route `/preview/<slug>/<step>` mirrors the shape of the live `/go/<slug>/<step>` so that `funnelBasePath` alone rewrites every in-funnel button. The draft render sequence is lifted out of the existing builder-iframe preview into `lib/funnels/preview-render.ts` and shared, so the two routes cannot drift. Test submissions go to a new admin-gated `/api/funnels/preview-submit` that reads the DRAFT form config and performs zero writes.

**Tech Stack:** Next.js 16 App Router (server components), NextAuth v5 (`auth()`), Zod, Supabase, Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-22-draft-preview-design.md`

## Global Constraints

- **No migration.** This feature adds no column and no table. If a task seems to need one, stop and re-read the spec — an `is_test` column was explicitly rejected.
- **Zero writes on the preview-submit path.** No `createSubmission`, no lead upsert, no `captureContactFromSubmission`, no `recordConsent`, no email, no Stripe. This is asserted by test, not assumed.
- **Never change** `/api/funnels/submit`, `app/(funnel)/go/**`, or the publish path. `/go` output must be byte-identical after this branch.
- **Gates fail closed and answer 404**, never a redirect. Role check is `role !== "admin" && role !== "staff"`, matching `app/(funnel)/funnel-preview/[stepId]/page.tsx`.
- **Semantic colour classes only** (`text-muted-foreground`, `bg-surface`, `border-border`, `var(--warning)`). Never a hardcoded hex.
- **Fonts** via `font-heading` / `font-body` classes, never inline `fontFamily`.
- **Admin UI is light-only.** Do not add `.dark` variants to admin components.
- **No Claude attribution** in any commit message.
- Run tests with `npx vitest run <path>` from the worktree root. Targeted runs only — never the full suite.

---

### Task 1: Preview path helpers

A pure module. Both the route and the endpoint need to turn a funnel slug into a preview base, and to rewrite a stored `/go/…` redirect onto `/preview/…`. Neither may hand-roll it.

**Files:**
- Create: `lib/funnels/preview-path.ts`
- Test: `__tests__/lib/funnels/preview-path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PREVIEW_BASE: "/preview"`
  - `LIVE_BASE: "/go"`
  - `previewBasePath(funnelSlug: string): string`
  - `livePathToPreview(url: string): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/preview-path.test.ts
//
// The preview walks the funnel by REWRITING the base path, so these two
// functions are the whole of "step to step works". Each test names the mutant
// it kills.

import { describe, expect, it } from "vitest"
import { LIVE_BASE, PREVIEW_BASE, livePathToPreview, previewBasePath } from "@/lib/funnels/preview-path"

describe("previewBasePath", () => {
  it("builds the base a step CTA is appended to", () => {
    // MUTANT KILLED: returning `/go/${slug}` — the preview would link to the
    // live route and 404 on every unpublished next step.
    expect(previewBasePath("summer-camp")).toBe("/preview/summer-camp")
  })

  it("encodes a slug so it cannot break out of its segment", () => {
    // MUTANT KILLED: raw interpolation. A slug is owner input; `a/b` would
    // otherwise silently become a two-segment path.
    expect(previewBasePath("a/b")).toBe("/preview/a%2Fb")
  })
})

describe("livePathToPreview", () => {
  it("rewrites an internal funnel URL onto the preview base", () => {
    // MUTANT KILLED: returning the input unchanged — the form would redirect
    // out of the preview onto a 404.
    expect(livePathToPreview("/go/summer-camp/thanks")).toBe("/preview/summer-camp/thanks")
  })

  it("rewrites an entry-page URL with no step segment", () => {
    expect(livePathToPreview("/go/summer-camp")).toBe("/preview/summer-camp")
  })

  it("rewrites across funnels, because /preview resolves any slug", () => {
    expect(livePathToPreview("/go/other-funnel/x")).toBe("/preview/other-funnel/x")
  })

  it("returns null for an external URL", () => {
    // MUTANT KILLED: prefixing anything. An https target must be REPORTED, not
    // navigated, so the caller needs to tell the two apart.
    expect(livePathToPreview("https://example.com/thanks")).toBeNull()
  })

  it("returns null for an internal URL that is not a funnel page", () => {
    expect(livePathToPreview("/admin/funnels")).toBeNull()
  })

  it("returns null for a protocol-relative URL that only looks internal", () => {
    // MUTANT KILLED: a `startsWith("/")` check. `//evil.com/go/x` starts with
    // a slash and is an absolute cross-origin navigation.
    expect(livePathToPreview("//evil.com/go/x")).toBeNull()
  })

  it("does not rewrite a path that merely starts with the letters go", () => {
    // MUTANT KILLED: `startsWith("/go")` without the boundary.
    expect(livePathToPreview("/golf/summer-camp")).toBeNull()
  })

  it("exports the two bases it is built from", () => {
    expect(PREVIEW_BASE).toBe("/preview")
    expect(LIVE_BASE).toBe("/go")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/preview-path.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/funnels/preview-path"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/funnels/preview-path.ts
//
// The full-screen draft preview mirrors the LIVE route's path shape on purpose:
// `renderCtaTarget`'s `step` case builds `${ctx.funnelBasePath}/${stepSlug}`
// (lib/funnels/sections/render.ts:463), so handing the renderer a preview base
// rewrites every in-funnel button with no renderer change at all.
//
// Both functions live here rather than at their call sites because the route
// and the submit endpoint must agree about where a preview link points. Two
// copies of a string rewrite is how the preview and the page it is previewing
// start disagreeing.

/** The full-screen draft preview's base. Mirrors `/go`. */
export const PREVIEW_BASE = "/preview"

/** The public funnel route's base. */
export const LIVE_BASE = "/go"

/**
 * The base a step CTA is appended to, e.g. `/preview/summer-camp`.
 *
 * The slug is encoded: it is owner input, and an un-encoded `a/b` would become
 * two path segments, which the `[[...step]]` catch-all would then read as a
 * step that does not exist.
 */
export function previewBasePath(funnelSlug: string): string {
  return `${PREVIEW_BASE}/${encodeURIComponent(funnelSlug)}`
}

/**
 * `/go/<funnel>[/<step>]` -> `/preview/<funnel>[/<step>]`, or `null` when the
 * URL is not an internal funnel page.
 *
 * `null` IS A DISTINCT ANSWER, not a failure. An external `https://` success
 * redirect must be REPORTED to the owner rather than followed — navigating out
 * of an admin-gated preview to a third-party site is a place they cannot come
 * back from — so the caller has to be able to tell the two apart.
 *
 * A protocol-relative `//evil.com/go/x` is rejected before anything else: it
 * starts with `/`, so a naive prefix check reads it as internal, and it is an
 * absolute cross-origin navigation.
 */
export function livePathToPreview(url: string): string | null {
  if (url.startsWith("//")) return null
  if (url === LIVE_BASE) return PREVIEW_BASE
  // The trailing slash is the segment boundary — without it `/golf` matches.
  if (!url.startsWith(`${LIVE_BASE}/`)) return null
  return `${PREVIEW_BASE}${url.slice(LIVE_BASE.length)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/funnels/preview-path.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/preview-path.ts __tests__/lib/funnels/preview-path.test.ts
git commit -m "feat(preview): path helpers for the draft preview base"
```

---

### Task 2: Extract the draft render so two routes cannot drift

`app/(funnel)/funnel-preview/[stepId]/page.tsx` owns the resolve → gate → reassemble → compile sequence. The new route needs the identical sequence. A second copy is the exact failure that file's header warns about, so this task moves it and leaves the existing route as a thin caller.

**This is a refactor. `__tests__/app/funnel-draft-preview-page.test.tsx` must pass untouched at the end — that is the proof the extraction changed no behaviour.**

**Files:**
- Create: `lib/funnels/preview-render.ts`
- Modify: `app/(funnel)/funnel-preview/[stepId]/page.tsx`
- Test: `__tests__/lib/funnels/preview-render.test.ts`

**Interfaces:**
- Consumes: `getDraft` (`lib/db/funnel-builder`), `listSteps` (`lib/db/funnels`), `loadCatalogues`/`resolveDoc`/`publishGate` (`lib/funnels/sections/resolve`), `reassemble` (`lib/funnels/sections/doc`), `compileFunnelStep` (`lib/funnels/compile`).
- Produces:

```ts
export type DraftPreviewResult =
  | { kind: "no-draft" }
  | { kind: "doc-invalid" }
  | { kind: "render-failed"; message: string }
  | { kind: "compile-failed"; problems: string[] }
  | { kind: "ok"; nodes: FunnelNode[]; css: string; problems: string[] }

export async function renderDraftPreview(input: {
  stepId: string
  funnelId: string
  funnelBasePath: string
  editable?: boolean
}): Promise<DraftPreviewResult>
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/preview-render.test.ts
//
// The extraction exists so the builder iframe and the full-screen preview
// cannot render the same document two ways. The load-bearing test is the LAST
// one: same doc, two base paths, identical output apart from the hrefs.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ listSteps: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))

import { renderDraftPreview } from "@/lib/funnels/preview-render"
import { getDraft } from "@/lib/db/funnel-builder"
import { listSteps } from "@/lib/db/funnels"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"

/** A doc with a STEP cta — the only section whose html depends on the base. */
const DOC: SectionDoc = {
  version: 1,
  theme: { preset: "dark" },
  sections: [
    {
      id: "hero-1",
      kind: "hero",
      props: {
        heading: "Eight weeks. Measurable rotational power.",
        sub: "Built for throwers.",
        cta: { label: "Apply now", target: { kind: "step", stepSlug: "apply" } },
      },
    },
  ],
} as unknown as SectionDoc

function armCatalogues() {
  for (const fn of [getPrograms, getAllPrograms, listActiveProducts, listAllProducts, getEvents, getPublishedEvents]) {
    mock(fn).mockResolvedValue([])
  }
  mock(getFaqCountsByPage).mockResolvedValue({})
  mock(listSteps).mockResolvedValue([
    { id: STEP_ID, slug: "start", name: "Start" },
    { id: "other", slug: "apply", name: "Apply" },
  ])
}

beforeEach(() => {
  // resetAllMocks, never clearAllMocks: a leaked `*Once` implementation crosses
  // test boundaries here and misattributes the failure to the wrong case.
  vi.resetAllMocks()
  armCatalogues()
})

describe("renderDraftPreview", () => {
  it("reports no-draft when the step has no document", async () => {
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
    })
    expect(result.kind).toBe("no-draft")
  })

  it("reports doc-invalid separately from no-draft", async () => {
    // MUTANT KILLED: collapsing the two. "Nothing to preview yet" and "this is
    // a legacy blob we cannot read" need different words on screen.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 0 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
    })
    expect(result.kind).toBe("doc-invalid")
  })

  it("renders a clean draft with no problems", async () => {
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.problems).toEqual([])
    expect(JSON.stringify(result.nodes)).toContain("Eight weeks")
  })

  it("fails soft when the catalogue read throws, and says publish will refuse", async () => {
    // MUTANT KILLED: letting the throw escape. This page's whole job is "let me
    // look at my draft"; a 500 here is the one unacceptable answer.
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    mock(getPrograms).mockRejectedValue(new Error("catalogue unreadable"))
    mock(getAllPrograms).mockRejectedValue(new Error("catalogue unreadable"))
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.problems.join(" ")).toMatch(/could not be checked/i)
  })

  it("renders step CTAs against the base path it was given — THE DRIFT GUARD", async () => {
    // This is why the module exists. The builder iframe passes /go/<slug> and
    // the full-screen preview passes /preview/<slug>; everything else about the
    // two renders must be identical, or the owner is judging a page that is not
    // the page publish ships.
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const live = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/go/summer-camp",
    })
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const preview = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
    })

    if (live.kind !== "ok" || preview.kind !== "ok") throw new Error("both should render")
    expect(JSON.stringify(live.nodes)).toContain("/go/summer-camp/apply")
    expect(JSON.stringify(preview.nodes)).toContain("/preview/summer-camp/apply")
    // MUTANT KILLED: a second rendering path. Normalise the one href that is
    // ALLOWED to differ; everything else must match byte for byte.
    const normalise = (s: string) => s.split("/preview/summer-camp").join("/go/summer-camp")
    expect(normalise(JSON.stringify(preview.nodes))).toBe(JSON.stringify(live.nodes))
    expect(preview.css).toBe(live.css)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/preview-render.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/funnels/preview-render"`.

- [ ] **Step 3: Write the module**

Move the body of `FunnelDraftPreviewPage` (from `getDraft` through `compileFunnelStep`) into `lib/funnels/preview-render.ts`, returning the discriminated union instead of JSX. Copy the existing explanatory comments across — they record why the resolve step and the gate are here, and deleting them loses the reason.

```ts
// lib/funnels/preview-render.ts
//
// The draft render, shared by the builder's iframe preview
// (/funnel-preview/[stepId]) and the full-screen one (/preview/<slug>).
//
// WHY IT IS ONE MODULE AND NOT TWO ROUTES DOING THE SAME THING.
// `resolveDoc -> publishGate -> reassemble -> compileFunnelStep` is exactly the
// sequence the publish path runs, which is the only reason a preview is worth
// looking at: it shows what publish will actually ship. A second hand-rolled
// copy of that sequence is how preview and publish start disagreeing about the
// same document — a silent, perfectly plausible wrong answer, and the worst
// failure mode this feature has.
//
// IT FAILS SOFT, and that is the one place it differs from publish. A catalogue
// read that throws must not turn "look at my draft" into an error page: the
// draft still renders, from the unresolved document, with a problem saying
// publishing will refuse it until the links can be checked — which is true,
// because both publish gates fail CLOSED on the same throw.

import { compileFunnelStep } from "@/lib/funnels/compile"
import { getDraft } from "@/lib/db/funnel-builder"
import { listSteps } from "@/lib/db/funnels"
import { reassemble } from "@/lib/funnels/sections/doc"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"
import type { FunnelNode } from "@/lib/funnels/compile/types"

export type DraftPreviewResult =
  | { kind: "no-draft" }
  | { kind: "doc-invalid" }
  | { kind: "render-failed"; message: string }
  | { kind: "compile-failed"; problems: string[] }
  | { kind: "ok"; nodes: FunnelNode[]; css: string; problems: string[] }

export interface DraftPreviewInput {
  stepId: string
  funnelId: string
  /** `/go/<slug>` for the builder iframe, `/preview/<slug>` full screen. */
  funnelBasePath: string
  editable?: boolean
}

export async function renderDraftPreview({
  stepId,
  funnelId,
  funnelBasePath,
  editable = false,
}: DraftPreviewInput): Promise<DraftPreviewResult> {
  const draft = await getDraft(stepId)
  if (!draft) return { kind: "no-draft" }
  if (draft.docInvalid) return { kind: "doc-invalid" }
  if (!draft.doc) return { kind: "no-draft" }

  let docToRender = draft.doc
  let gateBlockers: string[] = []
  try {
    const [catalogues, pages] = await Promise.all([
      loadCatalogues(),
      listSteps(funnelId).then((rows) => rows.map((row) => ({ slug: row.slug, name: row.name }))),
    ])
    const resolution = resolveDoc(draft.doc, catalogues, pages)
    docToRender = resolution.doc
    gateBlockers = publishGate(resolution).blockers
  } catch (error) {
    gateBlockers = [
      "This page's links could not be checked, so publishing will refuse it until they can be: " +
        (error as Error).message,
    ]
  }

  let rendered
  try {
    rendered = reassemble(docToRender, { funnelBasePath, editable })
  } catch (error) {
    return { kind: "render-failed", message: (error as Error).message }
  }

  const compiled = compileFunnelStep({ html: rendered.html, css: rendered.css })
  if (!compiled.ok) {
    return {
      kind: "compile-failed",
      problems: [...rendered.problems.map((p) => p.message), ...compiled.errors.map((e) => e.message)],
    }
  }

  return {
    kind: "ok",
    nodes: compiled.nodes,
    css: compiled.css,
    problems: [...rendered.problems.map((p) => p.message), ...gateBlockers],
  }
}
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run __tests__/lib/funnels/preview-render.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Rewrite the existing route as a thin caller**

In `app/(funnel)/funnel-preview/[stepId]/page.tsx`, keep the gate, `getStep`/`getFunnelById`, `PreviewNotice`, `PreviewBlockedBanner`, the `FUNNEL_ROOT_ID` wrapper, `CANVAS_EDIT_CSS` and the `NodeRenderer` context exactly as they are. Replace the inlined sequence with:

```tsx
const result = await renderDraftPreview({
  stepId,
  funnelId: funnel.id,
  funnelBasePath: `/go/${funnel.slug}`,
  editable,
})

if (result.kind === "doc-invalid") {
  return (
    <PreviewNotice
      title="This page can't be previewed"
      lines={[
        "Its saved content is not a document the page builder can read — either it is from the old " +
          "drag-and-drop editor, or it has been corrupted.",
        "Nothing has been lost. Restore an earlier version from the chat to carry on.",
      ]}
    />
  )
}
if (result.kind === "no-draft") {
  return (
    <PreviewNotice
      title="Nothing to preview yet"
      lines={["This page has no draft. Describe what you want in the builder chat and it will appear here."]}
    />
  )
}
if (result.kind === "render-failed") {
  return <PreviewNotice title="This page can't be rendered" lines={[result.message]} />
}
if (result.kind === "compile-failed") {
  return <PreviewNotice title="This page can't be compiled" lines={result.problems} />
}
```

Keep the `funnelBasePath` as `/go/${funnel.slug}` — the builder iframe's links must be unchanged.

- [ ] **Step 6: Prove the refactor changed nothing**

Run: `npx vitest run __tests__/app/funnel-draft-preview-page.test.tsx __tests__/components/admin/funnel-preview-pane.test.tsx`
Expected: PASS with the test file **unmodified**. If a test needed editing to pass, the extraction changed behaviour — revert and find out why.

- [ ] **Step 7: Commit**

```bash
git add lib/funnels/preview-render.ts __tests__/lib/funnels/preview-render.test.ts "app/(funnel)/funnel-preview/[stepId]/page.tsx"
git commit -m "refactor(preview): share the draft render between preview routes

The full-screen preview needs the identical resolve/gate/reassemble/compile
sequence. A second copy is how preview and publish start disagreeing about
the same document, which is the failure the original route exists to prevent."
```

---

### Task 3: `testRun` on the render context, and the form that honours it

**Files:**
- Modify: `components/funnels/islands/index.tsx` (add the field to `FunnelRenderContext`)
- Modify: `components/funnels/islands/FormIsland.tsx` (pass it through)
- Modify: `components/funnels/islands/FunnelForm.tsx` (branch the submit)
- Test: `__tests__/components/funnels/funnel-form-test-run.test.tsx`

**Interfaces:**
- Consumes: `livePathToPreview` from Task 1.
- Produces: `FunnelRenderContext.testRun?: { basePath: string }`; `FunnelForm` prop `testRun?: { basePath: string }`.

**Design note the implementer must not "improve":** ONE optional object, not a `testRun: boolean` beside a `previewBasePath: string`. Two fields that must agree eventually disagree — the builder already learned this with `editable`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/funnels/funnel-form-test-run.test.tsx
//
// Three submit behaviours share one handler, and getting the branch wrong is
// either "the owner cannot test the form" or "a preview created a real lead".

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FunnelForm } from "@/components/funnels/islands/FunnelForm"

const FIELDS = [{ name: "email", label: "Email", type: "email" as const, required: true }]

function renderForm(extra: Record<string, unknown> = {}) {
  return render(
    <FunnelForm
      funnelId="ffffffff-1111-4222-8333-444444444444"
      stepId="3f1b7c5e-1111-4222-8333-444444444444"
      formKey="optin"
      fields={FIELDS}
      submitLabel="Request a spot"
      successMode="message"
      successMessage="Thanks — you're in."
      waiverHtml={null}
      isPreview={false}
      {...extra}
    />,
  )
}

async function submitWith(email: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
  fireEvent.click(screen.getByRole("button", { name: /request a spot/i }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    clone: () => ({ json: async () => ({}) }),
    json: async () => ({ ok: true, outcome: { kind: "message" } }),
  }))
})

describe("FunnelForm submit routing", () => {
  it("posts to the LIVE endpoint when there is no test run", async () => {
    renderForm()
    await submitWith("a@b.com")
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mock(fetch).mock.calls[0][0]).toBe("/api/funnels/submit")
  })

  it("posts to the PREVIEW endpoint when testRun is set", async () => {
    // MUTANT KILLED: leaving the URL alone. The live route validates against
    // getPublishedFormConfig, which is null on a draft, so this would answer
    // "This form is no longer available" and the test run would be impossible.
    renderForm({ testRun: { basePath: "/preview/summer-camp" } })
    await submitWith("a@b.com")
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(mock(fetch).mock.calls[0][0]).toBe("/api/funnels/preview-submit")
  })

  it("never posts at all while the canvas is editable", async () => {
    // MUTANT KILLED: checking testRun before editable. The first click of a
    // double-click to RENAME the button is a submit.
    renderForm({ editable: true, testRun: { basePath: "/preview/summer-camp" } })
    await submitWith("a@b.com")
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
  })

  it("still refuses a plain preview with no test run", async () => {
    // MUTANT KILLED: dropping the old isPreview guard once testRun exists. The
    // builder iframe and /go?preview=1 both still rely on it.
    renderForm({ isPreview: true })
    await submitWith("a@b.com")
    await waitFor(() => expect(screen.getByText(/submissions are disabled/i)).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
  })

  it("navigates to the server-supplied preview href on a redirect outcome", async () => {
    mock(fetch).mockResolvedValue({
      ok: true,
      clone: () => ({ json: async () => ({}) }),
      json: async () => ({ ok: true, outcome: { kind: "redirect", href: "/preview/summer-camp/thanks" } }),
    })
    const assign = vi.fn()
    Object.defineProperty(window, "location", { value: { ...window.location, get href() { return "" }, set href(v: string) { assign(v) } }, writable: true })
    renderForm({ testRun: { basePath: "/preview/summer-camp" }, successMode: "redirect", redirectUrl: "/go/summer-camp/thanks" })
    await submitWith("a@b.com")
    // MUTANT KILLED: navigating to the stored /go url. The SERVER does the
    // rewrite; the client never navigates to a URL the server did not produce.
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/preview/summer-camp/thanks"))
  })

  it("reports an external redirect instead of following it", async () => {
    mock(fetch).mockResolvedValue({
      ok: true,
      clone: () => ({ json: async () => ({}) }),
      json: async () => ({ ok: true, outcome: { kind: "external", href: "https://example.com/thanks" } }),
    })
    renderForm({ testRun: { basePath: "/preview/summer-camp" }, successMode: "redirect", redirectUrl: "https://example.com/thanks" })
    await submitWith("a@b.com")
    await waitFor(() => expect(screen.getByText(/would send you to/i)).toBeInTheDocument())
    expect(screen.getByRole("link", { name: /example\.com/i })).toBeInTheDocument()
  })

  it("reports a checkout instead of starting one", async () => {
    mock(fetch).mockResolvedValue({
      ok: true,
      clone: () => ({ json: async () => ({}) }),
      json: async () => ({ ok: true, outcome: { kind: "checkout", label: "Comeback Code" } }),
    })
    renderForm({ testRun: { basePath: "/preview/summer-camp" }, successMode: "checkout" })
    await submitWith("a@b.com")
    await waitFor(() => expect(screen.getByText(/would start a checkout/i)).toBeInTheDocument())
  })

  it("shows what would have been captured", async () => {
    mock(fetch).mockResolvedValue({
      ok: true,
      clone: () => ({ json: async () => ({}) }),
      json: async () => ({ ok: true, outcome: { kind: "message" }, captured: { email: "a@b.com" } }),
    })
    renderForm({ testRun: { basePath: "/preview/summer-camp" } })
    await submitWith("a@b.com")
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument())
    expect(screen.getByText("a@b.com")).toBeInTheDocument()
  })
})

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/funnels/funnel-form-test-run.test.tsx`
Expected: FAIL — the second test posts to `/api/funnels/submit`.

- [ ] **Step 3: Add the context field**

In `components/funnels/islands/index.tsx`, inside `FunnelRenderContext`:

```ts
  /**
   * Set ONLY by the full-screen draft preview (/preview/<slug>). Its presence
   * means BOTH "post to the preview-submit endpoint" and "in-funnel redirects
   * come back rewritten onto this base".
   *
   * ONE OBJECT, NOT TWO FLAGS. A `testRun: boolean` beside a
   * `previewBasePath: string` is two values that must agree, and the pair that
   * disagrees is the one nobody tests: posting to the preview endpoint while
   * navigating to a live URL, or the reverse.
   *
   * Absent everywhere else BY OMISSION, so /go and every published version row
   * build a context byte-identical to what they built before this existed.
   */
  testRun?: { basePath: string }
```

- [ ] **Step 4: Thread it through `FormIsland`**

In `components/funnels/islands/FormIsland.tsx`, add to the `<FunnelForm .../>` call:

```tsx
      testRun={context.testRun}
```

- [ ] **Step 5: Branch the submit in `FunnelForm`**

Add `testRun?: { basePath: string }` to `FunnelFormProps` and to the destructured params. In `handleSubmit`, **after** the `editable` short-circuit and **before** the `isPreview` guard:

```ts
    // ORDER MATTERS AND IS TESTED. `editable` still wins — the first click of a
    // double-click to rename the button is a submit, and answering it is what
    // makes an edit look like it failed. `testRun` then overrides the plain
    // preview refusal below, which every OTHER preview surface still relies on.
    const endpoint = testRun ? "/api/funnels/preview-submit" : "/api/funnels/submit"
    if (isPreview && !testRun) {
      setError("This is a preview — submissions are disabled.")
      setStatus("error")
      return
    }
```

Change the `fetch("/api/funnels/submit", …)` call to `fetch(endpoint, …)`.

Then, still inside the `response.ok` path, handle the test-run outcome **before** the existing `sessionUrl` and `successMode` branches:

```ts
      if (testRun) {
        const result = (await response.clone().json().catch(() => null)) as TestRunBody | null
        const outcome = result?.outcome
        if (outcome?.kind === "redirect" && typeof outcome.href === "string") {
          // The SERVER produced this href, already rewritten onto the preview
          // base. Same rule as `sessionUrl`: never navigate to a URL the client
          // assembled, and never string-replace `redirectUrl` here — that would
          // be the second, drifting implementation of `livePathToPreview`.
          if (outcome.href.startsWith("/") && !outcome.href.startsWith("//")) {
            window.location.href = outcome.href
            return
          }
        }
        setTestRun({ outcome: outcome ?? { kind: "message" }, captured: result?.captured ?? {} })
        setStatus("done")
        return
      }
```

Add the state and the type:

```ts
type TestRunOutcome =
  | { kind: "message" }
  | { kind: "redirect"; href: string }
  | { kind: "external"; href: string }
  | { kind: "checkout"; label: string }
  | { kind: "no-draft"; stepName: string }

interface TestRunBody {
  outcome?: TestRunOutcome
  captured?: Record<string, string>
}

const [testRunResult, setTestRun] = useState<{ outcome: TestRunOutcome; captured: Record<string, string> } | null>(null)
```

- [ ] **Step 6: Render the test-run panel**

In the `status === "done"` branch, when `testRunResult` is set, render the success message followed by the panel. Plain words, no jargon — the audience is a coach, not a developer:

```tsx
  if (status === "done" && testRunResult) {
    const { outcome, captured } = testRunResult
    return (
      <div className="djp-form-success" data-djp-form-state="success" role="status">
        {successMessage}
        <div
          data-djp-test-run
          className="mt-4 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 text-left"
        >
          <p className="font-heading text-sm">This was a test run</p>
          {outcome.kind === "external" ? (
            <p className="font-body mt-1 text-sm">
              On the live page this would send you to{" "}
              <a className="underline" href={outcome.href} target="_blank" rel="noopener noreferrer">
                {outcome.href}
              </a>
              .
            </p>
          ) : null}
          {outcome.kind === "checkout" ? (
            <p className="font-body mt-1 text-sm">
              On the live page this would start a checkout for “{outcome.label}”. No payment was set up.
            </p>
          ) : null}
          {outcome.kind === "no-draft" ? (
            <p className="font-body mt-1 text-sm">
              This form sends people to “{outcome.stepName}” next, but that page has no draft yet — so there is
              nothing to show. Write it in the builder and try again.
            </p>
          ) : null}
          {Object.keys(captured).length > 0 ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {Object.entries(captured).map(([key, value]) => (
                <Fragment key={key}>
                  <dt className="font-body text-xs text-muted-foreground">{key}</dt>
                  <dd className="font-mono text-xs">{value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
          <p className="font-body mt-3 text-xs text-muted-foreground">
            Nothing was saved. No one was emailed or texted.
          </p>
        </div>
      </div>
    )
  }
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run __tests__/components/funnels/funnel-form-test-run.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 8: Prove the live path is untouched**

Run: `npx vitest run __tests__/components/funnels __tests__/app/funnel-draft-preview-page.test.tsx`
Expected: PASS, every pre-existing form test unmodified.

- [ ] **Step 9: Commit**

```bash
git add components/funnels/islands __tests__/components/funnels/funnel-form-test-run.test.tsx
git commit -m "feat(preview): route form submits to the test-run endpoint

One optional context object rather than a flag plus a base path: two values
that must agree eventually disagree, and the pair nobody tests is posting to
the preview endpoint while navigating to a live URL."
```

---

### Task 4: `/api/funnels/preview-submit` — validates like the live route, writes nothing

**Files:**
- Create: `app/api/funnels/preview-submit/route.ts`
- Test: `__tests__/app/api/funnels/preview-submit.test.ts`

**Interfaces:**
- Consumes: `auth`, `getDraft`, `getFunnelById`, `getFunnelBySlug`, `listSteps`, `funnelFormFieldSchema`, `livePathToPreview` (Task 1).
- Produces: `POST` accepting `{ stepId, formKey, values }`, answering `{ ok: true, outcome, captured }` or `{ ok: false, error }`.

**The load-bearing constraint:** this route must never construct a Supabase write. The test asserts it by making the service-role client throw if anything but a read is attempted.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/app/api/funnels/preview-submit.test.ts
//
// The endpoint that lets the owner test a form on an UNPUBLISHED page. The
// live route cannot do this: it validates against getPublishedFormConfig,
// which is null until a version row exists. So this route reads the DRAFT —
// and the price of that is that it must be admin-gated and must write nothing.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ getFunnelById: vi.fn(), getFunnelBySlug: vi.fn(), listSteps: vi.fn(), getStep: vi.fn() }))

import { POST } from "@/app/api/funnels/preview-submit/route"
import { auth } from "@/lib/auth"
import { getDraft } from "@/lib/db/funnel-builder"
import { getFunnelById, getFunnelBySlug, getStep, listSteps } from "@/lib/db/funnels"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"

function docWith(props: Record<string, unknown>): SectionDoc {
  return {
    version: 1,
    theme: { preset: "dark" },
    sections: [
      {
        id: "form-1",
        kind: "form",
        props: {
          heading: "Apply",
          formKey: "optin",
          submitLabel: "Request a spot",
          fields: [
            { name: "name", label: "Name", type: "text", required: true },
            { name: "email", label: "Email", type: "email", required: true },
          ],
          successMessage: "Thanks — you're in.",
          ...props,
        },
      },
    ],
  } as unknown as SectionDoc
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/funnels/preview-submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

const GOOD = { stepId: STEP_ID, formKey: "optin", values: { name: "Jane", email: "jane@example.com" } }

beforeEach(() => {
  vi.resetAllMocks()
  mock(auth).mockResolvedValue({ user: { role: "admin" } })
  mock(getStep).mockResolvedValue({ id: STEP_ID, funnel_id: FUNNEL_ID, slug: "start", name: "Start" })
  mock(getFunnelById).mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", name: "Summer camp" })
  mock(getDraft).mockResolvedValue({ doc: docWith({}), docInvalid: false, revision: 1 })
  mock(listSteps).mockResolvedValue([{ id: STEP_ID, slug: "start", name: "Start" }])
})

describe("the gate", () => {
  it("404s an anonymous caller", async () => {
    mock(auth).mockResolvedValue(null)
    expect((await post(GOOD)).status).toBe(404)
  })

  it("404s a signed-in client", async () => {
    // MUTANT KILLED: gating on "is signed in". A client could otherwise read
    // the field list of a page that was never published.
    mock(auth).mockResolvedValue({ user: { role: "client" } })
    expect((await post(GOOD)).status).toBe(404)
  })

  it("lets staff through", async () => {
    mock(auth).mockResolvedValue({ user: { role: "staff" } })
    expect((await post(GOOD)).status).toBe(200)
  })
})

describe("validation matches the live route", () => {
  it("rejects a missing required field with the field's label", async () => {
    const response = await post({ ...GOOD, values: { name: "Jane", email: "" } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Email is required.")
  })

  it("rejects a malformed email", async () => {
    const response = await post({ ...GOOD, values: { name: "Jane", email: "nope" } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/valid email/i)
  })

  it("discards a field the draft form does not declare", async () => {
    // MUTANT KILLED: echoing back the raw payload. The draft doc is the
    // authority on which fields exist, exactly as the published config is on
    // the live route.
    const response = await post({ ...GOOD, values: { ...GOOD.values, injected: "x" } })
    const body = await response.json()
    expect(body.captured).toEqual({ name: "Jane", email: "jane@example.com" })
    expect(body.captured.injected).toBeUndefined()
  })

  it("404s a form key the draft does not contain", async () => {
    const response = await post({ ...GOOD, formKey: "not-a-form" })
    expect(response.status).toBe(404)
  })

  it("reports a draft that cannot be read rather than throwing", async () => {
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 1 })
    expect((await post(GOOD)).status).toBe(409)
  })
})

describe("outcomes", () => {
  it("returns the success message for a message form", async () => {
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "message" })
  })

  it("rewrites an internal redirect onto the preview base", async () => {
    mock(getDraft).mockResolvedValue({
      doc: docWith({ successMode: "redirect", redirectUrl: "/go/summer-camp/thanks" }),
      docInvalid: false, revision: 1,
    })
    mock(getFunnelBySlug).mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", name: "Summer camp" })
    mock(listSteps).mockResolvedValue([
      { id: STEP_ID, slug: "start", name: "Start" },
      { id: "next-id", slug: "thanks", name: "Thanks" },
    ])
    mock(getDraft).mockImplementation(async (id: string) =>
      id === "next-id"
        ? { doc: docWith({}), docInvalid: false, revision: 1 }
        : { doc: docWith({ successMode: "redirect", redirectUrl: "/go/summer-camp/thanks" }), docInvalid: false, revision: 1 },
    )
    const body = await (await post(GOOD)).json()
    // MUTANT KILLED: returning the stored /go url. The owner would be thrown
    // out of the preview onto a 404 at the exact moment the funnel walk works.
    expect(body.outcome).toEqual({ kind: "redirect", href: "/preview/summer-camp/thanks" })
  })

  it("reports a next step that has no draft instead of walking to a blank page", async () => {
    mock(getDraft).mockImplementation(async (id: string) =>
      id === "next-id"
        ? { doc: null, docInvalid: false, revision: 0 }
        : { doc: docWith({ successMode: "redirect", redirectUrl: "/go/summer-camp/thanks" }), docInvalid: false, revision: 1 },
    )
    mock(getFunnelBySlug).mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", name: "Summer camp" })
    mock(listSteps).mockResolvedValue([
      { id: STEP_ID, slug: "start", name: "Start" },
      { id: "next-id", slug: "thanks", name: "Thanks" },
    ])
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "no-draft", stepName: "Thanks" })
  })

  it("reports an external redirect rather than returning it as a navigation", async () => {
    mock(getDraft).mockResolvedValue({
      doc: docWith({ successMode: "redirect", redirectUrl: "https://example.com/thanks" }),
      docInvalid: false, revision: 1,
    })
    const body = await (await post(GOOD)).json()
    expect(body.outcome).toEqual({ kind: "external", href: "https://example.com/thanks" })
  })

  it("reports a checkout without naming a Stripe session", async () => {
    mock(getDraft).mockResolvedValue({
      doc: docWith({ successMode: "checkout", productKind: "program", productId: "11111111-2222-4333-8444-555555555555" }),
      docInvalid: false, revision: 1,
    })
    const body = await (await post(GOOD)).json()
    expect(body.outcome.kind).toBe("checkout")
    expect(JSON.stringify(body)).not.toMatch(/stripe|sessionUrl/i)
  })
})

describe("it writes nothing — the whole reason this route exists", () => {
  it("never imports a write path", async () => {
    // MUTANT KILLED: someone adding createSubmission "so the owner can see the
    // lead". The module graph is the assertion; a spy would only prove this
    // request did not write, not that the route cannot.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/funnels/preview-submit/route.ts", "utf8"),
    )
    for (const forbidden of [
      "createSubmission", "captureContactFromSubmission", "recordConsent",
      "sendNewFunnelLeadEmail", "createEventSignupCheckout", "createServiceRoleClient",
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/app/api/funnels/preview-submit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

```ts
// app/api/funnels/preview-submit/route.ts
//
// A TEST RUN OF A FORM ON AN UNPUBLISHED PAGE. It exists because the live
// route cannot do this and must not be taught to: /api/funnels/submit reads the
// field list from `getPublishedFormConfig`, which returns null until a version
// row exists, and that indirection IS its security model — the browser never
// gets to say what the form contained.
//
// So this route reads the DRAFT instead, and pays for that two ways:
//   1. It is admin/staff gated and answers 404 to everyone else, exactly like
//      the preview page it is submitted from.
//   2. IT WRITES NOTHING. No submission row, no lead user, no contact-spine
//      capture, no consent row, no coach email, no Stripe session. An `is_test`
//      column was considered and rejected: `funnel_submissions` has seven read
//      sites plus three lead counts plus the attribution join, and one missed
//      filter puts fake leads in a real export.
//
// The validation below is deliberately a MIRROR of the live route's, not a
// shared helper. Sharing it would mean the live route's rules could be changed
// from here, and the live route's rules protect real leads.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getDraft } from "@/lib/db/funnel-builder"
import { getFunnelById, getFunnelBySlug, getStep, listSteps } from "@/lib/db/funnels"
import { funnelFormFieldSchema, type FunnelFormField } from "@/lib/funnels/islands"
import { livePathToPreview } from "@/lib/funnels/preview-path"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const bodySchema = z.object({
  stepId: z.string().uuid(),
  formKey: z.string().min(1).max(40),
  values: z.record(z.string(), z.string().max(2000)),
})

/** 404, never 403 — the route does not confirm a step exists to a stranger. */
const NOT_FOUND = () => NextResponse.json({ error: "Not found." }, { status: 404 })

export async function POST(request: Request) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") return NOT_FOUND()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  const { stepId, formKey, values } = parsed.data

  const step = await getStep(stepId)
  if (!step) return NOT_FOUND()
  const funnel = await getFunnelById(step.funnel_id)
  if (!funnel) return NOT_FOUND()

  const draft = await getDraft(stepId)
  if (!draft || draft.docInvalid) {
    return NextResponse.json({ error: "This page's draft can't be read." }, { status: 409 })
  }
  if (!draft.doc) return NOT_FOUND()

  const props = findFormProps(draft.doc, formKey)
  if (!props) return NOT_FOUND()

  const fieldsResult = z.array(funnelFormFieldSchema).safeParse(props.fields)
  if (!fieldsResult.success) {
    return NextResponse.json({ error: "This form is misconfigured." }, { status: 409 })
  }
  const fields: FunnelFormField[] = fieldsResult.data

  // The SAME rules the live route applies, in the same order, so a form that
  // passes here passes there.
  const captured: Record<string, string> = {}
  for (const field of fields) {
    const value = (values[field.name] ?? "").trim()
    if (field.required && value.length === 0) {
      return NextResponse.json({ error: `${field.label} is required.` }, { status: 400 })
    }
    if (field.type === "email" && value.length > 0 && !z.string().email().safeParse(value).success) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
    }
    if (value.length > 0) captured[field.name] = value
  }

  return NextResponse.json({ ok: true, outcome: await outcomeFor(props), captured })
}

type Outcome =
  | { kind: "message" }
  | { kind: "redirect"; href: string }
  | { kind: "external"; href: string }
  | { kind: "checkout"; label: string }
  | { kind: "no-draft"; stepName: string }

/**
 * What the live page would have done next, said rather than done.
 *
 * Only the internal redirect is ACTED on, and that is the funnel walk. A
 * checkout and an external URL are both places the owner cannot come back from
 * mid-test, so they are reported.
 */
async function outcomeFor(props: Record<string, unknown>): Promise<Outcome> {
  if (props.successMode === "checkout") {
    return { kind: "checkout", label: String(props.productName ?? props.submitLabel ?? "this product") }
  }
  if (props.successMode !== "redirect") return { kind: "message" }

  const redirectUrl = typeof props.redirectUrl === "string" ? props.redirectUrl : ""
  if (!redirectUrl) return { kind: "message" }

  const previewHref = livePathToPreview(redirectUrl)
  if (!previewHref) return { kind: "external", href: redirectUrl }

  // A journey that ends on a blank page is a FINDING, not a crash — say so
  // rather than walking the owner into an empty preview.
  const [, , slug, nextSlug] = previewHref.split("/")
  const target = await getFunnelBySlug(decodeURIComponent(slug)).catch(() => null)
  if (!target) return { kind: "redirect", href: previewHref }
  const steps = await listSteps(target.id).catch(() => [])
  const next = nextSlug
    ? steps.find((s) => s.slug === decodeURIComponent(nextSlug))
    : steps.find((s) => s.is_entry)
  if (!next) return { kind: "redirect", href: previewHref }
  const nextDraft = await getDraft(next.id).catch(() => null)
  if (!nextDraft?.doc) return { kind: "no-draft", stepName: next.name }
  return { kind: "redirect", href: previewHref }
}

/** The draft doc is the authority on which fields exist. */
function findFormProps(doc: SectionDoc, formKey: string): Record<string, unknown> | null {
  for (const section of doc.sections) {
    const props = section.props as Record<string, unknown>
    if (props?.formKey === formKey) return props
  }
  return null
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/app/api/funnels/preview-submit.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/funnels/preview-submit __tests__/app/api/funnels/preview-submit.test.ts
git commit -m "feat(preview): a test-run submit endpoint that writes nothing

Mirrors the live route's validation rather than sharing it: a shared helper
would let this route's needs change rules that protect real leads."
```

---

### Task 5: The `/preview/<slug>/<step>` route

**Files:**
- Create: `app/(funnel)/preview/[slug]/[[...step]]/page.tsx`
- Test: `__tests__/app/draft-preview-route.test.tsx`

**Interfaces:**
- Consumes: `renderDraftPreview` (Task 2), `previewBasePath` (Task 1), `PreviewPill` (Task 6 — build the pill first if executing strictly in order, or stub the import and fill it in Task 6).
- Produces: the route. Nothing imports it.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/app/draft-preview-route.test.tsx
//
// /preview/<slug>/<step> — the full-screen draft. It mirrors /go's path shape
// so that `funnelBasePath` alone walks the funnel; everything else about it is
// the gate and the fail-soft notices.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ getFunnelBySlug: vi.fn(), listSteps: vi.fn() }))
vi.mock("@/lib/funnels/preview-render", () => ({ renderDraftPreview: vi.fn() }))

import Page, { metadata } from "@/app/(funnel)/preview/[slug]/[[...step]]/page"
import { auth } from "@/lib/auth"
import { getFunnelBySlug, listSteps } from "@/lib/db/funnels"
import { renderDraftPreview } from "@/lib/funnels/preview-render"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const FUNNEL = { id: "ffffffff-1111-4222-8333-444444444444", slug: "summer-camp", name: "Summer camp", status: "draft", kind: "funnel" }
const ENTRY = { id: "step-1", slug: "start", name: "Start", is_entry: true, position: 0 }
const SECOND = { id: "step-2", slug: "thanks", name: "Thanks", is_entry: false, position: 1 }

const render = (slug: string, step?: string[]) =>
  Page({ params: Promise.resolve({ slug, step }) })

beforeEach(() => {
  vi.resetAllMocks()
  mock(auth).mockResolvedValue({ user: { role: "admin" } })
  mock(getFunnelBySlug).mockResolvedValue(FUNNEL)
  mock(listSteps).mockResolvedValue([ENTRY, SECOND])
  mock(renderDraftPreview).mockResolvedValue({ kind: "ok", nodes: [], css: ".x{}", problems: [] })
})

describe("the gate", () => {
  it.each([[null], [{ user: { role: "client" } }], [{ user: {} }]])("404s %#", async (session) => {
    mock(auth).mockResolvedValue(session)
    await expect(render("summer-camp")).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("lets admin and staff through", async () => {
    for (const role of ["admin", "staff"]) {
      mock(auth).mockResolvedValue({ user: { role } })
      await expect(render("summer-camp")).resolves.toBeTruthy()
    }
  })

  it("404s an unknown funnel slug", async () => {
    mock(getFunnelBySlug).mockResolvedValue(null)
    await expect(render("nope")).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("404s more than one segment past the slug", async () => {
    // MUTANT KILLED: dropping the catch-all length check that /go has.
    await expect(render("summer-camp", ["a", "b"])).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("is never indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

describe("which step it renders", () => {
  it("renders the entry step when no step segment is given", async () => {
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].stepId).toBe("step-1")
  })

  it("renders the named step", async () => {
    await render("summer-camp", ["thanks"])
    expect(mock(renderDraftPreview).mock.calls[0][0].stepId).toBe("step-2")
  })

  it("404s a step slug this funnel does not have", async () => {
    await expect(render("summer-camp", ["ghost"])).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders against the PREVIEW base so in-funnel buttons stay in the preview", async () => {
    // MUTANT KILLED: passing /go/<slug>. Every step button would leave the
    // preview for a route that 404s until publish — the exact complaint.
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].funnelBasePath).toBe("/preview/summer-camp")
  })

  it("never renders editable, whatever the URL says", async () => {
    // MUTANT KILLED: accepting ?edit=1 here. The canvas anchors belong to the
    // builder iframe alone; a slug-addressed URL must not reach them.
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].editable).not.toBe(true)
  })
})

describe("what the owner sees", () => {
  it("shows the pill saying this is not the live page", async () => {
    const html = renderToStaticMarkup(await render("summer-camp") as React.ReactElement)
    expect(html).toMatch(/not published/i)
  })

  it("shows the publish-blocked banner above the page", async () => {
    mock(renderDraftPreview).mockResolvedValue({ kind: "ok", nodes: [], css: "", problems: ["Two buy buttons are dead."] })
    const html = renderToStaticMarkup(await render("summer-camp") as React.ReactElement)
    expect(html).toContain("Two buy buttons are dead.")
  })

  it("says nothing to preview yet rather than 404ing an undrafted step", async () => {
    // MUTANT KILLED: notFound() here. "This step does not exist" is a
    // different and wrong statement from "you have not written it yet".
    mock(renderDraftPreview).mockResolvedValue({ kind: "no-draft" })
    const html = renderToStaticMarkup(await render("summer-camp") as React.ReactElement)
    expect(html).toMatch(/nothing to preview yet/i)
  })

  it("explains a document it cannot read", async () => {
    mock(renderDraftPreview).mockResolvedValue({ kind: "doc-invalid" })
    const html = renderToStaticMarkup(await render("summer-camp") as React.ReactElement)
    expect(html).toMatch(/can't be previewed/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/app/draft-preview-route.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

```tsx
// app/(funnel)/preview/[slug]/[[...step]]/page.tsx — the FULL-SCREEN draft.
//
// WHY IT MIRRORS /go's PATH SHAPE. `renderCtaTarget`'s `step` case builds
// `${ctx.funnelBasePath}/${stepSlug}` (lib/funnels/sections/render.ts:463), so
// a route addressed the same way as the live one — funnel slug, then optional
// step slug — walks the whole funnel in draft for the cost of passing a
// different base. Address it any other way and every in-funnel button needs a
// rewrite the renderer would have to learn about.
//
// WHY NOT UNDER /admin. The (funnel) route group exists to escape the marketing
// chrome — navbar, footer, sticky CTA — which is the whole of "full screen".
// (admin) would wrap it in the dashboard shell instead, which is the thing the
// builder's own iframe already does.
//
// /funnel-preview/[stepId] IS NOT REPLACED BY THIS. It is keyed by step id
// because the builder knows the id and not the slug, and it carries `?edit=1`,
// which must never be reachable from a slug-addressed URL — hence `editable`
// is hard-coded false below rather than read from searchParams.
//
// SELF-GATED. middleware.ts matches only /admin/* and /client/*, so everything
// here is public unless this file says otherwise. It fails CLOSED and answers
// 404, so the route does not confirm that a funnel slug exists.

import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { NodeRenderer } from "@/components/funnels/NodeRenderer"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { getFunnelBySlug, listSteps } from "@/lib/db/funnels"
import { renderDraftPreview } from "@/lib/funnels/preview-render"
import { previewBasePath } from "@/lib/funnels/preview-path"
import { PreviewPill } from "@/components/funnels/PreviewPill"

export const metadata = { robots: { index: false, follow: false } }

interface PageProps {
  params: Promise<{ slug: string; step?: string[] }>
}

function PreviewNotice({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-heading text-2xl text-foreground">{title}</h1>
      <ul className="mt-6 space-y-2">
        {lines.map((line, index) => (
          <li key={index} className="font-body text-sm text-muted-foreground">{line}</li>
        ))}
      </ul>
    </div>
  )
}

function BlockedBanner({ problems }: { problems: string[] }) {
  return (
    <div className="border-b border-[var(--warning)]/40 bg-[var(--warning)]/10 px-6 py-4">
      <p className="font-heading text-sm text-foreground">This page previews, but publishing will refuse it</p>
      <ul className="mt-2 space-y-1">
        {problems.map((problem, index) => (
          <li key={index} className="font-body text-sm text-muted-foreground">{problem}</li>
        ))}
      </ul>
    </div>
  )
}

export default async function DraftPreviewPage({ params }: PageProps) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") notFound()

  const { slug, step } = await params
  if (step && step.length > 1) notFound()

  const funnel = await getFunnelBySlug(slug)
  if (!funnel) notFound()

  const steps = await listSteps(funnel.id)
  const stepSlug = step?.[0]
  const target = stepSlug ? steps.find((s) => s.slug === stepSlug) : steps.find((s) => s.is_entry)
  if (!target) notFound()

  const basePath = previewBasePath(funnel.slug)
  const result = await renderDraftPreview({
    stepId: target.id,
    funnelId: funnel.id,
    funnelBasePath: basePath,
    // NEVER from the URL. See the header.
    editable: false,
  })

  const pill = (
    <PreviewPill
      funnelName={funnel.name}
      stepName={target.name}
      isLive={funnel.status === "published" && Boolean(target.published_version_id)}
      livePath={`/go/${funnel.slug}${target.is_entry ? "" : `/${target.slug}`}`}
    />
  )

  if (result.kind === "doc-invalid") {
    return (
      <>
        <PreviewNotice
          title="This page can't be previewed"
          lines={[
            "Its saved content is not a document the page builder can read — either it is from the old " +
              "drag-and-drop editor, or it has been corrupted.",
            "Nothing has been lost. Restore an earlier version from the chat to carry on.",
          ]}
        />
        {pill}
      </>
    )
  }
  if (result.kind === "no-draft") {
    return (
      <>
        <PreviewNotice
          title="Nothing to preview yet"
          lines={["This page has no draft. Describe what you want in the builder chat and it will appear here."]}
        />
        {pill}
      </>
    )
  }
  if (result.kind === "render-failed") {
    return <><PreviewNotice title="This page can't be rendered" lines={[result.message]} />{pill}</>
  }
  if (result.kind === "compile-failed") {
    return <><PreviewNotice title="This page can't be compiled" lines={result.problems} />{pill}</>
  }

  return (
    <>
      {result.problems.length > 0 ? <BlockedBanner problems={result.problems} /> : null}
      <div id={FUNNEL_ROOT_ID}>
        {result.css ? <style dangerouslySetInnerHTML={{ __html: result.css }} /> : null}
        <NodeRenderer
          nodes={result.nodes}
          context={{
            funnelId: funnel.id,
            funnelSlug: funnel.slug,
            stepId: target.id,
            stepSlug: target.slug,
            // Still true: the page is not published, so nothing it submits may
            // reach the real world. `testRun` is what makes the form usable
            // ANYWAY, through an endpoint that writes nothing.
            isPreview: true,
            testRun: { basePath },
          }}
        />
      </div>
      {pill}
    </>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/app/draft-preview-route.test.tsx`
Expected: PASS, 14 assertions across the describes.

- [ ] **Step 5: Commit**

```bash
git add "app/(funnel)/preview" __tests__/app/draft-preview-route.test.tsx
git commit -m "feat(preview): full-screen draft route at /preview/<slug>"
```

---

### Task 6: The preview pill

**Files:**
- Create: `components/funnels/PreviewPill.tsx`
- Test: `__tests__/components/funnels/preview-pill.test.tsx`

**Interfaces:**
- Produces: `PreviewPill({ funnelName, stepName, isLive, livePath })`.

**Copy rule:** the audience is a coach, not a developer. No "draft state", no "unpublished route", no jargon. Read every line aloud before writing it.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/funnels/preview-pill.test.tsx

import { describe, expect, it, beforeEach, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PreviewPill } from "@/components/funnels/PreviewPill"

const PROPS = { funnelName: "Summer camp", stepName: "Start", isLive: false, livePath: "/go/summer-camp" }

beforeEach(() => { window.sessionStorage.clear() })

describe("PreviewPill", () => {
  it("says this is not the live page, in words a coach can read", () => {
    render(<PreviewPill {...PROPS} />)
    expect(screen.getByText(/not published/i)).toBeInTheDocument()
    // MUTANT KILLED: jargon. "draft state", "unpublished route", "version row"
    // are all things the audience has never been taught.
    expect(document.body.textContent).not.toMatch(/route|version row|draft state|endpoint/i)
  })

  it("names the page being previewed", () => {
    render(<PreviewPill {...PROPS} />)
    expect(screen.getByText(/Start/)).toBeInTheDocument()
  })

  it("offers the live page only when there IS one", () => {
    const { rerender } = render(<PreviewPill {...PROPS} />)
    expect(screen.queryByRole("link", { name: /live page/i })).toBeNull()
    rerender(<PreviewPill {...PROPS} isLive />)
    expect(screen.getByRole("link", { name: /live page/i })).toHaveAttribute("href", "/go/summer-camp")
  })

  it("hides when dismissed and stays hidden for the session", () => {
    const { unmount } = render(<PreviewPill {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: /hide/i }))
    expect(screen.queryByText(/not published/i)).toBeNull()
    unmount()
    render(<PreviewPill {...PROPS} />)
    expect(screen.queryByText(/not published/i)).toBeNull()
  })

  it("renders even when sessionStorage throws", () => {
    // MUTANT KILLED: an unguarded read. Private-window browsers throw on
    // access, and the pill is the one thing telling the owner this is not live.
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    render(<PreviewPill {...PROPS} />)
    expect(screen.getByText(/not published/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/funnels/preview-pill.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
"use client"

// components/funnels/PreviewPill.tsx
//
// The one piece of chrome the full-screen preview adds.
//
// The builder's iframe preview deliberately renders bare — "the preview is
// supposed to look exactly like the published page" — and that is right INSIDE
// the builder, where the surrounding app already says where you are. Full
// screen in its own tab it becomes a liability: the page is then
// indistinguishable from the live site, which is how a /preview link gets sent
// to a client by mistake.
//
// A PILL AND NOT A BANNER. A bar across the top pushes the fold and changes the
// very layout being judged. Bottom-right, dismissible for the session.

import { useEffect, useState } from "react"
import { Eye, X } from "lucide-react"

const DISMISS_KEY = "djp-preview-pill-dismissed"

/** Every access guarded: a private window throws rather than returning null. */
function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

export function PreviewPill({
  funnelName,
  stepName,
  isLive,
  livePath,
}: {
  funnelName: string
  stepName: string
  isLive: boolean
  livePath: string
}) {
  // Starts visible and hides after mount if it was dismissed. The reverse would
  // flash the pill's absence on the one screen whose job is to say "not live".
  const [hidden, setHidden] = useState(false)
  useEffect(() => { if (readDismissed()) setHidden(true) }, [])

  if (hidden) return null

  return (
    <div
      data-djp-preview-pill
      className="fixed bottom-4 right-4 z-[9999] flex max-w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-border bg-white p-3 shadow-lg"
      role="status"
    >
      <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm text-foreground">Preview — not published</p>
        <p className="font-body mt-0.5 text-xs text-muted-foreground">
          You are looking at “{stepName}” in {funnelName}. Only you can see this. Anything you send from
          this page is a test — it is not saved.
        </p>
        {isLive ? (
          <a
            className="font-body mt-2 inline-block text-xs underline"
            href={livePath}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the live page
          </a>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Hide this note"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-surface"
        onClick={() => {
          setHidden(true)
          try { window.sessionStorage.setItem(DISMISS_KEY, "1") } catch { /* private window */ }
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/components/funnels/preview-pill.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add components/funnels/PreviewPill.tsx __tests__/components/funnels/preview-pill.test.tsx
git commit -m "feat(preview): a dismissible pill so a preview is never mistaken for the live page"
```

---

### Task 7: The three entry points

Nothing above is reachable yet. This task is the whole of "the owner can get to it".

**Files:**
- Modify: `components/admin/funnels/PreviewCard.tsx` (accept a draft preview link)
- Modify: `components/admin/funnels/StepList.tsx:93`
- Modify: `components/admin/funnels/FunnelCard.tsx:190`
- Modify: `components/admin/funnels/FunnelBoard.tsx:264`
- Modify: `components/admin/funnels/FunnelBuilder.tsx` (header button, near line 1908)
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx` (pass `previewUrl`)
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/design/page.tsx` (same prop)
- Test: `__tests__/components/admin/preview-entry-points.test.tsx`

**Interfaces:**
- Consumes: `previewBasePath` (Task 1).
- Produces: `FunnelBuilderProps.previewUrl: string`; `PreviewCardProps.previewUrl` semantics change from "published path or null" to "always a path" plus a new `previewIsDraft: boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/admin/preview-entry-points.test.tsx
//
// The feature is unreachable without these. Each assertion is one surface that
// used to answer "No preview yet" on a page the owner had already written.

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PreviewCard } from "@/components/admin/funnels/PreviewCard"

const BASE = {
  title: "Summer camp",
  href: "/admin/funnels/x/edit/y",
  badgeLabel: "never published",
  badgeTone: "neutral" as const,
}

describe("PreviewCard", () => {
  it("renders a draft thumbnail instead of 'No preview yet'", () => {
    // MUTANT KILLED: keeping `previewUrl={published ? … : null}`. The owner's
    // actual complaint was that an unpublished page shows nothing at all.
    render(<PreviewCard {...BASE} previewUrl="/preview/summer-camp" previewIsDraft />)
    expect(screen.queryByText(/no preview yet/i)).toBeNull()
    expect(document.querySelector("iframe")).toHaveAttribute("src", "/preview/summer-camp")
  })

  it("offers to open the draft full screen", () => {
    render(<PreviewCard {...BASE} previewUrl="/preview/summer-camp" previewIsDraft />)
    const link = screen.getByRole("link", { name: /preview/i })
    expect(link).toHaveAttribute("href", "/preview/summer-camp")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("still says 'No preview yet' when there is genuinely nothing", () => {
    render(<PreviewCard {...BASE} previewUrl={null} />)
    expect(screen.getByText(/no preview yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/admin/preview-entry-points.test.tsx`
Expected: FAIL — no `previewIsDraft` prop, no preview link.

- [ ] **Step 3: Extend `PreviewCard`**

Add `previewIsDraft?: boolean` to `PreviewCardProps`. In the action row, beside the existing `publicUrl` button, render when `previewUrl && previewIsDraft`:

```tsx
          <Button asChild variant="ghost" size="sm">
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              <Eye className="size-4" aria-hidden />
              Preview
            </a>
          </Button>
```

Import `Eye` from `lucide-react`.

- [ ] **Step 4: Point the three card surfaces at the draft**

In each of `StepList.tsx`, `FunnelCard.tsx`, `FunnelBoard.tsx`, replace the `previewUrl={published ? `${path}?preview=1` : null}` line. The published page still previews from the live route (it is the real thing); an unpublished one previews from the draft:

```tsx
// StepList.tsx — `path` is already `/go/<slug>[/<step>]`
const draftPath = `${previewBasePath(funnel.slug)}${step.is_entry ? "" : `/${step.slug}`}`
…
  previewUrl={published ? `${path}?preview=1` : draftPath}
  previewIsDraft={!published}
```

`FunnelCard.tsx` (the funnel's face is its entry page):

```tsx
  previewUrl={entryPublished ? `${path}?preview=1` : previewBasePath(funnel.slug)}
  previewIsDraft={!entryPublished}
```

`FunnelBoard.tsx`:

```tsx
const draftPath = `${previewBasePath(funnel.slug)}${step.is_entry ? "" : `/${step.slug}`}`
…
  previewUrl={published ? `${path}?preview=1` : draftPath}
  previewIsDraft={!published}
```

Import `previewBasePath` from `@/lib/funnels/preview-path` in each.

- [ ] **Step 5: Add the builder header button**

In `FunnelBuilder.tsx`, add `previewUrl: string` to `FunnelBuilderProps` (documented `/** Where "open the draft full screen" goes. */`). Immediately BEFORE the existing "Live page" button (near line 1908):

```tsx
        <Button asChild variant="ghost" size="sm">
          <a href={props.previewUrl} target="_blank" rel="noopener noreferrer">
            <Eye className="size-4" aria-hidden />
            Preview
          </a>
        </Button>
```

Import `Eye` from `lucide-react` alongside the existing icons. Before "Live page", because the draft is the thing the owner is working on and the live page is the reference.

- [ ] **Step 6: Pass the prop from both editor pages**

In `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx`, beside the existing `publicUrl`:

```ts
  const previewUrl = `${previewBasePath(funnel.slug)}${step.is_entry ? "" : `/${step.slug}`}`
```

and `previewUrl={previewUrl}` on the `<FunnelBuilder />`. Repeat in `design/page.tsx`, which builds the same `publicUrl` at line 61 and passes it at line 86.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run __tests__/components/admin/preview-entry-points.test.tsx __tests__/components/admin`
Expected: PASS. Existing `funnel-preview-pane.test.tsx` and any card tests must pass unmodified.

- [ ] **Step 8: Typecheck the prop additions**

Run: `npx tsc --noEmit 2>&1 | grep -E "FunnelBuilder|PreviewCard|StepList|FunnelCard|FunnelBoard|preview" | head -20`
Expected: no output. A missing `previewUrl` at a call site is a compile error, which is how the two editor pages are guaranteed to be updated.

- [ ] **Step 9: Commit**

```bash
git add components/admin/funnels "app/(admin)/admin/funnels" __tests__/components/admin/preview-entry-points.test.tsx
git commit -m "feat(preview): reach the draft preview from the builder and the cards

An unpublished page showed 'No preview yet' on every card in the admin, which
was the owner's actual complaint — the preview existed and nothing linked to it."
```

---

### Task 8: Verify against the real app, and screenshot it

**Files:**
- Create: `screenshots/draft-preview/*.png` + `index.html`
- Modify: `CLAUDE.md` (one line under the funnels section pointing at `/preview`)

- [ ] **Step 1: Build**

Run: `npm run build 2>&1 | tail -30`
Expected: compiles. Confirm `/preview/[slug]/[[...step]]` and `/api/funnels/preview-submit` appear in the route table.

- [ ] **Step 2: Typecheck against the baseline**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: **251**, the recorded baseline. A LOWER number is not automatically good — it can hide a new error displacing an old one. If it differs, intersect the error files with the files this branch touched before concluding anything.

- [ ] **Step 3: Run every suite this branch touched**

Run:
```bash
npx vitest run __tests__/lib/funnels/preview-path.test.ts \
  __tests__/lib/funnels/preview-render.test.ts \
  __tests__/app/draft-preview-route.test.tsx \
  __tests__/app/funnel-draft-preview-page.test.tsx \
  __tests__/app/api/funnels/preview-submit.test.ts \
  __tests__/components/funnels \
  __tests__/components/admin
```
Expected: all pass.

- [ ] **Step 4: Drive the real app**

Start `npm run dev` (port 3050). Sign in as admin. Create or find a funnel that has **never been published**, write a draft in the builder, then open `/preview/<slug>` in a real browser via Playwright.

**It must be the real route in the real browser.** A component mounted in a harness does not count and is not an acceptable substitute.

Capture:
1. `/preview/<slug>` full screen, pill visible.
2. The publish-blocked banner state (a draft with a dead buy button).
3. A test-run submission, showing the captured-values panel.
4. The funnel walk — step one, then the page it lands on after submitting.
5. The "nothing to preview yet" state.

- [ ] **Step 5: Annotate and deliver**

Burn numbered markers and captions INTO each PNG at the source capture's exact pixel width — never upscaled, never an HTML wrapper drawing callouts around a clean shot. Write `screenshots/draft-preview/index.html` referencing the sibling images.

The admin is light-only, so light theme only for the admin surfaces; capture the `/preview` page itself in whatever theme the funnel's own doc specifies.

- [ ] **Step 6: Commit**

```bash
git add screenshots/draft-preview CLAUDE.md
git commit -m "docs(preview): annotated screenshots of the draft preview"
```

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Separate preview-submit endpoint, zero writes | 4 |
| `/preview/<slug>/<step>` mirroring `/go` | 5 |
| Render extracted, not duplicated | 2 |
| One context field (`testRun`) | 3 |
| Dismissible pill | 6 |
| Three success modes | 3 (client) + 4 (server) |
| Error handling: fail soft, banner, notices, 404 gate, noindex | 2, 5 |
| Three entry points | 7 |
| Testing table | 1–7, verified in 8 |
| No migration | Global constraint |

**Type consistency:** `renderDraftPreview` takes `{ stepId, funnelId, funnelBasePath, editable? }` in Tasks 2 and 5. `testRun: { basePath: string }` is spelled identically in Tasks 3, 4 and 5. `livePathToPreview` returns `string | null` in Tasks 1 and 4. `previewBasePath` is used in Tasks 5 and 7 with the same signature.

**Known risk to watch in review:** Task 7 changes `PreviewCardProps.previewUrl` from "published path or null" to "a path, possibly a draft". Three call sites are updated here; if a fourth exists it will still compile (the prop is unchanged in type) and will silently point a thumbnail at the live route. Grep for `previewUrl=` across `components/` during the Task 7 review and confirm the count is exactly three plus the card's own definition.
