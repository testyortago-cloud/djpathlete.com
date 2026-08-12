# Landing Pages vs Funnels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split landing pages from funnels as a stored type, and replace the bare name-and-button create control with a dialog that collects intent and hands off to the AI builder.

**Architecture:** One new stored column (`funnels.kind`) separates the two concepts; a second (`funnels.goal`) records what the page is for using values the section registry can already resolve into CTAs. Both types keep the same tables, builder, publish path and `/go/<slug>` URLs — the split is a filter plus a vocabulary change, not a second engine. `FunnelBoard` gains a `kind` prop rather than being forked.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui, Supabase, Zod, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-08-12-landing-pages-vs-funnels-design.md](../specs/2026-08-12-landing-pages-vs-funnels-design.md)

## Global Constraints

- **Never hardcode colours or fonts.** Use semantic classes (`text-primary`, `bg-accent`, `text-muted-foreground`, `bg-surface`) and `--success` / `--error` / `--warning`. No hex, no inline `fontFamily`.
- **Supabase clients drop the `Database` generic.** Cast results in the DAL, matching every other function in `lib/db/funnels.ts`.
- **Do not restate validation rules.** Import `RESERVED_FUNNEL_SLUGS`, the slug regex and `FUNNEL_GOALS` from the validator. A guard and its schema must agree by construction.
- **Every test must be able to fail for the reason it claims.** Name the mutant each test kills in a comment, following `__tests__/components/admin/funnel-go-live.test.tsx`.
- **The migration is NOT applied in this plan.** It ships ready to apply to the prod project (`epzuvz…`) via `mcp__supabase__apply_migration`. `.env.local` points at a stale clone.
- **Run targeted tests only.** `npx vitest run <path>` for the suites you touched, plus `npx tsc --noEmit` at the end. Never the full suite.
- **Stage explicit paths in every commit.** `git add -A` is unsafe in this repo — the working tree holds untracked personal CSVs.

---

### Task 1: Migration, types and DAL

**Files:**
- Create: `supabase/migrations/00205_funnel_kind_goal.sql`
- Modify: `types/database.ts:3128-3137`
- Modify: `lib/db/funnels.ts:25-32` (`listFunnels`), `:63-88` (`createFunnel`), `:90-103` (`updateFunnel`)
- Test: `__tests__/lib/db/funnel-kind.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type FunnelKind = "page" | "funnel"`
  - `type FunnelGoal = "leads" | "booking" | "program" | "session_pack" | "event"`
  - `Funnel` gains `kind: FunnelKind` and `goal: FunnelGoal | null`
  - `listFunnels(opts?: { status?: FunnelStatus; kind?: FunnelKind }): Promise<Funnel[]>`
  - `createFunnel(input: CreateFunnelInput): Promise<Funnel & { entryStepId: string }>` where `CreateFunnelInput` gains `kind?: FunnelKind` and `goal?: FunnelGoal | null`
  - `updateFunnel(id, input: Partial<Pick<Funnel, "slug"|"name"|"description"|"status"|"kind"|"goal">>)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00205_funnel_kind_goal.sql`:

```sql
-- Landing pages and funnels become separate things.
--
-- Every landing page was already a funnel: createFunnel inserts the funnels row
-- and an entry step in one breath. That collapse is why the create control
-- could only ask for a name — any richer question would have applied to just
-- one of the two things it might be making.
--
-- `kind` is STORED, NOT DERIVED FROM STEP COUNT. Deriving it would silently
-- relocate a page to the funnels screen the moment a second step was added,
-- and would turn every "is this a page?" question into a step-count query.
--
-- `goal` mirrors the CTA targets lib/funnels/sections/registry.ts already
-- resolves (program, session_pack, event, booking) plus `leads` for a form
-- capture, so the choice seeds a real call to action rather than a badge.
--
-- Design doc: docs/superpowers/specs/2026-08-12-landing-pages-vs-funnels-design.md

ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'page'
    CHECK (kind IN ('page', 'funnel')),
  ADD COLUMN IF NOT EXISTS goal text
    CHECK (goal IN ('leads', 'booking', 'program', 'session_pack', 'event'));

-- Backfill: anything already holding more than one step is a funnel. Runs
-- before any code reads the column, so no row is ever seen mis-typed.
UPDATE public.funnels f
   SET kind = 'funnel'
 WHERE (SELECT count(*) FROM public.funnel_steps s WHERE s.funnel_id = f.id) > 1;

CREATE INDEX IF NOT EXISTS funnels_kind_idx ON public.funnels (kind);

COMMENT ON COLUMN public.funnels.kind IS
  'page = one standalone landing page; funnel = an ordered multi-step sequence. '
  'Set explicitly at creation and changed only by the Convert to funnel action.';
COMMENT ON COLUMN public.funnels.goal IS
  'What the page is for. Nullable because rows backfilled from before this '
  'column have no honest value; new pages must choose one.';
```

- [ ] **Step 2: Extend the types**

In `types/database.ts`, directly above `export interface Funnel`:

```ts
export type FunnelKind = "page" | "funnel"

export type FunnelGoal = "leads" | "booking" | "program" | "session_pack" | "event"
```

Then add two fields to `Funnel`, after `description`:

```ts
  kind: FunnelKind
  goal: FunnelGoal | null
```

- [ ] **Step 3: Write the failing test**

Create `__tests__/lib/db/funnel-kind.test.ts`:

```ts
// The DAL half of the page/funnel split. Both tests here read the arguments
// actually handed to Supabase, because the cheap version of each — asserting
// the function resolved without throwing — passes against a DAL that ignores
// `kind` entirely, which is the exact bug worth catching.

import { describe, it, expect, vi, beforeEach } from "vitest"

const eq = vi.fn()
const order = vi.fn()
const insert = vi.fn()
const single = vi.fn()
const select = vi.fn()
const from = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

/** A thenable query builder: chainable, and awaits to `{ data, error }`. */
function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = (fn: ReturnType<typeof vi.fn>) =>
    fn.mockImplementation(() => builder as never)
  builder.select = chain(select)
  builder.order = chain(order)
  builder.eq = chain(eq)
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return builder
}

describe("listFunnels({ kind })", () => {
  it("filters on the kind column when a kind is given", async () => {
    // MUTANT KILLED: a listFunnels that accepts `kind` and never applies it —
    // which would show every funnel on the landing pages screen and vice versa.
    from.mockReturnValue(queryBuilder({ data: [], error: null }))
    const { listFunnels } = await import("@/lib/db/funnels")

    await listFunnels({ kind: "page" })

    expect(eq).toHaveBeenCalledWith("kind", "page")
  })

  it("does not filter on kind when none is given", async () => {
    // MUTANT KILLED: defaulting to kind='page', which would hide every funnel
    // from callers that legitimately want both (e.g. the leads inbox).
    from.mockReturnValue(queryBuilder({ data: [], error: null }))
    const { listFunnels } = await import("@/lib/db/funnels")

    await listFunnels()

    expect(eq).not.toHaveBeenCalledWith("kind", expect.anything())
  })
})

describe("createFunnel", () => {
  it("persists kind and goal on the inserted row", async () => {
    // MUTANT KILLED: dropping kind/goal from the insert. The row would fall
    // back to the column default 'page' with a null goal, so a funnel created
    // from the Funnels screen would appear under Landing pages instead.
    single.mockResolvedValue({ data: { id: "f1" }, error: null })
    select.mockReturnValue({ single })
    insert.mockReturnValue({ select })
    from.mockReturnValue({ insert })

    const { createFunnel } = await import("@/lib/db/funnels")
    await createFunnel({
      slug: "camp-2026",
      name: "Camp 2026",
      kind: "funnel",
      goal: "event",
    })

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "funnel", goal: "event" }),
    )
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/db/funnel-kind.test.ts`
Expected: FAIL — `listFunnels` does not accept `kind`, `createFunnel` does not pass it.

- [ ] **Step 5: Update `listFunnels`**

Replace `lib/db/funnels.ts:25-32`:

```ts
export async function listFunnels(
  opts: { status?: FunnelStatus; kind?: FunnelKind } = {},
): Promise<Funnel[]> {
  const supabase = getClient()
  let query = supabase.from("funnels").select("*").order("updated_at", { ascending: false })
  if (opts.status) query = query.eq("status", opts.status)
  // Deliberately only applied when asked. Callers that want both types (the
  // leads inbox, the builder) must keep getting both.
  if (opts.kind) query = query.eq("kind", opts.kind)
  const { data, error } = await query
  if (error) throw new Error(`listFunnels: ${error.message}`)
  return (data ?? []) as Funnel[]
}
```

Add `FunnelKind` and `FunnelGoal` to the `types/database` import at the top of the file.

- [ ] **Step 6: Update `createFunnel` and `updateFunnel`**

In `CreateFunnelInput` (same file), add:

```ts
  kind?: FunnelKind
  goal?: FunnelGoal | null
```

In `createFunnel`, extend the insert object:

```ts
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind ?? "page",
      goal: input.goal ?? null,
      created_by: input.created_by ?? null,
    })
```

The create dialog needs the entry step's id to route into the builder, and this
function currently throws it away. Capture it — replace the entry-step insert at
`:78-85` and the return:

```ts
  const { data: stepRow, error: stepError } = await supabase
    .from("funnel_steps")
    .insert({
      funnel_id: funnel.id,
      slug: "index",
      name: input.kind === "funnel" ? "Step 1" : "Landing page",
      position: 0,
      is_entry: true,
    })
    .select("id")
    .single()
  if (stepError) throw new Error(`createFunnel(entry step): ${stepError.message}`)

  return { ...funnel, entryStepId: (stepRow as { id: string }).id }
```

and widen the signature to `Promise<Funnel & { entryStepId: string }>`.

In `app/api/admin/funnels/route.ts:42-43`, split it back out so the `funnel` body
keeps the exact shape every existing caller expects:

```ts
      const { entryStepId, ...funnel } = await createFunnel({ ...parsed.data, created_by: session.user.id })
      return NextResponse.json({ funnel, entryStepId }, { status: 201 })
```

Widen `updateFunnel`'s parameter type:

```ts
export async function updateFunnel(
  id: string,
  input: Partial<Pick<Funnel, "slug" | "name" | "description" | "status" | "kind" | "goal">>,
): Promise<Funnel> {
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/db/funnel-kind.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00205_funnel_kind_goal.sql types/database.ts lib/db/funnels.ts __tests__/lib/db/funnel-kind.test.ts
git commit -m "feat(funnels): a landing page and a funnel become different rows, not the same row read twice"
```

---

### Task 2: Validators and the shared slug helper

**Files:**
- Create: `lib/funnels/slug.ts`
- Modify: `lib/validators/funnel.ts:4-24`
- Modify: `components/admin/funnels/FunnelBoard.tsx:232-239` (delete local `slugify`)
- Test: `__tests__/lib/validators/funnel-kind-goal.test.ts`

**Interfaces:**
- Consumes: `FunnelKind`, `FunnelGoal` from Task 1.
- Produces:
  - `lib/funnels/slug.ts` → `slugify(value: string): string`
  - `lib/validators/funnel.ts` → `RESERVED_FUNNEL_SLUGS: ReadonlySet<string>`, `FUNNEL_SLUG_PATTERN: RegExp`, `FUNNEL_GOALS: readonly { value: FunnelGoal; label: string; hint: string }[]`
  - `createFunnelSchema` accepts `kind`, `goal`; `updateFunnelSchema` accepts `kind`, `goal`

- [ ] **Step 1: Create the shared slug helper**

Create `lib/funnels/slug.ts`:

```ts
/**
 * The one slug derivation. Lived privately inside FunnelBoard until the create
 * dialog needed the same rule; two copies of a slug rule means two answers to
 * "what URL will this get", and the user only ever sees one of them.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/validators/funnel-kind-goal.test.ts`:

```ts
// The create dialog renders its goal options from FUNNEL_GOALS and validates
// slugs with RESERVED_FUNNEL_SLUGS. Both are exported precisely so the client
// cannot drift from the schema — these tests fail the moment they do.

import { describe, it, expect } from "vitest"
import {
  createFunnelSchema,
  updateFunnelSchema,
  FUNNEL_GOALS,
  RESERVED_FUNNEL_SLUGS,
} from "@/lib/validators/funnel"

const base = { slug: "free-trial", name: "Free Trial" }

describe("createFunnelSchema", () => {
  it("defaults kind to page when omitted", () => {
    // MUTANT KILLED: making kind required, which would 400 every request from
    // the existing create path that does not send it.
    const parsed = createFunnelSchema.parse(base)
    expect(parsed.kind).toBe("page")
  })

  it("accepts every goal offered by the UI", () => {
    // MUTANT KILLED: a FUNNEL_GOALS list containing a value the schema rejects
    // — the dialog would offer an option that 400s on submit.
    for (const goal of FUNNEL_GOALS) {
      expect(createFunnelSchema.safeParse({ ...base, goal: goal.value }).success).toBe(true)
    }
  })

  it("rejects a goal outside the registry-backed set", () => {
    // MUTANT KILLED: typing goal as a bare string, which would let a typo reach
    // the CHECK constraint and 500 instead of 400.
    expect(createFunnelSchema.safeParse({ ...base, goal: "newsletter" }).success).toBe(false)
  })

  it("rejects a reserved slug", () => {
    expect(createFunnelSchema.safeParse({ ...base, slug: "admin" }).success).toBe(false)
  })

  it("exports the reserved set the dialog checks against", () => {
    // MUTANT KILLED: the dialog hard-coding its own reserved list, which would
    // silently diverge the moment a route is added here.
    expect(RESERVED_FUNNEL_SLUGS.has("admin")).toBe(true)
    expect(RESERVED_FUNNEL_SLUGS.has("go")).toBe(true)
  })
})

describe("updateFunnelSchema", () => {
  it("accepts kind so Convert to funnel can PATCH it", () => {
    // MUTANT KILLED: forgetting kind here — Convert would 400 with a generic
    // "Invalid request" and no clue which field was refused.
    expect(updateFunnelSchema.safeParse({ kind: "funnel" }).success).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/validators/funnel-kind-goal.test.ts`
Expected: FAIL — `FUNNEL_GOALS` and `RESERVED_FUNNEL_SLUGS` are not exported.

- [ ] **Step 4: Update the validator**

Replace `lib/validators/funnel.ts:4-24` with:

```ts
export const FUNNEL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(FUNNEL_SLUG_PATTERN, "Slug must be lowercase with hyphens only")

/**
 * Slugs that would collide with an existing top-level route or a reserved path.
 * EXPORTED so the create dialog can warn before submitting. It must never grow
 * a second copy on the client — three bugs in this repo came from restating a
 * validation rule instead of calling the one that decides.
 */
export const RESERVED_FUNNEL_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "client",
  "go",
  "login",
  "register",
])

/**
 * What a landing page is for. These are not free labels: every value except
 * `leads` names a CTA target lib/funnels/sections/registry.ts already resolves,
 * so the choice can seed a real call to action. `leads` maps to a form section.
 *
 * The dialog renders its options from this list, so an option can never be
 * offered that the schema below would refuse.
 */
export const FUNNEL_GOALS = [
  { value: "leads", label: "Capture leads", hint: "A form that lands in your inbox" },
  { value: "booking", label: "Book a consult", hint: "Sends visitors to your booking flow" },
  { value: "program", label: "Sell a program", hint: "Links to a training program" },
  { value: "session_pack", label: "Sell a session pack", hint: "Links to a pack checkout" },
  { value: "event", label: "Fill an event", hint: "Links to a camp or clinic signup" },
] as const satisfies readonly { value: FunnelGoal; label: string; hint: string }[]

const goalSchema = z.enum(["leads", "booking", "program", "session_pack", "event"])
const kindSchema = z.enum(["page", "funnel"])

export const createFunnelSchema = z.object({
  slug: slugSchema.refine((s) => !RESERVED_FUNNEL_SLUGS.has(s), "That slug is reserved"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  kind: kindSchema.default("page"),
  goal: goalSchema.nullable().optional(),
})

export const updateFunnelSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  kind: kindSchema.optional(),
  goal: goalSchema.nullable().optional(),
})
```

Add to the imports at the top of the file:

```ts
import type { FunnelGoal } from "@/types/database"
```

- [ ] **Step 5: Delete the duplicate `slugify` from `FunnelBoard`**

Remove the `slugify` function at `components/admin/funnels/FunnelBoard.tsx:232-239` and import it instead:

```ts
import { slugify } from "@/lib/funnels/slug"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/validators/funnel-kind-goal.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/validators/funnel.ts lib/funnels/slug.ts components/admin/funnels/FunnelBoard.tsx __tests__/lib/validators/funnel-kind-goal.test.ts
git commit -m "feat(funnels): the goal list the dialog offers is the one the schema accepts"
```

---

### Task 3: Permissions registry and navigation

**Files:**
- Modify: `lib/permissions/registry.ts:433-436`
- Modify: `components/admin/admin-nav.ts:76`, `:91`
- Test: `__tests__/lib/permissions-registry.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `/admin/pages` resolving to `{ kind: "permission", permission: "funnels" }`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/permissions-registry.test.ts`:

```ts
describe("landing pages path", () => {
  it("maps /admin/pages to the funnels permission", () => {
    // MUTANT KILLED: adding the screen and forgetting the registry entry.
    // Unmapped paths are DENIED by default, so staff holding `funnels` would be
    // bounced to /admin/no-access with nothing explaining why. Asserting the
    // resolved permission — not merely that some entry exists — is what makes
    // this fail for the right reason.
    expect(resolvePathRequirement("/admin/pages")).toEqual({
      kind: "permission",
      permission: "funnels",
    })
  })

  it("maps nested landing page routes too", () => {
    // MUTANT KILLED: an exact-match entry instead of a prefix rule.
    expect(resolvePathRequirement("/admin/pages/new")).toEqual({
      kind: "permission",
      permission: "funnels",
    })
  })

  it("still maps /admin/funnels to the same permission", () => {
    // MUTANT KILLED: moving the funnels rule rather than adding beside it.
    expect(resolvePathRequirement("/admin/funnels")).toEqual({
      kind: "permission",
      permission: "funnels",
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/permissions-registry.test.ts`
Expected: FAIL — `/admin/pages` resolves to `{ kind: "unmapped" }`.

- [ ] **Step 3: Add the registry entry**

At `lib/permissions/registry.ts:435`, add above the existing funnels rule:

```ts
  // Landing pages and funnels are separate SCREENS but one permission: they are
  // the same capability wearing two vocabularies.
  { prefix: "/admin/pages", permission: "funnels" },
  { prefix: "/admin/funnels", permission: "funnels" },
  { prefix: "/api/admin/funnels", permission: "funnels" },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/permissions-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Add both nav entries**

In `components/admin/admin-nav.ts`, replace the single `Funnels` entry in **both** arrays (line 76 and line 91) with:

```ts
        { label: "Landing Pages", href: "/admin/pages", icon: LayoutTemplate },
        { label: "Funnels", href: "/admin/funnels", icon: Workflow },
```

`Workflow` is already imported in this file (used by SEO Memos). `LayoutTemplate` stays on Landing Pages.

- [ ] **Step 6: Commit**

```bash
git add lib/permissions/registry.ts components/admin/admin-nav.ts __tests__/lib/permissions-registry.test.ts
git commit -m "feat(funnels): two screens in the nav, one permission behind them"
```

---

### Task 4: `CreatePageDialog`

**Files:**
- Create: `components/admin/funnels/CreatePageDialog.tsx`
- Test: `__tests__/components/admin/create-page-dialog.test.tsx`

**Interfaces:**
- Consumes: `slugify` (Task 2), `FUNNEL_GOALS`, `RESERVED_FUNNEL_SLUGS` (Task 2), `Funnel` (Task 1).
- Produces:
  ```ts
  interface CreatePageDialogProps {
    /** Slugs already taken, for the inline hint. The server 409 remains the authority. */
    takenSlugs: string[]
  }
  export function CreatePageDialog(props: CreatePageDialogProps): JSX.Element
  ```
  On success it routes to `/admin/funnels/<funnelId>/edit/<stepId>?start=1`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/create-page-dialog.test.tsx`:

```tsx
// The create dialog exists because a bare name field could not ask anything
// useful. These tests hold it to that: the URL it promises must be the URL it
// sends, and the rules it enforces must be the validator's rules, not a copy.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CreatePageDialog } from "@/components/admin/funnels/CreatePageDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ funnel: { id: "f1" }, entryStepId: "s1" }),
  })) as unknown as typeof fetch
})

function open(taken: string[] = []) {
  render(<CreatePageDialog takenSlugs={taken} />)
  fireEvent.click(screen.getByRole("button", { name: /new landing page/i }))
}

describe("<CreatePageDialog>", () => {
  it("derives the slug from the name and shows the resulting URL", () => {
    // MUTANT KILLED: showing a static /go/ placeholder. The owner must be able
    // to read the real address before committing to it.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    expect(screen.getByText(/free-trial-week/)).toBeInTheDocument()
  })

  it("stops deriving once the slug is edited by hand", () => {
    // MUTANT KILLED: re-deriving on every keystroke, which silently discards a
    // hand-picked URL the moment the name is touched again.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial" } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "trial" } })
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    expect(screen.getByLabelText(/url/i)).toHaveValue("trial")
  })

  it("refuses a reserved slug using the validator's own list", () => {
    // MUTANT KILLED: a hard-coded reserved list in the component that drifts
    // from lib/validators/funnel.ts.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Admin" } })
    expect(screen.getByText(/reserved/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled()
  })

  it("warns when the slug is already used", () => {
    // MUTANT KILLED: dropping the takenSlugs check, leaving the owner to
    // discover the clash only after the AI has spent a turn building.
    open(["free-trial-week"])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    expect(screen.getByText(/already in use/i)).toBeInTheDocument()
  })

  it("posts kind page with the chosen goal and description", async () => {
    // MUTANT KILLED: collecting the fields and posting only name+slug — the
    // dialog would look rich and change nothing about what gets stored.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("radio", { name: /book a consult/i }))
    fireEvent.change(screen.getByLabelText(/describe/i), { target: { value: "For HS athletes." } })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({
      name: "Free Trial Week",
      slug: "free-trial-week",
      kind: "page",
      goal: "booking",
      description: "For HS athletes.",
    })
  })

  it("routes into the builder with the start flag", async () => {
    // MUTANT KILLED: creating the page and leaving the owner on the list, which
    // is the shipped behaviour this whole feature exists to replace.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/f1/edit/s1?start=1"))
  })

  it("keeps the dialog open and reports the error when the server refuses", async () => {
    // MUTANT KILLED: closing on failure, which loses everything typed.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "That slug is already in use." }),
    })) as unknown as typeof fetch
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That slug is already in use."))
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/create-page-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `components/admin/funnels/CreatePageDialog.tsx`:

```tsx
"use client"

// Creating a landing page used to be a name and a button, which is all a
// combined page/funnel concept could honestly ask for. Now that a page is its
// own thing, the dialog can ask the two questions that actually shape it —
// what it is for, and what it should say — and hand both to the builder so the
// page starts writing itself instead of opening blank.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { slugify } from "@/lib/funnels/slug"
import { FUNNEL_GOALS, RESERVED_FUNNEL_SLUGS, FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"
import type { FunnelGoal } from "@/types/database"

interface CreatePageDialogProps {
  /** Slugs already taken, for the inline hint. The server 409 stays authoritative. */
  takenSlugs: string[]
}

export function CreatePageDialog({ takenSlugs }: CreatePageDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [goal, setGoal] = useState<FunnelGoal>("leads")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  // Derived until the owner takes the wheel. Re-deriving after that would throw
  // away a URL they chose deliberately.
  const effectiveSlug = slugTouched ? slug : slugify(name)

  const slugError = useMemo(() => {
    if (effectiveSlug === "") return null
    if (effectiveSlug.length < 2) return "Too short — use at least 2 characters."
    if (!FUNNEL_SLUG_PATTERN.test(effectiveSlug)) return "Lowercase letters, numbers and hyphens only."
    if (RESERVED_FUNNEL_SLUGS.has(effectiveSlug)) return "That address is reserved — pick another."
    if (takenSlugs.includes(effectiveSlug)) return "That address is already in use."
    return null
  }, [effectiveSlug, takenSlugs])

  const canSubmit = name.trim().length >= 2 && effectiveSlug.length >= 2 && slugError === null && !creating

  function reset() {
    setName("")
    setSlug("")
    setSlugTouched(false)
    setGoal("leads")
    setDescription("")
  }

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    try {
      const response = await fetch("/api/admin/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          kind: "page",
          goal,
          description: description.trim() === "" ? null : description.trim(),
        }),
      })
      const body = (await response.json()) as {
        funnel?: { id: string }
        entryStepId?: string
        error?: string
      }
      if (!response.ok || !body.funnel) {
        // Stay open. Everything typed is still here, and closing would lose it.
        toast.error(body.error ?? "Could not create the page.")
        return
      }
      toast.success("Landing page created.")
      setOpen(false)
      reset()
      // Straight into the builder. `start=1` is only a nudge — the builder's own
      // guard (empty doc, no turns) decides whether the first prompt fires.
      router.push(
        body.entryStepId
          ? `/admin/funnels/${body.funnel.id}/edit/${body.entryStepId}?start=1`
          : `/admin/funnels/${body.funnel.id}`,
      )
    } catch {
      toast.error("Could not create the page.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New landing page
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New landing page</DialogTitle>
          <DialogDescription>
            One focused page with one job. Answer these and the builder writes the first draft for you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="page-name">Name</Label>
            <Input
              id="page-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Free Trial Week"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Only you see this — it labels the page in this list.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="page-slug">URL</Label>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
              <span className="shrink-0 text-sm text-muted-foreground">/go/</span>
              <Input
                id="page-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
                placeholder="free-trial-week"
                className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-[var(--error)]">{slugError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Visitors will land on <span className="font-mono">/go/{effectiveSlug || "…"}</span>
              </p>
            )}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">What should this page do?</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {FUNNEL_GOALS.map((option) => {
                const active = goal === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={option.label}
                    onClick={() => setGoal(option.value)}
                    className={
                      active
                        ? "rounded-lg border border-primary bg-primary/5 p-3 text-left"
                        : "rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40"
                    }
                  >
                    <span className="block text-sm font-medium text-primary">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="page-description">Describe it</Label>
            <Textarea
              id="page-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A page for high-school athletes considering a first training block."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Optional. This becomes the builder&rsquo;s first instruction, so the more you say the closer the
              first draft lands.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {creating ? "Creating…" : "Create & build"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/create-page-dialog.test.tsx`
Expected: PASS (7 tests). `entryStepId` already comes back from the create route — that was Task 1, Step 6.

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/CreatePageDialog.tsx __tests__/components/admin/create-page-dialog.test.tsx
git commit -m "feat(funnels): the create dialog asks what the page is for, then starts building it"
```

---

### Task 5: Goal badge and description on the card

**Files:**
- Modify: `components/admin/funnels/PreviewCard.tsx:21-40`, `:145-155`
- Test: `__tests__/components/admin/funnel-preview-pane.test.tsx` is a different component — create `__tests__/components/admin/preview-card-goal.test.tsx`

**Interfaces:**
- Consumes: `FUNNEL_GOALS` (Task 2).
- Produces: `PreviewCardProps` gains `goalLabel?: string` and `description?: string | null`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/preview-card-goal.test.tsx`:

```tsx
// A card that shows only a name and a URL cannot tell two similar pages apart.
// The goal and the description are the two things that do.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PreviewCard } from "@/components/admin/funnels/PreviewCard"

const base = {
  title: "Free Trial Week",
  previewUrl: null,
  href: "/admin/funnels/f1/edit/s1",
  badgeLabel: "live",
  badgeTone: "success" as const,
}

describe("<PreviewCard> goal and description", () => {
  it("shows the goal label when one is given", () => {
    // MUTANT KILLED: accepting goalLabel and never rendering it.
    render(<PreviewCard {...base} goalLabel="Capture leads" />)
    expect(screen.getByText("Capture leads")).toBeInTheDocument()
  })

  it("shows the description when one is given", () => {
    render(<PreviewCard {...base} description="For HS athletes." />)
    expect(screen.getByText("For HS athletes.")).toBeInTheDocument()
  })

  it("renders neither when both are absent", () => {
    // MUTANT KILLED: rendering an empty badge or a blank line for the funnels
    // screen, where goals do not apply.
    const { container } = render(<PreviewCard {...base} />)
    expect(screen.queryByText("Capture leads")).not.toBeInTheDocument()
    expect(container.querySelector("[data-testid='card-description']")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/preview-card-goal.test.tsx`
Expected: FAIL — props do not exist, nothing renders.

- [ ] **Step 3: Add the props**

In `PreviewCardProps`, after `badgeTone`:

```ts
  /** Human label for the page's goal. Omitted on funnels, which have no single goal. */
  goalLabel?: string
  /** The owner's own note about what this page is for. */
  description?: string | null
```

Add both to the destructured parameter list.

- [ ] **Step 4: Render them**

Replace the badge row block at `:146-154` so the goal sits under the title, and add the description beneath:

```tsx
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={href} className="block truncate font-medium text-primary hover:underline">
              {title}
            </Link>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <DataTableBadge tone={badgeTone}>{badgeLabel}</DataTableBadge>
            {goalLabel ? <DataTableBadge tone="info">{goalLabel}</DataTableBadge> : null}
          </div>
        </div>

        {description ? (
          <p data-testid="card-description" className="line-clamp-2 text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/preview-card-goal.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/PreviewCard.tsx __tests__/components/admin/preview-card-goal.test.tsx
git commit -m "feat(funnels): a card says what the page is for, not just what it is called"
```

---

### Task 6: `FunnelBoard` becomes kind-aware

**Files:**
- Modify: `components/admin/funnels/FunnelBoard.tsx`
- Test: `__tests__/components/admin/funnel-board-kind.test.tsx`

> **Implement Task 8 before this one.** The board imports `CreateFunnelDialog`,
> which Task 8 creates. The numbering follows the reading order of the spec, not
> the build order.

**Interfaces:**
- Consumes: `CreatePageDialog` (Task 4), `CreateFunnelDialog` (Task 8), `PreviewCard` goal props (Task 5), `FUNNEL_GOALS` (Task 2).
- Produces: `FunnelBoardProps` gains `kind: FunnelKind`. The inline create input and `handleCreateFunnel` are removed — creation now belongs to the dialogs.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/funnel-board-kind.test.tsx`:

```tsx
// The split is the whole feature, and it lives here. A board that renders the
// same chrome for both kinds would look done and be exactly the thing the owner
// complained about.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelBoard } from "@/components/admin/funnels/FunnelBoard"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel => ({
  id: "f1",
  slug: "free-trial",
  name: "Free Trial",
  description: "For HS athletes.",
  status: "published",
  kind: "page",
  goal: "leads",
  created_by: null,
  created_at: "",
  updated_at: "",
  ...over,
})

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: "v1",
    project_data: null,
  }) as FunnelStep

beforeEach(() => vi.clearAllMocks())

describe("<FunnelBoard kind='page'>", () => {
  it("offers the landing page dialog, not a bare input", () => {
    // MUTANT KILLED: leaving the inline "New landing page name" input in place,
    // which is the control this whole feature replaces.
    render(<FunnelBoard kind="page" pages={[]} funnels={[]} leadCounts={{}} />)
    expect(screen.getByRole("button", { name: /new landing page/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/new landing page name/i)).not.toBeInTheDocument()
  })

  it("teaches the flow when there is nothing yet", () => {
    // MUTANT KILLED: the old one-line "No landing pages yet." empty state.
    render(<FunnelBoard kind="page" pages={[]} funnels={[]} leadCounts={{}} />)
    expect(screen.getByText(/one focused page/i)).toBeInTheDocument()
  })

  it("shows the goal badge on a page card", () => {
    render(
      <FunnelBoard
        kind="page"
        pages={[{ step: step(), funnel: funnel() }]}
        funnels={[funnel()]}
        leadCounts={{}}
      />,
    )
    expect(screen.getByText("Capture leads")).toBeInTheDocument()
  })
})

describe("<FunnelBoard kind='funnel'>", () => {
  it("uses funnel vocabulary and hides the goal badge", () => {
    // MUTANT KILLED: reusing the page copy on the funnels screen — the two
    // screens would be indistinguishable, which is the original complaint.
    render(
      <FunnelBoard
        kind="funnel"
        pages={[{ step: step(), funnel: funnel({ kind: "funnel", goal: null }) }]}
        funnels={[funnel({ kind: "funnel", goal: null })]}
        leadCounts={{}}
      />,
    )
    expect(screen.getByRole("button", { name: /new funnel/i })).toBeInTheDocument()
    expect(screen.queryByText("Capture leads")).not.toBeInTheDocument()
  })

  it("says something funnel-shaped when empty", () => {
    render(<FunnelBoard kind="funnel" pages={[]} funnels={[]} leadCounts={{}} />)
    expect(screen.getByText(/more than one step/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/funnel-board-kind.test.tsx`
Expected: FAIL — `kind` is not a prop; the bare input is still rendered.

- [ ] **Step 3: Rewrite the board's header and empty state**

In `components/admin/funnels/FunnelBoard.tsx`:

Add `kind: FunnelKind` to `FunnelBoardProps` and destructure it. Delete `name`, `creating`, `handleCreateFunnel` and the `slugify` import usage for creation (the import itself was removed in Task 2).

Replace the header row (`:111-133`):

```tsx
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "page" ? "Search pages…" : "Search funnels…"}
          className="sm:max-w-xs"
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          {kind === "page" ? (
            <CreatePageDialog takenSlugs={funnels.map((f) => f.slug)} />
          ) : (
            <CreateFunnelDialog takenSlugs={funnels.map((f) => f.slug)} />
          )}
        </div>
      </div>
```

Replace the empty state (`:153-156`):

```tsx
      {visible.length === 0 ? (
        pages.length === 0 ? (
          <EmptyState kind={kind} />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center text-muted-foreground">
            Nothing matches that search.
          </div>
        )
      ) : (
```

- [ ] **Step 4: Add the `EmptyState` component**

At the bottom of the same file, beside `FilterChip`:

```tsx
/**
 * The empty state is the only place a first-time owner is told what this screen
 * makes. A single grey "nothing here yet" line taught nothing and was the state
 * the screen spent its first day in.
 */
function EmptyState({ kind }: { kind: FunnelKind }) {
  const copy =
    kind === "page"
      ? {
          title: "No landing pages yet",
          body: "A landing page is one focused page at /go/<url> built to do a single job — capture a lead, sell a program, fill a camp.",
          steps: [
            "Name it and pick what it should do",
            "Describe it — the builder writes the first draft",
            "Review it, then go live",
          ],
        }
      : {
          title: "No funnels yet",
          body: "A funnel is more than one step in order — a landing page, then a booking step, then a thank-you — sharing one address.",
          steps: [
            "Create the funnel and name its first step",
            "Add the steps that follow it",
            "Publish each step, then take the funnel live",
          ],
        }

  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/30 px-6 py-14 text-center">
      <h2 className="font-heading text-lg text-primary">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy.body}</p>
      <ol className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
        {copy.steps.map((entry, index) => (
          <li key={entry} className="flex gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">
              {index + 1}
            </span>
            {entry}
          </li>
        ))}
      </ol>
    </div>
  )
}
```

- [ ] **Step 5: Pass the goal and description into each card**

Inside the `visible.map` body, before the `return`:

```tsx
            // Goals belong to a page. A funnel's goal lives on its steps, so
            // showing one on the container would be inventing a fact.
            const goalLabel =
              kind === "page" && step.is_entry
                ? FUNNEL_GOALS.find((option) => option.value === funnel.goal)?.label
                : undefined
```

And add to the `<PreviewCard …>` props:

```tsx
                goalLabel={goalLabel}
                description={step.is_entry ? funnel.description : null}
```

Add the imports at the top:

```ts
import { CreatePageDialog } from "./CreatePageDialog"
import { CreateFunnelDialog } from "./CreateFunnelDialog"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { Funnel, FunnelStep, FunnelKind } from "@/types/database"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/funnel-board-kind.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add components/admin/funnels/FunnelBoard.tsx __tests__/components/admin/funnel-board-kind.test.tsx
git commit -m "feat(funnels): one board, two vocabularies"
```

---

### Task 7: The two screens

**Files:**
- Create: `app/(admin)/admin/pages/page.tsx`
- Modify: `app/(admin)/admin/funnels/page.tsx`

**Interfaces:**
- Consumes: `listFunnels({ kind })` (Task 1), `FunnelBoard` `kind` prop (Task 6).
- Produces: two routes rendering the same board with different `kind`.

- [ ] **Step 1: Create the landing pages screen**

Create `app/(admin)/admin/pages/page.tsx`:

```tsx
// The landing pages screen. Its twin at /admin/funnels renders the same board
// with kind="funnel"; the only differences are the filter, the title and the
// vocabulary the board picks up from `kind`.

import Link from "next/link"
import { LayoutTemplate } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { FunnelBoard, type BoardPage } from "@/components/admin/funnels/FunnelBoard"

export const metadata = { title: "Landing pages" }

export default async function LandingPagesScreen() {
  const funnels = await listFunnels({ kind: "page" })

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  const pages: BoardPage[] = funnels.flatMap((funnel, index) =>
    stepsPerFunnel[index].map((step) => ({ step, funnel })),
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Landing pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One focused page each, published at /go/&lt;slug&gt;.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How landing pages work
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <LayoutTemplate className="size-5 text-accent" />
        </div>
      </div>

      <FunnelBoard kind="page" pages={pages} funnels={funnels} leadCounts={leadCounts} />
    </div>
  )
}
```

- [ ] **Step 2: Retitle and refilter the funnels screen**

Replace `app/(admin)/admin/funnels/page.tsx` in full:

```tsx
// The funnels screen. Multi-step sequences only — single landing pages live at
// /admin/pages and render the same board with kind="page".

import Link from "next/link"
import { Workflow } from "lucide-react"
import { listFunnels, listSteps, getSubmissionCountsByFunnel } from "@/lib/db/funnels"
import { FunnelBoard, type BoardPage } from "@/components/admin/funnels/FunnelBoard"

export const metadata = { title: "Funnels" }

export default async function FunnelsScreen() {
  const funnels = await listFunnels({ kind: "funnel" })

  const [leadCounts, stepsPerFunnel] = await Promise.all([
    getSubmissionCountsByFunnel().catch(() => ({}) as Record<string, number>),
    Promise.all(funnels.map((funnel) => listSteps(funnel.id).catch(() => []))),
  ])

  const pages: BoardPage[] = funnels.flatMap((funnel, index) =>
    stepsPerFunnel[index].map((step) => ({ step, funnel })),
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Funnels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-step sequences sharing one address.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How funnels work
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <Workflow className="size-5 text-accent" />
        </div>
      </div>

      <FunnelBoard kind="funnel" pages={pages} funnels={funnels} leadCounts={leadCounts} />
    </div>
  )
}
```

- [ ] **Step 3: Fix the back-links that now point at the wrong screen**

`components/admin/funnels/StepList.tsx:44` pushes to `/admin/funnels` after deleting a step, and `app/(admin)/admin/funnels/[id]/page.tsx:24` links back to `/admin/funnels`. Both are reached from either kind. Change each to route by the funnel's kind:

```ts
router.push(funnel.kind === "page" ? "/admin/pages" : "/admin/funnels")
```

For `[id]/page.tsx:24`, the funnel is already loaded — use the same expression in the `href`.

- [ ] **Step 4: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `app/(admin)/admin/pages/`, `app/(admin)/admin/funnels/`, `components/admin/funnels/`.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/pages/page.tsx" "app/(admin)/admin/funnels/page.tsx" "app/(admin)/admin/funnels/[id]/page.tsx" components/admin/funnels/StepList.tsx
git commit -m "feat(funnels): landing pages and funnels get a screen each"
```

---

### Task 8: `CreateFunnelDialog`

**Files:**
- Create: `components/admin/funnels/CreateFunnelDialog.tsx`
- Test: `__tests__/components/admin/create-funnel-dialog.test.tsx`

**Interfaces:**
- Consumes: `slugify`, `RESERVED_FUNNEL_SLUGS`, `FUNNEL_SLUG_PATTERN` (Task 2).
- Produces: `export function CreateFunnelDialog(props: { takenSlugs: string[] }): JSX.Element`. Posts `kind: "funnel"` and routes to `/admin/funnels/<id>` (the step list), **not** into the builder.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/create-funnel-dialog.test.tsx`:

```tsx
// A funnel is a container, so its dialog asks less than the page one and lands
// somewhere else: the step list, where you decide what the sequence is, rather
// than the builder, which only ever edits one step.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CreateFunnelDialog } from "@/components/admin/funnels/CreateFunnelDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9" }),
  })) as unknown as typeof fetch
})

function open() {
  render(<CreateFunnelDialog takenSlugs={[]} />)
  fireEvent.click(screen.getByRole("button", { name: /new funnel/i }))
}

describe("<CreateFunnelDialog>", () => {
  it("does not ask for a goal", () => {
    // MUTANT KILLED: copying CreatePageDialog wholesale. A funnel has no single
    // goal — its steps do — so asking would store a fact that is not true.
    open()
    expect(screen.queryByText(/capture leads/i)).not.toBeInTheDocument()
  })

  it("posts kind funnel", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ name: "Camp 2026", slug: "camp-2026", kind: "funnel" })
  })

  it("routes to the funnel's step list, not the builder", async () => {
    // MUTANT KILLED: reusing the page hand-off, which would drop the owner into
    // step one's canvas before they have decided what the steps are.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/f9"))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/create-funnel-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `components/admin/funnels/CreateFunnelDialog.tsx`:

```tsx
"use client"

// Deliberately plainer than CreatePageDialog. A funnel is a container: the
// interesting questions belong to its steps, and asking them here would store a
// goal for something that does not have one.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { slugify } from "@/lib/funnels/slug"
import { RESERVED_FUNNEL_SLUGS, FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"

export function CreateFunnelDialog({ takenSlugs }: { takenSlugs: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const slugError = useMemo(() => {
    if (effectiveSlug === "") return null
    if (effectiveSlug.length < 2) return "Too short — use at least 2 characters."
    if (!FUNNEL_SLUG_PATTERN.test(effectiveSlug)) return "Lowercase letters, numbers and hyphens only."
    if (RESERVED_FUNNEL_SLUGS.has(effectiveSlug)) return "That address is reserved — pick another."
    if (takenSlugs.includes(effectiveSlug)) return "That address is already in use."
    return null
  }, [effectiveSlug, takenSlugs])

  const canSubmit = name.trim().length >= 2 && effectiveSlug.length >= 2 && slugError === null && !creating

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    try {
      const response = await fetch("/api/admin/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          kind: "funnel",
          description: description.trim() === "" ? null : description.trim(),
        }),
      })
      const body = (await response.json()) as { funnel?: { id: string }; error?: string }
      if (!response.ok || !body.funnel) {
        toast.error(body.error ?? "Could not create the funnel.")
        return
      }
      toast.success("Funnel created.")
      setOpen(false)
      // The step list, not the builder: the next decision is what the sequence
      // is, not what step one says.
      router.push(`/admin/funnels/${body.funnel.id}`)
    } catch {
      toast.error("Could not create the funnel.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New funnel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New funnel</DialogTitle>
          <DialogDescription>
            A sequence of steps sharing one address. You&rsquo;ll add and order the steps next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="funnel-name">Name</Label>
            <Input
              id="funnel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Summer Camp 2026"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="funnel-slug">URL</Label>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
              <span className="shrink-0 text-sm text-muted-foreground">/go/</span>
              <Input
                id="funnel-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
                placeholder="summer-camp-2026"
                className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-[var(--error)]">{slugError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Every step lives under <span className="font-mono">/go/{effectiveSlug || "…"}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="funnel-description">Describe it</Label>
            <Textarea
              id="funnel-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Registration flow for the summer camp: signup, payment, confirmation."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">Optional. Only you see this.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {creating ? "Creating…" : "Create funnel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/create-funnel-dialog.test.tsx __tests__/components/admin/funnel-board-kind.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/CreateFunnelDialog.tsx __tests__/components/admin/create-funnel-dialog.test.tsx
git commit -m "feat(funnels): a funnel's dialog asks less, because a container has less to say"
```

---

### Task 9: Convert to funnel

**Files:**
- Create: `components/admin/funnels/ConvertToFunnelDialog.tsx`
- Modify: `components/admin/funnels/FunnelBoard.tsx` (wire into `secondaryAction`)
- Test: `__tests__/components/admin/convert-to-funnel.test.tsx`

**Interfaces:**
- Consumes: `updateFunnelSchema` accepting `kind` (Task 2) — the existing `PATCH /api/admin/funnels/[id]` route needs no change.
- Produces: `export function ConvertToFunnelDialog(props: { funnelId: string; funnelName: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/convert-to-funnel.test.tsx`:

```tsx
// Conversion moves a page between two screens while it is live. The dialog's
// job is to say what does NOT change, because the owner's reasonable fear is
// that a URL people are already visiting is about to move.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ConvertToFunnelDialog } from "@/components/admin/funnels/ConvertToFunnelDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ funnel: {} }) })) as unknown as typeof fetch
})

describe("<ConvertToFunnelDialog>", () => {
  it("promises the URL will not change", async () => {
    // MUTANT KILLED: a bare "Are you sure?" confirm. The one question the owner
    // has is whether a live address moves, and silence reads as "probably".
    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    expect(await screen.findByText(/does not change/i)).toBeInTheDocument()
  })

  it("PATCHes kind to funnel", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^convert$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/funnels/f1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ kind: "funnel" })
  })

  it("sends the owner to the funnels screen afterwards", async () => {
    // MUTANT KILLED: only refreshing. The card has just left this screen, so
    // refreshing in place makes the page appear to have been deleted.
    render(<ConvertToFunnelDialog funnelId="f1" funnelName="Free Trial" />)
    fireEvent.click(screen.getByRole("button", { name: /convert to funnel/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^convert$/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels"))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/convert-to-funnel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `components/admin/funnels/ConvertToFunnelDialog.tsx`:

```tsx
"use client"

// A page outgrows itself the moment it needs a thank-you or an upsell step.
// Conversion is explicit rather than automatic: deriving the type from step
// count would move a live page between screens with no warning and no undo.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function ConvertToFunnelDialog({
  funnelId,
  funnelName,
}: {
  funnelId: string
  funnelName: string
}) {
  const router = useRouter()
  const [converting, setConverting] = useState(false)

  async function handleConvert() {
    setConverting(true)
    try {
      const response = await fetch(`/api/admin/funnels/${funnelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "funnel" }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not convert this page.")
        return
      }
      toast.success(`"${funnelName}" is now a funnel.`)
      // It has left this screen. Refreshing in place would read as a deletion.
      router.push("/admin/funnels")
    } catch {
      toast.error("Could not convert this page.")
    } finally {
      setConverting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" title="Convert to funnel" aria-label="Convert to funnel">
          <GitBranch className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Convert &ldquo;{funnelName}&rdquo; to a funnel?</AlertDialogTitle>
          <AlertDialogDescription>
            It moves to the Funnels screen and gains multi-step ordering, so you can add a thank-you or
            upsell step after it. Its address does not change and it stays live — anyone visiting the page
            right now sees exactly what they see today.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={converting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConvert} disabled={converting}>
            {converting ? "Converting…" : "Convert"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 4: Wire it into the board**

In `FunnelBoard.tsx`, inside the `secondaryAction` fragment, after the `FunnelGoLiveButton` line:

```tsx
                    {kind === "page" && step.is_entry ? (
                      <ConvertToFunnelDialog funnelId={funnel.id} funnelName={funnel.name} />
                    ) : null}
```

Add the import:

```ts
import { ConvertToFunnelDialog } from "./ConvertToFunnelDialog"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/convert-to-funnel.test.tsx __tests__/components/admin/funnel-board-kind.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/ConvertToFunnelDialog.tsx components/admin/funnels/FunnelBoard.tsx __tests__/components/admin/convert-to-funnel.test.tsx
git commit -m "feat(funnels): a page becomes a funnel when you say so, not when a step count says so"
```

---

### Task 10: The builder hand-off

**Files:**
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx:119-198`
- Modify: `components/admin/funnels/FunnelBuilder.tsx` (props + one effect)
- Test: `__tests__/components/admin/funnel-builder-initial-prompt.test.tsx`

**Interfaces:**
- Consumes: `funnels.goal` / `funnels.description` (Task 1), `FUNNEL_GOALS` (Task 2), `?start=1` from `CreatePageDialog` (Task 4).
- Produces: `FunnelBuilderProps` gains `initialPrompt?: string | null`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/funnel-builder-initial-prompt.test.tsx`:

```tsx
// The hand-off that makes a new page start building itself. The danger is not
// that it fails to fire — it is that it fires twice, or fires over work that
// already exists, so both tests below exist to catch a send that should not
// have happened.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { FunnelBuilder } from "@/components/admin/funnels/FunnelBuilder"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

const baseProps = {
  funnelId: "f1",
  funnelName: "Free Trial",
  stepId: "s1",
  stepName: "Landing page",
  publicUrl: "/go/free-trial",
  funnelStatus: "draft" as const,
  initialDoc: null,
  initialRevision: 0,
  docInvalid: false,
  resetToRevision: null,
  initialUnresolved: [],
  initialDanglingAnchors: [],
  initialCompile: null,
  initialResolutionError: null,
  initialMessages: [],
  maxMessageLength: 2000,
  renderForPublish: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch
})

describe("FunnelBuilder initialPrompt", () => {
  it("sends the prompt exactly once on a brand-new page", async () => {
    // MUTANT KILLED: an effect without a fired-ref, which re-sends on every
    // re-render and spends a paid model turn each time.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const { rerender } = render(<FunnelBuilder {...baseProps} initialPrompt="Build a free trial page." />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender(<FunnelBuilder {...baseProps} initialPrompt="Build a free trial page." />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.message).toBe("Build a free trial page.")
  })

  it("never sends when the page already has turns", async () => {
    // MUTANT KILLED: guarding on the doc alone. A page whose first build FAILED
    // has a null doc and a real transcript; re-firing would silently replay the
    // creation prompt over whatever the owner typed since.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(
      <FunnelBuilder
        {...baseProps}
        initialPrompt="Build a free trial page."
        initialMessages={[{ id: "turn-1", role: "owner", text: "make it green" }]}
      />,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never sends when there is no prompt", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelBuilder {...baseProps} initialPrompt={null} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/funnel-builder-initial-prompt.test.tsx`
Expected: FAIL — `initialPrompt` is not a prop; nothing is sent.

- [ ] **Step 3: Add the prop and the guarded effect**

In `components/admin/funnels/FunnelBuilder.tsx`, add to `FunnelBuilderProps` after `initialMessages`:

```ts
  /**
   * First instruction for a page created through the create dialog. Composed
   * server-side from the stored name, goal and description — never taken from
   * the URL, so a refresh cannot replay a stale one.
   */
  initialPrompt?: string | null
```

After the `send` callback definition, add:

```tsx
  // Fire the creation prompt once, and only into a page that has never been
  // built or talked to. The ref — not the message list — is what makes it once:
  // `send` appends optimistically, so keying off `messages` would re-enter
  // before the state settled. Guarding on turns as well as the document matters
  // because a FAILED first build leaves a null doc beside a real transcript.
  const initialPromptFired = useRef(false)
  useEffect(() => {
    if (initialPromptFired.current) return
    if (!props.initialPrompt) return
    if (props.initialDoc !== null) return
    if (props.initialMessages.length > 0) return
    initialPromptFired.current = true
    void send(props.initialPrompt)
  }, [props.initialPrompt, props.initialDoc, props.initialMessages, send])
```

Ensure `useRef` and `useEffect` are in the React import at the top of the file.

- [ ] **Step 4: Compose the prompt server-side**

In `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx`, change the props signature to accept search params:

```ts
interface PageProps {
  params: Promise<{ id: string; stepId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
```

and the function signature:

```ts
export default async function FunnelEditPage({ params, searchParams }: PageProps) {
  const { id, stepId } = await params
  const { start } = await searchParams
```

Add this helper above the component:

```ts
/**
 * The first instruction for a page that has just been created. Rebuilt from
 * stored columns every time rather than carried in the URL: a prompt in the
 * query string survives a refresh, a share and a back button, and would replay
 * over work the owner has since done.
 */
function creationPrompt(funnel: Funnel): string | null {
  const goal = FUNNEL_GOALS.find((option) => option.value === funnel.goal)
  if (!goal) return null
  const lines = [
    `Build a landing page called "${funnel.name}".`,
    `Its job: ${goal.label.toLowerCase()} — ${goal.hint.toLowerCase()}.`,
  ]
  if (funnel.description) lines.push(`What it is for: ${funnel.description}`)
  return lines.join("\n")
}
```

with imports:

```ts
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { Funnel } from "@/types/database"
```

Then, before the `return`:

```ts
  // `start=1` is a nudge from the create dialog, not the condition. The
  // builder's own guard (no document, no turns) decides whether it fires.
  const initialPrompt = start === "1" && draft.doc === null && turns.length === 0 ? creationPrompt(funnel) : null
```

and pass it to `<FunnelBuilder … initialPrompt={initialPrompt} />`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/admin/funnel-builder-initial-prompt.test.tsx __tests__/components/admin/funnel-builder.test.tsx`
Expected: PASS — including the pre-existing builder suite, which must not regress.

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/FunnelBuilder.tsx "app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx" __tests__/components/admin/funnel-builder-initial-prompt.test.tsx
git commit -m "feat(funnels): a new page opens already building itself"
```

---

### Task 11: The how-it-works guide

**Files:**
- Create: `app/(admin)/admin/funnels/guide/page.tsx`

**Interfaces:**
- Consumes: nothing. A static server component, matching `app/(admin)/admin/books/guide/page.tsx`.
- Produces: `/admin/funnels/guide`, linked from both screen headers (Task 7).

- [ ] **Step 1: Read the existing guide for its house shape**

Run: `sed -n '1,60p' "app/(admin)/admin/books/guide/page.tsx"`

Match its heading levels, spacing and card chrome rather than inventing a second guide style.

- [ ] **Step 2: Write the guide**

Create `app/(admin)/admin/funnels/guide/page.tsx`:

```tsx
// Why this exists: the two words in this product's marketing area mean specific
// things, and until now nothing said which was which. Everything here is
// answerable from the screens themselves — this page just says it once, plainly.

import Link from "next/link"
import { HelpCircle } from "lucide-react"

export const metadata = { title: "How landing pages and funnels work" }

interface Section {
  heading: string
  body: string[]
}

const SECTIONS: Section[] = [
  {
    heading: "A landing page vs a funnel",
    body: [
      "A landing page is one page with one job — capture a lead, sell a program, fill a camp. It lives at /go/<url> and that is the whole thing.",
      "A funnel is more than one page in order, sharing one address: a signup page at /go/<url>, then a payment step at /go/<url>/pay, then a confirmation. Use one when a visitor has to move through stages.",
      "Start with a landing page. If it later needs a second step, open its menu and choose Convert to funnel — the address does not change and the page stays live.",
    ],
  },
  {
    heading: "Naming and addresses",
    body: [
      "The name is for you: it labels the page in the list and nobody else sees it.",
      "The URL is public and permanent in practice — once you have shared it or an ad points at it, changing it breaks every link. Pick it deliberately at creation.",
      "A few addresses are reserved because the app already uses them: admin, api, client, go, login and register.",
    ],
  },
  {
    heading: "Building with AI",
    body: [
      "Creating a page drops you into the builder with your description already sent, so a first draft starts immediately. Everything after that is conversation: say what to change and it changes.",
      "The builder works in sections — hero, proof, bullets, steps, testimonial, pricing, FAQ, form, CTA, footer. Asking for a section by name is the fastest way to get one.",
      "Buttons can point at real things in this app: a program, a session pack, an event, or your booking flow. Name the thing and the builder links it.",
    ],
  },
  {
    heading: "Reviewing before you publish",
    body: [
      "The builder checks every button before it lets you publish. A button pointing at a program you have since deleted is reported rather than shipped broken.",
      "The preview is the real page, not a mockup. What you see is what a visitor gets.",
    ],
  },
  {
    heading: "Going live",
    body: [
      "Publishing is two separate things, and this catches people out. Publishing a PAGE saves a version of it. Going LIVE is what makes /go/<url> reachable at all.",
      "Both controls are on the card: publish inside the builder, then Go live on the list. A published page whose funnel is still a draft returns a 404 — that is not a bug, it is the second switch waiting.",
    ],
  },
  {
    heading: "Where leads land",
    body: [
      "Every form submission on a published page lands in the leads inbox, tagged with the page it came from.",
      "The lead count on each card links straight to that page's leads.",
    ],
  },
]

export default function FunnelsGuidePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">How landing pages and funnels work</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Back to{" "}
            <Link href="/admin/pages" className="underline underline-offset-2 hover:text-primary">
              Landing pages
            </Link>{" "}
            or{" "}
            <Link href="/admin/funnels" className="underline underline-offset-2 hover:text-primary">
              Funnels
            </Link>
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <HelpCircle className="size-5 text-accent" />
        </div>
      </div>

      <div className="space-y-5">
        {SECTIONS.map((section, index) => (
          <section key={section.heading} className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2.5 font-heading text-base text-primary">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">
                {index + 1}
              </span>
              {section.heading}
            </h2>
            <div className="mt-3 space-y-2.5 pl-8.5">
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles and the route resolves**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/funnels/guide/page.tsx"
git commit -m "docs(funnels): say once, plainly, what the two words mean"
```

---

### Task 12: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Run every touched suite**

```bash
npx vitest run \
  __tests__/lib/db/funnel-kind.test.ts \
  __tests__/lib/db/funnel-builder.test.ts \
  __tests__/lib/validators/funnel-kind-goal.test.ts \
  __tests__/lib/permissions-registry.test.ts \
  __tests__/components/admin/create-page-dialog.test.tsx \
  __tests__/components/admin/create-funnel-dialog.test.tsx \
  __tests__/components/admin/convert-to-funnel.test.tsx \
  __tests__/components/admin/funnel-board-kind.test.tsx \
  __tests__/components/admin/preview-card-goal.test.tsx \
  __tests__/components/admin/funnel-builder-initial-prompt.test.tsx \
  __tests__/components/admin/funnel-builder.test.tsx \
  __tests__/components/admin/funnel-go-live.test.tsx \
  __tests__/lib/funnels/sections/leadgen.test.ts \
  > verify.txt 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " verify.txt
```

Expected: EXIT=0, zero failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit > tsc.txt 2>&1; echo "EXIT=$?"; grep -E "funnels|pages|permissions" tsc.txt`
Expected: EXIT=0.

Never gate on a piped command's exit code — a pipe reports the LAST command's status, so `tsc | tail` reports tail's exit 0 and hides a failing build. Redirect to a file and capture `$?`, as above.

- [ ] **Step 3: Production build**

Run: `npm run build > build.txt 2>&1; echo "EXIT=$?"; grep -iE "error|failed" build.txt | head -20`
Expected: EXIT=0. A green `tsc` is not a green build in this repo — `next build` resolves modules `tsc` does not.

- [ ] **Step 4: Clean up and commit if anything moved**

```bash
rm -f verify.txt tsc.txt build.txt
git status --short
```

Expected: clean, apart from files you intended to change.

---

## Post-implementation, requires the owner

These are deliberately NOT part of the implementation:

1. **Apply the migration to production.** `mcp__supabase__apply_migration` against the prod project, contents of `00205_funnel_kind_goal.sql`. Nothing works before this and application code must not deploy ahead of it.
2. **Verify the backfill.** After applying, confirm the split landed sensibly:
   ```sql
   SELECT kind, count(*) FROM funnels GROUP BY kind;
   ```
3. **Push and deploy.** The branch is `worktree-funnel-improvements`.
