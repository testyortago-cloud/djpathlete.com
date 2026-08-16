# Funnel navigation and step connections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a funnel navigable as one screen and make its pages actually lead to each other, with a broken step link blocking publish instead of 404ing live.

**Architecture:** A persistent Next.js layout holds a step rail above the existing `[stepId]` builder, so every URL survives and only the canvas swaps. One pure module, `lib/funnels/connections.ts`, answers "what leads where" for the rail, the publish review and the repair tool. `resolveDoc` gains a required steps parameter so a step link pointing at a page that does not exist becomes a publish blocker.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Tailwind v4, Vitest, Supabase.

**Spec:** `docs/superpowers/specs/2026-08-16-funnel-connections-design.md`

## Global Constraints

- **Branch:** `funnel-connections`. Already created, spec committed at `e8fc3903`.
- **No migration.** Every connection lives in the existing `funnel_steps.project_data` jsonb. Do not add a column.
- **Never `git add -A`.** The working tree permanently holds a bank CSV. Stage explicit paths on every commit.
- **Never commit `JOURNAL.md`.** It is gitignored; keep it that way.
- **`@testing-library/user-event` is NOT a dependency.** Use `fireEvent`.
- **Scope every component query with `within`.** A rail renders N rows; an unscoped `getByRole` has already passed for the wrong reason twice in this repo.
- **Mutate every test that passes on its first run.** Change the exact line the test's comment names and watch it fail. If it does not fail for that reason, the comment is lying.
- **Do not use `instanceof` on anything that may come from the preview iframe.** Different realm. Recognise by capability (`typeof v.closest === "function"`), per `asElement` in `canvas-editing.ts`.
- **`tsc --noEmit` baseline is 258 errors.** Introduce zero. Check with `npx tsc --noEmit 2>&1 | grep -c "error TS"`.
- **Targeted test runs only**, e.g. `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts`. No full-suite runs.
- **Copy rule:** owner-facing strings say "page", never "step". The rail, the picker and every blocker message follow `StepList`'s existing vocabulary.

---

### Task 1: Move the props-patch helper into `lib/`

`autoConnectOps` (Task 5) must build the same `update_section` props patch the inspector builds. That helper currently lives under `components/`, and a `lib/` module may not import from `components/`. Move it; do not write a second one.

**Files:**
- Create: `lib/funnels/sections/patch.ts` (moved content)
- Delete: `components/admin/funnels/builder/section-patch.ts`
- Modify: `components/admin/funnels/builder/SectionInspector.tsx:34`
- Modify: `components/admin/funnels/FunnelBuilder.tsx:77`

**Interfaces:**
- Consumes: nothing.
- Produces: `valueAtPath(source: unknown, path: string): unknown` and `patchForPath(props: Record<string, unknown>, path: string, value: unknown): Record<string, unknown>`, both from `@/lib/funnels/sections/patch`.

- [ ] **Step 1: Move the file with git so history follows**

```bash
git mv components/admin/funnels/builder/section-patch.ts lib/funnels/sections/patch.ts
```

- [ ] **Step 2: Fix the header comment's own path reference**

The first line names the old path. Change it to `lib/funnels/sections/patch.ts` and add a sentence saying why it sits in `lib/`: three callers now, one of them (`autoConnectOps`) in `lib/`, and `functions/`-style layering means `lib/` cannot reach into `components/`.

- [ ] **Step 3: Update both importers**

In `SectionInspector.tsx` replace `from "./section-patch"` with `from "@/lib/funnels/sections/patch"`. In `FunnelBuilder.tsx` replace `from "./builder/section-patch"` with the same.

- [ ] **Step 4: Verify nothing else referenced it**

Run: `grep -rn "section-patch" lib components app __tests__ --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 5: Typecheck and run the tests that cover it**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run __tests__/components/admin/builder/section-inspector.test.tsx
```
Expected: count still 258; inspector tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/patch.ts components/admin/funnels/builder/SectionInspector.tsx components/admin/funnels/FunnelBuilder.tsx
git commit -m "refactor(funnels): move the props-patch helper into lib so lib callers can use it"
```

---

### Task 2: `resolveDoc` learns the funnel's pages

**Files:**
- Modify: `lib/funnels/sections/resolve.ts` (`ResolveResult`, `resolveDoc`, `publishGate`, new `describeBrokenStepLink`)
- Test: `__tests__/lib/funnels/sections/resolve.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface FunnelStepRef { slug: string; name: string }

  export interface BrokenStepLink {
    sectionId: string
    /** Props path within that section — the `DanglingAnchor.field` format. */
    field: string
    /** The slug that matches no page in this funnel. */
    stepSlug: string
  }

  // `steps: null` means NOT KNOWN — skip the check entirely.
  // `steps: []` means a funnel with no pages — every step link is broken.
  export function resolveDoc(
    doc: SectionDoc,
    catalogues: Catalogues,
    steps: FunnelStepRef[] | null,
  ): ResolveResult
  ```
  `ResolveResult` gains `brokenStepLinks: BrokenStepLink[]`.

**The `null` is load-bearing and is not optionality.** `loadPageContext` in the build route already degrades a failed read to `stepSlugs: []`. If "unknown" and "no pages" were the same value, one failed Supabase read would mark every step link in the document broken and block a publish that is perfectly fine. `null` says "could not check"; `[]` says "checked, there are none". The parameter stays **required** so all five call sites become compile errors until each decides which it means.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/funnels/sections/resolve.test.ts`. `catalogue()` is the existing helper in that file; reuse it.

```ts
/** A doc whose hero CTA points at another page of the funnel. */
function docWithStepCta(stepSlug: string): SectionDoc {
  return {
    theme: {},
    sections: [
      {
        id: "he1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Summer camp",
          primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug } },
        },
      },
    ],
  } as SectionDoc
}

const STEPS: FunnelStepRef[] = [
  { slug: "index", name: "Opt-in" },
  { slug: "offer", name: "Offer" },
]

it("a step CTA naming a real page is not broken", () => {
  const result = resolveDoc(docWithStepCta("offer"), catalogue(), STEPS)
  expect(result.brokenStepLinks).toEqual([])
})

it("a step CTA naming a page that does not exist is reported, with the slug", () => {
  const result = resolveDoc(docWithStepCta("offer-page"), catalogue(), STEPS)
  expect(result.brokenStepLinks).toEqual([
    { sectionId: "he1", field: "primaryCta", stepSlug: "offer-page" },
  ])
})

it("a broken step link BLOCKS publishing, and the message names the page", () => {
  const gate = publishGate(resolveDoc(docWithStepCta("offer-page"), catalogue(), STEPS))
  expect(gate.ok).toBe(false)
  expect(gate.blockers.join(" ")).toContain("offer-page")
})

it("a dangling in-page anchor still only WARNS — the two are not the same problem", () => {
  // Guards the split the spec makes: a dead #anchor scrolls nowhere, a dead
  // step link is a 404 on a page being paid for.
  const doc = docWithStepCta("offer")
  ;(doc.sections[0].props as Record<string, unknown>).primaryCta = {
    label: "See pricing",
    target: { kind: "anchor", sectionId: "nope" },
  }
  const gate = publishGate(resolveDoc(doc, catalogue(), STEPS))
  expect(gate.ok).toBe(true)
  expect(gate.warnings).toHaveLength(1)
})

it("a NULL step list checks nothing — an unreadable page list must not brand every link broken", () => {
  // MUTANT TO KILL: treating `null` as `[]`. That inverts a failed Supabase
  // read into "every link in this document is broken" and blocks a good publish.
  const result = resolveDoc(docWithStepCta("offer-page"), catalogue(), null)
  expect(result.brokenStepLinks).toEqual([])
  expect(publishGate(result).ok).toBe(true)
})

it("an EMPTY step list is not the same as null — it means there are no pages", () => {
  const result = resolveDoc(docWithStepCta("offer"), catalogue(), [])
  expect(result.brokenStepLinks).toHaveLength(1)
})

it("a step CTA pointing at its own page is not broken", () => {
  // A "start over" button is legitimate. The prompt's sibling list excludes
  // the current page; the validator's list must not.
  const result = resolveDoc(docWithStepCta("index"), catalogue(), STEPS)
  expect(result.brokenStepLinks).toEqual([])
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts`
Expected: FAIL — `resolveDoc` takes two arguments, `brokenStepLinks` does not exist.

- [ ] **Step 3: Implement**

In `resolve.ts`:

1. Export `FunnelStepRef` and `BrokenStepLink` next to `DanglingAnchor`. Give `BrokenStepLink` a doc comment that **replaces** the existing "`step` targets are deliberately NOT validated here" paragraph on `DanglingAnchor` — that comment is now false and leaving it would send the next reader the wrong way. Say instead that the slug list is now a parameter, and why `null` differs from `[]`.
2. Add the third parameter and `const knownSlugs = steps === null ? null : new Set(steps.map((s) => s.slug))`.
3. In the CTA walk that already collects `danglingAnchors` for `kind === "anchor"`, add the sibling branch: for `kind === "step"`, if `knownSlugs !== null && !knownSlugs.has(target.stepSlug)`, push a `BrokenStepLink` with the same `sectionId` / `field` the anchor branch uses.
4. Return `brokenStepLinks` from `resolveDoc`.
5. Add `describeBrokenStepLink`, shaped like `describeDanglingAnchor`:

```ts
function describeBrokenStepLink(entry: BrokenStepLink): string {
  return (
    `Section "${entry.sectionId}" (${entry.field}): links to the page ` +
    `"${entry.stepSlug}", which is not a page in this funnel.`
  )
}
```

6. In `publishGate`, add `...result.brokenStepLinks.map(describeBrokenStepLink)` to `blockers`. Leave `warnings` alone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/funnels/sections/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutate to prove the null test**

Temporarily change `steps === null ? null : new Set(...)` to `new Set(steps ?? [])`. Re-run.
Expected: the null test FAILS and the empty-list test still passes. Revert with `git checkout -- lib/funnels/sections/resolve.ts` **only if you have not yet staged**; otherwise undo by hand. Never `Get-Content -Raw`/`Set-Content` a source file — it double-encodes non-ASCII and everything stays green.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/resolve.ts __tests__/lib/funnels/sections/resolve.test.ts
git commit -m "feat(funnels): a step CTA pointing at a page that does not exist blocks publish"
```

---

### Task 3: Thread the page list through all five call sites

Task 2 broke compilation on purpose. Each site now decides whether it knows the page list.

**Files:**
- Modify: `app/api/admin/funnels/steps/[stepId]/publish/route.ts` (`gateSectionDoc`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (`PageContext`, `loadPageContext`, three `resolveDoc` calls)
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx` (`resolveAndCompile`)
- Modify: `app/(funnel)/funnel-preview/[stepId]/page.tsx`
- Modify: `components/admin/funnels/builder/publish-actions.ts`
- Test: `__tests__/components/admin/funnel-publish-actions.test.ts`, `__tests__/app/funnel-draft-preview-page.test.tsx`

**Interfaces:**
- Consumes: `resolveDoc(doc, catalogues, steps)` and `FunnelStepRef` from Task 2.
- Produces: `PageContext` in the build route gains `allSteps: FunnelStepRef[] | null`, kept **separate** from the existing `stepSlugs: string[]`.

**Who fails open and who fails closed, and why each is right:**

| Site | On a failed page read | Reason |
| --- | --- | --- |
| publish route | **Refuse to publish** | The route's own comment: a gate that degrades to permissive *"is not a softer version of this gate, it is the absence of one"*. |
| build route | `allSteps: null` | An AI turn must not be lost to a Supabase blip; `loadPageContext` already degrades everything else. |
| editor screen | `null` | A read failure must never turn a page the owner wants to edit into an error screen. |
| draft preview | `null`, banner already says so | Its existing catch already reports "links could not be checked". |
| `publish-actions` | `null` | Its `catch` is already fail-open by design and the real gate is the route. |

- [ ] **Step 1: Write the failing test for the publish route's fail-closed rule**

Add to `__tests__/components/admin/funnel-publish-actions.test.ts` a sibling describe for the route gate, or extend the existing publish-route test file if one exists. The behaviour to pin:

```ts
it("refuses to publish when the funnel's page list cannot be read", async () => {
  // MUTANT KILLED: passing `null` here instead of refusing. `null` means
  // "not checked", and a publish gate that silently stops checking is the
  // absence of a gate — the exact failure this route's header comment names.
  listStepsMock.mockRejectedValueOnce(new Error("supabase down"))
  const response = await PUT(request(), { params: Promise.resolve({ stepId: "s1" }) })
  expect(response.status).toBe(400)
  const body = await response.json()
  expect(JSON.stringify(body)).toContain("could not be checked")
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/components/admin/funnel-publish-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the publish route**

In `gateSectionDoc`, the step row is already loaded to get `funnel_id`. Load the page list beside the catalogue and let a throw fall into the existing catch, which already returns a refusal:

```ts
const [catalogues, steps] = await Promise.all([
  loadCatalogues(),
  listSteps(funnelId).then((rows) => rows.map((row) => ({ slug: row.slug, name: row.name }))),
])
const gate = publishGate(resolveDoc(doc, catalogues, steps))
```

Make sure the catch's message contains "could not be checked".

- [ ] **Step 4: Implement the other four**

- **build route:** `PageContext` gains `allSteps: FunnelStepRef[] | null`. In `loadPageContext`, set it from the same `listSteps(funnelId)` already being awaited — `steps.map((s) => ({ slug: s.slug, name: s.name }))` — and set it to `null` in the existing catch. Leave `stepSlugs` exactly as it is, still filtered to exclude this step; add a comment on both fields saying one is the prompt's and one is the validator's, and that they differ by the self-link. Pass `context.allSteps` at all three `resolveDoc` calls.
- **editor screen:** in `resolveAndCompile`, take `steps: FunnelStepRef[] | null` as a parameter and pass it through. `FunnelBuilderScreen` already has the funnel; call `listSteps(funnel.id).catch(() => null)` and hand the mapped result down. The existing `catch` around `resolveDoc` keeps its "links were not checked" degrade.
- **draft preview:** `listSteps(funnel.id).catch(() => null)`, mapped, passed in.
- **publish-actions:** same, inside the existing try.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run __tests__/components/admin/funnel-publish-actions.test.ts __tests__/app/funnel-draft-preview-page.test.tsx
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: tests pass; error count back to 258.

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/funnels/steps/[stepId]/publish/route.ts" "app/api/admin/funnels/steps/[stepId]/build/route.ts" "app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx" "app/(funnel)/funnel-preview/[stepId]/page.tsx" components/admin/funnels/builder/publish-actions.ts __tests__/components/admin/funnel-publish-actions.test.ts __tests__/app/funnel-draft-preview-page.test.tsx
git commit -m "feat(funnels): thread the funnel's page list into every resolveDoc call site"
```

---

### Task 4: `lib/funnels/connections.ts` — the one reader

**Files:**
- Create: `lib/funnels/connections.ts`
- Test: `__tests__/lib/funnels/connections.test.ts`

**Interfaces:**
- Consumes: `SectionDoc` from `@/lib/funnels/sections/registry`.
- Produces: exactly the types in the spec's section 2 — `StepWithDoc`, `Destination`, `Connection`, `FunnelConnections`, and `funnelConnections(funnelSlug: string, steps: StepWithDoc[]): FunnelConnections`.

**The three connectors and the one rule.** A `{kind:"step"}` CTA; a form island's `redirectUrl` inside `/go/<funnelSlug>`; a booking island's `href` under the same rule. And: a CTA target of exactly `{kind:"url", href:"/"}` maps to `{kind:"none"}`, because `blankValueFor`'s comment defines `/` as the placeholder. Reference that comment in code so the coupling is visible from both ends.

- [ ] **Step 1: Write the failing tests**

```ts
import { funnelConnections, type StepWithDoc } from "@/lib/funnels/connections"

function heroWith(target: unknown): SectionDoc {
  return {
    theme: {},
    sections: [
      { id: "he1", kind: "hero", variant: "centered", style: {},
        props: { headline: "Camp", primaryCta: { label: "Get my spot", target } } },
    ],
  } as SectionDoc
}

const TWO_PAGES = (doc: SectionDoc | null): StepWithDoc[] => [
  { id: "s1", name: "Opt-in", slug: "index", position: 0, isEntry: true, doc },
  { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, doc: null },
]

it("reads a step CTA as a connection to that page", () => {
  const result = funnelConnections("camp", TWO_PAGES(heroWith({ kind: "step", stepSlug: "thanks" })))
  expect(result.connections).toContainEqual(
    expect.objectContaining({ fromStepId: "s1", label: "Get my spot", via: "cta",
      to: { kind: "step", slug: "thanks", exists: true } }),
  )
  expect(result.broken).toEqual([])
})

it("marks a step CTA naming no page as broken", () => {
  const result = funnelConnections("camp", TWO_PAGES(heroWith({ kind: "step", stepSlug: "nope" })))
  expect(result.broken).toHaveLength(1)
  expect(result.broken[0].to).toEqual({ kind: "step", slug: "nope", exists: false })
})

it('href "/" is NOT SET, not a link to the homepage', () => {
  // MUTANT TO KILL: reporting `{kind:"external", href:"/"}`. `/` is
  // `blankValueFor`'s documented placeholder; treating it as a destination
  // makes an unwired button look wired and hides it from the repair tool.
  const result = funnelConnections("camp", TWO_PAGES(heroWith({ kind: "url", href: "/" })))
  expect(result.connections[0].to).toEqual({ kind: "none" })
})

it("a real URL is external, not none", () => {
  const result = funnelConnections("camp", TWO_PAGES(heroWith({ kind: "url", href: "/contact" })))
  expect(result.connections[0].to).toEqual({ kind: "external", href: "/contact" })
})

it("reads a form redirect inside this funnel as a connection", () => {
  const doc = {
    theme: {},
    sections: [
      { id: "fo1", kind: "form", variant: "split", style: {},
        props: { formKey: "optin", fields: [], successMode: "redirect",
                 redirectUrl: "/go/camp/thanks" } },
    ],
  } as SectionDoc
  const result = funnelConnections("camp", TWO_PAGES(doc))
  expect(result.connections[0]).toMatchObject({
    via: "form", label: "Form submit", to: { kind: "step", slug: "thanks", exists: true },
  })
})

it("a form redirect to the funnel root is the entry page", () => {
  const doc = {
    theme: {},
    sections: [
      { id: "fo1", kind: "form", variant: "split", style: {},
        props: { formKey: "optin", fields: [], successMode: "redirect", redirectUrl: "/go/camp" } },
    ],
  } as SectionDoc
  expect(funnelConnections("camp", TWO_PAGES(doc)).connections[0].to)
    .toEqual({ kind: "step", slug: "index", exists: true })
})

it("a redirect to ANOTHER funnel is external, not a step of this one", () => {
  // MUTANT TO KILL: matching on "/go/" instead of "/go/<thisFunnelSlug>/".
  const doc = {
    theme: {},
    sections: [
      { id: "fo1", kind: "form", variant: "split", style: {},
        props: { formKey: "optin", fields: [], successMode: "redirect",
                 redirectUrl: "/go/other-funnel/thanks" } },
    ],
  } as SectionDoc
  expect(funnelConnections("camp", TWO_PAGES(doc)).connections[0].to)
    .toEqual({ kind: "external", href: "/go/other-funnel/thanks" })
})

it("a message-only form is a dead end, and its page is reported as one", () => {
  const doc = {
    theme: {},
    sections: [
      { id: "fo1", kind: "form", variant: "split", style: {},
        props: { formKey: "optin", fields: [], successMode: "message" } },
    ],
  } as SectionDoc
  expect(funnelConnections("camp", TWO_PAGES(doc)).deadEnds).toEqual(["s1"])
})

it("the LAST page is never a dead end — it is supposed to end", () => {
  const result = funnelConnections("camp", TWO_PAGES(heroWith({ kind: "step", stepSlug: "thanks" })))
  expect(result.deadEnds).toEqual([])
})

it("a page with no document at all is a dead end, not a crash", () => {
  const result = funnelConnections("camp", TWO_PAGES(null))
  expect(result.deadEnds).toEqual(["s1"])
})

it("a program CTA is an offer — a real destination outside the funnel, not broken", () => {
  const result = funnelConnections("camp", TWO_PAGES(heroWith({ kind: "program", ref: "Comeback Code" })))
  expect(result.connections[0].to).toEqual({ kind: "offer", what: "Comeback Code" })
  expect(result.broken).toEqual([])
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run __tests__/lib/funnels/connections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `lib/funnels/connections.ts` with the exported types from the spec. Walk each step's `doc.sections`; for each section walk its props for objects shaped `{label, target}` (a CTA) and for form/booking island props. Reuse the same props-path format `DanglingAnchor.field` uses so the rail can address a section the way the inspector does.

Internal destination mapping, all of it:

```ts
function destinationForTarget(
  target: Record<string, unknown>,
  funnelSlug: string,
  known: Set<string>,
  entrySlug: string,
): Destination {
  const kind = typeof target.kind === "string" ? target.kind : ""
  if (kind === "step") {
    const slug = typeof target.stepSlug === "string" ? target.stepSlug : ""
    return { kind: "step", slug, exists: known.has(slug) }
  }
  if (kind === "anchor") {
    return { kind: "anchor", sectionId: String(target.sectionId ?? "") }
  }
  if (kind === "url") {
    const href = typeof target.href === "string" ? target.href : ""
    // `/` is `blankValueFor`'s documented placeholder, NOT the homepage.
    if (href === "/" || href === "") return { kind: "none" }
    return internalStep(href, funnelSlug, known, entrySlug) ?? { kind: "external", href }
  }
  if (kind === "booking") return { kind: "offer", what: "the booking enquiry" }
  if (kind === "program" || kind === "session_pack" || kind === "event") {
    return { kind: "offer", what: String(target.ref ?? "") }
  }
  return { kind: "none" }
}

/** `/go/<thisFunnel>` -> entry page; `/go/<thisFunnel>/<slug>` -> that page. */
function internalStep(
  href: string,
  funnelSlug: string,
  known: Set<string>,
  entrySlug: string,
): Destination | null {
  const base = `/go/${funnelSlug}`
  if (href === base) return { kind: "step", slug: entrySlug, exists: true }
  if (!href.startsWith(`${base}/`)) return null
  const slug = decodeURIComponent(href.slice(base.length + 1).split(/[?#]/)[0])
  if (slug === "" || slug.includes("/")) return null
  return { kind: "step", slug, exists: known.has(slug) }
}
```

`deadEnds`: every step whose id carries no `to.kind === "step"` connection, excluding the step with the highest `position`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/lib/funnels/connections.test.ts`
Expected: PASS, all 11.

- [ ] **Step 5: Mutate the two marked tests**

Change `href === "/"` to `false`, re-run: the "NOT SET" test must fail. Change `base` to `"/go"`, re-run: the other-funnel test must fail. Restore both.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/connections.ts __tests__/lib/funnels/connections.test.ts
git commit -m "feat(funnels): one pure reader for what leads where"
```

---

### Task 5: `autoConnectOps` — the repair tool

**Files:**
- Modify: `lib/funnels/connections.ts` (same module — it changes together with the reader)
- Test: `__tests__/lib/funnels/connections.test.ts`

**Interfaces:**
- Consumes: `patchForPath` from `@/lib/funnels/sections/patch` (Task 1), `SectionOp` from `@/lib/funnels/sections/apply`.
- Produces:
  ```ts
  export interface AutoConnectTarget { funnelSlug: string; nextStepSlug: string }
  export interface AutoConnectChange { sectionId: string; field: string; label: string; to: string }
  export interface AutoConnectPlan { ops: SectionOp[]; changes: AutoConnectChange[] }
  export function autoConnectOps(doc: SectionDoc, target: AutoConnectTarget): AutoConnectPlan
  ```

`changes` exists so the rail can show exactly what it will do before doing it. Two exact-match cases only.

- [ ] **Step 1: Write the failing tests — refusals first**

```ts
const TARGET = { funnelSlug: "camp", nextStepSlug: "thanks" }

it("rewires a placeholder button to the next page", () => {
  const plan = autoConnectOps(heroWith({ kind: "url", href: "/" }), TARGET)
  expect(plan.ops).toEqual([
    { op: "update_section", id: "he1",
      props: { primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug: "thanks" } } } },
  ])
  expect(plan.changes).toEqual([
    { sectionId: "he1", field: "primaryCta", label: "Get my spot", to: "thanks" },
  ])
})

it.each([
  ["a program CTA", { kind: "program", ref: "Comeback Code" }],
  ["a booking CTA", { kind: "booking" }],
  ["an in-page anchor", { kind: "anchor", sectionId: "pricing" }],
  ["a URL somebody typed", { kind: "url", href: "/contact" }],
  ["a step link already set", { kind: "step", stepSlug: "index" }],
])("refuses to touch %s", (_label, target) => {
  expect(autoConnectOps(heroWith(target), TARGET).ops).toEqual([])
})

it("switches a message-only form to redirect at the next page", () => {
  const doc = { theme: {}, sections: [
    { id: "fo1", kind: "form", variant: "split", style: {},
      props: { formKey: "optin", fields: [], successMode: "message",
               successMessage: "Thanks — you're in." } },
  ] } as SectionDoc
  const plan = autoConnectOps(doc, TARGET)
  expect(plan.ops).toEqual([
    { op: "update_section", id: "fo1",
      props: { successMode: "redirect", redirectUrl: "/go/camp/thanks" } },
  ])
})

it("refuses a form that already redirects somewhere", () => {
  const doc = { theme: {}, sections: [
    { id: "fo1", kind: "form", variant: "split", style: {},
      props: { formKey: "optin", fields: [], successMode: "redirect",
               redirectUrl: "/go/camp/somewhere-else" } },
  ] } as SectionDoc
  expect(autoConnectOps(doc, TARGET).ops).toEqual([])
})

it("returns nothing when there is nothing to connect, so the button can say so", () => {
  expect(autoConnectOps(heroWith({ kind: "step", stepSlug: "thanks" }), TARGET))
    .toEqual({ ops: [], changes: [] })
})

it("the ops it returns are accepted by the real applyOps", () => {
  // The op shape is only correct if `applyOps` says so. A hand-checked
  // object literal is an assertion about a contract, not the contract.
  const doc = heroWith({ kind: "url", href: "/" })
  const result = applyOps(doc, autoConnectOps(doc, TARGET).ops)
  expect(result.ok).toBe(true)
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run __tests__/lib/funnels/connections.test.ts`
Expected: FAIL — `autoConnectOps` is not exported.

- [ ] **Step 3: Implement**

Walk the same CTA/form paths the reader walks. Emit one `update_section` per section, building `props` with `patchForPath` so nested CTA paths (`plans.0.cta`) are expressed the way the shallow merge in `applyOps` requires. Case 1: target deep-equals `{kind:"url", href:"/"}`. Case 2: a `form` section with no non-empty `redirectUrl` and `successMode` either absent or `"message"`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/lib/funnels/connections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/connections.ts __tests__/lib/funnels/connections.test.ts
git commit -m "feat(funnels): a repair tool that connects only what nobody chose"
```

---

### Task 6: The step rail in a persistent layout

**Files:**
- Create: `app/(admin)/admin/funnels/[id]/edit/layout.tsx`
- Create: `app/(admin)/admin/pages/[id]/edit/layout.tsx`
- Create: `components/admin/funnels/StepRail.tsx`
- Create: `components/admin/funnels/connections-context.tsx`
- Test: `__tests__/components/admin/funnels/step-rail.test.tsx`

**Interfaces:**
- Consumes: `funnelConnections` (Task 4), `adminStepHref` from `@/lib/funnels/admin-path`, `listSteps` / `getFunnelById` from `@/lib/db/funnels`.
- Produces:
  ```ts
  // connections-context.tsx
  export function ConnectionsProvider(props: {
    initial: FunnelConnections
    children: React.ReactNode
  }): JSX.Element
  export function useConnections(): FunnelConnections
  /** Called by FunnelBuilder when its doc changes. Replaces only this step's rows. */
  export function usePublishStepConnections(): (stepId: string, doc: SectionDoc | null) => void
  ```

The layout is a server component: load the funnel and `listSteps`, build `StepWithDoc[]` from each row's `project_data` (parsed with `sectionDocSchema.safeParse`, `null` on failure — a corrupt draft must not take the rail down), compute `funnelConnections`, render `<ConnectionsProvider initial={…}><StepRail …/>{children}</ConnectionsProvider>`.

`/admin/pages/[id]/edit/layout.tsx` re-exports with `base="pages"`, exactly as its sibling `[stepId]/page.tsx` already does.

- [ ] **Step 1: Write the failing rail tests**

```ts
it("lists every page in position order with its slug", () => { /* within(rail) queries */ })
it("marks the page being edited as current", () => { /* aria-current="page" */ })
it("draws one arrow per onward link, labelled with what carries it", () => {})
it("shows a broken link in red and names the missing page", () => {})
it("does not call the last page a dead end", () => {})
it("offers Connect these pages only when there is something to connect", () => {})
it("says page, never step", () => {
  expect(within(rail).queryByText(/step/i)).toBeNull()
})
```

Scope every query with `within(screen.getByRole("navigation", { name: /pages in this funnel/i }))`.

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run __tests__/components/admin/funnels/step-rail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the context, the rail and the two layouts**

Chrome follows the house table/card style: `rounded-xl border border-border bg-white shadow-sm`, header `bg-surface/50` with `text-muted-foreground`, rows `hover:bg-surface/30`. Status pill reuses `StepList`'s rule verbatim — `live = published && funnel.status === "published"` — do not restate it differently.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/components/admin/funnels/step-rail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the builder to publish its connections**

In `FunnelBuilder`, call `usePublishStepConnections()` and fire it in the same effect that already reacts to `doc` changing, so wiring a button moves the rail's arrow without a refresh.

- [ ] **Step 6: Typecheck, then commit**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
git add "app/(admin)/admin/funnels/[id]/edit/layout.tsx" "app/(admin)/admin/pages/[id]/edit/layout.tsx" components/admin/funnels/StepRail.tsx components/admin/funnels/connections-context.tsx components/admin/funnels/FunnelBuilder.tsx __tests__/components/admin/funnels/step-rail.test.tsx
git commit -m "feat(funnels): a step rail that stays mounted while the canvas swaps"
```

---

### Task 7: The destination picker in the inspector

**Files:**
- Modify: `components/admin/funnels/builder/SectionInspector.tsx` (the `field.type === "cta"` branch, ~line 140-190)
- Create: `components/admin/funnels/builder/DestinationPicker.tsx`
- Test: `__tests__/components/admin/builder/section-inspector.test.tsx`

**Interfaces:**
- Consumes: `useConnections` (Task 6) for the funnel's pages; `UnresolvedCta["candidates"]` for offers.
- Produces: `<DestinationPicker value={target} pages={…} onChange={(target: CtaTarget) => void} disabled={boolean} />`.

The picker writes through the existing `onChange(path, value)` → `patchForPath` → `update_section` path. It sets `${field.path}.target`, never a bare string. Delete the "Ask in the chat to send this button somewhere else." line; keep `describeCtaTarget` underneath as confirmation.

- [ ] **Step 1: Write the failing tests**

```ts
it("lists the funnel's other pages as destinations", () => {})
it("writes a step target through the ops path, not a bare string", () => {
  // MUTANT KILLED: sending `onChange(path, "thanks")`. `applyOps` refuses a
  // bare string over a CTA object and the owner is told their change "could
  // not be applied" for a rule they were never shown.
  expect(onOps).toHaveBeenCalledWith([
    { op: "update_section", id: "he1",
      props: { primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug: "thanks" } } } },
  ])
})
it("offers ONLY catalogue candidates for a program target, never a free-text ref", () => {})
it("leaves a CTA that does not exist alone — still says ask in the chat", () => {})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run __tests__/components/admin/builder/section-inspector.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/components/admin/builder/section-inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/builder/SectionInspector.tsx components/admin/funnels/builder/DestinationPicker.tsx __tests__/components/admin/builder/section-inspector.test.tsx
git commit -m "feat(funnels): the inspector can send a button to another page"
```

---

### Task 8: The form's success destination, and booking

**Files:**
- Modify: `components/admin/funnels/builder/SectionInspector.tsx` (the `successMode` / `redirectUrl` fields on a form section)
- Modify: `components/funnels/islands/BookingIsland.tsx` — no logic change; confirm `href` is already threaded
- Test: `__tests__/components/admin/builder/section-inspector.test.tsx`

**Interfaces:**
- Consumes: `DestinationPicker` (Task 7), restricted to page destinations.
- Produces: nothing new.

When the section is a `form` and the funnel has more than one page, `successMode` + `redirectUrl` render as one control: "After someone submits → [ show a message | go to a page ]", and choosing a page writes both `successMode: "redirect"` and `redirectUrl: "/go/<slug>/<step>"` in a single patch. Two separate controls would let an owner set `redirectUrl` while `successMode` stays `message`, which `formIslandSchema`'s own `superRefine` already calls invalid in the other direction.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes successMode and redirectUrl together, never one without the other", () => {
  expect(onOps).toHaveBeenCalledWith([
    { op: "update_section", id: "fo1",
      props: { successMode: "redirect", redirectUrl: "/go/camp/thanks" } },
  ])
})
it("choosing show a message clears the redirect URL", () => {})
it("a landing page with one page offers no page destination", () => {})
```

- [ ] **Step 2: Run and watch fail; Step 3: implement; Step 4: run to verify pass**

Run: `npx vitest run __tests__/components/admin/builder/section-inspector.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/builder/SectionInspector.tsx __tests__/components/admin/builder/section-inspector.test.tsx
git commit -m "feat(funnels): a form can send someone to the next page instead of a dead end"
```

---

### Task 9: Teach the model to connect a new page

**Files:**
- Modify: `lib/funnels/sections/prompt.ts` (`BuilderCatalogueInput`, `buildCatalogueBlock`, `SECTION_BUILDER_BLOCK_A`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (pass `nextStepSlug`)
- Test: `__tests__/lib/funnels/sections/prompt.test.ts`

**Interfaces:**
- Consumes: `PageContext.allSteps` (Task 3).
- Produces: `BuilderCatalogueInput` gains `nextStepSlug: string | null` — **required**, following the field's own doc comment about required keys turning a forgotten argument into a compile error.

Block B stays cache-stable: the next page's slug does not change per turn.

- [ ] **Step 1: Write the failing tests**

```ts
it("names the next page in the catalogue block", () => {
  expect(buildCatalogueBlock({ ...base, nextStepSlug: "thanks" })).toContain("thanks")
})
it("says there is no next page on the last one, rather than omitting the line", () => {
  // An omitted line reads to the model as "field missing", which it fills in.
  expect(buildCatalogueBlock({ ...base, nextStepSlug: null })).toMatch(/last page/i)
})
it("Block A tells the model to connect a non-final page", () => {
  expect(SECTION_BUILDER_BLOCK_A).toMatch(/next page/i)
})
```

- [ ] **Step 2: Run and watch fail; Step 3: implement; Step 4: run to verify pass**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/prompt.ts "app/api/admin/funnels/steps/[stepId]/build/route.ts" __tests__/lib/funnels/sections/prompt.test.ts
git commit -m "feat(funnels): the model is told which page comes next and to link to it"
```

---

### Task 10: Surface it — publish review and Connect these pages

**Files:**
- Modify: `components/admin/funnels/builder/PublishReview.tsx`
- Modify: `components/admin/funnels/StepRail.tsx`
- Test: `__tests__/components/admin/funnels/step-rail.test.tsx`

**Interfaces:**
- Consumes: `autoConnectOps` (Task 5), `useConnections` (Task 6), the builder's existing `sendOps`.
- Produces: nothing new.

"Connect these pages" opens a confirm listing `AutoConnectChange[]` in plain English ("Get my spot on Opt-in → Thanks"), then sends the ops through `PUT /api/admin/funnels/steps/[stepId]/edit` so the change lands as a revertible transcript turn. No new API route, no `lib/permissions/registry.ts` entry.

- [ ] **Step 1: Write the failing tests**

```ts
it("previews every change before applying anything", () => {})
it("applies nothing when the owner cancels", () => {
  expect(fetchMock).not.toHaveBeenCalled()
})
it("sends the ops to the edit endpoint, so the change is revertible", () => {})
it("says nothing to connect when the tool returns no ops", () => {})
```

- [ ] **Step 2: Run and watch fail; Step 3: implement; Step 4: run to verify pass**

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/builder/PublishReview.tsx components/admin/funnels/StepRail.tsx __tests__/components/admin/funnels/step-rail.test.tsx
git commit -m "feat(funnels): show broken links where they can be fixed"
```

---

### Task 11: Verification

- [ ] **Step 1: Targeted suites**

```bash
npx vitest run __tests__/lib/funnels __tests__/components/admin/funnels __tests__/components/admin/builder __tests__/app __tests__/api/funnels
```
Expected: pass. **7 failures in `__tests__/components/admin/` are pre-existing** (an onboarding-checklist component, unrelated). Confirm the count is still 7 and the names match before accepting them.

- [ ] **Step 2: Typecheck against the baseline**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: 258. Anything higher is introduced — fix it against the real type, never with a cast.

- [ ] **Step 3: Build**

```bash
rm -rf .next && npm run build
```
Expected: exit 0.

- [ ] **Step 4: Drive it in a real browser**

`npm run dev` (port 3050). `.env.local` points at the clone (`anjvz…`) — safe to click around, never to verify data work. Mint an admin session with `encode()` from `next-auth/jwt`, `secret = AUTH_SECRET`, **`salt` = the cookie name** (`authjs.session-token`); set it with `document.cookie` and confirm via `fetch('/api/auth/session')` before trusting it.

The end-to-end check, in one sentence: build a two-page funnel, wire page one to page two in the picker, publish, and follow the link on the live `/go` page.

Also confirm: the rail stays mounted when you click another page (no flash, chat pane does not remount); a deliberately broken link refuses to publish and names the page; "Connect these pages" previews before applying and the change appears in the chat transcript as revertible.

**This is not optional.** This feature area shipped completely inert once with 900+ green tests, because a node from the preview iframe is not `instanceof` the parent window's `Element` and jsdom is one realm that never loads an iframe.

- [ ] **Step 5: Journal**

Add a dated entry to `JOURNAL.md`, newest first, tagged `[Feature build-out]`, with mistakes made and the lesson. **Do not stage it.**

---

## Self-Review

**Spec coverage.** Section 1 (shell) → Task 6. Section 2 (`connections.ts`) → Tasks 4 and 5, plus Task 1 which unblocks 5. Section 3 (publish gate) → Tasks 2 and 3. Section 4(a) prompt → Task 9; 4(b) picker → Tasks 7 and 8; 4(c) repair tool → Tasks 5 and 10. Section 5 (booking) → Task 8. "What we are not building" needs no task. Testing section → Task 11. No gaps.

**Placeholder scan.** No TBD/TODO. Every code step carries real code or an exact edit. Tasks 7-10 give test bodies and interfaces rather than full component source, which is a deliberate proportionality call: those files are UI whose shape is fixed by the interfaces and the house style rules in Global Constraints, and transcribing them here would duplicate what the tests already pin.

**Type consistency.** `FunnelStepRef` is defined once in Task 2 and consumed by name in Tasks 3 and 6. `StepWithDoc`, `Destination`, `Connection`, `FunnelConnections` are defined in Task 4 and consumed in 5, 6 and 10. `AutoConnectPlan.changes` is produced in Task 5 and rendered in Task 10. `patchForPath` moves in Task 1 and is consumed in Task 5. `nextStepSlug` is `string | null` in both Task 3 and Task 9.

**One risk the plan carries deliberately:** Task 2 breaks compilation on purpose and Task 3 repairs it, so the tree does not typecheck between those two commits. That is the point of making the parameter required — but it means Tasks 2 and 3 land together or not at all.
