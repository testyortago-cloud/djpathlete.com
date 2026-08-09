# Funnel Builder — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Deviation note:** this session was instructed not to dispatch subagents, so the plan author is also
> the implementer and executes inline. Interfaces are specified exactly; per-line code is not transcribed
> where the author writes it directly.

**Goal:** A free-form drag-and-drop funnel/landing-page builder inside `/admin`, replacing GoHighLevel
as the page builder, with six server-rendered interactive islands.

**Architecture:** GrapesJS (BSD-3 core, mounted directly) produces HTML+CSS. On publish, a pure
server-side compiler parses that into a sanitised `FunnelNode` tree (JSONB) with typed island nodes,
plus a CSS stylesheet scoped under `#djp-funnel-root`. The public route walks the node tree and returns
real React elements — islands are server components. `dangerouslySetInnerHTML` is never used for page body.

**Tech stack:** Next 16 App Router · React 19 · Supabase · Zod v4 · Tailwind v4 · GrapesJS 0.23.4 ·
parse5 · postcss 8.5.6 · Vitest.

## Global Constraints

- Migration number: `00202_funnels.sql` (head is `00201_admin_permissions.sql`). **Written as a file
  only — NOT applied to production in this session.**
- Supabase client: drop the `Database` generic; cast in the DAL.
- Tables in admin UI: `components/ui/data-table.tsx` only. Never hand-roll `<table>`.
- No hardcoded hex, no inline `fontFamily` — semantic classes only (admin UI; the funnel canvas is
  exempt by design, that is the point of a free-form builder).
- Uploads go to Firebase Storage, not Supabase.
- New code makes **no** GoHighLevel calls.
- No feature flag (flags are for money / mass-email risk only).
- `/api/*` is not covered by `middleware.ts` — every new API route self-gates.
- Verification = targeted Vitest suites + `npm run build`. No full-suite run.
- Commit to `main` directly. **Do not push.**

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/00202_funnels.sql` | 4 tables + indexes |
| `lib/validators/funnel.ts` | Zod: funnel, step, SEO, publish input |
| `lib/funnels/islands.ts` | Island registry — names, Zod props schemas. Single source of truth shared by editor + renderer |
| `lib/funnels/compile/types.ts` | `FunnelNode` union, `CompileResult`, `CompileError` |
| `lib/funnels/compile/sanitize.ts` | Tag/attr/URL allowlist, parse5 → node tree, island extraction |
| `lib/funnels/compile/css-scope.ts` | postcss: prefix selectors, recurse `@media`, strip `@import` |
| `lib/funnels/compile/index.ts` | `compileFunnelStep({html, css})` orchestrator |
| `lib/db/funnels.ts` | DAL: funnels, steps, versions, submissions |
| `components/funnels/NodeRenderer.tsx` | Recursive node tree → React elements |
| `components/funnels/islands/*.tsx` | 6 island server components (+ `FunnelForm.client.tsx`) |
| `app/(marketing)/go/[slug]/[[...step]]/page.tsx` | Public route + `generateMetadata` |
| `app/api/funnels/submit/route.ts` | Public submission endpoint (self-gated) |
| `app/api/admin/funnels/**` | Admin CRUD + publish + asset upload |
| `app/(admin)/admin/funnels/**` | List, steps, editor page |
| `components/admin/funnels/FunnelEditor.tsx` | GrapesJS mount (client, `ssr:false`) |
| `__tests__/lib/funnels/**` | Compiler tests (the risk lives here) |

---

## Tasks

### Task 1: Schema + dependencies
**Files:** create `supabase/migrations/00202_funnels.sql`; modify `package.json`.
**Produces:** tables `funnels`, `funnel_steps`, `funnel_step_versions`, `funnel_submissions`.
- [ ] Add `grapesjs` and `parse5`. Do **not** add `@grapesjs/react` (pins `grapesjs@^0.22.5`, excludes 0.23.4).
- [ ] Write the migration per spec §3, additive only, `IF NOT EXISTS` throughout.
- [ ] Commit. Do not apply to prod.

### Task 2: Island registry + validators
**Files:** create `lib/funnels/islands.ts`, `lib/validators/funnel.ts`.
**Produces:**
```ts
export type IslandName = "form" | "checkout" | "event" | "booking" | "testimonials" | "faq"
export const ISLANDS: Record<IslandName, { label: string; schema: z.ZodType }>
export function isIslandName(v: unknown): v is IslandName
```
- [ ] Zod schema per island (spec §5 prop tables). Commit.

### Task 3: Compiler — sanitiser (TDD)
**Files:** create `lib/funnels/compile/types.ts`, `sanitize.ts`; test `__tests__/lib/funnels/sanitize.test.ts`.
**Produces:**
```ts
type FunnelNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; attrs: Record<string,string>; children: FunnelNode[] }
  | { t: "island"; name: IslandName; props: Record<string, unknown> }
export function htmlToNodes(html: string): { nodes: FunnelNode[]; errors: CompileError[] }
```
- [ ] **Tests first**, each written so removing the rule fails the test:
      `<script>` dropped · `onclick` dropped · `javascript:` href dropped · non-allowlisted iframe host
      dropped · allowlisted YouTube iframe kept · unknown tag unwrapped but children kept ·
      `data:image/png` src kept, `data:text/html` dropped · island extracted with parsed props ·
      island nested 3 levels deep still extracted · island with invalid props returns a `CompileError`.
- [ ] Run, confirm fail. Implement. Run, confirm pass. Commit.

### Task 4: Compiler — CSS scoping (TDD)
**Files:** create `lib/funnels/compile/css-scope.ts`; test `__tests__/lib/funnels/css-scope.test.ts`.
**Produces:** `export function scopeCss(css: string, rootId = "djp-funnel-root"): string`
- [ ] Tests: `.hero{}` → `#djp-funnel-root .hero{}` · `body{}` → `#djp-funnel-root{}` ·
      rules inside `@media` scoped · `@import` stripped · comma-separated selectors each prefixed ·
      already-prefixed selector not double-prefixed.
- [ ] Implement with postcss. Commit.

### Task 5: Compiler orchestrator + CSP assertion
**Files:** create `lib/funnels/compile/index.ts`; test `__tests__/lib/funnels/compile.test.ts`,
`__tests__/config/csp-frame-src.test.ts`.
**Produces:** `export function compileFunnelStep(input: {html: string; css: string}): CompileResult`
- [ ] Test: valid input → `{ok:true, nodes, css}`; invalid island props → `{ok:false, errors}`.
- [ ] Test: every host in the iframe allowlist appears in `next.config.mjs` `frame-src`
      (a CSP omission is invisible to component tests).
- [ ] Add missing hosts to `next.config.mjs` if the assertion fails. Commit.

### Task 6: DAL
**Files:** create `lib/db/funnels.ts`.
**Produces:** `listFunnels`, `getFunnelBySlug`, `getFunnelById`, `createFunnel`, `updateFunnel`,
`deleteFunnel`, `listSteps`, `getStep`, `upsertStepDraft`, `publishStep`, `getPublishedStep`,
`createSubmission`.
- [ ] `publishStep` compiles, inserts an immutable version row, points `published_version_id` at it.
- [ ] Commit.

### Task 7: Node renderer + islands
**Files:** create `components/funnels/NodeRenderer.tsx`, `components/funnels/islands/*`.
- [ ] Test: node tree → React, including a deeply nested island. Element nodes render via
      `React.createElement`; `style` string converted to a React style object.
- [ ] Six islands per spec §5, each a server component except the form's interactive shell.
- [ ] Commit.

### Task 8: Public route
**Files:** create `app/(marketing)/go/[slug]/[[...step]]/page.tsx`.
- [ ] Entry step at `/go/<funnel>`, named step at `/go/<funnel>/<step>`; unpublished → 404;
      `generateMetadata` from SEO fields; `noindex` honoured; CSS injected in a `<style>` tag inside
      `<div id="djp-funnel-root">`.
- [ ] Commit.

### Task 9: Submission endpoint
**Files:** create `app/api/funnels/submit/route.ts`.
- [ ] Tests: honeypot filled → rejected · client-declared field not in the published config → rejected ·
      rate limit → 429 · valid → row in `funnel_submissions` + `users` lead upsert.
- [ ] Attribution via `parseAttrCookie`. No GHL call. Commit.

### Task 10: Admin CRUD + permissions + audit
**Files:** create `app/api/admin/funnels/**`; modify `lib/permissions/registry.ts`, `lib/audit/actions.ts`.
- [ ] New `funnels` permission key (group `marketing`) + `PATH_PERMISSIONS` for `/admin/funnels` and
      `/api/admin/funnels`. Audit slugs `funnel.created|updated|published|deleted`.
- [ ] Routes wrapped in `withAudit`. Commit.

### Task 11: Admin UI + GrapesJS editor
**Files:** create `app/(admin)/admin/funnels/**`, `components/admin/funnels/FunnelEditor.tsx`.
- [ ] List page uses `DataTableCard`/`DataTable`/`DataTableBadge`. Editor is a client component,
      `ssr:false`, brand tokens as style presets, six islands registered as draggable blocks that emit
      `data-djp-island` + `data-djp-props`.
- [ ] Add `/admin/funnels` to the command-palette registry and the admin sidebar. Commit.

### Task 12: Verify + document
- [ ] Targeted suites: `npx vitest run __tests__/lib/funnels __tests__/config`.
- [ ] `npm run build`, grep output for funnel paths.
- [ ] Journal entry + memory file. Commit. **Do not push.**

---

## Self-Review

**Spec coverage:** §3 schema→T1 · §5 islands→T2,T7 · §4 pipeline→T3,T4,T5 · §6 rendering→T7,T8 ·
§5 submission→T9 · §7 admin/permissions/audit→T10,T11 · §8 testing→T3,T4,T5,T7,T9,T12. No gaps.

**Placeholder scan:** none — every task names exact files and exact test cases.

**Type consistency:** `FunnelNode`, `IslandName`, `compileFunnelStep`, `scopeCss`, `htmlToNodes` are
defined once in T2–T5 and referenced with identical names in T6–T8.
