> ## PARKED 2026-09-23 — read this before acting on anything below
>
> **The code for this design was built and is NOT merged.** It lives on the local
> branch `funnel-step-roles` (15 commits, tip `b2ea2e2e`, last touched 2026-08-17).
> This document and its sibling are on `main`; the code deliberately is not.
>
> **Why it was parked, measured 2026-09-23 rather than guessed:**
> - The branch is **961 commits behind `main`** and `git merge-tree` reports
>   **15 conflicts**.
> - Its migration is **`00211_funnel_step_role.sql`, and `00211` is already taken**
>   on `main` by `00211_lead_inquiries_click_ids.sql`. Supabase keys on the version
>   NUMBER, and 00211 is recorded as applied — so that migration would never run,
>   silently, and every code path expecting `funnel_steps.role` would ship against
>   a schema without the column.
> - **G31 rewrites the same files.** It adds `business_id` to `funnel_steps` and six
>   sibling tables plus a tenant predicate on every reader in `lib/db/funnels.ts`.
>   Landing step roles first means doing that conflict work twice.
>
> **The decision: re-implement from this plan AFTER G31, do not rebase.** The branch
> is 5,077 lines, but only **1,236 of them are code** and 28 are the migration — the
> rest is this design (2,107) and its tests (1,706). Rebuilding ~1,200 lines against a
> funnel subsystem that already has its tenancy shape is cheaper and safer than
> resolving 15 conflicts across 961 commits of drift and then re-tenanting the result.
>
> **Two things to take from the branch when you do, because it is their only copy:**
> 1. **The 1,706 lines of tests.** They encode the behaviours this spec argues for.
> 2. The migration body — the SQL is sound, only its NUMBER is wrong. Take the next
>    free number, checked against `main` AND every live worktree, because numbers
>    collide silently across sessions.
>
> **Do not delete the branch** until its tests have been harvested. Every reference
> to "migration 00211" below is stale by number and correct by content.

---

# Funnel Step Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A funnel page is built and reviewed according to the job it does —
pitch, capture, checkout, booking or confirmation — instead of every page in the
product being built from one landing-page prompt.

**Architecture:** A stored `role` on `funnel_steps`, a leaf registry that owns
the vocabulary, craft rules tagged with the roles they govern and rendered
*filtered* into the per-page prompt block, and a critic panel that skips the
conversion lens where there is nothing to convert.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Zod 4, Vitest,
Anthropic via `@ai-sdk/anthropic`.

**Spec:** `docs/superpowers/specs/2026-08-16-funnel-step-roles-design.md`

## Global Constraints

- **Test command is targeted, never the full suite.** `npx vitest run <path>`.
  A build gate is `npx tsc --noEmit`; the recorded baseline is **258 errors**,
  and the journal records a commit that shipped 259 because the count was
  chained to the commit with `&&`. Read the number, then commit.
- **`SECTION_BUILDER_BLOCK_A` must stay a module-level `const`**, built once at
  import. `prompt.test.ts` pins reference identity with `toBe`; a
  `buildBlockA()` called per turn passes `toEqual` and fails `toBe`.
- **`SECTION_BUILDER_BLOCK_A.length < 16_000`** is asserted and must keep
  passing. After Task 3 it should be ~13,900.
- **No UUIDs may reach the prompt.** Block B renders names only; a test feeds
  real UUIDs and asserts none survive. Nothing added here may take an id.
- **Migrations are additive and code tolerates the old schema for one deploy.**
  `.github/workflows/apply-migrations.yml` states the constraint; Vercel builds
  on push to main and nothing sequences the two.
- **`null` is a value, never an omitted field.** Every place a role is rendered
  for the model, `null` renders as an explicit statement. A missing line reads
  to a model as something it is free to guess at.
- **Never restate a rule that has an owner.** Enums derive from the registry.
  This repo has logged bugs from restating instead of importing.
- Colours are semantic classes (`text-muted-foreground`), never hex. Tables use
  `components/ui/data-table.tsx`.

---

### Task 1: The role registry and template roles

**Files:**
- Create: `lib/funnels/roles.ts`
- Modify: `lib/funnels/templates.ts` (add `role` to `TemplateStep` + all 6 templates)
- Modify: `types/database.ts` (add `FunnelStepRole`, add `role` to `FunnelStep`)
- Test: `__tests__/lib/funnels/roles.test.ts`
- Test: `__tests__/lib/funnels/templates.test.ts` (extend)

**Interfaces:**
- Consumes: nothing — this is a leaf, like `templates.ts`.
- Produces:
  - `type FunnelStepRole = "pitch" | "capture" | "checkout" | "booking" | "confirmation"` (in `types/database.ts`)
  - `FUNNEL_STEP_ROLES: readonly { value: FunnelStepRole; label: string; hint: string; brief: string }[]`
  - `getRole(value: string | null | undefined): FunnelStepRoleDef | null`
  - `roleForPage(goal: FunnelGoal | null): FunnelStepRole` — the landing-page derivation
  - `ROLE_VALUES: readonly FunnelStepRole[]`
  - `TemplateStep.role: FunnelStepRole | null`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/funnels/roles.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  FUNNEL_STEP_ROLES,
  ROLE_VALUES,
  getRole,
  roleForPage,
} from "@/lib/funnels/roles"
import { FUNNEL_TEMPLATES } from "@/lib/funnels/templates"

describe("FUNNEL_STEP_ROLES", () => {
  it("gives every role a brief the prompt can render", () => {
    // MUTANT KILLED: adding a role with no `brief`. Block B renders the brief,
    // so a role without one is a page told its name and nothing about its job.
    for (const role of FUNNEL_STEP_ROLES) {
      expect(role.brief.length, role.value).toBeGreaterThan(40)
      expect(role.label.length, role.value).toBeGreaterThan(0)
      expect(role.hint.length, role.value).toBeGreaterThan(0)
    }
  })

  it("has no duplicate values", () => {
    expect(new Set(ROLE_VALUES).size).toBe(ROLE_VALUES.length)
  })
})

describe("getRole", () => {
  it("returns null for a role it has never heard of", () => {
    // Mirrors getTemplate: a row written by a newer build must not throw.
    expect(getRole("upsell")).toBeNull()
    expect(getRole("")).toBeNull()
    expect(getRole(null)).toBeNull()
    expect(getRole(undefined)).toBeNull()
  })

  it("returns the definition for a real role", () => {
    expect(getRole("confirmation")?.value).toBe("confirmation")
  })
})

describe("roleForPage", () => {
  it("maps a lead-capture landing page to capture and everything else to pitch", () => {
    // A landing page has exactly one job and its goal IS that job, so this
    // derives rather than storing. pitch and capture are the two roles the
    // pre-existing rules already addressed, which is what keeps landing-page
    // output unchanged by construction.
    expect(roleForPage("leads")).toBe("capture")
    expect(roleForPage("booking")).toBe("pitch")
    expect(roleForPage("program")).toBe("pitch")
    expect(roleForPage("session_pack")).toBe("pitch")
    expect(roleForPage("event")).toBe("pitch")
  })

  it("treats a page with no goal as a pitch", () => {
    // Pages created before goals existed. They must open as they always did.
    expect(roleForPage(null)).toBe("pitch")
  })
})

describe("template step roles", () => {
  it("only uses roles the registry knows", () => {
    // MUTANT KILLED: a template naming "thankyou" instead of "confirmation".
    // Without this the step is created with a role no rule names, and the page
    // is built with no doctrine at all.
    for (const template of FUNNEL_TEMPLATES) {
      for (const step of template.steps) {
        if (step.role === null) continue
        expect(getRole(step.role), `${template.value}/${step.slug}`).not.toBeNull()
      }
    }
  })

  it("ends every multi-step template on a confirmation", () => {
    // The confirmation page is the one this whole change exists for: it is the
    // page that was being told to open with a form.
    for (const template of FUNNEL_TEMPLATES) {
      if (template.steps.length < 2) continue
      const last = template.steps[template.steps.length - 1]
      expect(last.role, template.value).toBe("confirmation")
    }
  })

  it("gives the scratch template no role", () => {
    // Its whole hint is "one step, no assumptions".
    const scratch = FUNNEL_TEMPLATES.find((t) => t.value === "scratch")!
    expect(scratch.steps[0].role).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/roles.test.ts`
Expected: FAIL — `Cannot find module '@/lib/funnels/roles'`

- [ ] **Step 3: Add the type to `types/database.ts`**

Next to `FunnelGoal`, add:

```ts
/**
 * What a funnel page is FOR — the job it does in the sequence, as opposed to
 * `FunnelGoal`, which is what it sells.
 *
 * The two are not the same and cannot substitute for each other: in the
 * `program` template both "Offer" and "Checkout" carry `goal: "program"`, and
 * in `event` both "Details" and "Payment" carry `goal: "event"`. Only the role
 * separates a page that argues for the purchase from the page that takes the
 * money, and they want opposite shapes.
 */
export type FunnelStepRole = "pitch" | "capture" | "checkout" | "booking" | "confirmation"
```

And on `interface FunnelStep`, after `goal`:

```ts
  /**
   * What this page is for. Read by the builder prompt and by the review panel.
   *
   * Null for every step created before migration 00211, and for a template that
   * makes no assumption (`scratch`). Null MEANS "unspecified — treat this as a
   * pitch or capture page", which is exactly the behaviour those pages had
   * before roles existed. It is never rendered as an absent field.
   */
  role: FunnelStepRole | null
```

- [ ] **Step 4: Write `lib/funnels/roles.ts`**

```ts
// lib/funnels/roles.ts — what a funnel page is FOR.
//
// `FunnelGoal` says what a page SELLS. This says what it DOES. They are
// different questions and the difference is the whole feature: in the `program`
// template both "Offer" and "Checkout" carry `goal: "program"`, so goal cannot
// tell the page that argues for a purchase from the page that takes the money —
// and those two want opposite shapes. One opens with a hero and builds a case;
// the other names a price and gets out of the way.
//
// A CONST, NOT A TABLE, for the reason `templates.ts` gives: a step whose role
// no rule names must be a compile error, not a page discovered in production to
// have been built with no doctrine.
//
// This module is a LEAF: types only, no `lib/db`, no `lib/ai`, nothing with a
// runtime client. The step-settings control is a client component and imports
// it directly.

import type { FunnelGoal, FunnelStepRole } from "@/types/database"

export interface FunnelStepRoleDef {
  value: FunnelStepRole
  /** What the owner picks in the select. */
  label: string
  /** One line under the option. */
  hint: string
  /**
   * One line handed to the MODEL, in Block B of the builder prompt and in the
   * critics' shared envelope. Written as a description of the page's situation,
   * not as an instruction — the rules carry the instructions, and saying the
   * same thing twice in two voices is how they drift.
   */
  brief: string
}

export const FUNNEL_STEP_ROLES = [
  {
    value: "pitch",
    label: "Pitch",
    hint: "Argues for the offer",
    brief:
      "This page makes the case for the offer. The visitor arrived curious and has decided nothing yet.",
  },
  {
    value: "capture",
    label: "Capture details",
    hint: "A form that lands in your inbox",
    brief:
      "This page exists to collect the visitor's details. Everything on it either earns the form or gets out of its way.",
  },
  {
    value: "checkout",
    label: "Checkout",
    hint: "Takes the payment",
    brief:
      "This page takes payment for something the visitor has already decided to buy. The argument was won on an earlier page.",
  },
  {
    value: "booking",
    label: "Book a time",
    hint: "Puts a call in the calendar",
    brief:
      "This page gets a time on the calendar. The visitor already wants the call; they need to know what it is and pick a slot.",
  },
  {
    value: "confirmation",
    label: "Confirmation",
    hint: "Says what happens next",
    brief:
      "The visitor has ALREADY acted — paid, booked or signed up. This page reassures them it worked and tells them what happens next.",
  },
] as const satisfies readonly FunnelStepRoleDef[]

export const ROLE_VALUES: readonly FunnelStepRole[] = FUNNEL_STEP_ROLES.map((role) => role.value)

/**
 * The definition for a role, or null.
 *
 * RETURNS NULL RATHER THAN THROWING, following `getTemplate`: `funnel_steps.role`
 * is CHECK-constrained but a row written by a newer build than the one reading
 * it would otherwise take down the editor. Every caller handles null already,
 * because null is also what every pre-00211 step has.
 */
export function getRole(value: string | null | undefined): FunnelStepRoleDef | null {
  if (!value) return null
  return FUNNEL_STEP_ROLES.find((role) => role.value === value) ?? null
}

/**
 * The role of a LANDING PAGE, derived from its goal.
 *
 * DERIVED, NOT STORED, and that is not an inconsistency with funnel steps. A
 * landing page has exactly one job and its goal IS that job, so there is no
 * second fact to store and nothing that could fall out of sync. A funnel step
 * needs the column precisely because its goal does NOT determine its job.
 *
 * It is also the safety property of this whole change: `pitch` and `capture`
 * are the two roles the pre-existing craft rules already addressed, so a
 * landing page's instructions come out unchanged by construction.
 */
export function roleForPage(goal: FunnelGoal | null): FunnelStepRole {
  return goal === "leads" ? "capture" : "pitch"
}
```

- [ ] **Step 5: Add `role` to `TemplateStep` and every template**

In `lib/funnels/templates.ts`, import the type and extend the interface:

```ts
import type { FunnelGoal, FunnelStepRole, OfferKind } from "@/types/database"

export interface TemplateStep {
  name: string
  /** The first step's slug is ALWAYS `ENTRY_STEP_SLUG` — it is the front door. */
  slug: string
  /** What this step is for. Null when a template gives a step no job. */
  goal: FunnelGoal | null
  /**
   * What this step IS — the shape the page should take. Distinct from `goal`:
   * "Offer" and "Checkout" are both `goal: "program"` and want opposite pages.
   * Null on `scratch`, whose whole promise is that it assumes nothing.
   */
  role: FunnelStepRole | null
}
```

Then add `role` to each step. The full mapping:

```ts
  // leads
  { name: "Signup",    slug: ENTRY_STEP_SLUG, goal: "leads", role: "capture" },
  { name: "Thank you", slug: "thank-you",     goal: null,    role: "confirmation" },

  // program
  { name: "Offer",        slug: ENTRY_STEP_SLUG, goal: "program", role: "pitch" },
  { name: "Checkout",     slug: "checkout",      goal: "program", role: "checkout" },
  { name: "Confirmation", slug: "thank-you",     goal: null,      role: "confirmation" },

  // session_pack
  { name: "Offer",        slug: ENTRY_STEP_SLUG, goal: "session_pack", role: "pitch" },
  { name: "Checkout",     slug: "checkout",      goal: "session_pack", role: "checkout" },
  { name: "Confirmation", slug: "thank-you",     goal: null,           role: "confirmation" },

  // event
  { name: "Details",      slug: ENTRY_STEP_SLUG, goal: "event", role: "pitch" },
  { name: "Register",     slug: "register",      goal: "leads", role: "capture" },
  { name: "Payment",      slug: "payment",       goal: "event", role: "checkout" },
  { name: "Confirmation", slug: "thank-you",     goal: null,    role: "confirmation" },

  // booking
  { name: "Pitch",        slug: ENTRY_STEP_SLUG, goal: "booking", role: "pitch" },
  { name: "Book a time",  slug: "book",          goal: "booking", role: "booking" },
  { name: "Confirmation", slug: "thank-you",     goal: null,      role: "confirmation" },

  // scratch
  { name: "Step 1", slug: ENTRY_STEP_SLUG, goal: null, role: null },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/funnels/roles.test.ts __tests__/lib/funnels/templates.test.ts`
Expected: PASS. If `templates.test.ts` has a step-shape assertion listing keys,
extend it to include `role` rather than deleting the assertion.

- [ ] **Step 7: Check the build gate**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 258 or fewer. `PlannedStep` in `ai-plan.ts` and `createStepPlanSchema`
in `validators/funnel.ts` do NOT get `role` in this task — they take their roles
from the template in Task 2, so nothing there should break.

- [ ] **Step 8: Commit**

```bash
git add lib/funnels/roles.ts lib/funnels/templates.ts types/database.ts \
        __tests__/lib/funnels/roles.test.ts __tests__/lib/funnels/templates.test.ts
git commit -m "feat(funnels): a page has a job, and goal was never able to say what it is"
```

---

### Task 2: Migration 00211, schema tolerance, and the write path

**Files:**
- Create: `supabase/migrations/00211_funnel_step_role.sql`
- Modify: `lib/db/funnel-schema-support.ts` (add the 00211 probe)
- Modify: `lib/db/funnels.ts` (`createFunnel` writes role; `UpdateStepInput`)
- Modify: `lib/validators/funnel.ts` (`updateStepSchema.role`, `createStepPlanSchema.role`)
- Modify: `lib/funnels/ai-plan.ts` (`PlannedStep.role`, carried from the template)
- Test: `__tests__/lib/db/funnel-step-role-support.test.ts`
- Test: `__tests__/lib/funnels/ai-plan.test.ts` (extend)

**Interfaces:**
- Consumes: `FunnelStepRole`, `ROLE_VALUES`, `getRole` (Task 1).
- Produces:
  - `hasStepRoleColumn(supabase, options?): Promise<boolean>` and
    `__resetStepRoleColumnCache()` in `lib/db/funnel-schema-support.ts`
  - `STEP_ROLE_PROBE_COLUMN = "role"`
  - `createFunnel` accepts `steps: { name, slug, goal, role }[]`
  - `updateStepSchema` accepts `role`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/db/funnel-step-role-support.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetStepRoleColumnCache,
  hasStepRoleColumn,
} from "@/lib/db/funnel-schema-support"

/** A Supabase stub whose probe result the test controls. */
function client(error: { message: string } | null) {
  const limit = vi.fn().mockResolvedValue({ error })
  const select = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from }, from, select }
}

beforeEach(() => {
  __resetStepRoleColumnCache()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("hasStepRoleColumn", () => {
  it("probes funnel_steps, not funnels", () => {
    // MUTANT KILLED: copying hasIntakeColumns and leaving `.from("funnels")`.
    // 00210 added columns to `funnels`; 00211 adds one to `funnel_steps`. A
    // probe of the wrong table answers a question nobody asked, and would
    // report the role column present on any database that has 00210.
    const { client: c, from, select } = client(null)
    return hasStepRoleColumn(c).then(() => {
      expect(from).toHaveBeenCalledWith("funnel_steps")
      expect(select).toHaveBeenCalledWith("role")
    })
  })

  it("is true when the column is there", async () => {
    expect(await hasStepRoleColumn(client(null).client)).toBe(true)
  })

  it("is false when the column is missing", async () => {
    expect(await hasStepRoleColumn(client({ message: "column does not exist" }).client)).toBe(false)
  })

  it("caches a positive answer forever and stops probing", async () => {
    const { client: c, from } = client(null)
    await hasStepRoleColumn(c)
    await hasStepRoleColumn(c)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it("re-probes after the recheck window when the answer was negative", async () => {
    // The migration lands roughly fifteen seconds after the deploy that races
    // it, and a warm serverless instance lives for hours. Caching "absent"
    // permanently strands that instance writing role-less steps forever.
    const { client: c, from } = client({ message: "nope" })
    await hasStepRoleColumn(c, { now: 0 })
    await hasStepRoleColumn(c, { now: 1_000 })
    expect(from).toHaveBeenCalledTimes(1)
    await hasStepRoleColumn(c, { now: 40_000 })
    expect(from).toHaveBeenCalledTimes(2)
  })

  it("fails towards absent when the probe throws", async () => {
    // Resolving to "present" would 500 the next insert. Resolving to "absent"
    // performs the pre-00211 insert, which works against either schema.
    const from = vi.fn().mockImplementation(() => {
      throw new Error("network")
    })
    expect(await hasStepRoleColumn({ from } as never)).toBe(false)
  })

  it("does not share a cache with the 00210 probe", async () => {
    // MUTANT KILLED: reusing `hasIntakeColumns`'s module-level `present` flag.
    // 00210 and 00211 are separate migrations and can land apart; one flag
    // answering for both is wrong in whichever direction it guessed.
    const { hasIntakeColumns, __resetIntakeColumnCache } = await import(
      "@/lib/db/funnel-schema-support"
    )
    __resetIntakeColumnCache()
    __resetStepRoleColumnCache()

    // Intake present, role absent — the two answers must differ.
    const intakeOk = client(null).client
    const roleMissing = client({ message: "no role column" }).client
    expect(await hasIntakeColumns(intakeOk)).toBe(true)
    expect(await hasStepRoleColumn(roleMissing)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/db/funnel-step-role-support.test.ts`
Expected: FAIL — `hasStepRoleColumn` is not exported.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/00211_funnel_step_role.sql`:

```sql
-- What a funnel page is FOR, as distinct from what it sells.
--
-- `funnel_steps.goal` (00205) says what a page sells. It cannot say what the
-- page IS: in the `program` template both "Offer" and "Checkout" carry
-- goal = 'program', and in `event` both "Details" and "Payment" carry
-- goal = 'event'. Only position separated those pairs, and position is exactly
-- what changes when somebody inserts a step — silently re-roling every page
-- after it.
--
-- STORED, NOT DERIVED, for the same reason 00205 stores `kind`. Deriving from
-- template + slug fails differently: the AI create assist re-slugs every step
-- it renames, and AddStepDialog lets an owner rename by hand.
--
-- NULLABLE WITH NO BACKFILL. Null means "unspecified", which the builder reads
-- as "treat this as a pitch or capture page" — exactly how every one of these
-- pages behaved before this column existed. Guessing roles for old rows would
-- change pages the owner never asked us to touch.
--
-- Design doc: docs/superpowers/specs/2026-08-16-funnel-step-roles-design.md

ALTER TABLE public.funnel_steps
  ADD COLUMN IF NOT EXISTS role text
    CHECK (role IN ('pitch', 'capture', 'checkout', 'booking', 'confirmation'));

COMMENT ON COLUMN public.funnel_steps.role IS
  'What this page is for: pitch | capture | checkout | booking | confirmation. '
  'Written from the template at creation, changeable per step. NULL means '
  'unspecified and is read as pitch-or-capture, which is the pre-00211 behaviour.';
```

- [ ] **Step 4: Add the probe to `lib/db/funnel-schema-support.ts`**

Append to that file (do NOT widen `INTAKE_PROBE_COLUMN` — see the test):

```ts
// ---------------------------------------------------------------------------
// Migration 00211 — funnel_steps.role
//
// A SECOND PROBE, WITH ITS OWN CACHE, NOT A WIDENED FIRST ONE. 00210 and 00211
// are separate migrations applied by separate transactions and can land apart,
// so one flag answering for both is wrong in whichever direction it guessed —
// and both ways of being wrong hurt: claiming `role` exists 500s every create
// (funnels AND landing pages, since CreatePageDialog calls the same
// `createFunnel`), and claiming `template` is missing silently strips the
// intake a funnel was just created with.
//
// It probes `funnel_steps`, not `funnels`. 00210's columns are on `funnels`;
// this one is not, and a probe of the wrong table would report present on any
// database that has 00210.
// ---------------------------------------------------------------------------

/** The column probed for. There is only one in 00211. */
export const STEP_ROLE_PROBE_COLUMN = "role"

let rolePresent: boolean | null = null
let roleLastProbeAt = 0

/** Test seam. Never called by application code. */
export function __resetStepRoleColumnCache(): void {
  rolePresent = null
  roleLastProbeAt = 0
}

/**
 * True when this database has `funnel_steps.role`.
 *
 * Same asymmetric caching and same fail-towards-absent as `hasIntakeColumns`,
 * and for the same reasons — see that function's header, which is the canonical
 * statement of both.
 */
export async function hasStepRoleColumn(
  supabase: { from: (table: string) => { select: (columns: string) => { limit: (n: number) => unknown } } },
  options: ProbeOptions = {},
): Promise<boolean> {
  const now = options.now ?? Date.now()
  if (rolePresent === true) return true
  if (rolePresent === false && now - roleLastProbeAt < RECHECK_MS) return false

  roleLastProbeAt = now
  try {
    const result = (await supabase.from("funnel_steps").select(STEP_ROLE_PROBE_COLUMN).limit(1)) as {
      error: { code?: string; message?: string } | null
    }
    rolePresent = !result?.error
    if (!rolePresent) {
      console.warn(
        `[funnels] migration 00211 not applied to this database (${result?.error?.message ?? "unknown"}). ` +
          "Creating steps without a role until it lands.",
      )
    }
  } catch (error) {
    console.warn("[funnels] could not probe for migration 00211 — assuming absent:", error)
    rolePresent = false
  }
  return rolePresent
}
```

- [ ] **Step 5: Run the probe tests**

Run: `npx vitest run __tests__/lib/db/funnel-step-role-support.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Wire the write path**

In `lib/db/funnels.ts`, `createFunnel`:

```ts
  const intake = await hasIntakeColumns(supabase)
  // Probed independently — see funnel-schema-support.ts. Both probes are cheap
  // and both are cached, so this does not add a round trip per create once warm.
  const roleColumn = await hasStepRoleColumn(supabase)
```

Widen the `planned` fallback and the insert:

```ts
  const planned =
    input.steps && input.steps.length > 0
      ? input.steps
      : [
          {
            name: input.kind === "funnel" ? "Step 1" : "Landing page",
            slug: ENTRY_STEP_SLUG,
            goal: null,
            // A landing page derives its role from its goal (`roleForPage`) and
            // a from-scratch funnel step makes no assumption, so neither wants
            // a stored role here.
            role: null,
          },
        ]
```

```ts
      planned.map((step, index) => ({
        funnel_id: funnel.id,
        slug: index === 0 ? ENTRY_STEP_SLUG : step.slug,
        name: step.name,
        ...(intake ? { goal: step.goal ?? null } : {}),
        // Dropped, not defaulted, when 00211 has not landed. A step created in
        // the window has null role, which is read as "unspecified" — the same
        // as every step that predates this column.
        ...(roleColumn ? { role: step.role ?? null } : {}),
        position: index,
        is_entry: index === 0,
      })),
```

Update `CreateFunnelInput.steps` to `{ name: string; slug: string; goal: FunnelGoal | null; role: FunnelStepRole | null }[]`.

Add `role` to `UpdateStepInput` (the `Pick<FunnelStep, ...>` union in
`updateStep`), so the PATCH route can write it.

- [ ] **Step 7: Wire the validator and the plan sanitiser**

In `lib/validators/funnel.ts`:

```ts
import { ROLE_VALUES } from "@/lib/funnels/roles"

/** DERIVED from the registry — a hand-typed copy would let the select offer a
 *  value this schema refuses, which is the exact failure FUNNEL_GOALS exists to
 *  prevent. */
const roleSchema = z.enum(ROLE_VALUES as [FunnelStepRole, ...FunnelStepRole[]])
```

Add to `createStepPlanSchema`: `role: roleSchema.nullable().default(null)`.
Add to `updateStepSchema`: `role: roleSchema.nullable().optional()`.

In `lib/funnels/ai-plan.ts`, `PlannedStep` gains `role: FunnelStepRole | null`.
The model is NOT asked for a role — it is taken from the template by position,
because the model has no way to know a vocabulary it was never shown, and the
template is right about this by construction:

```ts
    // The ROLE IS NOT THE MODEL'S TO CHOOSE. It is never in `planSchema` and
    // never in the interview prompt: the template already knows what its Nth
    // step is for, and a model asked to invent a role would occasionally call a
    // checkout a pitch — producing a page that re-opens an argument the visitor
    // already settled. Taken by position, falling back to null past the end of
    // the template's own plan (a step the model added has no template answer).
    const role = template.steps[cleaned.length]?.role ?? null

    cleaned.push({ name, slug, goal, role })
```

And the fallback `steps` line already spreads the template step, which now
carries `role`, so it needs no change.

Add to `__tests__/lib/validators/funnel.test.ts` (or create it alongside the
existing validator tests):

```ts
  it("accepts every role the registry offers and rejects anything else", () => {
    // MUTANT KILLED: hand-typing the enum here. A select rendered from the
    // registry would then offer a value the API refuses, and the owner would
    // meet a 400 naming a field they picked from a list we gave them.
    for (const role of ROLE_VALUES) {
      expect(updateStepSchema.safeParse({ role }).success, role).toBe(true)
    }
    expect(updateStepSchema.safeParse({ role: null }).success).toBe(true)
    expect(updateStepSchema.safeParse({ role: "upsell" }).success).toBe(false)
  })
```

- [ ] **Step 8: Run the affected suites**

Run: `npx vitest run __tests__/lib/funnels/ai-plan.test.ts __tests__/lib/db/funnel-step-role-support.test.ts __tests__/lib/funnels/roles.test.ts`
Expected: PASS. Extend `ai-plan.test.ts` with:

```ts
  it("takes each step's role from the template, never from the model", () => {
    // MUTANT KILLED: reading `candidate.role` off the model's output. The model
    // is never shown the role vocabulary, so anything it returned would be a
    // guess — and a checkout mislabelled as a pitch produces a page that
    // re-argues a decision the visitor already made.
    const plan = sanitiseFunnelPlan(
      {
        template: "program",
        name: "Block",
        steps: [
          { name: "Sales page", slug: "index", goal: "program", role: "confirmation" },
          { name: "Pay", slug: "pay", goal: "program", role: "pitch" },
          { name: "Done", slug: "done", goal: null, role: "checkout" },
        ],
      },
      { allowedOfferNames: [] },
    )!
    expect(plan.steps.map((s) => s.role)).toEqual(["pitch", "checkout", "confirmation"])
  })

  it("accepts every role the registry knows and refuses anything else", () => {
    // MUTANT KILLED: hand-typing the enum here instead of deriving it from
    // ROLE_VALUES. A hand-typed copy lets the select offer a value this schema
    // refuses — the owner picks it, the PATCH 400s, and the failure looks like
    // the control being broken rather than like a stale list.
    for (const role of ROLE_VALUES) {
      expect(updateStepSchema.safeParse({ role }).success, role).toBe(true)
    }
    expect(updateStepSchema.safeParse({ role: null }).success).toBe(true)
    expect(updateStepSchema.safeParse({ role: "upsell" }).success).toBe(false)
    expect(updateStepSchema.safeParse({ role: "" }).success).toBe(false)
  })

  it("gives a step the model added beyond the template plan no role", () => {
    const plan = sanitiseFunnelPlan(
      {
        template: "leads",
        name: "Trial",
        steps: [
          { name: "Signup", slug: "index", goal: "leads" },
          { name: "Thanks", slug: "thanks", goal: null },
          { name: "Extra", slug: "extra", goal: null },
        ],
      },
      { allowedOfferNames: [] },
    )!
    expect(plan.steps[2].role).toBeNull()
  })
```

- [ ] **Step 9: Build gate, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — read the number, confirm
it is 258 or fewer, THEN commit. Do not chain these with `&&`.

```bash
git add supabase/migrations/00211_funnel_step_role.sql lib/db/funnel-schema-support.ts \
        lib/db/funnels.ts lib/validators/funnel.ts lib/funnels/ai-plan.ts \
        __tests__/lib/db/funnel-step-role-support.test.ts __tests__/lib/funnels/ai-plan.test.ts
git commit -m "feat(funnels): a step's job is stored, and survives the deploy that adds it"
```

---

### Task 3: Role-tagged craft rules, moved out of Block A

**Files:**
- Modify: `lib/funnels/sections/prompt.ts` (`LEADGEN_RULES`, `LEADGEN_BLOCK`, Block A template, the header comment)
- Test: `__tests__/lib/funnels/sections/prompt.test.ts` (extend)

**Interfaces:**
- Consumes: `FunnelStepRole`, `ROLE_VALUES`, `FUNNEL_STEP_ROLES` (Task 1).
- Produces:
  - `export interface CraftRule { roles: readonly FunnelStepRole[]; text: string }`
  - `export const LEADGEN_RULES: readonly CraftRule[]`
  - `export function craftRulesFor(role: FunnelStepRole | null): CraftRule[]`
  - Block A no longer contains any rule text.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/funnels/sections/prompt.test.ts`:

```ts
import { LEADGEN_RULES, craftRulesFor, SECTION_BUILDER_BLOCK_A } from "@/lib/funnels/sections/prompt"
import { ROLE_VALUES } from "@/lib/funnels/roles"

describe("craft rules", () => {
  it("names at least one rule for every role in the registry", () => {
    // MUTANT KILLED: adding a role to the registry and no doctrine for it. That
    // page would be built with the section catalogue and nothing else — which
    // is the exact bug this whole change exists to fix, reintroduced one role
    // at a time.
    for (const role of ROLE_VALUES) {
      expect(craftRulesFor(role).length, role).toBeGreaterThan(0)
    }
  })

  it("only tags rules with roles the registry knows", () => {
    for (const rule of LEADGEN_RULES) {
      for (const role of rule.roles) {
        expect(ROLE_VALUES, rule.text.slice(0, 40)).toContain(role)
      }
    }
  })

  it("gives a confirmation page the confirmation rule and NOT the form-first rule", () => {
    // THE WHOLE FEATURE, in one assertion. A thank-you page was being told to
    // open with a form.
    const texts = craftRulesFor("confirmation").map((rule) => rule.text)
    expect(texts.some((text) => text.includes("ALREADY ACTED"))).toBe(true)
    expect(texts.some((text) => text.includes("THE FORM GOES FIRST"))).toBe(false)
  })

  it("gives a checkout page no instruction to re-pitch or to capture a lead", () => {
    const texts = craftRulesFor("checkout").map((rule) => rule.text)
    expect(texts.some((text) => text.includes("THE FORM GOES FIRST"))).toBe(false)
    expect(texts.some((text) => text.includes("PROOF GOES NEAR THE TOP"))).toBe(false)
    expect(texts.some((text) => text.includes("DECISION IS ALREADY MADE"))).toBe(true)
  })

  it("gives an unspecified page exactly the pitch and capture rules", () => {
    // Every step created before migration 00211 has role null, and it must be
    // built the way it was built yesterday. Not a subset, not a superset.
    const union = LEADGEN_RULES.filter(
      (rule) => rule.roles.includes("pitch") || rule.roles.includes("capture"),
    )
    expect(craftRulesFor(null)).toEqual(union)
  })
})

describe("SECTION_BUILDER_BLOCK_A", () => {
  it("no longer carries the craft rules", () => {
    // MUTANT KILLED: leaving LEADGEN_BLOCK interpolated in Block A as well as
    // rendering it per-role in Block B. Two copies drift, and the Block A copy
    // is the one that tells a confirmation page to open with a form.
    for (const rule of LEADGEN_RULES) {
      expect(SECTION_BUILDER_BLOCK_A).not.toContain(rule.text)
    }
  })

  it("stays under the 16k ceiling with real headroom now", () => {
    expect(SECTION_BUILDER_BLOCK_A.length).toBeLessThan(16_000)
    // The rules moved out, so this should now be comfortably under rather than
    // 46 characters from the edge. If this fails, something was left behind.
    expect(SECTION_BUILDER_BLOCK_A.length).toBeLessThan(14_500)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts -t "craft rules"`
Expected: FAIL — `craftRulesFor` is not exported.

- [ ] **Step 3: Rewrite `LEADGEN_RULES` as tagged rules**

Replace the `LEADGEN_RULES` declaration in `lib/funnels/sections/prompt.ts`.
Keep the existing header comment (it explains the waitlist-page and site-wide-FAQ
bugs these rules exist for) and extend it. The six existing rules keep their
wording; only the tags are new. The three new rules are added.

```ts
export interface CraftRule {
  /** The roles this rule governs. A page is only shown rules naming its role. */
  roles: readonly FunnelStepRole[]
  text: string
}

/** Every role. Spelled once so a rule meaning "all" cannot drift from the registry. */
const ALL_ROLES = ROLE_VALUES

export const LEADGEN_RULES: readonly CraftRule[] = [
  {
    roles: ["capture"],
    text:
      'THE FORM GOES FIRST, with `variant: "split"`. That variant puts the pitch on one side and the ' +
      "fields on the other, so someone who is already sold can act without scrolling. Put the headline and " +
      "the offer in the form's own `heading` and `sub`, add two or three `proofPoints` (\"No payment now\", " +
      '"Coached in person", "12 spots"), and do not also add a hero above it — two headlines in the first ' +
      "screen compete and neither wins.",
  },
  {
    roles: ["pitch", "capture", "checkout", "booking"],
    text:
      "ONE OFFER, ONE ACTION. Every CTA on the page points at the SAME place. A page that offers a waitlist " +
      "and a consultation and a program purchase converts on none of them. If the owner asks for a second " +
      "action, put it in the footer as a link, not as a competing button.",
  },
  {
    roles: ALL_ROLES,
    text:
      'NEVER USE `faq` WITH `source: "live"` ON A CAMPAIGN PAGE. That pulls the SITE-WIDE FAQ — "What is DJP ' +
      'Athlete?", "Where are you based?" — which is written for a visitor who has never heard of the ' +
      'business, not for someone deciding about THIS offer. Write `source: "inline"` items that answer the ' +
      "objections to this specific thing: what it costs, how much time it takes, whether it suits their " +
      "level, what happens if they are injured, how to cancel. Live FAQ belongs on an evergreen page, not a " +
      "campaign.",
  },
  {
    roles: ["pitch", "capture"],
    text:
      "PROOF GOES NEAR THE TOP. A `proof` section directly under the first screen, or a `testimonial` before " +
      "the halfway point. Social proof at the bottom is read by people who were already going to convert.",
  },
  {
    roles: ["pitch", "capture"],
    text:
      "KEEP IT SHORT. Six to nine sections for a capture page. Every section a visitor scrolls past without " +
      "acting is a chance to leave; length is not thoroughness. If you cannot say why a section earns its " +
      "place, omit it.",
  },
  {
    roles: ALL_ROLES,
    text:
      "THE FOOTER IS NOT A SITE FOOTER. On a landing page it carries the business name, one contact line and " +
      "the legal text — nothing that invites someone to navigate away. `links` should be empty or near it.",
  },

  // --- The three roles that had no doctrine at all until now. --------------
  {
    roles: ["checkout"],
    text:
      "THE DECISION IS ALREADY MADE. Name what is being bought and what it costs, then the checkout — and " +
      "little else. No second offer, no lead form, no re-pitch: a page that re-opens the argument invites " +
      "the visitor to re-think it, and this is the page where that costs the sale. One reassurance about " +
      "refunds or cancellation earns its place; a wall of testimonials does not. Three to five sections.",
  },
  {
    roles: ["booking"],
    text:
      "THE CALENDAR GOES NEAR THE TOP. Say how long the call is, what happens on it, and what they leave " +
      "with — the fear is always that it is a sales pitch, so answer that out loud rather than hoping " +
      "nobody has it. Do not add a `form`: the booking flow already collects what it needs, and a second " +
      "set of fields is a second chance to abandon. Three to five sections.",
  },
  {
    roles: ["confirmation"],
    text:
      "THE VISITOR HAS ALREADY ACTED — they have paid, booked or signed up. This page reassures them it " +
      "worked and tells them what happens next: when they will hear from you, what to check, what to bring, " +
      "what to do now. NO form, NO pricing, NO proof, NO urgency, NO second offer — every one of those asks " +
      "again for something already given. Two to four sections, and it ENDS: it links nowhere further.",
  },
]

/**
 * The rules that govern a page in this role.
 *
 * `null` — every step created before migration 00211, and the `scratch`
 * template — returns the pitch+capture union, which is the exact rule set every
 * page in the product received before roles existed. That is the whole reason
 * null is a value here rather than a missing one.
 */
export function craftRulesFor(role: FunnelStepRole | null): CraftRule[] {
  if (role === null) {
    return LEADGEN_RULES.filter(
      (rule) => rule.roles.includes("pitch") || rule.roles.includes("capture"),
    )
  }
  return LEADGEN_RULES.filter((rule) => rule.roles.includes(role))
}
```

- [ ] **Step 4: Remove the rules from Block A**

Delete the `LEADGEN_BLOCK` const and the `## How to build a page that actually
gets leads\n\n${LEADGEN_BLOCK}` section from the Block A template string.

In the "How to write" section of Block A, the line *"One idea per section. A
landing page has one job; it has no navigation on purpose"* stays — it is true
of every role. Add one line pointing at where the rules now live:

```
- The catalogue below names this page's ROLE and the rules that govern it. Those
  rules are the ones that apply; there are no others.
```

- [ ] **Step 5: Correct the header comment**

The three-block comment at the top of `prompt.ts` claims Block A is "frozen ...
cached, BUILT ONCE AT MODULE LOAD" in a way that reads as sharing one cache
entry across every page. Replace that claim with what the code does:

```
//   A  frozen   role-neutral: the kinds, CtaTarget, style knobs, the op
//               grammar, the op-application rules, 2 worked examples
//   B  per-page the live catalogue (NAMES ONLY, NO IDS), this page's ROLE,
//               and the craft rules that govern that role
//   C  per-turn the current SectionDoc + recent prose + the new message
//
// THERE IS ONE CACHE BREAKPOINT AND IT IS AT THE END OF THE WHOLE SYSTEM
// STRING (`callAgent`, lib/ai/anthropic.ts) — not between A and B. Anthropic
// caching is a strict prefix match, so the cached unit is A+B, which varies per
// page: two different pages have NEVER shared a cache read. What freezing Block
// A buys is stability across TURNS OF ONE PAGE, and Block B has that too, since
// every field in it is stable for the life of a page.
//
// That is why the craft rules live in B. Filtering them by role there costs
// nothing in cache terms and means the model never reads a rule that does not
// apply to the page in front of it — which is strictly better than showing it
// all nine and trusting it to skip six.
//
// *** BLOCK A IS STILL A MODULE-LEVEL CONST, NOT A FUNCTION. *** Interpolating
// per-page state into it would invalidate the prefix on every turn of every
// page. `prompt.test.ts` pins reference identity with `toBe`, which a
// `buildBlockA()` called per turn would fail while passing any `toEqual`.
```

- [ ] **Step 6: Run the prompt suite**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts`
Expected: PASS. Any pre-existing test asserting Block A contains leadgen text
must be MOVED to assert against Block B (Task 4), not deleted.

- [ ] **Step 7: Commit**

```bash
git add lib/funnels/sections/prompt.ts __tests__/lib/funnels/sections/prompt.test.ts
git commit -m "feat(funnels): a rule that does not apply to this page is not shown to it"
```

---

### Task 4: Block B renders the role, and the route supplies it

**Files:**
- Modify: `lib/funnels/sections/prompt.ts` (`BuilderCatalogueInput`, `buildCatalogueBlock`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (`PageContext`, `loadPageContext`, the `buildSystemPrompt` call)
- Test: `__tests__/lib/funnels/sections/prompt.test.ts` (extend)
- Test: `__tests__/app/api/admin/funnels/build-route.test.ts` (extend)

**Interfaces:**
- Consumes: `craftRulesFor` (Task 3), `getRole`, `roleForPage` (Task 1).
- Produces: `BuilderCatalogueInput.role: FunnelStepRole | null` (required).

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/funnels/sections/prompt.test.ts`:

```ts
describe("buildCatalogueBlock — the role", () => {
  const base = () => ({ ...catalogueInput(), nextStepSlug: null })

  it("names the role and its brief", () => {
    const block = buildCatalogueBlock({ ...base(), role: "confirmation" })
    expect(block).toContain("confirmation")
    expect(block).toContain("ALREADY acted")
  })

  it("states 'not specified' rather than omitting the line when the role is null", () => {
    // MUTANT KILLED: rendering nothing for a null role. An absent line reads to
    // a model as a field it was not given and is free to guess at — the same
    // reasoning `nextStepSlug` already carries. Every step created before
    // migration 00211 takes this path.
    const block = buildCatalogueBlock({ ...base(), role: null })
    expect(block).toMatch(/not specified/i)
  })

  it("renders the rules for this role and no others", () => {
    const block = buildCatalogueBlock({ ...base(), role: "confirmation" })
    expect(block).toContain("ALREADY ACTED")
    expect(block).not.toContain("THE FORM GOES FIRST")
    expect(block).not.toContain("PROOF GOES NEAR THE TOP")
  })

  it("gives a null role the same rules a page got before roles existed", () => {
    const block = buildCatalogueBlock({ ...base(), role: null })
    expect(block).toContain("THE FORM GOES FIRST")
    expect(block).toContain("PROOF GOES NEAR THE TOP")
    expect(block).not.toContain("ALREADY ACTED")
  })

  it("gives a landing page exactly the doctrine it had before roles existed", () => {
    // SPEC TEST #1, and the safety property of the whole change. A landing page
    // derives `capture` from goal "leads" and `pitch` from everything else, and
    // those two roles between them carry every rule that used to be shown
    // unconditionally. So the instructions a landing page receives are the same
    // ones it received yesterday.
    //
    // The one difference is intended and is an improvement: a goal:"program"
    // page no longer reads the form-first rule at all, where before it read it
    // and was trusted to notice the "IF THE PAGE'S JOB IS TO COLLECT DETAILS"
    // condition did not apply to it.
    const capture = buildCatalogueBlock({ ...base(), role: roleForPage("leads") })
    for (const rule of LEADGEN_RULES.filter((r) => r.roles.includes("capture"))) {
      expect(capture).toContain(rule.text)
    }
    expect(capture).toContain("THE FORM GOES FIRST")

    const pitch = buildCatalogueBlock({ ...base(), role: roleForPage("program") })
    expect(pitch).toContain("ONE OFFER, ONE ACTION")
    expect(pitch).toContain("PROOF GOES NEAR THE TOP")
    expect(pitch).not.toContain("THE FORM GOES FIRST")
  })

  it("still leaks no UUIDs once the role block is in it", () => {
    // The existing no-ids guarantee, re-asserted over the new surface.
    const block = buildCatalogueBlock({ ...base(), role: "checkout" })
    expect(block).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it("gives a landing page exactly the rules it received before roles existed", () => {
    // THE SAFETY PROPERTY OF THE WHOLE CHANGE, asserted rather than assumed.
    // Landing pages are the tuned, shipped behaviour and this change is not
    // meant to touch them. `roleForPage` sends a leads page to `capture` and
    // every other goal to `pitch`; between them those two roles must cover the
    // original six rules, with the ONLY difference being that a non-leads page
    // no longer reads the form-first rule — which it was already told to skip,
    // because that rule opened "IF THE PAGE'S JOB IS TO COLLECT DETAILS".
    const capture = craftRulesFor(roleForPage("leads")).map((rule) => rule.text)
    const pitch = craftRulesFor(roleForPage("program")).map((rule) => rule.text)

    // A leads landing page: all six of the originals, unchanged.
    expect(capture).toHaveLength(6)

    // A selling landing page: the same set minus the one it always skipped.
    expect(new Set([...pitch, ...capture]).size).toBe(6)
    expect(pitch.some((text) => text.includes("THE FORM GOES FIRST"))).toBe(false)
    for (const text of ["ONE OFFER", "PROOF GOES NEAR THE TOP", "KEEP IT SHORT", "FOOTER IS NOT A SITE FOOTER"]) {
      expect(pitch.some((rule) => rule.includes(text)), text).toBe(true)
    }
  })
})
```

Every existing call to `buildCatalogueBlock` / `buildSystemPrompt` in this test
file needs `role` added — it is required, so tsc will find them all.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts -t "the role"`
Expected: FAIL — `role` is not a known property.

- [ ] **Step 3: Extend `BuilderCatalogueInput`**

```ts
  /**
   * What this page is FOR. Decides which craft rules Block B renders.
   *
   * Required, not optional, following `nextStepSlug`: a forgotten argument
   * becomes a compile error instead of a page that silently stops being told
   * what it is — which is the bug this whole change exists to fix.
   *
   * `null` is a real answer meaning "unspecified", and it is RENDERED, never
   * omitted. It yields the pitch+capture rules, which is exactly what every
   * page in the product received before roles existed.
   *
   * Stable for the life of a page, so Block B stays cacheable.
   */
  role: FunnelStepRole | null
```

- [ ] **Step 4: Render it in `buildCatalogueBlock`**

Append to the returned template string, after the next-page line:

```ts
## What this page is for

${
  // STATED EITHER WAY. See `nextStepSlug` above: a missing line reads to a
  // model as a field it may guess at, and the guess it makes on a thank-you
  // page is that the page should sell something.
  roleDef === null
    ? "Role: not specified. Treat this as a pitch or capture page."
    : `Role: ${roleDef.value} — ${roleDef.brief}`
}

These are the rules that govern a page in this role. They are the only ones that
apply to it:

${craftRulesFor(role).map((rule) => `- ${rule.text}`).join("\n\n")}
```

where `const roleDef = getRole(role)` is computed at the top of the function.

- [ ] **Step 5: Supply it from the build route**

In `app/api/admin/funnels/steps/[stepId]/build/route.ts`:

`PageContext` gains:

```ts
  /**
   * What this page is for. From the step's stored `role` on a funnel; DERIVED
   * from the funnel's goal on a landing page, where there is no second fact to
   * store — see `roleForPage`.
   *
   * Null when the read failed, which is the same instruction the page had
   * before roles existed. Degrading here costs the page its doctrine, not its
   * correctness, which is why this whole loader degrades rather than throwing.
   */
  role: FunnelStepRole | null
```

`loadPageContext` currently takes `(funnelId, thisStepSlug)`. It needs the step
row, which the caller already has (`getStep` at the `Promise.all` around line
553). Change the signature to `(funnelId, step: FunnelStep)` and derive:

```ts
    // A LANDING PAGE DERIVES, A FUNNEL STEP READS ITS COLUMN. `funnel.kind`
    // decides which, because a landing page's goal IS its job while a funnel
    // step's goal explicitly is not — "Offer" and "Checkout" are both
    // goal:"program" and want opposite pages.
    const role =
      funnel?.kind === "page" ? roleForPage(funnel.goal ?? null) : (step.role ?? null)
```

and in the degraded `catch` return, `role: null` alongside the other degraded
values, with the existing comment style.

Pass it through at the `buildSystemPrompt` call site (~line 986):

```ts
    role: context.role,
```

- [ ] **Step 6: Add the route test**

In `__tests__/app/api/admin/funnels/build-route.test.ts`:

```ts
  it("gives the prompt a landing page's derived role, not its stored one", async () => {
    // A landing page has no stored role by design. If the route read
    // `step.role` for it, every landing page would be built as "unspecified"
    // and would lose the capture doctrine a leads page has always had.
    mock(getFunnelById).mockResolvedValue({ ...FUNNEL, kind: "page", goal: "leads" })
    mock(getStep).mockResolvedValue({ ...STEP, role: null })

    await POST(request({ message: "build it" }), params())

    const system = mock(buildSystemPrompt).mock.calls[0][0]
    expect(system.role).toBe("capture")
  })

  it("gives the prompt a funnel step's stored role", async () => {
    mock(getFunnelById).mockResolvedValue({ ...FUNNEL, kind: "funnel", goal: null })
    mock(getStep).mockResolvedValue({ ...STEP, role: "confirmation" })

    await POST(request({ message: "build it" }), params())

    expect(mock(buildSystemPrompt).mock.calls[0][0].role).toBe("confirmation")
  })
```

Match the file's existing mocking style — read the top of it first; it mocks
`lib/db/funnels` wholesale and has `FUNNEL` / `STEP` fixtures already. Add
`role: null` to the `STEP` fixture so it matches the real row shape.

- [ ] **Step 7: Run both suites and the build gate**

Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts __tests__/app/api/admin/funnels/build-route.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — read it, confirm ≤258.

- [ ] **Step 8: Commit**

```bash
git add lib/funnels/sections/prompt.ts "app/api/admin/funnels/steps/[stepId]/build/route.ts" \
        __tests__/lib/funnels/sections/prompt.test.ts __tests__/app/api/admin/funnels/build-route.test.ts
git commit -m "feat(funnels): the model is told what page it is on, on every turn"
```

---

### Task 5: The review panel stops reviewing everything as a landing page

**Files:**
- Modify: `lib/funnels/sections/review/critics.ts` (`SHARED_ENVELOPE`, `CriticLens.roles`, `runCritics`)
- Modify: `lib/funnels/sections/review/pipeline.ts` (`ReviewInput.role`, thread to `runCritics`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (pass role to `reviewDoc`)
- Test: `__tests__/lib/funnels/sections/review/critics.test.ts` (extend)
- Test: `__tests__/lib/funnels/sections/review/pipeline.test.ts` (extend)

**Interfaces:**
- Consumes: `FunnelStepRole`, `getRole` (Task 1); `PageContext.role` (Task 4).
- Produces: `runCritics(doc, auditFindings, role)`; `ReviewInput.role` (required).

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/funnels/sections/review/critics.test.ts`:

```ts
describe("which lenses run", () => {
  it("does not run the conversion critic on a confirmation page", async () => {
    // THE REVIEW WAS UNDOING THE PROMPT FIX. The conversion lens asks what the
    // page's ONE job is and is told to weigh what is MISSING as heavily as what
    // is present — so on a thank-you page it reliably reports a missing offer,
    // a missing price and a missing CTA, and the reviser acts on all three.
    await runCritics(DOC, [], "confirmation")
    const systems = mock(callAgent).mock.calls.map((call) => call[0] as string)
    expect(systems.some((system) => system.includes("Conversion strategist") ||
      system.includes("whether somebody who wants this can actually act"))).toBe(false)
  })

  it("still runs the art and copy critics on a confirmation page", async () => {
    // Over-correcting into no review at all would be its own bug: a flat,
    // badly written confirmation page is still flat and badly written.
    await runCritics(DOC, [], "confirmation")
    expect(mock(callAgent)).toHaveBeenCalledTimes(2)
  })

  it("runs all three on every other role and on an unspecified page", async () => {
    for (const role of ["pitch", "capture", "checkout", "booking", null] as const) {
      mock(callAgent).mockClear()
      await runCritics(DOC, [], role)
      expect(mock(callAgent), String(role)).toHaveBeenCalledTimes(3)
    }
  })

  it("tells each critic which kind of page it is looking at", async () => {
    await runCritics(DOC, [], "checkout")
    const systems = mock(callAgent).mock.calls.map((call) => call[0] as string)
    for (const system of systems) expect(system).toContain("checkout")
  })

  it("tells them it is unspecified rather than silently saying nothing", async () => {
    // Same rule as the prompt: null is stated, never omitted.
    await runCritics(DOC, [], null)
    const system = mock(callAgent).mock.calls[0][0] as string
    expect(system).toMatch(/not specified/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/critics.test.ts -t "which lenses run"`
Expected: FAIL — `runCritics` takes 2 arguments.

- [ ] **Step 3: Make the envelope role-aware**

`SHARED_ENVELOPE` becomes a function of the role. Replace the opening line:

```ts
function sharedEnvelope(role: FunnelStepRole | null): string {
  const def = getRole(role)
  // STATED EITHER WAY — a critic told nothing about the page's job invents one,
  // and the one it invents is "landing page", which is what this fixes.
  const situation =
    def === null
      ? "Its role is not specified: treat it as a pitch or capture page."
      : `Its role is ${def.value}. ${def.brief}`

  return `
You are reviewing one page of a marketing funnel for a strength-and-conditioning
coaching business. ${situation}

The page is a TYPED DOCUMENT, not HTML: each section has a kind, a variant, four
style knobs (headline size, align, tone, pad) and typed props.
${/* ...the rest of the existing envelope, unchanged... */ ""}`.trim()
}
```

Keep every other line of the envelope exactly as it is — the finding shape, the
ten kinds, the empty-list instruction and the stay-in-your-lane instruction are
all role-neutral and all load-bearing.

- [ ] **Step 4: Tag the lenses and filter**

```ts
export interface CriticLens {
  source: Exclude<FindingSource, "audit">
  label: string
  /**
   * The roles this lens is worth running on.
   *
   * `conversion` is excluded from `confirmation` and that exclusion is the
   * point: its brief tells it to weigh what is MISSING as heavily as what is
   * present, so pointed at a thank-you page it reports a missing offer, price
   * and CTA — and the reviser dutifully adds all three, rebuilding the exact
   * landing page the role was introduced to prevent.
   *
   * `art` and `copy` run on everything. A confirmation page can still be flat
   * and still be badly written.
   */
  roles: readonly FunnelStepRole[]
  /** Built per role, because the envelope names the role. */
  system: (role: FunnelStepRole | null) => string
}
```

`CRITICS` gains `roles: ROLE_VALUES` on art and copy (imported from
`@/lib/funnels/roles` — **not** the `ALL_ROLES` local in `prompt.ts`, which is
private to that module and must not be reached across), and
`roles: ["pitch", "capture", "checkout", "booking"]` on conversion. Each
`system` becomes `(role) => \`${sharedEnvelope(role)}\n\n...lens text...\``.

`runCritics` filters:

```ts
export async function runCritics(
  doc: SectionDoc,
  auditFindings: Finding[],
  role: FunnelStepRole | null,
): Promise<CriticPanelResult> {
  const message = userMessage(doc, auditFindings)
  // A null role runs EVERY lens. It means "unspecified", which is the
  // pre-roles behaviour, and the pre-roles behaviour ran all three.
  const lenses = role === null ? CRITICS : CRITICS.filter((critic) => critic.roles.includes(role))
```

and the `settled` loop maps over `lenses`, with the failure log reading
`lenses[index].source` — **not `CRITICS[index].source`**, which would name the
wrong critic once the list is filtered.

- [ ] **Step 5: Thread it through the pipeline and the route**

`ReviewInput` gains `role: FunnelStepRole | null` (required — one caller).
`runReview(doc, role, onFinding)` passes it to `runCritics`.
The build route's `reviewDoc({ ... })` call gains `role: context.role`.

- [ ] **Step 6: Run the review suites**

Run: `npx vitest run __tests__/lib/funnels/sections/review/`
Expected: PASS. `pipeline.test.ts` and `pipeline-rounds.test.ts` mock
`runCritics`, so their `reviewDoc({ doc: PROD })` calls need `role` added —
tsc will list them.

Add one pipeline test:

```ts
  it("hands the critics the role it was given", async () => {
    runCritics.mockResolvedValue({ findings: [], tokensUsed: 0 })
    await reviewDoc({ doc: PROD, role: "checkout" })
    expect(runCritics).toHaveBeenCalledWith(PROD, expect.anything(), "checkout")
  })
```

- [ ] **Step 7: Build gate, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — read it, confirm ≤258.

```bash
git add lib/funnels/sections/review/ "app/api/admin/funnels/steps/[stepId]/build/route.ts" \
        __tests__/lib/funnels/sections/review/
git commit -m "feat(funnels): stop asking a thank-you page why it does not convert"
```

---

### Task 6: The control — setting a role

**Files:**
- Modify: `components/admin/funnels/AddStepDialog.tsx` (role select)
- Modify: `components/admin/funnels/StepRail.tsx` (role label per row; select on the current row)
- Modify: `components/admin/funnels/connections-context.tsx` (`RailPage.role`)
- Modify: `app/(admin)/admin/funnels/[id]/edit/layout.tsx` (supply `role` to the rail)
- Test: `__tests__/components/admin/funnels/step-role-control.test.tsx`

**Interfaces:**
- Consumes: `FUNNEL_STEP_ROLES`, `getRole` (Task 1); `updateStepSchema.role` (Task 2).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/funnels/step-role-control.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FUNNEL_STEP_ROLES } from "@/lib/funnels/roles"

// Follow the mocking style already used by the other component tests in
// __tests__/components/admin/funnels/ — read one before writing this.

describe("the role control on the step rail", () => {
  it("offers every role the registry knows and no others", async () => {
    renderRail({ currentRole: "pitch" })
    await userEvent.click(screen.getByRole("button", { name: /role/i }))
    for (const role of FUNNEL_STEP_ROLES) {
      expect(screen.getByRole("option", { name: new RegExp(role.label, "i") })).toBeInTheDocument()
    }
  })

  it("offers 'not specified' so a role can be cleared", async () => {
    // A stored role that cannot be unset is a one-way door: an owner who picks
    // wrong has no way back to the default behaviour.
    renderRail({ currentRole: "pitch" })
    await userEvent.click(screen.getByRole("button", { name: /role/i }))
    expect(screen.getByRole("option", { name: /not specified/i })).toBeInTheDocument()
  })

  it("PATCHes the step when a role is chosen", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    renderRail({ currentRole: null, stepId: "step-1" })

    await userEvent.click(screen.getByRole("button", { name: /role/i }))
    await userEvent.click(screen.getByRole("option", { name: /confirmation/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/funnels/steps/step-1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "confirmation" }) }),
      )
    })
  })

  it("shows a read-only role label on rows that are not the current page", () => {
    // The rail exists to answer "is this connected?" by looking. "What is each
    // page for?" is the same question about the same object — but a select on
    // every row is noise on pages the owner is not working on.
    renderRail({ currentRole: "pitch", siblingRole: "confirmation" })
    expect(screen.getByText(/confirmation/i)).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /role/i })).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/admin/funnels/step-role-control.test.tsx`
Expected: FAIL — no role control exists.

- [ ] **Step 3: Carry the role on `RailPage`**

In `components/admin/funnels/connections-context.tsx`, add
`role: FunnelStepRole | null` to `RailPage`, and supply it in
`app/(admin)/admin/funnels/[id]/edit/layout.tsx` where the rail pages are built
from `listSteps` (the rows already carry `role` — `listSteps` does `select("*")`).

- [ ] **Step 4: Render the label and the select**

In `StepRail.tsx`, next to the existing `StatusPill`:

```tsx
/**
 * What the page is for, on its row.
 *
 * Read-only on every row EXCEPT the one the owner is currently editing, where
 * it becomes a select. A select on every row would put five dropdowns in a
 * 220px rail to change a value that is right by default.
 */
function RoleLabel({ role }: { role: FunnelStepRole | null }) {
  const def = getRole(role)
  if (!def) return null
  return (
    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {def.label}
    </span>
  )
}
```

Use the shadcn `Select` from `components/ui/select` for the editable one, with
`aria-label="Role"` so the test's `name: /role/i` finds it, and a
`"not specified"` option carrying the empty string that maps to `null` in the
PATCH body. On success call `router.refresh()` so the rail and the next build
turn both see the new value.

- [ ] **Step 5: Add the select to `AddStepDialog`**

Same options, same "not specified" default, included in the create body. A step
added by hand otherwise has no role forever, and the owner adding it is the one
person who knows what it is for.

- [ ] **Step 6: Run the component tests**

Run: `npx vitest run __tests__/components/admin/funnels/`
Expected: PASS.

- [ ] **Step 7: Build gate, then commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — read it, confirm ≤258.

```bash
git add components/admin/funnels/ "app/(admin)/admin/funnels/[id]/edit/layout.tsx" \
        __tests__/components/admin/funnels/step-role-control.test.tsx
git commit -m "feat(funnels): the owner can say what a page is for"
```

---

### Task 7: `PAGE_EXAMPLES`, written as pages

**Files:**
- Modify: `lib/funnels/examples.ts` (`PAGE_EXAMPLES`)
- Test: `__tests__/lib/funnels/examples.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/lib/funnels/examples.test.ts`:

```ts
describe("page examples are not funnel examples", () => {
  it("shares no name, slug or audience with any funnel example", () => {
    // THE REPORTED BUG. Four of five page examples had the same name, the same
    // slug and a CHARACTER-IDENTICAL audience as their funnel counterpart, and
    // the reason it survived is that every existing test here checks a page
    // example against the VALIDATOR rather than against the funnel set.
    //
    // It matters past the modal: "Start from this" writes `description` into
    // the create dialog, and that description is the brief every step builds
    // from. Identical examples guarantee identical first drafts.
    const funnelNames = new Set(FUNNEL_EXAMPLES.map((e) => e.name.toLowerCase()))
    const funnelSlugs = new Set(FUNNEL_EXAMPLES.map((e) => e.slug))
    const funnelAudiences = new Set(FUNNEL_EXAMPLES.map((e) => e.audience.toLowerCase()))

    for (const example of PAGE_EXAMPLES) {
      expect(funnelNames, example.name).not.toContain(example.name.toLowerCase())
      expect(funnelSlugs, example.slug).not.toContain(example.slug)
      expect(funnelAudiences, example.name).not.toContain(example.audience.toLowerCase())
    }
  })

  it("shares no description with any funnel example", () => {
    // Reworded-not-rethought is how the current set was produced. Compare on
    // normalised prose so a comma cannot pass as a difference.
    const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    const funnelDescriptions = new Set(FUNNEL_EXAMPLES.map((e) => norm(e.description)))
    for (const example of PAGE_EXAMPLES) {
      expect(funnelDescriptions, example.name).not.toContain(norm(example.description))
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/examples.test.ts -t "not funnel examples"`
Expected: FAIL on four of five entries.

- [ ] **Step 3: Rewrite `PAGE_EXAMPLES`**

Five new entries, one per `FUNNEL_GOALS` value, each a page that could not be a
funnel. Keep `description` between 121 and 500 characters and `audience` at 300
or under (existing tests assert both). `whyItWorks` over 30 characters.

The guiding difference to write into each: a funnel splits a job across pages,
so a page example must make the trade-off of doing it in one place visible.

```ts
export const PAGE_EXAMPLES = [
  {
    goal: "leads",
    name: "Coach Waitlist",
    slug: "coach-waitlist",
    audience: "Parents who called about a full squad and have nowhere to be put",
    description:
      "The squad is full and this page is where the next enquiry goes instead of into an inbox. Ask for name, email, the athlete's age and their sport — four fields, because a waitlist that asks ten gets none. Say plainly how many are ahead of them and when a place is likely. No payment, no promise of a date.",
    whyItWorks:
      "It replaces the sentence a coach would otherwise type forty times, and it says the queue length out loud instead of hoping nobody asks.",
  },
  {
    goal: "booking",
    name: "Return-to-Sport Screen",
    slug: "return-to-sport-screen",
    audience: "Athletes cleared by a physio who do not know whether they are ready to compete",
    description:
      "A forty-minute in-person screen for someone coming back from injury. Write for the athlete, not the parent. Cover what gets tested, what the report says, and that it is not treatment and not a substitute for their physio. The visitor is anxious, not shopping — reassurance beats persuasion on this page.",
    whyItWorks:
      "The reader is frightened rather than undecided, so the page answers 'is this going to hurt' before it answers 'what does it cost'.",
  },
  {
    goal: "program",
    name: "In-Season Maintenance",
    slug: "in-season-maintenance",
    audience: "Athletes mid-season who already train with us and are being asked to add nothing",
    description:
      "A two-day-a-week programme for athletes in competition, sold to people who already know the coaching. It is a smaller ask, not a bigger one, and the page should feel like it: what gets kept, what gets dropped, and how it fits around fixtures. Do not re-explain the business — they know it.",
    whyItWorks:
      "It is written for someone already inside, so it opens at the detail an outsider page would have to spend four sections earning.",
  },
  {
    goal: "session_pack",
    name: "Six Before Trials",
    slug: "six-before-trials",
    audience: "Players with a trial or selection date inside the next two months",
    description:
      "Six sessions used before a fixed date, sold on the deadline rather than on flexibility. Ask for the trial date and say plainly that six sessions will sharpen what is there and will not rebuild anything. The honesty is the offer — a page promising transformation in six weeks sells one pack and no second one.",
    whyItWorks:
      "It names what six sessions cannot do, which is the only claim on the page a sceptical parent will believe.",
  },
  {
    goal: "event",
    name: "Parents' Evening",
    slug: "parents-evening",
    audience: "Parents of squad athletes, who are being invited rather than sold to",
    description:
      "A free ninety-minute evening on load, sleep and what to do when a coach and a club disagree. Nothing is being sold, so nothing on the page should read as selling: date, venue, parking, what gets covered, and a form for numbers. The tone is a club noticeboard, not a campaign.",
    whyItWorks:
      "A free invitation written in campaign language reads as a trap, so this one deliberately drops urgency, proof and pricing entirely.",
  },
] as const satisfies readonly PageExample[]
```

Also update the LANDING PAGES header comment in that file to say what now keeps
the two sets apart — the old comment claimed the separation that did not exist:

```
// The test asserts no page example shares a name, slug, audience or description
// with a funnel example. That assertion exists because the first version of
// this list WAS the funnel list reworded, and nothing here caught it: every
// other test checks a page example against the validator, never against the
// funnel set.
```

- [ ] **Step 4: Run the examples suite**

Run: `npx vitest run __tests__/lib/funnels/examples.test.ts`
Expected: PASS, including the pre-existing length, slug-pattern and
goal-coverage assertions.

- [ ] **Step 5: Run the dialog test that counts the cards**

Run: `npx vitest run __tests__/components/admin/page-create-assist.test.tsx`
Expected: PASS — it asserts `PAGE_EXAMPLES.length`, which is still 5.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/examples.ts __tests__/lib/funnels/examples.test.ts
git commit -m "feat(funnels): a page example teaches what one page can carry alone"
```

---

## Final verification

- [ ] `npx vitest run __tests__/lib/funnels/ __tests__/app/api/admin/funnels/ __tests__/components/admin/funnels/ __tests__/lib/db/funnel-step-role-support.test.ts`
- [ ] `npx tsc --noEmit 2>&1 | grep -c "error TS"` — must be ≤258. Read the
      number; do not chain it to anything.
- [ ] `npx tsx -e "import {SECTION_BUILDER_BLOCK_A} from './lib/funnels/sections/prompt.ts'; console.log(SECTION_BUILDER_BLOCK_A.length)"`
      — expect ~13,900, comfortably under 16,000.
- [ ] Confirm no `role` value reaches the prompt as a UUID and Block B still
      passes its no-ids test.
