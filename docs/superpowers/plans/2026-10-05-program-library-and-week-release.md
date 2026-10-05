# Program Library and Weekly Week-Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coaches keep ready-made programs in library folders and give a client their own copy, and that
copy releases one week every 7 days while the client's access is running. Hidden weeks never reach the
client's browser.

**Architecture:**
- A library program is an ordinary `programs` row with `is_template = true` and a required folder in the
  new `program_folders` table, which is tenant-scoped.
- "Give to client" deep-copies the row (`copyProgram`) and assigns the copy.
- Weekly release is two columns on `program_assignments` (`release_base_week`, `release_anchor_at`) plus a
  per-week `visibility` override on `program_week_access`.
- A DB trigger pauses and resumes the clock on every status or payment change.
- One pure module, `lib/programs/week-visibility.ts`, decides what a client may see. It is used by the
  workouts page and by the access guard on the workout routes.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + PostgREST, Zod 4, Vitest, shadcn/ui, Stripe.

**Spec:** `docs/superpowers/specs/2026-10-05-program-library-and-week-release-design.md`. Read it first. It
records why each choice was made.

## Global Constraints

- **Work only in** `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/program-library`
  (branch `worktree-program-library`).
  - Use absolute paths.
  - Never `cd` into the main checkout.
  - Never use bare `git stash`.
- **Node:** the shell default node is 20, and vitest refuses it. Prefix every vitest, tsc and npm command
  with `PATH=/opt/homebrew/bin:$PATH` (node 26 there).
- **Tests are targeted by FILE.** Name the files. Never sweep a directory and never run the full suite.
  - Command: `PATH=/opt/homebrew/bin:$PATH npx vitest run <file> [<file>...]`
- **Type gate:** `PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit 2>&1 | grep -c "error TS"`.
  - It must equal the baseline recorded in Task 0.
  - `grep` the output for your own files: there must be zero errors in them.
- **Commits:** plain conventional messages. **NO `Co-Authored-By` trailer and no tool attribution of any
  kind.** Never stage `JOURNAL.md` or anything under `screenshots/` until Task 11.
- **Migration:** `00288` only. Apply it to the **dev clone `anjvztjiokcgiyhobknq` only**, never to prod
  (`epzuvzkokzqtzomeyoha`). Prod applies itself on push to `main`.
- **Never add a `SINGLETON_BUSINESS_ID` reference.** Tenant ids come from `resolveAdminTenant()`
  (server components) or `resolveAdminTenantForRequest(request)` (route handlers), both in
  `@/lib/tenancy/resolve`.
- **New DB-defaulted fields on row types are optional** (`?:`), so existing insert payloads and test
  fixtures keep compiling. Read them as `x ?? default`.
- **Admin tables use `components/ui/data-table.tsx`.** Admin is light-only: no dark styles.
- **User-facing copy** is for a coach or athlete, not a programmer:
  - short sentences
  - no "visibility", "schedule state", "template" or "assignment" in client-facing text
  - "library program" is fine for the coach
- **Next.js route files may export only HTTP handlers and route config.** Put helpers in `lib/`.

## Review Focus

These are the failure modes the spec implies that people will hit first. Each one is pinned by a test in
the task named.

1. **A client given a program with a future start date** still sees their opening weeks before that
   date. They must not see nothing. (Task 2: "never drops below base while the anchor is in the future".)
2. **A coach turns weekly release on for a client already in week 5.** The client keeps weeks 1-5 and is
   not dropped back to week 1. (Task 10: "starts the schedule from the client's current week".)
3. **A paid week that hasn't been released yet** shows no price and no "Unlock" button: a client can't
   pay for a week that isn't out. (Task 2: "a scheduled paid week is unavailable, not locked".)
4. **Changing a library program's price after giving it away** must not break the client's checkout.
   Copies never carry Stripe ids, and a paid copy gets its own. (Task 5: "nulls Stripe ids"; Task 8:
   "creates a fresh Stripe price for a paid copy".)
5. **Deleting a folder that still holds programs** gets a plain refusal, not a 500. (Task 7: "refuses to
   delete a folder that still holds programs".)

---

### Task 0: Worktree setup and baselines

**Files:** none committed.

- [ ] **Step 1: Link dependencies and env from the main checkout**

```bash
ln -s "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/node_modules" node_modules
cp "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.env.local" .env.local
grep -c "anjvztjiokcgiyhobknq" .env.local
grep -c "^SUPABASE_ACCESS_TOKEN=" .env.local
```
Expected:
- both counts ≥ 1. If `SUPABASE_ACCESS_TOKEN` is 0, stop and ask the owner.
- `.env.local` must point at the clone, never prod.

- [ ] **Step 2: Record the tsc baseline**

Run: `PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: a number (the journal says 236 on 2026-10-03). Write it into the task report as
`TSC_BASELINE=<n>`. Every later task compares against it.

- [ ] **Step 3: Write the clone SQL runner (scratch, not committed)**

Create `/private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/87d95ad7-d03b-4748-a1f1-73253078e34a/scratchpad/clone-sql.mjs`:

```js
// Runs one .sql file against the DEV CLONE only. Refuses anything else.
import { readFileSync } from "node:fs"

const CLONE = "anjvztjiokcgiyhobknq"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!url.includes(CLONE)) {
  console.error(`refusing: .env.local points at ${url}, not the dev clone`)
  process.exit(1)
}
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is missing from .env.local")
  process.exit(1)
}
const res = await fetch(`https://api.supabase.com/v1/projects/${CLONE}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: readFileSync(process.argv[2], "utf8") }),
})
console.log(res.status, await res.text())
if (!res.ok) process.exit(1)
```

Usage, from the worktree root:
`/opt/homebrew/bin/node -r dotenv/config <scratchpad>/clone-sql.mjs <file.sql> dotenv_config_path=.env.local dotenv_config_quiet=true`

---

### Task 1: Migration 00288, row types, applied to the dev clone

**Files:**
- Create: `supabase/migrations/00288_program_library_and_week_release.sql`
- Modify: `types/database.ts` (`Program` ~L408, `ProgramAssignment` ~L462, `ProgramWeekAccess` ~L479)
- Modify: `lib/db/week-access.ts` (the two `updateWeekAccess*` `Pick` lists)
- Scratch: `<scratchpad>/probe-00288.sql`

**Interfaces:**
- Produces, as DB objects:
  - table `program_folders`
  - columns `programs.is_template`, `programs.folder_id`
  - columns `program_assignments.release_base_week`, `program_assignments.release_anchor_at`
  - column `program_week_access.visibility`
  - function and trigger `program_assignment_release_clock`
- Produces, as types: `ProgramFolder`, `WeekVisibility = "auto" | "shown" | "hidden"`, plus the optional
  fields `Program.is_template?`, `Program.folder_id?`, `ProgramAssignment.release_base_week?`,
  `ProgramAssignment.release_anchor_at?` and `ProgramWeekAccess.visibility?`.

- [ ] **Step 1: Write the migration**

```sql
-- 00288_program_library_and_week_release.sql
--
-- Program library (folders of ready-made programs) and weekly week-release.
-- Spec: docs/superpowers/specs/2026-10-05-program-library-and-week-release-design.md
--
-- Additive. Every existing assignment keeps release_base_week NULL, meaning
-- "no schedule, every week visible" (today's behaviour), and the release-clock
-- trigger does nothing for such a row. Safe under the code that predates it.

CREATE TABLE public.program_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_folders_business_name_key
  ON public.program_folders (business_id, lower(btrim(name)));
-- Service-role DAL only (lib/db/program-folders.ts); no policies.
ALTER TABLE public.program_folders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.program_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- A library program ("template") is never sold or assigned directly; "Give to
-- client" copies it. Every template lives in a folder, and the folder carries
-- the tenant, so the library is tenant-scoped although programs is not (G37).
-- RESTRICT: a folder that still holds programs cannot be deleted.
ALTER TABLE public.programs
  ADD COLUMN is_template boolean NOT NULL DEFAULT false,
  ADD COLUMN folder_id uuid REFERENCES public.program_folders(id) ON DELETE RESTRICT;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_template_never_public CHECK (NOT (is_template AND is_public)),
  ADD CONSTRAINT programs_template_has_folder CHECK (
    (is_template AND folder_id IS NOT NULL) OR (NOT is_template AND folder_id IS NULL)
  );
CREATE INDEX programs_folder_id_idx ON public.programs (folder_id) WHERE folder_id IS NOT NULL;

-- Weekly release. release_base_week NULL = no schedule (every week visible).
-- Otherwise weeks 1..base were released before release_anchor_at, and one more
-- week is released every 7 days after it. Anchor NULL with a base = paused.
ALTER TABLE public.program_assignments
  ADD COLUMN release_base_week integer CHECK (release_base_week >= 1),
  ADD COLUMN release_anchor_at timestamptz;

-- Coach override per week: 'auto' follows the schedule, 'shown' opens early,
-- 'hidden' closes it whatever the schedule says.
ALTER TABLE public.program_week_access
  ADD COLUMN visibility text NOT NULL DEFAULT 'auto'
    CHECK (visibility IN ('auto', 'shown', 'hidden'));

-- The release clock runs only while the assignment is "running": active and
-- not awaiting payment. Every status/payment writer (Stripe webhook, admin
-- PATCH, funnel grant) goes through this trigger, so none of them has to
-- remember to pause or resume the clock.
--
-- TWIN: lib/programs/week-visibility.ts releasedThroughWeek() uses the same
-- formula (base + whole weeks since the anchor, never negative). Change both.
CREATE OR REPLACE FUNCTION public.program_assignment_release_clock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  was_running boolean;
  is_running boolean;
BEGIN
  IF NEW.release_base_week IS NULL THEN
    RETURN NEW;
  END IF;

  is_running := NEW.status = 'active' AND NEW.payment_status <> 'pending';

  IF TG_OP = 'INSERT' THEN
    -- Given while payment is pending: the clock starts when they pay.
    IF NOT is_running THEN
      NEW.release_anchor_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  was_running := OLD.status = 'active' AND OLD.payment_status <> 'pending';

  IF was_running AND NOT is_running AND OLD.release_anchor_at IS NOT NULL THEN
    -- Freeze: keep what was released, stop the clock. A client who cancels
    -- after week 1 and returns months later resumes at week 2, not week 9.
    NEW.release_base_week := NEW.release_base_week
      + greatest(0, floor(extract(epoch FROM (now() - OLD.release_anchor_at)) / 604800))::integer;
    NEW.release_anchor_at := NULL;
  ELSIF NOT was_running AND is_running AND NEW.release_anchor_at IS NULL THEN
    NEW.release_anchor_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER program_assignment_release_clock
  BEFORE INSERT OR UPDATE OF status, payment_status ON public.program_assignments
  FOR EACH ROW EXECUTE FUNCTION public.program_assignment_release_clock();
```

- [ ] **Step 2: Apply to the dev clone**

Run:
`/opt/homebrew/bin/node -r dotenv/config <scratchpad>/clone-sql.mjs supabase/migrations/00288_program_library_and_week_release.sql dotenv_config_path=.env.local dotenv_config_quiet=true`
Expected: `201 []`, or another 2xx status. Any 4xx: read the message, fix the SQL, and re-run. The DDL is
not re-runnable once it has partly applied, so on a partial failure drop the objects that did get
created before re-running.

- [ ] **Step 3: Probe the trigger and constraints (rolled back by design)**

Create `<scratchpad>/probe-00288.sql`:

```sql
DO $$
DECLARE
  p uuid;
  u uuid;
  a public.program_assignments%ROWTYPE;
BEGIN
  SELECT pr.id, us.id INTO p, u
  FROM public.programs pr CROSS JOIN public.users us
  WHERE NOT EXISTS (
    SELECT 1 FROM public.program_assignments pa WHERE pa.program_id = pr.id AND pa.user_id = us.id
  )
  LIMIT 1;

  -- 1. Given while payment is pending: the anchor is cleared.
  INSERT INTO public.program_assignments
    (program_id, user_id, start_date, status, payment_status, current_week, release_base_week, release_anchor_at)
  VALUES (p, u, current_date, 'active', 'pending', 1, 1, now())
  RETURNING * INTO a;
  ASSERT a.release_anchor_at IS NULL, 'pending insert kept its anchor';

  -- 2. Payment arrives: the clock starts.
  UPDATE public.program_assignments SET payment_status = 'paid' WHERE id = a.id RETURNING * INTO a;
  ASSERT a.release_anchor_at IS NOT NULL, 'paid update did not start the clock';

  -- 3. 15 days later they cancel: frozen at 1 + 2 = 3.
  UPDATE public.program_assignments SET release_anchor_at = now() - interval '15 days' WHERE id = a.id;
  UPDATE public.program_assignments SET status = 'cancelled' WHERE id = a.id RETURNING * INTO a;
  ASSERT a.release_base_week = 3 AND a.release_anchor_at IS NULL,
    format('freeze wrong: base=%s anchor=%s', a.release_base_week, a.release_anchor_at);

  -- 4. They come back: resume from 3 with a fresh anchor.
  UPDATE public.program_assignments SET status = 'active' WHERE id = a.id RETURNING * INTO a;
  ASSERT a.release_base_week = 3 AND a.release_anchor_at > now() - interval '1 minute', 'resume wrong';

  -- 5. A row with no schedule is never touched.
  UPDATE public.program_assignments SET release_base_week = NULL, release_anchor_at = NULL WHERE id = a.id;
  UPDATE public.program_assignments SET status = 'cancelled' WHERE id = a.id RETURNING * INTO a;
  ASSERT a.release_base_week IS NULL AND a.release_anchor_at IS NULL, 'unscheduled row was touched';

  -- 6. A template must have a folder.
  BEGIN
    UPDATE public.programs SET is_template = true WHERE id = p;
    RAISE EXCEPTION 'template without a folder was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE EXCEPTION 'PROBE PASSED (rolled back)';
END $$;
```

Run: `/opt/homebrew/bin/node -r dotenv/config <scratchpad>/clone-sql.mjs <scratchpad>/probe-00288.sql dotenv_config_path=.env.local dotenv_config_quiet=true`
Expected: a non-2xx status whose body contains exactly `PROBE PASSED (rolled back)`. Any other message
(an `ASSERT` text, or "template without a folder was accepted") is a failure: fix the migration and
re-apply. The final `RAISE` rolls back every probe write.

- [ ] **Step 4: Add the row types**

In `types/database.ts`, next to `ProgramWeekAccess`:

```ts
/** Coach override for one client's week. 'auto' follows the weekly release schedule. */
export type WeekVisibility = "auto" | "shown" | "hidden"

export interface ProgramFolder {
  id: string
  business_id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}
```

In `interface Program`, after `ai_generation_params`:

```ts
  /**
   * Library program: never assigned or sold directly — "Give to client" copies it.
   * DB default false; optional so insert payloads and fixtures may omit it.
   */
  is_template?: boolean
  /** The library folder. Set exactly when is_template (DB check programs_template_has_folder). */
  folder_id?: string | null
```

In `interface ProgramAssignment`, after `expires_at`:

```ts
  /**
   * Weekly release. null = no schedule, every week visible (every assignment made before 00288).
   * Otherwise weeks 1..base were released before release_anchor_at; one more every 7 days after.
   */
  release_base_week?: number | null
  /** When the release clock last (re)started; null = paused. A DB trigger maintains it on status/payment changes. */
  release_anchor_at?: string | null
```

In `interface ProgramWeekAccess`, after `stripe_payment_id`:

```ts
  /** DB default 'auto'; optional so insert payloads may omit it. */
  visibility?: WeekVisibility
```

In `lib/db/week-access.ts`, add `"visibility"` to the `Pick<...>` key list of both `updateWeekAccess`
and `updateWeekAccessByAssignmentAndWeek`:

```ts
    Pick<
      ProgramWeekAccess,
      "access_type" | "price_cents" | "payment_status" | "stripe_session_id" | "stripe_payment_id" | "visibility"
    >
```

- [ ] **Step 5: Drift and select gates on the clone**

Run:
- `PATH=/opt/homebrew/bin:$PATH npm run test:integration:drift`
- `PATH=/opt/homebrew/bin:$PATH npm run test:integration:selects`

Expected: both PASS. The drift test must see `program_assignment_release_clock` matching the migration.
If it reports the function as unknown or different, read its output before touching the ratchet lists.

- [ ] **Step 6: Type gate**

Run: `PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: equals `TSC_BASELINE`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00288_program_library_and_week_release.sql types/database.ts lib/db/week-access.ts
git commit -m "feat(programs): schema for the program library and weekly week release"
```

---

### Task 2: The visibility rule (pure)

**Files:**
- Create: `lib/programs/week-visibility.ts`
- Test: `__tests__/lib/programs/week-visibility.test.ts`

**Interfaces:**
- Consumes: `ProgramAssignment`, `ProgramWeekAccess`, `WeekVisibility` (Task 1)
- Produces:
  - `type ReleaseFields = Pick<ProgramAssignment, "release_base_week" | "release_anchor_at">`
  - `releasedThroughWeek(a: ReleaseFields, now: Date): number | null`
  - `type WeekState = "visible" | "scheduled" | "hidden"`
  - `weekState(week: number, a: ReleaseFields, visibility: WeekVisibility | undefined, now: Date): WeekState`
  - `unlockDate(week: number, a: ReleaseFields): Date | null`
  - `interface WeekGate { open: Set<number>; locked: Record<number, { priceCents: number }>; unavailable: Record<number, { unlocksOn: string | null }> }`
  - `buildWeekGate(a: ReleaseFields, rows: WeekAccessFields[], totalWeeks: number, now: Date): WeekGate`
  - `formatUnlockDate(iso: string): string`, e.g. `"Monday, October 19"`
  - `releaseAnchorFor(startDate: string, now: Date): string` (ISO)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import {
  releasedThroughWeek,
  weekState,
  unlockDate,
  buildWeekGate,
  formatUnlockDate,
  releaseAnchorFor,
} from "@/lib/programs/week-visibility"

const DAY = 24 * 60 * 60 * 1000
const anchor = new Date("2026-10-05T10:00:00Z") // a Monday
const at = (days: number) => new Date(anchor.getTime() + days * DAY)
const sched = { release_base_week: 1, release_anchor_at: anchor.toISOString() }
const noSched = { release_base_week: null, release_anchor_at: null }

type Row = {
  week_number: number
  access_type: "included" | "paid"
  payment_status: "not_required" | "pending" | "paid"
  price_cents: number | null
  visibility?: "auto" | "shown" | "hidden"
}
const row = (week_number: number, extra: Partial<Row> = {}): Row => ({
  week_number,
  access_type: "included",
  payment_status: "not_required",
  price_cents: null,
  visibility: "auto",
  ...extra,
})

describe("releasedThroughWeek", () => {
  it("is null without a schedule — every assignment made before 00288", () => {
    expect(releasedThroughWeek(noSched, at(100))).toBeNull()
  })
  it("releases one more week on each 7th day after the anchor, not before", () => {
    expect(releasedThroughWeek(sched, at(0))).toBe(1)
    expect(releasedThroughWeek(sched, at(6.99))).toBe(1)
    expect(releasedThroughWeek(sched, at(7))).toBe(2)
    expect(releasedThroughWeek(sched, at(21))).toBe(4)
  })
  it("starts from the base the coach chose", () => {
    expect(releasedThroughWeek({ ...sched, release_base_week: 3 }, at(7))).toBe(4)
  })
  it("never drops below base while the anchor is in the future (a later start date)", () => {
    expect(releasedThroughWeek({ release_base_week: 2, release_anchor_at: at(3).toISOString() }, at(0))).toBe(2)
  })
  it("holds at base while paused (no anchor), however long", () => {
    expect(releasedThroughWeek({ release_base_week: 2, release_anchor_at: null }, at(365))).toBe(2)
  })
})

describe("weekState", () => {
  it("hidden always wins, even for a released week and with no schedule", () => {
    expect(weekState(1, sched, "hidden", at(30))).toBe("hidden")
    expect(weekState(1, noSched, "hidden", at(0))).toBe("hidden")
  })
  it("shown opens a week the schedule has not reached", () => {
    expect(weekState(5, sched, "shown", at(0))).toBe("visible")
  })
  it("auto (or missing) follows the schedule", () => {
    expect(weekState(1, sched, "auto", at(0))).toBe("visible")
    expect(weekState(2, sched, "auto", at(0))).toBe("scheduled")
    expect(weekState(2, sched, undefined, at(7))).toBe("visible")
  })
  it("auto with no schedule is visible (today's behaviour)", () => {
    expect(weekState(12, noSched, "auto", at(0))).toBe("visible")
  })
})

describe("unlockDate", () => {
  it("is the anchor plus (week - base) weeks", () => {
    expect(unlockDate(3, sched)?.toISOString()).toBe(at(14).toISOString())
  })
  it("is null when paused or unscheduled", () => {
    expect(unlockDate(3, { release_base_week: 1, release_anchor_at: null })).toBeNull()
    expect(unlockDate(3, noSched)).toBeNull()
  })
  it("agrees with releasedThroughWeek at the boundary", () => {
    const d = unlockDate(4, sched)!
    expect(releasedThroughWeek(sched, new Date(d.getTime() - 1))).toBe(3)
    expect(releasedThroughWeek(sched, d)).toBe(4)
  })
})

describe("buildWeekGate", () => {
  it("opens released weeks, dates scheduled ones, and gives a hidden one no date", () => {
    const gate = buildWeekGate(sched, [row(1), row(2), row(3, { visibility: "hidden" })], 4, at(0))
    expect([...gate.open]).toEqual([1])
    expect(gate.unavailable[2]).toEqual({ unlocksOn: at(7).toISOString() })
    expect(gate.unavailable[3]).toEqual({ unlocksOn: null })
    expect(gate.unavailable[4]).toEqual({ unlocksOn: at(21).toISOString() })
    expect(gate.locked).toEqual({})
  })
  it("locks a visible paid week without opening it", () => {
    const gate = buildWeekGate(
      noSched,
      [row(1), row(2, { access_type: "paid", payment_status: "pending", price_cents: 4000 })],
      2,
      at(0),
    )
    expect([...gate.open]).toEqual([1])
    expect(gate.locked).toEqual({ 2: { priceCents: 4000 } })
  })
  it("a scheduled paid week is unavailable, not locked — no price before it is out", () => {
    const gate = buildWeekGate(
      sched,
      [row(2, { access_type: "paid", payment_status: "pending", price_cents: 4000 })],
      2,
      at(0),
    )
    expect(gate.locked).toEqual({})
    expect(gate.unavailable[2]).toEqual({ unlocksOn: at(7).toISOString() })
  })
  it("a paused schedule gives scheduled weeks no date", () => {
    const gate = buildWeekGate({ release_base_week: 1, release_anchor_at: null }, [], 2, at(0))
    expect(gate.unavailable[2]).toEqual({ unlocksOn: null })
  })
  it("treats a week with no access row as included and auto", () => {
    expect([...buildWeekGate(noSched, [], 3, at(0)).open]).toEqual([1, 2, 3])
  })
})

describe("formatUnlockDate", () => {
  it("names the day in UTC so the server and the browser agree", () => {
    expect(formatUnlockDate("2026-10-19T23:30:00Z")).toBe("Monday, October 19")
  })
})

describe("releaseAnchorFor", () => {
  it("is the start date's midnight UTC when that is later than now", () => {
    expect(releaseAnchorFor("2026-10-12", at(0))).toBe("2026-10-12T00:00:00.000Z")
  })
  it("is now when the start date has passed", () => {
    expect(releaseAnchorFor("2026-10-01", at(0))).toBe(at(0).toISOString())
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/programs/week-visibility.test.ts`
Expected: FAIL, cannot resolve `@/lib/programs/week-visibility`.

- [ ] **Step 3: Implement**

```ts
// lib/programs/week-visibility.ts
//
// What a client may see of their program, week by week. Pure: the workouts
// page, the workout routes' access guard and the admin week panel all decide
// from these functions, so they cannot disagree.
import type { ProgramAssignment, ProgramWeekAccess, WeekVisibility } from "@/types/database"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type ReleaseFields = Pick<ProgramAssignment, "release_base_week" | "release_anchor_at">
type WeekAccessFields = Pick<
  ProgramWeekAccess,
  "week_number" | "access_type" | "payment_status" | "price_cents" | "visibility"
>

/**
 * The last week the release schedule has reached, or null when the assignment
 * has no schedule (every week visible).
 *
 * TWIN: program_assignment_release_clock() in
 * supabase/migrations/00288_program_library_and_week_release.sql freezes with
 * the same formula. Change both.
 */
export function releasedThroughWeek(a: ReleaseFields, now: Date): number | null {
  const base = a.release_base_week ?? null
  if (base == null) return null
  if (!a.release_anchor_at) return base
  const elapsed = now.getTime() - new Date(a.release_anchor_at).getTime()
  return base + Math.max(0, Math.floor(elapsed / WEEK_MS))
}

export type WeekState = "visible" | "scheduled" | "hidden"

export function weekState(
  week: number,
  a: ReleaseFields,
  visibility: WeekVisibility | undefined,
  now: Date,
): WeekState {
  const v = visibility ?? "auto"
  if (v === "hidden") return "hidden"
  if (v === "shown") return "visible"
  const released = releasedThroughWeek(a, now)
  return released == null || week <= released ? "visible" : "scheduled"
}

/** When `week` is released if the clock keeps running. Null when paused or unscheduled. */
export function unlockDate(week: number, a: ReleaseFields): Date | null {
  if (a.release_base_week == null || !a.release_anchor_at) return null
  return new Date(new Date(a.release_anchor_at).getTime() + (week - a.release_base_week) * WEEK_MS)
}

export interface WeekGate {
  /** Weeks whose workouts may be sent to the client. */
  open: Set<number>
  /** Visible paid weeks awaiting payment: the client gets the price (Unlock card), never the workouts. */
  locked: Record<number, { priceCents: number }>
  /** Weeks the client cannot see. unlocksOn is an ISO time for a scheduled week; null if hidden or paused. */
  unavailable: Record<number, { unlocksOn: string | null }>
}

export function buildWeekGate(
  a: ReleaseFields,
  rows: WeekAccessFields[],
  totalWeeks: number,
  now: Date,
): WeekGate {
  const byWeek = new Map(rows.map((r) => [r.week_number, r]))
  const gate: WeekGate = { open: new Set(), locked: {}, unavailable: {} }
  for (let w = 1; w <= totalWeeks; w++) {
    const row = byWeek.get(w)
    const state = weekState(w, a, row?.visibility, now)
    if (state !== "visible") {
      gate.unavailable[w] = {
        unlocksOn: state === "scheduled" ? (unlockDate(w, a)?.toISOString() ?? null) : null,
      }
    } else if (row && row.access_type === "paid" && row.payment_status === "pending") {
      gate.locked[w] = { priceCents: row.price_cents ?? 0 }
    } else {
      gate.open.add(w)
    }
  }
  return gate
}

/** "Monday, October 19". UTC, so a server render and the browser print the same day. */
export function formatUnlockDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** Where a new schedule's clock starts: the start date's midnight UTC, or now once that has passed. */
export function releaseAnchorFor(startDate: string, now: Date): string {
  const start = new Date(`${startDate}T00:00:00Z`)
  return (start > now ? start : now).toISOString()
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/programs/week-visibility.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Prove a test can fail.** Change `Math.max(0, …)` to drop the clamp and re-run: the
  "future anchor" test must go red. Restore it.

- [ ] **Step 6: Commit**

```bash
git add lib/programs/week-visibility.ts __tests__/lib/programs/week-visibility.test.ts
git commit -m "feat(programs): weekly release rule and per-client week gate"
```

---

### Task 3: Server-side week check on the workout routes

**Files:**
- Modify: `lib/services/access-guard.ts`
- Modify: `app/api/client/workouts/session/route.ts:20-21`
- Modify: `app/api/client/workouts/log/route.ts:46-52`
- Modify: `app/api/client/workouts/complete-week/route.ts:41-45`
- Test: `__tests__/lib/services/access-guard-weeks.test.ts`
- Test: `__tests__/api/client/workouts-week-gate.test.ts`

**Interfaces:**
- Consumes: `weekState` (Task 2)
- Produces: `assertAssignmentPayable(assignmentId: string, weekNumber?: number, now?: Date): Promise<AccessResult>`
  where `type AccessResult = { ok: true } | { ok: false; reason: "payment" | "not_released" }`.
  `isAccessAllowed` is unchanged.

- [ ] **Step 1: Write the failing guard test**

```ts
// __tests__/lib/services/access-guard-weeks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getAssignmentById = vi.fn()
const getWeekAccess = vi.fn()
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: (...a: unknown[]) => getAssignmentById(...a) }))
vi.mock("@/lib/db/week-access", () => ({ getWeekAccess: (...a: unknown[]) => getWeekAccess(...a) }))

import { assertAssignmentPayable } from "@/lib/services/access-guard"

const NOW = new Date("2026-10-05T10:00:00Z")
const scheduled = { payment_status: "paid", release_base_week: 1, release_anchor_at: NOW.toISOString() }
const included = { access_type: "included", payment_status: "not_required", visibility: "auto" }

beforeEach(() => {
  getAssignmentById.mockReset()
  getWeekAccess.mockReset()
})

describe("assertAssignmentPayable with a week", () => {
  it("refuses a week the schedule has not reached, as not_released", async () => {
    getAssignmentById.mockResolvedValue(scheduled)
    getWeekAccess.mockResolvedValue(included)
    expect(await assertAssignmentPayable("a1", 2, NOW)).toEqual({ ok: false, reason: "not_released" })
  })

  it("allows a released week (presence control for the refusal above)", async () => {
    getAssignmentById.mockResolvedValue(scheduled)
    getWeekAccess.mockResolvedValue(included)
    expect(await assertAssignmentPayable("a1", 1, NOW)).toEqual({ ok: true })
  })

  it("refuses a week the coach hid, even with no schedule", async () => {
    getAssignmentById.mockResolvedValue({ payment_status: "paid", release_base_week: null, release_anchor_at: null })
    getWeekAccess.mockResolvedValue({ ...included, visibility: "hidden" })
    expect(await assertAssignmentPayable("a1", 1, NOW)).toEqual({ ok: false, reason: "not_released" })
  })

  it("refuses a visible paid week awaiting payment, as payment", async () => {
    getAssignmentById.mockResolvedValue({ payment_status: "paid", release_base_week: null, release_anchor_at: null })
    getWeekAccess.mockResolvedValue({ access_type: "paid", payment_status: "pending", visibility: "auto" })
    expect(await assertAssignmentPayable("a1", 1, NOW)).toEqual({ ok: false, reason: "payment" })
  })

  it("refuses a pending assignment as payment before looking at the week", async () => {
    getAssignmentById.mockResolvedValue({ ...scheduled, payment_status: "pending" })
    getWeekAccess.mockResolvedValue(included)
    expect(await assertAssignmentPayable("a1", 5, NOW)).toEqual({ ok: false, reason: "payment" })
  })

  it("without a week, checks only the assignment", async () => {
    getAssignmentById.mockResolvedValue(scheduled)
    expect(await assertAssignmentPayable("a1")).toEqual({ ok: true })
    expect(getWeekAccess).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/services/access-guard-weeks.test.ts`
Expected: FAIL. `{ ok: true }` comes back where `not_released` is expected.

- [ ] **Step 3: Implement the guard.** Replace `assertAssignmentPayable` in `lib/services/access-guard.ts`
  and add the import:

```ts
import { weekState } from "@/lib/programs/week-visibility"

export type AccessResult = { ok: true } | { ok: false; reason: "payment" | "not_released" }

/**
 * Loads the assignment (and week, if given) and decides whether the client may
 * train it. A week the client cannot see — hidden by the coach, or not yet
 * released — is refused as `not_released`, so a client cannot log or start a
 * session in it by calling the route directly.
 */
export async function assertAssignmentPayable(
  assignmentId: string,
  weekNumber?: number,
  now: Date = new Date(),
): Promise<AccessResult> {
  const assignment = await getAssignmentById(assignmentId)
  if (assignment.payment_status === "pending") return { ok: false, reason: "payment" }
  const weekAccess = weekNumber != null ? await getWeekAccess(assignmentId, weekNumber) : null
  if (weekNumber != null && weekState(weekNumber, assignment, weekAccess?.visibility, now) !== "visible") {
    return { ok: false, reason: "not_released" }
  }
  return isAccessAllowed(assignment, weekAccess) ? { ok: true } : { ok: false, reason: "payment" }
}
```

- [ ] **Step 4: Run the guard test and the existing guard test**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/services/access-guard-weeks.test.ts __tests__/lib/services/access-guard.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Write the failing route test**

```ts
// @vitest-environment node
// __tests__/api/client/workouts-week-gate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const guardMock = vi.fn()
const ensureSessionMock = vi.fn()
const logProgressMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/services/access-guard", () => ({ assertAssignmentPayable: (...a: unknown[]) => guardMock(...a) }))
vi.mock("@/lib/db/workout-sessions", () => ({
  ensureSession: (...a: unknown[]) => ensureSessionMock(...a),
  setPrs: vi.fn(),
  finishSession: vi.fn(),
}))
vi.mock("@/lib/db/training-sessions", () => ({ upsert: vi.fn() }))
vi.mock("@/lib/db/progress", () => ({
  logProgress: (...a: unknown[]) => logProgressMock(...a),
  getProgress: vi.fn().mockResolvedValue([]),
  getWorkoutStreak: vi.fn().mockResolvedValue(0),
}))
vi.mock("@/lib/db/achievements", () => ({ createAchievement: vi.fn() }))
vi.mock("@/lib/db/exercises", () => ({ getExerciseById: vi.fn().mockResolvedValue({ name: "Squat" }) }))
vi.mock("@/lib/pr-detection", () => ({
  detectPRs: vi.fn().mockResolvedValue([]),
  checkStreakMilestones: vi.fn().mockResolvedValue(null),
  checkWorkoutMilestones: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn() }))

import { POST as sessionPOST } from "@/app/api/client/workouts/session/route"
import { POST as logPOST } from "@/app/api/client/workouts/log/route"

const ASSIGNMENT = "22222222-2222-4222-8222-222222222222"
const EXERCISE = "11111111-1111-1111-8111-111111111111"

function sessionReq(week_number: number) {
  return new Request("http://localhost/api/client/workouts/session", {
    method: "POST",
    body: JSON.stringify({ assignment_id: ASSIGNMENT, week_number, day_of_week: 1, session_date: "2026-10-05" }),
  })
}
function logReq(week_number: number) {
  return new Request("http://localhost/api/client/workouts/log", {
    method: "POST",
    body: JSON.stringify({
      exercise_id: EXERCISE,
      assignment_id: ASSIGNMENT,
      sets_completed: 3,
      reps_completed: "10",
      weight_kg: 60,
      set_details: [{ set_number: 1, weight_kg: 60, reps: 10 }],
      week_number,
      day_of_week: 1,
      session_date: "2026-10-05",
    }),
  })
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } })
  guardMock.mockReset()
  ensureSessionMock.mockReset().mockResolvedValue({ id: "ws-1", prs: null })
  logProgressMock.mockReset().mockResolvedValue({ id: "prog-1" })
})

describe("workout routes refuse a week the client cannot see", () => {
  it("session: 403 for an unreleased week, and nothing is created", async () => {
    guardMock.mockResolvedValue({ ok: false, reason: "not_released" })
    const res = await sessionPOST(sessionReq(4))
    expect(res.status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith(ASSIGNMENT, 4)
    expect(ensureSessionMock).not.toHaveBeenCalled()
  })

  it("session: 200 for a visible week (presence control)", async () => {
    guardMock.mockResolvedValue({ ok: true })
    expect((await sessionPOST(sessionReq(1))).status).toBe(200)
  })

  it("session: payment still answers 402", async () => {
    guardMock.mockResolvedValue({ ok: false, reason: "payment" })
    expect((await sessionPOST(sessionReq(1))).status).toBe(402)
  })

  it("log: 403 for an unreleased week, and nothing is logged", async () => {
    guardMock.mockResolvedValue({ ok: false, reason: "not_released" })
    const res = await logPOST(logReq(4))
    expect(res.status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith(ASSIGNMENT, 4)
    expect(logProgressMock).not.toHaveBeenCalled()
  })

  it("log: 201 for a visible week (presence control)", async () => {
    guardMock.mockResolvedValue({ ok: true })
    expect((await logPOST(logReq(1))).status).toBe(201)
  })
})
```

- [ ] **Step 6: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/api/client/workouts-week-gate.test.ts`
Expected: FAIL. The guard is called without the week, and a 402 comes back where a 403 is expected.

- [ ] **Step 7: Wire the routes**

`app/api/client/workouts/session/route.ts`, replace the two guard lines with:

```ts
    const access = await assertAssignmentPayable(assignment_id, week_number)
    if (!access.ok) {
      return access.reason === "not_released"
        ? NextResponse.json({ error: "This week isn't available yet." }, { status: 403 })
        : NextResponse.json({ error: "Payment required to access this program." }, { status: 402 })
    }
```

`app/api/client/workouts/log/route.ts`, replace the `if (assignment_id) { … }` guard block with:

```ts
    // Access guard: block a pending assignment, and a week the client cannot see, before any write.
    if (assignment_id) {
      const access = await assertAssignmentPayable(assignment_id, week_number ?? undefined)
      if (!access.ok) {
        return access.reason === "not_released"
          ? NextResponse.json({ error: "This week isn't available yet." }, { status: 403 })
          : NextResponse.json({ error: "Payment required to access this program." }, { status: 402 })
      }
    }
```

`app/api/client/workouts/complete-week/route.ts`, replace the guard block with:

```ts
    // Access guard — block pending payment or an unreleased week before any mutation
    const access = await assertAssignmentPayable(assignmentId, assignment.current_week)
    if (!access.ok) {
      return access.reason === "not_released"
        ? NextResponse.json({ error: "This week isn't available yet." }, { status: 403 })
        : NextResponse.json({ error: "Payment required to advance this program." }, { status: 402 })
    }
```

- [ ] **Step 8: Run the route test and the existing log-route test**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/api/client/workouts-week-gate.test.ts __tests__/api/client/workout-log-session-link.test.ts`
Expected: PASS, both files. If any other suite imports the `complete-week` route (check with
`grep -rln "complete-week/route" __tests__`), run it too.

- [ ] **Step 9: Type gate, then commit**

Run the tsc gate. It must equal the baseline.

```bash
git add lib/services/access-guard.ts app/api/client/workouts/session/route.ts app/api/client/workouts/log/route.ts app/api/client/workouts/complete-week/route.ts __tests__/lib/services/access-guard-weeks.test.ts __tests__/api/client/workouts-week-gate.test.ts
git commit -m "fix(workouts): refuse sessions and logs in a week the client cannot see"
```

---

### Task 4: The client workouts page sends only open weeks

**Files:**
- Modify: `app/(client)/client/workouts/page.tsx`
- Modify: `components/client/WorkoutTabs.tsx`

**Interfaces:**
- Consumes: `buildWeekGate`, `formatUnlockDate` (Task 2)
- Produces: a new `ProgramWorkout` prop `unavailableWeeks?: Record<number, { unlocksOn: string | null }>`, where
  `unlocksOn` is a display label such as `"Monday, October 19"`.

No unit test: the decision is `buildWeekGate` (Task 2). Task 11 proves the page in a real browser by
checking that a hidden week's exercise name is absent from the HTML.

- [ ] **Step 1: Page — build the gate per assignment.**
  - Add the import:
    `import { buildWeekGate, formatUnlockDate } from "@/lib/programs/week-visibility"`.
  - Right after `const userId = session.user.id`, add `const now = new Date()`.
  - Inside `tabPrograms`' `.map`, directly after the `const currentWeek = …` line, add:

```ts
      // What this client may see. Hidden and not-yet-released weeks get no workouts at all, and a
      // paid week awaiting payment gets only its price (the Unlock card) — never its exercises.
      const gate = buildWeekGate(assignment, weekAccessByAssignment[assignment.id] ?? [], totalWeeks, now)
```

  - Make the first line inside `for (let w = 1; w <= totalWeeks; w++) {` (the tabs loop):

```ts
        if (!gate.open.has(w)) continue
```

  - Replace the whole block from `// Build week access map: weekNumber → { locked, priceCents }` through
    the closing `}` of its `for (const wa of assignmentAccess)` loop with:

```ts
      const lockedWeeks = gate.locked
      const unavailableWeeks: Record<number, { unlocksOn: string | null }> = {}
      for (const [week, u] of Object.entries(gate.unavailable)) {
        unavailableWeeks[Number(week)] = { unlocksOn: u.unlocksOn ? formatUnlockDate(u.unlocksOn) : null }
      }
```

  - In the returned object, add `unavailableWeeks,` after `lockedWeeks,`.

- [ ] **Step 2: Page — gate the calendar view too.** It lists exercise names for every week. In the
  calendar loop (`for (const { assignment, exercises } of programExercises)`), directly after its
  `const totalWeeks = …` line, add:

```ts
    const gate = buildWeekGate(assignment, weekAccessByAssignment[assignment.id] ?? [], totalWeeks, now)
```

  Make the first line of its `for (let w = 1; w <= totalWeeks; w++) {`:

```ts
      if (!gate.open.has(w)) continue
```

- [ ] **Step 3: WorkoutTabs — accept and render unavailable weeks.**
  - Add `CalendarClock` to the existing `lucide-react` import.
  - In `interface ProgramWorkout`, after `lockedWeeks?`:

```ts
  /** Weeks the client can't see yet: a scheduled week carries its unlock day, a coach-hidden week null. */
  unavailableWeeks?: Record<number, { unlocksOn: string | null }>
```

  - Directly after `const lockedWeeks = program.lockedWeeks ?? {}`, add
    `const unavailableWeeks = program.unavailableWeeks ?? {}`.
  - Replace the `safeCurrentWeek` line with:

```ts
  const safeCurrentWeek =
    weekKeys.includes(effectiveCurrentWeek) ||
    lockedWeeks[effectiveCurrentWeek] ||
    unavailableWeeks[effectiveCurrentWeek]
      ? effectiveCurrentWeek
      : (weekKeys[0] ?? 1)
```

  - In the week selector, after
    `{lockedWeeks[selectedWeek] && <Lock className="inline size-3 ml-1 text-warning" />}` add
    `{unavailableWeeks[selectedWeek] && <Lock className="inline size-3 ml-1 text-muted-foreground" />}`.
  - Change `{isCurrentWeek && !lockedWeeks[selectedWeek] && (` (the "Current week" label) to
    `{isCurrentWeek && !lockedWeeks[selectedWeek] && !unavailableWeeks[selectedWeek] && (`.
  - After the "Payment required" line, add:

```tsx
            {unavailableWeeks[selectedWeek] && (
              <p className="text-[10px] text-muted-foreground font-medium">Not available yet</p>
            )}
```

  - In the content area, change `{lockedWeeks[selectedWeek] ? (` to start with the new branch:

```tsx
          {unavailableWeeks[selectedWeek] ? (
            <motion.div
              key={`unavailable-${selectedWeek}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="bg-white rounded-xl border border-border p-8 text-center space-y-3">
                <div className="flex justify-center">
                  <div className="size-14 rounded-full bg-muted flex items-center justify-center">
                    <CalendarClock className="size-7 text-muted-foreground" />
                  </div>
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  {unavailableWeeks[selectedWeek].unlocksOn
                    ? `Week ${selectedWeek} unlocks on ${unavailableWeeks[selectedWeek].unlocksOn}`
                    : `Week ${selectedWeek} isn't available yet`}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {unavailableWeeks[selectedWeek].unlocksOn
                    ? "Your coach opens one new week at a time. Come back that day to see your workouts."
                    : "Your coach will open this week for you."}
                </p>
              </div>
            </motion.div>
          ) : lockedWeeks[selectedWeek] ? (
```

  - Change the complete-week block's condition `{isCurrentWeek && !lockedWeeks[selectedWeek] && (` (near
    the end of the file, the one that renders the complete-week control) to
    `{isCurrentWeek && !lockedWeeks[selectedWeek] && !unavailableWeeks[selectedWeek] && (`.

- [ ] **Step 4: Type gate and the WorkoutTabs suites**

Run the tsc gate. It must equal the baseline, with no errors in `workouts/page.tsx` or `WorkoutTabs.tsx`.
Then: `grep -rln "WorkoutTabs" __tests__`. Run each file found with vitest. They must stay green.

- [ ] **Step 5: Commit**

```bash
git add "app/(client)/client/workouts/page.tsx" components/client/WorkoutTabs.tsx
git commit -m "fix(workouts): never send a hidden or locked week's workouts to the browser"
```

---

### Task 5: Whole-program copy

**Files:**
- Create: `lib/services/copy-program.ts`
- Modify: `lib/db/program-exercises.ts`. Delete the dead `duplicateProgramExercises` (no callers; check
  with `grep -rn duplicateProgramExercises app lib components __tests__`).
- Test: `__tests__/lib/services/copy-program.test.ts`

**Interfaces:**
- Consumes: `getProgramById`, `createProgram`, `deleteProgram` (`lib/db/programs.ts`)
- Produces:
  - `type ProgramCopyOverrides = Partial<Pick<Program, "name" | "is_template" | "folder_id" | "is_public">>`
  - `copyProgram(sourceId: string, overrides: ProgramCopyOverrides): Promise<Program>`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/services/copy-program.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getProgramById = vi.fn()
const createProgram = vi.fn()
const deleteProgram = vi.fn()
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  createProgram: (...a: unknown[]) => createProgram(...a),
  deleteProgram: (...a: unknown[]) => deleteProgram(...a),
}))

type Row = Record<string, unknown>
let fake: ReturnType<typeof makeFake>
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => fake.client }))

/**
 * A PostgREST stand-in that ENFORCES the 1000-row cap: a read without .range()
 * would silently stop at 1000, exactly as production does.
 */
function makeFake(exercises: Row[], pricing: Row[], opts: { failInsertCall?: number } = {}) {
  const inserted: { table: string; rows: Row[] }[] = []
  let insertCalls = 0
  const client = {
    from(table: string) {
      return {
        select() {
          const filters: [string, unknown][] = []
          let range: [number, number] | null = null
          const q = {
            eq(col: string, v: unknown) {
              filters.push([col, v])
              return q
            },
            order() {
              return q
            },
            range(a: number, b: number) {
              range = [a, b]
              return q
            },
            then(resolve: (r: { data: Row[]; error: null }) => void) {
              const src = table === "program_exercises" ? exercises : pricing
              let rows = src.filter((r) => filters.every(([c, v]) => r[c] === v))
              if (range) rows = rows.slice(range[0], range[1] + 1)
              resolve({ data: rows.slice(0, 1000), error: null })
            },
          }
          return q
        },
        insert(rows: Row[]) {
          insertCalls++
          if (opts.failInsertCall === insertCalls) {
            return Promise.resolve({ error: { code: "XX000", message: "insert failed" } })
          }
          inserted.push({ table, rows })
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { client, inserted }
}

import { copyProgram } from "@/lib/services/copy-program"

const SOURCE = {
  id: "src-1",
  name: "12-Week Strength",
  description: null,
  stripe_product_id: "prod_src",
  stripe_price_id: "price_src",
  is_template: true,
  folder_id: "folder-1",
  is_public: false,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
}

function exerciseRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pe-${i}`,
    program_id: "src-1",
    exercise_id: `ex-${i % 7}`,
    week_number: Math.floor(i / 200) + 1,
    day_of_week: (i % 5) + 1,
    order_index: i,
    slot_role: i % 2 ? "accessory" : "primary_compound",
    future_column: `kept-${i}`,
    created_at: "2026-01-01",
  }))
}

beforeEach(() => {
  getProgramById.mockReset().mockResolvedValue(SOURCE)
  createProgram.mockReset().mockResolvedValue({ ...SOURCE, id: "copy-1" })
  deleteProgram.mockReset().mockResolvedValue(undefined)
})

describe("copyProgram", () => {
  it("copies 2,300 exercises across three pages, every column but the row's own identity", async () => {
    fake = makeFake(exerciseRows(2300), [])
    await copyProgram("src-1", { name: "Copy" })
    const rows = fake.inserted.filter((i) => i.table === "program_exercises").flatMap((i) => i.rows)
    expect(rows).toHaveLength(2300)
    expect(rows[1999]).toMatchObject({ program_id: "copy-1", slot_role: "accessory", future_column: "kept-1999" })
    expect(rows[0]).not.toHaveProperty("id")
    expect(rows[0]).not.toHaveProperty("created_at")
  })

  it("nulls Stripe ids and applies the overrides on the new row", async () => {
    fake = makeFake([], [])
    await copyProgram("src-1", { is_template: false, folder_id: null, is_public: false, name: "Jo's copy" })
    const payload = createProgram.mock.calls[0][0]
    expect(payload).toMatchObject({
      stripe_product_id: null,
      stripe_price_id: null,
      is_template: false,
      folder_id: null,
      name: "Jo's copy",
    })
    expect(payload).not.toHaveProperty("id")
  })

  it("copies premium-week pricing onto the new program", async () => {
    fake = makeFake([], [{ program_id: "src-1", week_number: 5, price_cents: 4000 }])
    await copyProgram("src-1", {})
    const pricing = fake.inserted.find((i) => i.table === "program_week_pricing")!.rows
    expect(pricing).toEqual([{ program_id: "copy-1", week_number: 5, price_cents: 4000 }])
  })

  it("deletes the half-built copy and rethrows when an insert fails", async () => {
    fake = makeFake(exerciseRows(10), [], { failInsertCall: 1 })
    await expect(copyProgram("src-1", {})).rejects.toBeTruthy()
    expect(deleteProgram).toHaveBeenCalledWith("copy-1")
  })

  it("an empty program copies with no exercise insert (presence control)", async () => {
    fake = makeFake([], [])
    const copy = await copyProgram("src-1", {})
    expect(copy.id).toBe("copy-1")
    expect(fake.inserted).toEqual([])
    expect(deleteProgram).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/services/copy-program.test.ts`
Expected: FAIL, cannot resolve `@/lib/services/copy-program`.

- [ ] **Step 3: Implement**

```ts
// lib/services/copy-program.ts
import { createServiceRoleClient } from "@/lib/supabase"
import { createProgram, deleteProgram, getProgramById } from "@/lib/db/programs"
import type { Program } from "@/types/database"

const PAGE = 1000 // PostgREST's row cap: a read without .range() stops here silently
const CHUNK = 500

export type ProgramCopyOverrides = Partial<Pick<Program, "name" | "is_template" | "folder_id" | "is_public">>

function strip(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...row }
  for (const k of keys) delete out[k]
  return out
}

/**
 * THE whole-program copy: the programs row, every program_exercises row and
 * the program_week_pricing rows. Exercise rows are copied column-for-column
 * (minus their own identity), so a column added later is carried without
 * touching this file.
 *
 * Stripe ids are NEVER copied. PATCH /api/admin/programs/[id] archives a
 * program's Price when its price changes and renames its Product when its name
 * changes, so two programs sharing them would break each other's checkout. A
 * caller that needs the copy to be sellable creates its own (see the give route).
 *
 * All-or-nothing: if anything after the programs insert fails, the new program
 * is deleted (exercises and pricing cascade) and the error is rethrown.
 */
export async function copyProgram(sourceId: string, overrides: ProgramCopyOverrides): Promise<Program> {
  const source = await getProgramById(sourceId)
  const copy = await createProgram({
    ...strip(source as unknown as Record<string, unknown>, ["id", "created_at", "updated_at"]),
    stripe_product_id: null,
    stripe_price_id: null,
    ...overrides,
  } as Omit<Program, "id" | "created_at" | "updated_at">)

  const supabase = createServiceRoleClient()
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("program_exercises")
        .select("*")
        .eq("program_id", sourceId)
        .order("week_number")
        .order("day_of_week")
        .order("order_index")
        .order("id")
        .range(from, from + PAGE - 1)
      if (error) throw error
      const page = (data ?? []).map((r: Record<string, unknown>) => ({
        ...strip(r, ["id", "created_at", "updated_at"]),
        program_id: copy.id,
      }))
      for (let i = 0; i < page.length; i += CHUNK) {
        const { error: insertError } = await supabase.from("program_exercises").insert(page.slice(i, i + CHUNK))
        if (insertError) throw insertError
      }
      if (page.length < PAGE) break
    }

    const { data: pricing, error: pricingError } = await supabase
      .from("program_week_pricing")
      .select("week_number, price_cents")
      .eq("program_id", sourceId)
    if (pricingError) throw pricingError
    if (pricing && pricing.length > 0) {
      const { error } = await supabase
        .from("program_week_pricing")
        .insert(pricing.map((p: { week_number: number; price_cents: number }) => ({ ...p, program_id: copy.id })))
      if (error) throw error
    }
    return copy
  } catch (err) {
    await deleteProgram(copy.id).catch((e) => console.error(`[copyProgram] rollback of ${copy.id} failed:`, e))
    throw err
  }
}
```

- [ ] **Step 4: Run it and see it pass.** Same command. Expected: PASS.

- [ ] **Step 5: Prove the paging test can fail.** Remove `.range(from, from + PAGE - 1)` and re-run: the
  2,300-row test must go red, because 1000 rows are copied and the loop breaks. Restore it.

- [ ] **Step 6: Delete `duplicateProgramExercises`** from `lib/db/program-exercises.ts`. That is the
  `export async function duplicateProgramExercises(...)` block near L289, together with its doc comment.
  Run the tsc gate: it must equal the baseline.

- [ ] **Step 7: Commit**

```bash
git add lib/services/copy-program.ts lib/db/program-exercises.ts __tests__/lib/services/copy-program.test.ts
git commit -m "feat(programs): whole-program copy that pages past 1000 rows and never shares Stripe ids"
```

---

### Task 6: Folders DAL, the library reader, template exclusions, assignProgram, audit slugs

**Files:**
- Create: `lib/db/program-folders.ts`
- Create: `lib/validators/program-library.ts`
- Modify: `lib/db/programs.ts` (`getPrograms` and a new `getLibraryPrograms`)
- Modify: `lib/db/pipeline.ts` (`listGrantablePrograms`, ~L2121)
- Modify: `lib/services/assign-program.ts` (`AssignProgramInput`, `assignProgram`)
- Modify: `lib/db/assignments.ts` (`getActiveAssignmentsForProgram` select and return type)
- Modify: `lib/audit/actions.ts` (append slugs after `assignment.deleted`, L35)
- Test: `__tests__/lib/db/program-library-readers.test.ts`
- Test: `__tests__/lib/services/assign-program-release.test.ts`

**Interfaces:**
- Produces:
  - `listProgramFolders(businessId): Promise<ProgramFolder[]>`
  - `getProgramFolder(businessId, id): Promise<ProgramFolder | null>`
  - `createProgramFolder(businessId, name): Promise<ProgramFolder>`
  - `renameProgramFolder(businessId, id, name): Promise<ProgramFolder | null>`
  - `deleteProgramFolder(businessId, id): Promise<boolean>`. It throws a `23503` error while the folder
    still holds programs.
  - `pgErrorCode(err: unknown): string | undefined`
  - `getLibraryPrograms(businessId): Promise<Program[]>`
  - `AssignProgramInput.releaseBaseWeek?: number | null` and `AssignProgramInput.releaseAnchorAt?: string | null`
  - Zod schemas `folderNameSchema`, `saveToLibrarySchema`, `moveToFolderSchema`, `giveProgramSchema`
  - Audit slugs `program.given_to_client`, `program.saved_to_library`, `program_folder.created`,
    `program_folder.updated`, `program_folder.deleted`, `assignment.release_schedule_changed`,
    `assignment.week_visibility_changed`
  - `getActiveAssignmentsForProgram` now also returns `status`, `current_week`, `release_base_week` and
    `release_anchor_at`

- [ ] **Step 1: Write the failing readers test**

```ts
// __tests__/lib/db/program-library-readers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const calls: { table: string; op: string; args: unknown[] }[] = []
function builder(table: string, data: unknown[]) {
  const b: Record<string, unknown> = {}
  for (const op of ["select", "eq", "not", "in", "is", "order"]) {
    b[op] = (...args: unknown[]) => {
      calls.push({ table, op, args })
      return b
    }
  }
  b.then = (resolve: (r: unknown) => void) => resolve({ data, error: null })
  return b
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => builder(t, t === "program_folders" ? [{ id: "f1" }, { id: "f2" }] : []),
  }),
}))

import { getPrograms, getLibraryPrograms } from "@/lib/db/programs"
import { listGrantablePrograms } from "@/lib/db/pipeline"

const eqs = (table: string) => calls.filter((c) => c.table === table && c.op === "eq").map((c) => c.args)

beforeEach(() => {
  calls.length = 0
})

describe("readers that must never offer a library program", () => {
  it("getPrograms filters is_template = false", async () => {
    await getPrograms()
    expect(eqs("programs")).toContainEqual(["is_template", false])
  })
  it("listGrantablePrograms filters is_template = false", async () => {
    await listGrantablePrograms()
    expect(eqs("programs")).toContainEqual(["is_template", false])
  })
})

describe("getLibraryPrograms", () => {
  it("reads only this business's folders, then templates inside them", async () => {
    await getLibraryPrograms("biz-1")
    expect(eqs("program_folders")).toContainEqual(["business_id", "biz-1"])
    expect(eqs("programs")).toContainEqual(["is_template", true])
    expect(calls.find((c) => c.table === "programs" && c.op === "in")?.args).toEqual(["folder_id", ["f1", "f2"]])
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/db/program-library-readers.test.ts`
Expected: FAIL. `getLibraryPrograms` is not exported, and `is_template` is not filtered. If importing
`@/lib/db/pipeline` instead fails at import time because of a module it pulls in, copy the `vi.mock`
lines of an existing pipeline suite (`grep -ln "lib/db/pipeline" __tests__ -r`). Do not delete the
pipeline assertion.

- [ ] **Step 3: Implement the readers.** In `lib/db/programs.ts` `getPrograms`, add
  `.eq("is_template", false)` after `.eq("is_active", true)`, and add this sentence to its comment:
  `Library programs (is_template) are excluded: they are never assigned or sold directly.`
  Then add after `getPrograms`:

```ts
/**
 * The library: template programs in this business's folders. Tenant-scoped
 * through program_folders.business_id. `programs` itself has no business_id
 * (G37), but every template has a folder (DB check programs_template_has_folder),
 * so the folder is the tenant predicate. Two reads rather than an embed: an
 * embed hint is what 500'd the leads inbox in G31.
 */
export async function getLibraryPrograms(businessId: string): Promise<Program[]> {
  const supabase = getClient()
  const { data: folders, error: folderError } = await supabase
    .from("program_folders")
    .select("id")
    .eq("business_id", businessId)
  if (folderError) throw folderError
  const folderIds = (folders ?? []).map((f: { id: string }) => f.id)
  if (folderIds.length === 0) return []
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("is_active", true)
    .eq("is_template", true)
    .in("folder_id", folderIds)
    .order("name", { ascending: true })
  if (error) throw error
  return data as Program[]
}
```

In `lib/db/pipeline.ts` `listGrantablePrograms`, add `.eq("is_template", false)` after
`.eq("is_active", true)`.

- [ ] **Step 4: Run the readers test.** It must PASS. Also run
  `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts`. It must
  PASS: the shelf entries for `getPrograms` and `listGrantablePrograms` still read `programs` inside
  their own function.

- [ ] **Step 5: Folders DAL**

```ts
// lib/db/program-folders.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramFolder } from "@/types/database"

/** Service-role client: called only from admin routes and pages, which resolve the tenant first. */
function getClient() {
  return createServiceRoleClient()
}

/** Postgres error code off a raw PostgREST error object (the DALs rethrow it as-is). */
export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined
}

export async function listProgramFolders(businessId: string): Promise<ProgramFolder[]> {
  const { data, error } = await getClient()
    .from("program_folders")
    .select("*")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  if (error) throw error
  return (data ?? []) as ProgramFolder[]
}

export async function getProgramFolder(businessId: string, id: string): Promise<ProgramFolder | null> {
  const { data, error } = await getClient()
    .from("program_folders")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as ProgramFolder | null) ?? null
}

/** Throws a 23505 error when this business already has a folder with that name (case-insensitive). */
export async function createProgramFolder(businessId: string, name: string): Promise<ProgramFolder> {
  const { data, error } = await getClient()
    .from("program_folders")
    .insert({ business_id: businessId, name: name.trim() })
    .select()
    .single()
  if (error) throw error
  return data as ProgramFolder
}

export async function renameProgramFolder(businessId: string, id: string, name: string): Promise<ProgramFolder | null> {
  const { data, error } = await getClient()
    .from("program_folders")
    .update({ name: name.trim() })
    .eq("business_id", businessId)
    .eq("id", id)
    .select()
    .maybeSingle()
  if (error) throw error
  return (data as ProgramFolder | null) ?? null
}

/**
 * False when this business has no such folder. Throws a 23503 error while the
 * folder still holds programs (programs.folder_id is ON DELETE RESTRICT).
 */
export async function deleteProgramFolder(businessId: string, id: string): Promise<boolean> {
  const { data, error } = await getClient()
    .from("program_folders")
    .delete()
    .eq("business_id", businessId)
    .eq("id", id)
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}
```

- [ ] **Step 6: Validators**

```ts
// lib/validators/program-library.ts
import { z } from "zod"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const folderNameSchema = z.object({ name: z.string().trim().min(1).max(80) })

export const saveToLibrarySchema = z.object({
  folder_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
})

export const moveToFolderSchema = z.object({ folder_id: z.string().uuid() })

export const giveProgramSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  start_date: z.string().regex(DATE_RE),
  release_weekly: z.boolean(),
  weeks_visible_at_start: z.number().int().min(1).max(104),
  complimentary: z.boolean().default(false),
})
```

- [ ] **Step 7: Audit slugs.** In `lib/audit/actions.ts`, directly after the `assignment.deleted` entry:

```ts
  { slug: "assignment.release_schedule_changed", category: "admin_write", description: "Weekly week-release turned on or off for a client" },
  { slug: "assignment.week_visibility_changed", category: "admin_write", description: "A client's week shown, hidden or put back on the weekly schedule" },
  { slug: "program.given_to_client", category: "admin_write", description: "Library program copied and given to a client" },
  { slug: "program.saved_to_library", category: "admin_write", description: "Program copied into the library" },
  { slug: "program_folder.created", category: "admin_write", description: "Library folder created" },
  { slug: "program_folder.updated", category: "admin_write", description: "Library folder renamed" },
  { slug: "program_folder.deleted", category: "admin_write", description: "Library folder deleted" },
```

- [ ] **Step 8: Write the failing assignProgram test**

```ts
// __tests__/lib/services/assign-program-release.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getProgramById = vi.fn()
const createAssignment = vi.fn()
vi.mock("@/lib/db/programs", () => ({ getProgramById: (...a: unknown[]) => getProgramById(...a) }))
vi.mock("@/lib/db/program-week-pricing", () => ({ getPremiumWeeks: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentByUserAndProgram: vi.fn().mockResolvedValue(null),
  createAssignment: (...a: unknown[]) => createAssignment(...a),
  getActiveAssignmentsForProgram: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  createWeekAccessBulk: vi.fn().mockResolvedValue([]),
  getWeekAccessByAssignment: vi.fn(),
  createWeekAccess: vi.fn(),
  updateWeekAccessByAssignmentAndWeek: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn().mockResolvedValue({ email: "a@b.c", first_name: "Jo" }) }))
vi.mock("@/lib/email", () => ({ sendProgramReadyEmail: vi.fn() }))

import { assignProgram } from "@/lib/services/assign-program"

const base = { programId: "p1", userId: "u1", startDate: "2026-10-05" }

beforeEach(() => {
  getProgramById.mockReset().mockResolvedValue({ id: "p1", name: "P", payment_type: "free", duration_weeks: 12 })
  createAssignment.mockReset().mockResolvedValue({ id: "a1" })
})

describe("assignProgram and the library", () => {
  it("refuses a library program — clients only ever get a copy", async () => {
    getProgramById.mockResolvedValue({ id: "p1", name: "P", payment_type: "free", duration_weeks: 12, is_template: true })
    await expect(assignProgram(base)).rejects.toThrow(/library/i)
    expect(createAssignment).not.toHaveBeenCalled()
  })

  it("passes the release schedule through", async () => {
    await assignProgram({ ...base, releaseBaseWeek: 2, releaseAnchorAt: "2026-10-12T00:00:00.000Z" })
    expect(createAssignment.mock.calls[0][0]).toMatchObject({
      release_base_week: 2,
      release_anchor_at: "2026-10-12T00:00:00.000Z",
    })
  })

  it("every other caller's payload is unchanged: no release keys at all", async () => {
    await assignProgram(base)
    expect(Object.keys(createAssignment.mock.calls[0][0])).not.toContain("release_base_week")
    expect(Object.keys(createAssignment.mock.calls[0][0])).not.toContain("release_anchor_at")
  })
})
```

- [ ] **Step 9: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/services/assign-program-release.test.ts`
Expected: FAIL. No throw for a template, and the release keys are missing.

- [ ] **Step 10: Implement in `lib/services/assign-program.ts`.** Add to `AssignProgramInput`:

```ts
  /** Weekly release: weeks visible at the start. Omitted by every caller but "Give to client" = no schedule. */
  releaseBaseWeek?: number | null
  /** When the 7-day clock starts. The DB trigger clears it while payment is pending. */
  releaseAnchorAt?: string | null
```

  Destructure them as `releaseBaseWeek = null, releaseAnchorAt = null` in `assignProgram`. Directly after
  `const program = await getProgramById(programId)`, add:

```ts
  if (program.is_template) {
    throw new Error("A library program cannot be assigned directly; give the client a copy instead.")
  }
```

  In the `createAssignment({...})` object, after `expires_at: null,`, add:

```ts
    ...(releaseBaseWeek != null
      ? { release_base_week: releaseBaseWeek, release_anchor_at: releaseAnchorAt ?? new Date().toISOString() }
      : {}),
```

- [ ] **Step 11: getActiveAssignmentsForProgram columns.** In `lib/db/assignments.ts`:
  - Extend the return type with `status: string; current_week: number; release_base_week: number | null;
    release_anchor_at: string | null`.
  - Change the select to
    `"id, user_id, start_date, notes, payment_status, expires_at, status, current_week, release_base_week, release_anchor_at"`.

- [ ] **Step 12: Run the new and neighbouring suites**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/lib/services/assign-program-release.test.ts __tests__/lib/services/assign-program.test.ts __tests__/lib/services/resync-week-access.test.ts __tests__/lib/db/program-library-readers.test.ts __tests__/lib/funnels/checkout/grant-program.test.ts`
Expected: PASS, every file. Then run `grep -rln "lib/db/pipeline\"" __tests__ | head` and run the
pipeline suites it lists that cover `listGrantablePrograms`.

- [ ] **Step 13: Type gate, select contract, commit**

- Run the tsc gate.
- Run `PATH=/opt/homebrew/bin:$PATH npm run test:integration:selects`. It must PASS: the new folder and
  library selects are probed against the clone.

```bash
git add lib/db/program-folders.ts lib/validators/program-library.ts lib/db/programs.ts lib/db/pipeline.ts lib/services/assign-program.ts lib/db/assignments.ts lib/audit/actions.ts __tests__/lib/db/program-library-readers.test.ts __tests__/lib/services/assign-program-release.test.ts
git commit -m "feat(programs): library folders, tenant-scoped library reader, templates never assignable"
```

---

### Task 7: Library API routes

**Files:**
- Create: `app/api/admin/programs/folders/route.ts` (GET, POST)
- Create: `app/api/admin/programs/folders/[folderId]/route.ts` (PATCH, DELETE)
- Create: `app/api/admin/programs/[id]/save-to-library/route.ts` (POST)
- Create: `app/api/admin/programs/[id]/folder/route.ts` (PATCH)
- Modify: `app/api/admin/programs/route.ts` (POST accepts `folder_id`)
- Modify: `app/api/admin/programs/[id]/route.ts` (PATCH forces `is_public = false` on a template)
- Test: `__tests__/api/admin/program-library-routes.test.ts`

All four new paths are under `/api/admin/programs`, so `proxy.ts` already gates them with the `programs`
permission (`lib/permissions/registry.ts:462`). The static `folders` segment wins over `[id]`.

**Interfaces:**
- Consumes: the Task 6 DAL, validators and slugs; `copyProgram` (Task 5)
- Produces these HTTP contracts:
  - `GET /api/admin/programs/folders` → `{ folders }`
  - `POST /api/admin/programs/folders {name}` → `201 { folder }`, or `409`
  - `PATCH /api/admin/programs/folders/[folderId] {name}` → `{ folder }`, or `404`/`409`
  - `DELETE /api/admin/programs/folders/[folderId]` → `{ ok: true }`, or `404`/`409`
  - `POST /api/admin/programs/[id]/save-to-library {folder_id, name?}` → `201 { program }`
  - `PATCH /api/admin/programs/[id]/folder {folder_id}` → `{ program }`
  - `POST /api/admin/programs {…, folder_id?}`. With a folder, the program is created as a library
    program.

- [ ] **Step 1: Write the failing route test**

```ts
// @vitest-environment node
// __tests__/api/admin/program-library-routes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {}
  return { NoAccessibleBusinessError }
})

const resolveTenant = vi.fn()
const folders = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}
const getProgramById = vi.fn()
const updateProgram = vi.fn()
const copyProgram = vi.fn()

vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenant(...a),
  NoAccessibleBusinessError,
}))
vi.mock("@/lib/db/program-folders", () => ({
  listProgramFolders: (...a: unknown[]) => folders.list(...a),
  getProgramFolder: (...a: unknown[]) => folders.get(...a),
  createProgramFolder: (...a: unknown[]) => folders.create(...a),
  renameProgramFolder: (...a: unknown[]) => folders.rename(...a),
  deleteProgramFolder: (...a: unknown[]) => folders.remove(...a),
  pgErrorCode: (e: unknown) => (e as { code?: string })?.code,
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
}))
vi.mock("@/lib/services/copy-program", () => ({ copyProgram: (...a: unknown[]) => copyProgram(...a) }))

import { POST as createFolder } from "@/app/api/admin/programs/folders/route"
import { DELETE as deleteFolder } from "@/app/api/admin/programs/folders/[folderId]/route"
import { POST as saveToLibrary } from "@/app/api/admin/programs/[id]/save-to-library/route"
import { PATCH as moveProgram } from "@/app/api/admin/programs/[id]/folder/route"

const FOLDER = "33333333-3333-4333-8333-333333333333"
const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) })
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  resolveTenant.mockReset().mockResolvedValue({ businessId: "biz-1" })
  Object.values(folders).forEach((f) => f.mockReset())
  getProgramById.mockReset()
  updateProgram.mockReset()
  copyProgram.mockReset()
})

describe("folders", () => {
  it("creates a folder in the caller's own business", async () => {
    folders.create.mockResolvedValue({ id: FOLDER, name: "Strength" })
    const res = await createFolder(json({ name: " Strength " }), ctx({}))
    expect(res.status).toBe(201)
    expect(folders.create).toHaveBeenCalledWith("biz-1", "Strength")
  })

  it("answers 409 with a plain sentence for a duplicate name", async () => {
    folders.create.mockRejectedValue({ code: "23505" })
    const res = await createFolder(json({ name: "Strength" }), ctx({}))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already have a folder/i)
  })

  it("refuses to delete a folder that still holds programs, with a plain sentence", async () => {
    folders.remove.mockRejectedValue({ code: "23503" })
    const res = await deleteFolder(new Request("http://localhost/x", { method: "DELETE" }), ctx({ folderId: FOLDER }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/move or delete/i)
  })

  it("deletes an empty folder (presence control)", async () => {
    folders.remove.mockResolvedValue(true)
    const res = await deleteFolder(new Request("http://localhost/x", { method: "DELETE" }), ctx({ folderId: FOLDER }))
    expect(res.status).toBe(200)
    expect(folders.remove).toHaveBeenCalledWith("biz-1", FOLDER)
  })
})

describe("save to library", () => {
  it("404s a folder from another business and copies nothing", async () => {
    folders.get.mockResolvedValue(null)
    const res = await saveToLibrary(json({ folder_id: FOLDER }), ctx({ id: "p1" }))
    expect(res.status).toBe(404)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("copies the program into the folder as a private library program", async () => {
    folders.get.mockResolvedValue({ id: FOLDER })
    getProgramById.mockResolvedValue({ id: "p1", name: "Block A" })
    copyProgram.mockResolvedValue({ id: "copy-1" })
    const res = await saveToLibrary(json({ folder_id: FOLDER }), ctx({ id: "p1" }))
    expect(res.status).toBe(201)
    expect(copyProgram).toHaveBeenCalledWith("p1", { is_template: true, folder_id: FOLDER, is_public: false, name: "Block A" })
  })
})

describe("move to folder", () => {
  it("refuses a program that is not in the library", async () => {
    getProgramById.mockResolvedValue({ id: "p1", is_template: false, folder_id: null })
    const res = await moveProgram(json({ folder_id: FOLDER }), ctx({ id: "p1" }))
    expect(res.status).toBe(400)
    expect(updateProgram).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/api/admin/program-library-routes.test.ts`
Expected: FAIL, the route modules do not exist.

- [ ] **Step 3: `app/api/admin/programs/folders/route.ts`**

```ts
import { NextResponse } from "next/server"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { createProgramFolder, listProgramFolders, pgErrorCode } from "@/lib/db/program-folders"
import { folderNameSchema } from "@/lib/validators/program-library"

export async function GET(request: Request) {
  try {
    const { businessId } = await resolveAdminTenantForRequest(request)
    return NextResponse.json({ folders: await listProgramFolders(businessId) })
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
    console.error("[program-folders GET]", err)
    return NextResponse.json({ error: "Couldn't load your folders." }, { status: 500 })
  }
}

export const POST = withAudit(
  {
    action: "program_folder.created",
    category: "admin_write",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request) => {
    try {
      const parsed = folderNameSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json({ error: "Give the folder a name (up to 80 characters)." }, { status: 400 })
      }
      const { businessId } = await resolveAdminTenantForRequest(request)
      const folder = await createProgramFolder(businessId, parsed.data.name)
      const res = NextResponse.json({ folder }, { status: 201 })
      res.headers.set("x-audit-target-id", folder.id)
      return res
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (pgErrorCode(err) === "23505") {
        return NextResponse.json({ error: "You already have a folder with that name." }, { status: 409 })
      }
      console.error("[program-folders POST]", err)
      return NextResponse.json({ error: "Couldn't create the folder." }, { status: 500 })
    }
  },
)
```

- [ ] **Step 4: `app/api/admin/programs/folders/[folderId]/route.ts`**

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { deleteProgramFolder, pgErrorCode, renameProgramFolder } from "@/lib/db/program-folders"
import { folderNameSchema } from "@/lib/validators/program-library"

const idSchema = z.string().uuid()

async function folderIdFrom(context: unknown): Promise<string | null> {
  const { params } = context as { params: Promise<{ folderId: string }> }
  const parsed = idSchema.safeParse((await params).folderId)
  return parsed.success ? parsed.data : null
}

export const PATCH = withAudit(
  {
    action: "program_folder.updated",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program_folder", id: ((await ctx.params) as { folderId: string }).folderId }),
  },
  async (request, context) => {
    try {
      const folderId = await folderIdFrom(context)
      if (!folderId) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      const parsed = folderNameSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json({ error: "Give the folder a name (up to 80 characters)." }, { status: 400 })
      }
      const { businessId } = await resolveAdminTenantForRequest(request)
      const folder = await renameProgramFolder(businessId, folderId, parsed.data.name)
      if (!folder) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      return NextResponse.json({ folder })
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (pgErrorCode(err) === "23505") {
        return NextResponse.json({ error: "You already have a folder with that name." }, { status: 409 })
      }
      console.error("[program-folders PATCH]", err)
      return NextResponse.json({ error: "Couldn't rename the folder." }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  {
    action: "program_folder.deleted",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program_folder", id: ((await ctx.params) as { folderId: string }).folderId }),
  },
  async (request, context) => {
    try {
      const folderId = await folderIdFrom(context)
      if (!folderId) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      const { businessId } = await resolveAdminTenantForRequest(request)
      const deleted = await deleteProgramFolder(businessId, folderId)
      if (!deleted) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      return NextResponse.json({ ok: true })
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (pgErrorCode(err) === "23503") {
        return NextResponse.json(
          { error: "This folder still has programs in it. Move or delete them first." },
          { status: 409 },
        )
      }
      console.error("[program-folders DELETE]", err)
      return NextResponse.json({ error: "Couldn't delete the folder." }, { status: 500 })
    }
  },
)
```

- [ ] **Step 5: `app/api/admin/programs/[id]/save-to-library/route.ts`**

```ts
import { NextResponse } from "next/server"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { getProgramFolder } from "@/lib/db/program-folders"
import { getProgramById } from "@/lib/db/programs"
import { copyProgram } from "@/lib/services/copy-program"
import { saveToLibrarySchema } from "@/lib/validators/program-library"

/** Copies any program (a client's, or another library program) into a library folder. The source is untouched. */
export const POST = withAudit(
  {
    action: "program.saved_to_library",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program", id: ((await ctx.params) as { id: string }).id }),
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { copy_program_id: id } : {}
    },
  },
  async (request, context) => {
    try {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const parsed = saveToLibrarySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: "Pick a folder." }, { status: 400 })
      const { businessId } = await resolveAdminTenantForRequest(request)
      const folder = await getProgramFolder(businessId, parsed.data.folder_id)
      if (!folder) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      const source = await getProgramById(id)
      const program = await copyProgram(id, {
        is_template: true,
        folder_id: folder.id,
        is_public: false,
        name: parsed.data.name ?? source.name,
      })
      const res = NextResponse.json({ program }, { status: 201 })
      res.headers.set("x-audit-target-id", program.id)
      return res
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      console.error("[save-to-library]", err)
      return NextResponse.json({ error: "Couldn't save to the library. Nothing was saved." }, { status: 500 })
    }
  },
)
```

- [ ] **Step 6: `app/api/admin/programs/[id]/folder/route.ts`**

```ts
import { NextResponse } from "next/server"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { getProgramFolder } from "@/lib/db/program-folders"
import { getProgramById, updateProgram } from "@/lib/db/programs"
import { moveToFolderSchema } from "@/lib/validators/program-library"

/** Moves a library program to another of this business's folders. */
export const PATCH = withAudit(
  {
    action: "program.updated",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program", id: ((await ctx.params) as { id: string }).id }),
  },
  async (request, context) => {
    try {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const parsed = moveToFolderSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: "Pick a folder." }, { status: 400 })
      const program = await getProgramById(id)
      if (!program.is_template || !program.folder_id) {
        return NextResponse.json({ error: "Only a library program can be moved between folders." }, { status: 400 })
      }
      const { businessId } = await resolveAdminTenantForRequest(request)
      // Both ends must be this business's: the folder is a template's only tenant marker.
      const [from, to] = await Promise.all([
        getProgramFolder(businessId, program.folder_id),
        getProgramFolder(businessId, parsed.data.folder_id),
      ])
      if (!from || !to) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      return NextResponse.json({ program: await updateProgram(id, { folder_id: to.id }) })
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      console.error("[program folder PATCH]", err)
      return NextResponse.json({ error: "Couldn't move the program." }, { status: 500 })
    }
  },
)
```

- [ ] **Step 7: Create route accepts `folder_id`.** In `app/api/admin/programs/route.ts`:
  - Add imports:

```ts
import { z } from "zod"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getProgramFolder } from "@/lib/db/program-folders"
```

  - Directly after `const data = result.data`, add:

```ts
      // "New program" in the Library tab sends folder_id. Read off the RAW body: the form schema strips
      // it. A folder of this business makes the row a library program; is_template is never taken
      // from the body.
      let libraryFields: { is_template: true; folder_id: string; is_public: false } | null = null
      const rawFolderId = (body as { folder_id?: unknown }).folder_id
      if (rawFolderId !== undefined) {
        const folderId = z.string().uuid().safeParse(rawFolderId)
        if (!folderId.success) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
        const { businessId } = await resolveAdminTenantForRequest(request)
        const folder = await getProgramFolder(businessId, folderId.data)
        if (!folder) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
        libraryFields = { is_template: true, folder_id: folder.id, is_public: false }
      }
```

  - In the `createProgram({ ... })` call, add `...(libraryFields ?? {}),` as the **last** property.

- [ ] **Step 8: PATCH keeps a template private.** In `app/api/admin/programs/[id]/route.ts`, directly after
  `const existing = await getProgramById(id)`, add:

```ts
      // A library program is never public (DB check programs_template_never_public). Keep the
      // pricing sheet's toggle from turning a save into a 500.
      if (existing.is_template) data.is_public = false
```

  If `data` is typed read-only, use `const data = { ...result.data }` on the line above instead.

- [ ] **Step 9: Run the test and see it pass**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/api/admin/program-library-routes.test.ts`
Expected: PASS. Then run `grep -rln "api/admin/programs/route\"\|api/admin/programs/\[id\]/route\"" __tests__`
and run each file found. They must be green.

- [ ] **Step 10: Type gate and select contract, then commit**

```bash
git add app/api/admin/programs/folders "app/api/admin/programs/[id]/save-to-library" "app/api/admin/programs/[id]/folder" app/api/admin/programs/route.ts "app/api/admin/programs/[id]/route.ts" __tests__/api/admin/program-library-routes.test.ts
git commit -m "feat(programs): library folder, save-to-library and move routes"
```

---

### Task 8: Give to client

**Files:**
- Create: `app/api/admin/programs/[id]/give/route.ts`
- Test: `__tests__/api/admin/program-give-route.test.ts`

**Interfaces:**
- Consumes:
  - `copyProgram` (Task 5)
  - `assignProgram` with its release inputs, `getProgramFolder` and `giveProgramSchema` (Task 6)
  - `releaseAnchorFor` (Task 2)
  - `createStripeProductAndPrice` (`lib/stripe.ts:82`)
  - `updateProgram` and `deleteProgram` (`lib/db/programs.ts`)
- Produces: `POST /api/admin/programs/[id]/give` with body
  `{user_id, name, start_date, release_weekly, weeks_visible_at_start, complimentary}`, answering
  `201 { program, assignment }`. The copy's id is in the `x-audit-target-id` header.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
// __tests__/api/admin/program-give-route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const authMock = vi.fn()
const resolveTenant = vi.fn()
const getProgramById = vi.fn()
const updateProgram = vi.fn()
const deleteProgram = vi.fn()
const getProgramFolder = vi.fn()
const copyProgram = vi.fn()
const assignProgram = vi.fn()
const createStripe = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenant(...a),
  NoAccessibleBusinessError: class extends Error {},
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
  deleteProgram: (...a: unknown[]) => deleteProgram(...a),
}))
vi.mock("@/lib/db/program-folders", () => ({ getProgramFolder: (...a: unknown[]) => getProgramFolder(...a) }))
vi.mock("@/lib/services/copy-program", () => ({ copyProgram: (...a: unknown[]) => copyProgram(...a) }))
vi.mock("@/lib/services/assign-program", () => ({ assignProgram: (...a: unknown[]) => assignProgram(...a) }))
vi.mock("@/lib/stripe", () => ({ createStripeProductAndPrice: (...a: unknown[]) => createStripe(...a) }))

import { POST } from "@/app/api/admin/programs/[id]/give/route"

const CLIENT = "44444444-4444-4444-8444-444444444444"
const TEMPLATE = { id: "tpl-1", name: "12-Week Strength", is_template: true, folder_id: "f1", duration_weeks: 12 }
const COPY = { id: "copy-1", name: "12-Week Strength – Jo", payment_type: "free", price_cents: null, description: null, billing_interval: null }
const body = (extra: Record<string, unknown> = {}) => ({
  user_id: CLIENT,
  name: "12-Week Strength – Jo",
  start_date: "2026-10-12",
  release_weekly: true,
  weeks_visible_at_start: 2,
  ...extra,
})
const req = (b: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(b) })
const ctx = { params: Promise.resolve({ id: "tpl-1" }) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"))
  authMock.mockReset().mockResolvedValue({ user: { id: "coach-1" } })
  resolveTenant.mockReset().mockResolvedValue({ businessId: "biz-1" })
  getProgramById.mockReset().mockResolvedValue(TEMPLATE)
  getProgramFolder.mockReset().mockResolvedValue({ id: "f1" })
  copyProgram.mockReset().mockResolvedValue(COPY)
  assignProgram.mockReset().mockResolvedValue({ assignment: { id: "a1" }, skipped: false })
  updateProgram.mockReset()
  deleteProgram.mockReset().mockResolvedValue(undefined)
  createStripe.mockReset().mockResolvedValue({ productId: "prod_new", priceId: "price_new" })
})
afterEach(() => vi.useRealTimers())

describe("POST /api/admin/programs/[id]/give", () => {
  it("copies, then assigns the COPY with the weekly schedule starting on the start date", async () => {
    const res = await POST(req(body()), ctx)
    expect(res.status).toBe(201)
    expect(res.headers.get("x-audit-target-id")).toBe("copy-1")
    expect(copyProgram).toHaveBeenCalledWith("tpl-1", {
      is_template: false,
      folder_id: null,
      is_public: false,
      name: "12-Week Strength – Jo",
    })
    expect(assignProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: "copy-1",
        userId: CLIENT,
        assignedBy: "coach-1",
        releaseBaseWeek: 2,
        releaseAnchorAt: "2026-10-12T00:00:00.000Z",
      }),
    )
  })

  it("with weekly release off, assigns with no schedule", async () => {
    await POST(req(body({ release_weekly: false })), ctx)
    expect(assignProgram).toHaveBeenCalledWith(expect.objectContaining({ releaseBaseWeek: null, releaseAnchorAt: null }))
  })

  it("refuses a program that is not in the library, and copies nothing", async () => {
    getProgramById.mockResolvedValue({ ...TEMPLATE, is_template: false, folder_id: null })
    expect((await POST(req(body()), ctx)).status).toBe(400)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("refuses a library program from another business, and copies nothing", async () => {
    getProgramFolder.mockResolvedValue(null)
    expect((await POST(req(body()), ctx)).status).toBe(400)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("refuses more opening weeks than the program has", async () => {
    expect((await POST(req(body({ weeks_visible_at_start: 13 })), ctx)).status).toBe(400)
    expect(copyProgram).not.toHaveBeenCalled()
  })

  it("creates a fresh Stripe price for a paid copy, keyed to the copy", async () => {
    copyProgram.mockResolvedValue({ ...COPY, payment_type: "subscription", price_cents: 4900, billing_interval: "week" })
    await POST(req(body()), ctx)
    expect(createStripe).toHaveBeenCalledWith(expect.objectContaining({ programId: "copy-1", priceCents: 4900 }))
    expect(updateProgram).toHaveBeenCalledWith("copy-1", { stripe_product_id: "prod_new", stripe_price_id: "price_new" })
  })

  it("deletes the copy when assigning fails — nothing half-done is left behind", async () => {
    assignProgram.mockRejectedValue(new Error("boom"))
    expect((await POST(req(body()), ctx)).status).toBe(500)
    expect(deleteProgram).toHaveBeenCalledWith("copy-1")
  })

  it("deletes the copy when the assignment is skipped", async () => {
    assignProgram.mockResolvedValue({ assignment: null, skipped: true })
    expect((await POST(req(body()), ctx)).status).toBe(500)
    expect(deleteProgram).toHaveBeenCalledWith("copy-1")
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/api/admin/program-give-route.test.ts`
Expected: FAIL, the route module does not exist.

- [ ] **Step 3: Implement**

```ts
// app/api/admin/programs/[id]/give/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { deleteProgram, getProgramById, updateProgram } from "@/lib/db/programs"
import { getProgramFolder } from "@/lib/db/program-folders"
import { copyProgram } from "@/lib/services/copy-program"
import { assignProgram } from "@/lib/services/assign-program"
import { createStripeProductAndPrice } from "@/lib/stripe"
import { releaseAnchorFor } from "@/lib/programs/week-visibility"
import { giveProgramSchema } from "@/lib/validators/program-library"

/**
 * Give a library program to a client: copy it, make the copy sellable if it is
 * paid, and assign the copy (optionally releasing one week at a time). Any
 * failure after the copy deletes the copy, so the coach never finds a stray
 * half-given program.
 */
export const POST = withAudit(
  {
    action: "program.given_to_client",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program", id: ((await ctx.params) as { id: string }).id }),
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { copy_program_id: id } : {}
    },
  },
  async (request, context) => {
    try {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const session = await auth()
      if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

      const parsed = giveProgramSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 })
      }
      const input = parsed.data

      const { businessId } = await resolveAdminTenantForRequest(request)
      const source = await getProgramById(id)
      const folder =
        source.is_template && source.folder_id ? await getProgramFolder(businessId, source.folder_id) : null
      if (!folder) {
        return NextResponse.json({ error: "Only a program in your library can be given to a client." }, { status: 400 })
      }
      if (input.release_weekly && input.weeks_visible_at_start > source.duration_weeks) {
        return NextResponse.json(
          { error: `This program has ${source.duration_weeks} weeks, so they can't see more than that at the start.` },
          { status: 400 },
        )
      }

      const copy = await copyProgram(id, { is_template: false, folder_id: null, is_public: false, name: input.name })
      try {
        if (copy.payment_type !== "free" && copy.price_cents) {
          // ponytail: on a later rollback this Stripe product is left behind, unused. It sells nothing.
          const { productId, priceId } = await createStripeProductAndPrice({
            name: copy.name,
            description: copy.description,
            priceCents: copy.price_cents,
            paymentType: copy.payment_type,
            billingInterval: copy.billing_interval,
            programId: copy.id,
          })
          await updateProgram(copy.id, { stripe_product_id: productId, stripe_price_id: priceId })
        }

        const { assignment, skipped } = await assignProgram({
          programId: copy.id,
          userId: input.user_id,
          startDate: input.start_date,
          assignedBy: session.user.id,
          complimentary: input.complimentary,
          releaseBaseWeek: input.release_weekly ? input.weeks_visible_at_start : null,
          releaseAnchorAt: input.release_weekly ? releaseAnchorFor(input.start_date, new Date()) : null,
        })
        if (skipped || !assignment) throw new Error("assignProgram skipped a brand-new program")

        const res = NextResponse.json({ program: copy, assignment }, { status: 201 })
        res.headers.set("x-audit-target-id", copy.id)
        return res
      } catch (err) {
        console.error(`[give] rolling back copy ${copy.id}:`, err)
        await deleteProgram(copy.id).catch((e) => console.error(`[give] rollback of ${copy.id} failed:`, e))
        return NextResponse.json({ error: "Couldn't give the program to this client. Nothing was saved." }, { status: 500 })
      }
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      console.error("[give]", err)
      return NextResponse.json({ error: "Couldn't give the program to this client." }, { status: 500 })
    }
  },
)
```

- [ ] **Step 4: Run it and see it pass.** Same command. Expected: PASS.

- [ ] **Step 5: Type gate, then commit**

```bash
git add "app/api/admin/programs/[id]/give" __tests__/api/admin/program-give-route.test.ts
git commit -m "feat(programs): give a library program to a client as their own copy"
```

---

### Task 9: Admin Library UI

**Files:**
- Modify: `app/(admin)/admin/programs/page.tsx` (tabs and library data)
- Create: `components/admin/library/LibraryView.tsx`
- Create: `components/admin/library/FolderNameDialog.tsx`
- Create: `components/admin/library/GiveToClientDialog.tsx`
- Create: `components/admin/library/SaveToLibraryDialog.tsx`
- Modify: `components/admin/ProgramList.tsx` (a "Save to library" row action; header wording)
- Modify: `components/admin/ProgramFormDialog.tsx` (`folderId` prop)
- Modify: `components/admin/ProgramHeader.tsx` ("Give to client" for a library program)
- Modify: `app/(admin)/admin/programs/[id]/page.tsx` (the back link goes to the library for a template)

**Interfaces:**
- Consumes: the Task 7 and Task 8 HTTP contracts; `listProgramFolders`, `getLibraryPrograms` (Task 6);
  `resolveAdminTenant` (`@/lib/tenancy/resolve`)
- Produces:
  - `<LibraryView folders programs initialFolderId? />`
  - `<GiveToClientDialog open onOpenChange program clients />`
  - `<SaveToLibraryDialog open onOpenChange program />`
  - `<FolderNameDialog open onOpenChange folder? onSaved? />`
  - `ProgramFormDialog` gains `folderId?: string`

No unit tests: these components only call the tested routes. Task 11 proves them in the real app.

- [ ] **Step 1: `components/admin/library/FolderNameDialog.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ProgramFolder } from "@/types/database"

interface FolderNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rename this folder; omit to create a new one. */
  folder?: ProgramFolder | null
  onSaved?: (folder: ProgramFolder) => void
}

export function FolderNameDialog({ open, onOpenChange, folder, onSaved }: FolderNameDialogProps) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setName(folder?.name ?? "")
  }, [open, folder])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(folder ? `/api/admin/programs/folders/${folder.id}` : "/api/admin/programs/folders", {
        method: folder ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save the folder.")
        return
      }
      toast.success(folder ? "Folder renamed" : "Folder created")
      onSaved?.(body.folder)
      onOpenChange(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{folder ? "Rename folder" : "New folder"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              value={name}
              maxLength={80}
              placeholder="e.g. 12-week strength"
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: `components/admin/library/GiveToClientDialog.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Program, User } from "@/types/database"

interface GiveToClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program: Program | null
  clients: User[]
}

/** YYYY-MM-DD in the coach's own time zone. */
function todayIso(): string {
  return new Date().toLocaleDateString("en-CA")
}

export function GiveToClientDialog({ open, onOpenChange, program, clients }: GiveToClientDialogProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [startDate, setStartDate] = useState(todayIso())
  const [releaseWeekly, setReleaseWeekly] = useState(true)
  const [weeksAtStart, setWeeksAtStart] = useState(1)
  const [complimentary, setComplimentary] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch("")
    setClientId(null)
    setName(program?.name ?? "")
    setNameTouched(false)
    setStartDate(todayIso())
    setReleaseWeekly(true)
    setWeeksAtStart(1)
    setComplimentary(false)
  }, [open, program])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return clients
    return clients.filter((c) => `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(q))
  }, [clients, search])

  function pick(client: User) {
    setClientId(client.id)
    if (!nameTouched && program) setName(`${program.name} – ${client.first_name}`)
  }

  const duration = program?.duration_weeks ?? 1
  const canSubmit =
    !!program &&
    !!clientId &&
    name.trim().length > 0 &&
    (!releaseWeekly || (weeksAtStart >= 1 && weeksAtStart <= duration))

  async function submit() {
    if (!program || !clientId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/programs/${program.id}/give`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: clientId,
          name: name.trim(),
          start_date: startDate,
          release_weekly: releaseWeekly,
          weeks_visible_at_start: weeksAtStart,
          complimentary,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't give the program. Please try again.")
        return
      }
      toast.success("Program given. It is now in their account.")
      onOpenChange(false)
      router.push(`/admin/programs/${body.program.id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Give to a client</DialogTitle>
          <DialogDescription>
            The client gets their own copy of “{program?.name}”. Changing the library program later will not
            change their copy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="give-search">Client</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="give-search"
                placeholder="Search clients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Clients">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No clients found.</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={clientId === c.id}
                    onClick={() => pick(c)}
                    className={cn(
                      "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface/50",
                      clientId === c.id && "bg-primary/10",
                    )}
                  >
                    <span className="font-medium text-foreground">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.email}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="give-name">Name of their program</Label>
            <Input
              id="give-name"
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="give-start">Start date</Label>
            <Input id="give-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="give-release">Release one week at a time</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  A new week opens every 7 days while their payment is active. If they cancel, no new weeks open.
                </p>
              </div>
              <Switch id="give-release" checked={releaseWeekly} onCheckedChange={setReleaseWeekly} />
            </div>
            {releaseWeekly && (
              <div className="space-y-2">
                <Label htmlFor="give-weeks">Weeks they can see at the start</Label>
                <Input
                  id="give-weeks"
                  type="number"
                  min={1}
                  max={duration}
                  value={weeksAtStart}
                  onChange={(e) => setWeeksAtStart(Number(e.target.value))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Out of {duration} week{duration === 1 ? "" : "s"}. You can open or hide any week later on the
                  program page.
                </p>
              </div>
            )}
          </div>

          {program?.price_cents ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={complimentary} onCheckedChange={(v) => setComplimentary(v === true)} />
              Free for this client (no payment needed)
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? "Giving..." : "Give program"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: `components/admin/library/SaveToLibraryDialog.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Program, ProgramFolder } from "@/types/database"

const NEW_FOLDER = "__new__"

interface SaveToLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program: Program | null
}

export function SaveToLibraryDialog({ open, onOpenChange, program }: SaveToLibraryDialogProps) {
  const router = useRouter()
  const [folders, setFolders] = useState<ProgramFolder[] | null>(null)
  const [folderId, setFolderId] = useState("")
  const [newFolder, setNewFolder] = useState("")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(program?.name ?? "")
    setNewFolder("")
    setFolders(null)
    fetch("/api/admin/programs/folders")
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((d: { folders?: ProgramFolder[] }) => {
        const list = d.folders ?? []
        setFolders(list)
        setFolderId(list[0]?.id ?? NEW_FOLDER)
      })
      .catch(() => {
        setFolders([])
        setFolderId(NEW_FOLDER)
      })
  }, [open, program])

  async function submit() {
    if (!program) return
    setSaving(true)
    try {
      let target = folderId
      if (folderId === NEW_FOLDER) {
        const res = await fetch("/api/admin/programs/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newFolder }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(body.error ?? "Couldn't create the folder.")
          return
        }
        target = body.folder.id
      }
      const res = await fetch(`/api/admin/programs/${program.id}/save-to-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: target, name: name.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save to the library.")
        return
      }
      toast.success("Saved to your library")
      onOpenChange(false)
      router.push(`/admin/programs?tab=library&folder=${target}`)
    } finally {
      setSaving(false)
    }
  }

  const needsNewName = folderId === NEW_FOLDER && newFolder.trim().length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to library</DialogTitle>
          <DialogDescription>
            A copy goes into your library, ready to give to new clients. This program and anyone on it are not
            changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="save-folder">Folder</Label>
            <select
              id="save-folder"
              value={folderId}
              disabled={folders == null}
              onChange={(e) => setFolderId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
            >
              {(folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value={NEW_FOLDER}>+ New folder…</option>
            </select>
            {folderId === NEW_FOLDER && (
              <Input
                aria-label="New folder name"
                placeholder="e.g. 12-week strength"
                maxLength={80}
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="save-name">Name in the library</Label>
            <Input id="save-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || folders == null || needsNewName || name.trim().length === 0}>
            {saving ? "Saving..." : "Save to library"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: `components/admin/library/LibraryView.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, Folder, FolderInput, FolderPlus, Library, MoreHorizontal, Pencil, Plus, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"
import { ProgramFormDialog } from "@/components/admin/ProgramFormDialog"
import { FolderNameDialog } from "@/components/admin/library/FolderNameDialog"
import { GiveToClientDialog } from "@/components/admin/library/GiveToClientDialog"
import { cn } from "@/lib/utils"
import type { Program, ProgramFolder, User } from "@/types/database"

interface LibraryViewProps {
  folders: ProgramFolder[]
  programs: Program[]
  initialFolderId?: string
}

function formatPrice(cents: number | null): string {
  return cents == null ? "Free" : `$${(cents / 100).toFixed(2)}`
}

export function LibraryView({ folders, programs, initialFolderId }: LibraryViewProps) {
  const router = useRouter()
  const [folderId, setFolderId] = useState<string | null>(
    initialFolderId && folders.some((f) => f.id === initialFolderId) ? initialFolderId : (folders[0]?.id ?? null),
  )
  const [clients, setClients] = useState<User[]>([])
  const [folderDialog, setFolderDialog] = useState<{ folder: ProgramFolder | null } | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<ProgramFolder | null>(null)
  const [giveTarget, setGiveTarget] = useState<Program | null>(null)
  const [moveTarget, setMoveTarget] = useState<Program | null>(null)
  const [moveTo, setMoveTo] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Program | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Program | null>(null)
  const [busy, setBusy] = useState(false)

  // Keep the selection valid after a folder is created or deleted (router.refresh()).
  useEffect(() => {
    if (!folders.some((f) => f.id === folderId)) setFolderId(folders[0]?.id ?? null)
  }, [folders, folderId])

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/users?role=client")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setClients(data.users ?? data ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const countByFolder = new Map<string, number>()
  for (const p of programs) {
    if (p.folder_id) countByFolder.set(p.folder_id, (countByFolder.get(p.folder_id) ?? 0) + 1)
  }
  const current = folders.find((f) => f.id === folderId) ?? null
  const rows = programs.filter((p) => p.folder_id === folderId)

  async function send(url: string, init: RequestInit, success: string): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Something went wrong. Please try again.")
        return false
      }
      toast.success(success)
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  if (folders.length === 0) {
    return (
      <div>
        <EmptyState
          icon={Library}
          heading="Your library is empty"
          description="Make a folder, then save a program into it or build a new one. Programs in your library are never shown to clients. You give each client their own copy."
        />
        <div className="flex justify-center">
          <Button size="sm" onClick={() => setFolderDialog({ folder: null })}>
            <FolderPlus className="size-4" />
            New folder
          </Button>
        </div>
        <FolderNameDialog
          open={!!folderDialog}
          onOpenChange={(o) => !o && setFolderDialog(null)}
          folder={null}
          onSaved={(f) => setFolderId(f.id)}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="rounded-xl border border-border bg-white p-2 shadow-sm h-fit" aria-label="Library folders">
        <ul className="space-y-0.5">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setFolderId(f.id)}
                aria-current={f.id === folderId ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                  f.id === folderId ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface/50",
                )}
              >
                <Folder className="size-4 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-xs text-muted-foreground">{countByFolder.get(f.id) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => setFolderDialog({ folder: null })}>
          <FolderPlus className="size-4" />
          New folder
        </Button>
      </aside>

      <DataTableCard>
        <DataTableToolbar className="sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-heading text-sm font-semibold text-foreground truncate">{current?.name}</h2>
            {current && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Folder options">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setFolderDialog({ folder: current })}>
                    <Pencil className="size-3.5" /> Rename folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={(countByFolder.get(current.id) ?? 0) > 0}
                    onSelect={() => setDeleteFolder(current)}
                    className="text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    {(countByFolder.get(current.id) ?? 0) > 0 ? "Delete (move or delete its programs first)" : "Delete folder"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            disabled={!current}
          >
            <Plus className="size-4" />
            New program
          </Button>
        </DataTableToolbar>

        <DataTable>
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead className="hidden md:table-cell">Length</DataTableHead>
            <DataTableHead className="hidden md:table-cell">Sessions/wk</DataTableHead>
            <DataTableHead className="hidden lg:table-cell">Price</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <tbody>
            {rows.map((p) => (
              <DataTableRow key={p.id}>
                <DataTableCell className="font-medium">
                  <Link href={`/admin/programs/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </DataTableCell>
                <DataTableCell muted className="hidden md:table-cell">
                  {p.duration_weeks} week{p.duration_weeks !== 1 ? "s" : ""}
                </DataTableCell>
                <DataTableCell muted className="hidden md:table-cell">
                  {p.sessions_per_week}x
                </DataTableCell>
                <DataTableCell muted className="hidden lg:table-cell">
                  {formatPrice(p.price_cents)}
                </DataTableCell>
                <DataTableCell align="right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setGiveTarget(p)}>
                      <Send className="size-3.5" />
                      Give to client
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${p.name}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(p)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil className="size-3.5" /> Edit details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() =>
                            send(
                              `/api/admin/programs/${p.id}/save-to-library`,
                              { method: "POST", body: JSON.stringify({ folder_id: p.folder_id, name: `${p.name} (copy)` }) },
                              "Copy made in this folder",
                            )
                          }
                        >
                          <Copy className="size-3.5" /> Make a copy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={folders.length < 2}
                          onSelect={() => {
                            setMoveTarget(p)
                            setMoveTo(folders.find((f) => f.id !== p.folder_id)?.id ?? "")
                          }}
                        >
                          <FolderInput className="size-3.5" /> Move to folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(p)}>
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
            {rows.length === 0 && (
              <DataTableEmpty colSpan={5}>
                No programs in this folder yet. Use “New program”, or “Save to library” on a client program.
              </DataTableEmpty>
            )}
          </tbody>
        </DataTable>
      </DataTableCard>

      <FolderNameDialog
        open={!!folderDialog}
        onOpenChange={(o) => !o && setFolderDialog(null)}
        folder={folderDialog?.folder ?? null}
        onSaved={(f) => setFolderId(f.id)}
      />
      <GiveToClientDialog
        open={!!giveTarget}
        onOpenChange={(o) => !o && setGiveTarget(null)}
        program={giveTarget}
        clients={clients}
      />
      <ProgramFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        program={editing}
        folderId={editing ? undefined : (current?.id ?? undefined)}
      />

      <Dialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move “{moveTarget?.name}”</DialogTitle>
          </DialogHeader>
          <select
            aria-label="Folder"
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            {folders
              .filter((f) => f.id !== moveTarget?.folder_id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || !moveTo}
              onClick={async () => {
                if (!moveTarget) return
                const ok = await send(
                  `/api/admin/programs/${moveTarget.id}/folder`,
                  { method: "PATCH", body: JSON.stringify({ folder_id: moveTo }) },
                  "Program moved",
                )
                if (ok) setMoveTarget(null)
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This removes it from your library. Copies you already gave to clients are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteTarget) return
                const ok = await send(`/api/admin/programs/${deleteTarget.id}`, { method: "DELETE" }, "Program deleted")
                if (ok) setDeleteTarget(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteFolder} onOpenChange={(o) => !o && setDeleteFolder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete the folder “{deleteFolder?.name}”?</DialogTitle>
            <DialogDescription>The folder is empty, so nothing else is removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFolder(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteFolder) return
                const ok = await send(`/api/admin/programs/folders/${deleteFolder.id}`, { method: "DELETE" }, "Folder deleted")
                if (ok) setDeleteFolder(null)
              }}
            >
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

  Before relying on them, check the primitives this uses:
  - `grep -n "icon-xs" components/ui/button.tsx`. ProgramList already uses `size="icon-xs"`, so it exists.
  - `grep -n "destructive" components/ui/button.tsx` for `variant="destructive"`. If it is missing, use
    `variant="outline"` with `className="text-destructive"`.
  - `grep -n "export" components/ui/dropdown-menu.tsx` for the menu exports.

- [ ] **Step 5: `ProgramFormDialog` `folderId` prop.** In `components/admin/ProgramFormDialog.tsx`:
  - Add to `ProgramFormDialogProps`:
    `/** Create the program inside this library folder. Ignored when editing. */ folderId?: string`.
  - Destructure `folderId` in the component signature.
  - Change `body: JSON.stringify(result.data),` to
    `body: JSON.stringify(!isEditing && folderId ? { ...result.data, folder_id: folderId } : result.data),`.

- [ ] **Step 6: `ProgramList` "Save to library".** In `components/admin/ProgramList.tsx`:
  - Add `FolderPlus` to the lucide import.
  - Add `import { SaveToLibraryDialog } from "@/components/admin/library/SaveToLibraryDialog"`.
  - Add state `const [saveTarget, setSaveTarget] = useState<Program | null>(null)`.
  - In the row actions, before the Pencil button, add:

```tsx
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setSaveTarget(program)}
                        title="Save a copy to your library"
                        aria-label={`Save ${program.name} to your library`}
                      >
                        <FolderPlus className="size-3.5" />
                      </Button>
```

  - Render `<SaveToLibraryDialog open={!!saveTarget} onOpenChange={(o) => !o && setSaveTarget(null)} program={saveTarget} />`
    next to the other dialogs, in the main return.
  - Change the header text `… in library` to
    `{programs.length} client program{programs.length !== 1 ? "s" : ""}`.

- [ ] **Step 7: Programs page tabs.** Rewrite `app/(admin)/admin/programs/page.tsx`'s signature and data:

```tsx
import Link from "next/link"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getLibraryPrograms } from "@/lib/db/programs"
import { listProgramFolders } from "@/lib/db/program-folders"
import { LibraryView } from "@/components/admin/library/LibraryView"
import { cn } from "@/lib/utils"
import type { ProgramFolder } from "@/types/database"

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; folder?: string }>
}) {
  const { tab, folder } = await searchParams
  const showLibrary = tab === "library"
  // …existing Promise.all unchanged…

  let library: { folders: ProgramFolder[]; programs: Program[] } | null = null
  if (showLibrary) {
    const { businessId } = await resolveAdminTenant()
    const [folders, libraryPrograms] = await Promise.all([listProgramFolders(businessId), getLibraryPrograms(businessId)])
    library = { folders, programs: libraryPrograms }
  }
```

  Keep `getPrograms` in the existing import, adding `getLibraryPrograms` to it. Between the stats grid
  and the list, render the tabs, then switch the list:

```tsx
      <nav aria-label="Program views" className="mb-4 inline-flex rounded-lg border border-border bg-white p-1 text-sm">
        <Link
          href="/admin/programs"
          aria-current={!showLibrary ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5",
            !showLibrary ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Client programs
        </Link>
        <Link
          href="/admin/programs?tab=library"
          aria-current={showLibrary ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5",
            showLibrary ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Library
        </Link>
      </nav>

      {library ? (
        <LibraryView folders={library.folders} programs={library.programs} initialFolderId={folder} />
      ) : (
        <ProgramList programs={programs} athleteCounts={athleteCounts} excelImportEnabled={excelImportEnabled} />
      )}
```

- [ ] **Step 8: Program detail page for a library program.** In `components/admin/ProgramHeader.tsx`:
  - Add `Send` to the lucide import and
    `import { GiveToClientDialog } from "@/components/admin/library/GiveToClientDialog"`.
  - Add `const [giveOpen, setGiveOpen] = useState(false)`.
  - Replace the Assign `<Button>` with:

```tsx
            {program.is_template ? (
              <Button size="sm" onClick={() => setGiveOpen(true)}>
                <Send className="size-3.5" />
                Give to client
              </Button>
            ) : (
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                <UserPlus className="size-3.5" />
                Assign
              </Button>
            )}
```

  - After `<AssignProgramDialog … />`, add
    `<GiveToClientDialog open={giveOpen} onOpenChange={setGiveOpen} program={program} clients={clients} />`.
  - In `app/(admin)/admin/programs/[id]/page.tsx`, point the back `<Link>`'s `href` at
    `{program.is_template ? "/admin/programs?tab=library" : "/admin/programs"}`.

- [ ] **Step 9: Type gate.** It must equal the baseline, with zero errors in any file this task touched.
  Then run `PATH=/opt/homebrew/bin:$PATH npm run lint -- --file components/admin/library` (or the
  repo's `next lint` file flag) and fix what it reports in these files.

- [ ] **Step 10: Commit**

```bash
git add components/admin/library components/admin/ProgramList.tsx components/admin/ProgramFormDialog.tsx components/admin/ProgramHeader.tsx "app/(admin)/admin/programs/page.tsx" "app/(admin)/admin/programs/[id]/page.tsx"
git commit -m "feat(programs): library tab with folders, give-to-client and save-to-library"
```

---

### Task 10: Per-client week control

**Files:**
- Modify: `app/api/admin/assignments/[id]/route.ts` (PATCH accepts `release_schedule`)
- Modify: `app/api/admin/programs/[id]/week-access/route.ts` (POST action `set_visibility`)
- Modify: `components/admin/WeekAccessPanel.tsx`
- Test: `__tests__/api/admin/week-release-controls.test.ts`

**Interfaces:**
- Consumes: `weekState`, `unlockDate`, `formatUnlockDate` (Task 2); the extended
  `getActiveAssignmentsForProgram` columns and the audit slugs (Task 6)
- Produces:
  - `PATCH /api/admin/assignments/[id] { release_schedule: boolean }`
  - `POST /api/admin/programs/[id]/week-access { assignmentId, weekNumber, action: "set_visibility", visibility }`

- [ ] **Step 1: Write the failing route test**

```ts
// @vitest-environment node
// __tests__/api/admin/week-release-controls.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const getAssignmentById = vi.fn()
const updateAssignment = vi.fn()
const getWeekAccess = vi.fn()
const updateWeekAccess = vi.fn()
const createWeekAccess = vi.fn()
const recordAudit = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "coach-1", role: "admin" } }) }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentById: (...a: unknown[]) => getAssignmentById(...a),
  updateAssignment: (...a: unknown[]) => updateAssignment(...a),
  deleteAssignment: vi.fn(),
  getActiveAssignmentsForProgram: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  getWeekAccess: (...a: unknown[]) => getWeekAccess(...a),
  updateWeekAccess: (...a: unknown[]) => updateWeekAccess(...a),
  createWeekAccess: (...a: unknown[]) => createWeekAccess(...a),
  getWeekAccessByAssignment: vi.fn(),
}))

import { PATCH as patchAssignment } from "@/app/api/admin/assignments/[id]/route"
import { POST as weekAccessPOST } from "@/app/api/admin/programs/[id]/week-access/route"

const NOW = new Date("2026-10-05T10:00:00Z")
const patch = (body: unknown) =>
  patchAssignment(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "a1" }),
  })
const post = (body: unknown) =>
  weekAccessPOST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "prog-1" }),
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  getAssignmentById.mockReset()
  updateAssignment.mockReset().mockResolvedValue({ id: "a1" })
  getWeekAccess.mockReset()
  updateWeekAccess.mockReset().mockResolvedValue({ id: "wa-1" })
  createWeekAccess.mockReset().mockResolvedValue({ id: "wa-new" })
  recordAudit.mockReset()
})
afterEach(() => vi.useRealTimers())

describe("PATCH release_schedule", () => {
  it("starts the schedule from the client's current week, so nothing they already see disappears", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "paid", current_week: 5 })
    expect((await patch({ release_schedule: true })).status).toBe(200)
    expect(updateAssignment).toHaveBeenCalledWith("a1", {
      release_base_week: 5,
      release_anchor_at: NOW.toISOString(),
    })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assignment.release_schedule_changed" }))
  })

  it("leaves the clock stopped while payment is pending", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "pending", current_week: 1 })
    await patch({ release_schedule: true })
    expect(updateAssignment).toHaveBeenCalledWith("a1", { release_base_week: 1, release_anchor_at: null })
  })

  it("off makes every week visible again", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "paid", current_week: 3 })
    await patch({ release_schedule: false })
    expect(updateAssignment).toHaveBeenCalledWith("a1", { release_base_week: null, release_anchor_at: null })
  })

  it("rejects a non-boolean", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "paid", current_week: 3 })
    expect((await patch({ release_schedule: "yes" })).status).toBe(400)
    expect(updateAssignment).not.toHaveBeenCalled()
  })
})

describe("POST set_visibility", () => {
  const body = (visibility: string) => ({ assignmentId: "a1", weekNumber: 3, action: "set_visibility", visibility })

  it("404s an assignment that belongs to another program", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", program_id: "other" })
    expect((await post(body("hidden"))).status).toBe(404)
    expect(updateWeekAccess).not.toHaveBeenCalled()
  })

  it("updates the existing week row", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", program_id: "prog-1" })
    getWeekAccess.mockResolvedValue({ id: "wa-1" })
    expect((await post(body("hidden"))).status).toBe(200)
    expect(updateWeekAccess).toHaveBeenCalledWith("wa-1", { visibility: "hidden" })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assignment.week_visibility_changed" }))
  })

  it("creates an included row when the week has none", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", program_id: "prog-1" })
    getWeekAccess.mockResolvedValue(null)
    await post(body("shown"))
    expect(createWeekAccess).toHaveBeenCalledWith(
      expect.objectContaining({ assignment_id: "a1", week_number: 3, access_type: "included", visibility: "shown" }),
    )
  })

  it("rejects an unknown visibility", async () => {
    expect((await post(body("maybe"))).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `PATH=/opt/homebrew/bin:$PATH npx vitest run __tests__/api/admin/week-release-controls.test.ts`
Expected: FAIL. `release_schedule` is answered "No update fields provided", and `set_visibility` is an
"Invalid action".

- [ ] **Step 3: Assignment PATCH.** In `app/api/admin/assignments/[id]/route.ts`:
  - Destructure `release_schedule` from `body`.
  - Add `release_schedule === undefined &&` to the "no update fields" condition.
  - Add validation:

```ts
    if (release_schedule !== undefined && typeof release_schedule !== "boolean") {
      return NextResponse.json({ error: "release_schedule must be true or false" }, { status: 400 })
    }
```

  - After `if (expires_at !== undefined) updates.expires_at = expires_at`:

```ts
    if (release_schedule === true) {
      // Start from the week the client is on, so nothing they can already see disappears. The clock
      // runs only while the assignment is active and paid; the DB trigger takes over from here.
      const running =
        (status ?? existing.status) === "active" && (payment_status ?? existing.payment_status) !== "pending"
      updates.release_base_week = Math.max(1, existing.current_week ?? 1)
      updates.release_anchor_at = running ? new Date().toISOString() : null
    } else if (release_schedule === false) {
      updates.release_base_week = null
      updates.release_anchor_at = null
    }
```

  - Change the audit `action` expression to:

```ts
      action: status
        ? "assignment.status_changed"
        : release_schedule !== undefined
          ? "assignment.release_schedule_changed"
          : "assignment.updated",
```

  - Change the `metadata` expression to:

```ts
      metadata: status
        ? { new_status: status }
        : release_schedule !== undefined
          ? { release_schedule }
          : { changed: Object.keys(body) },
```

- [ ] **Step 4: week-access POST `set_visibility`.** In `app/api/admin/programs/[id]/week-access/route.ts`:
  - Change the signature to
    `export async function POST(request: Request, { params }: { params: Promise<{ id: string }> })`.
  - Add the imports `import { getAssignmentById } from "@/lib/db/assignments"`,
    `import { getWeekAccess } from "@/lib/db/week-access"` (add it to the existing import) and
    `import { recordAudit } from "@/lib/audit/record"`.
  - Before `if (action === "grant_free")`, add:

```ts
    if (action === "set_visibility") {
      const { visibility } = body as { visibility?: unknown }
      if (visibility !== "auto" && visibility !== "shown" && visibility !== "hidden") {
        return NextResponse.json({ error: "visibility must be auto, shown or hidden" }, { status: 400 })
      }
      const { id: programId } = await params
      const assignment = await getAssignmentById(assignmentId)
      if (!assignment || assignment.program_id !== programId) {
        return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
      }
      const existing = await getWeekAccess(assignmentId, weekNumber)
      const row = existing
        ? await updateWeekAccess(existing.id, { visibility })
        : await createWeekAccess({
            assignment_id: assignmentId,
            week_number: weekNumber,
            access_type: "included",
            price_cents: null,
            payment_status: "not_required",
            stripe_session_id: null,
            stripe_payment_id: null,
            visibility,
          })
      void recordAudit({
        action: "assignment.week_visibility_changed",
        category: "admin_write",
        target: { type: "assignment", id: assignmentId },
        metadata: { week_number: weekNumber, visibility },
        request,
      })
      return NextResponse.json(row)
    }
```

  - The existing `!assignmentId || !weekNumber` guard runs first. The test body carries both, so the
    "maybe" case reaches the visibility check. Confirm its 400 body says "visibility must be …", not
    "assignmentId and weekNumber required".

- [ ] **Step 5: Run the test and see it pass.** Same command. Expected: PASS. Then run
  `grep -rln "admin/assignments/\[id\]/route\"\|week-access/route\"" __tests__` and run each file found.

- [ ] **Step 6: WeekAccessPanel UI.** In `components/admin/WeekAccessPanel.tsx`:
  - Add `Switch` (`@/components/ui/switch`), the icons `Eye, EyeOff, CalendarClock` to the lucide import,
    and `import { weekState, unlockDate, formatUnlockDate } from "@/lib/programs/week-visibility"`.
  - Extend `AssignmentInfo` with:

```ts
  status: string
  current_week: number
  release_base_week: number | null
  release_anchor_at: string | null
```

  - Change `selectedWeek`'s state type to also carry `assignment: AssignmentInfo`. Make
    `openWeekModal(assignment: AssignmentInfo, weekNumber: number, clientName: string)` set
    `{ assignmentId: assignment.id, assignment, weekNumber, clientName, access }`, and update its single
    call site to pass `assignment`.
  - Add these functions next to `handleAction`:

```ts
  async function setVisibility(visibility: "auto" | "shown" | "hidden") {
    if (!selectedWeek) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: selectedWeek.assignmentId,
          weekNumber: selectedWeek.weekNumber,
          action: "set_visibility",
          visibility,
        }),
      })
      if (!res.ok) throw new Error("Failed")
      const w = selectedWeek.weekNumber
      toast.success(
        visibility === "hidden"
          ? `Week ${w} is hidden from ${selectedWeek.clientName}`
          : visibility === "shown"
            ? `Week ${w} is open for ${selectedWeek.clientName}`
            : `Week ${w} follows the weekly schedule again`,
      )
      setSelectedWeek(null)
      await fetchData()
    } catch {
      toast.error("Couldn't change this week")
    } finally {
      setActionLoading(false)
    }
  }

  async function toggleSchedule(assignmentId: string, on: boolean) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_schedule: on }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(on ? "One week at a time is on" : "Every week is now visible")
      await fetchData()
    } catch {
      toast.error("Couldn't change the weekly release")
    } finally {
      setActionLoading(false)
    }
  }

  function scheduleSummary(a: AssignmentInfo, now: Date): string {
    if (a.release_base_week == null) return "This client can see every week."
    if (!a.release_anchor_at) return "New weeks are paused until this client's payment is active again."
    for (let w = 1; w <= totalWeeks; w++) {
      if (weekState(w, a, getAccessForWeek(a.id, w)?.visibility, now) === "scheduled") {
        const d = unlockDate(w, a)
        if (d) return `A new week opens every 7 days. Next: week ${w} on ${formatUnlockDate(d.toISOString())}.`
      }
    }
    return "A new week opens every 7 days. Every week is already open."
  }
```

  - In the assignment card, replace the header `div` (name + payment badge) with:

```tsx
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{clientName}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {assignment.payment_status}
                        </Badge>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={assignment.release_base_week != null}
                          disabled={actionLoading}
                          onCheckedChange={(v) => toggleSchedule(assignment.id, v)}
                          aria-label={`Release one week at a time for ${clientName}`}
                        />
                        One week at a time
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{scheduleSummary(assignment, now)}</p>
```

  - Add `const now = new Date()` at the top of the render body. The panel renders only after a
    client-side fetch, so there is no hydration mismatch.
  - In the week chip `map`, compute
    `const state = weekState(week, assignment, access?.visibility, now)`.
  - Give the chip button
    `title={state === "hidden" ? "Hidden by you" : state === "scheduled" ? "Not out yet" : "Visible"}` and add
    `${state !== "visible" ? " opacity-60" : ""}` to its className.
  - Replace the chip's icon ternary's first branch so it reads:

```tsx
                            {state === "hidden" ? (
                              <EyeOff className="size-3" />
                            ) : state === "scheduled" ? (
                              <CalendarClock className="size-3" />
                            ) : weekIsPending ? (
```

    The `(... rest unchanged)` branches stay as they are.
  - Add to the legend row:

```tsx
                      <span className="flex items-center gap-0.5">
                        <CalendarClock className="size-2.5" /> Not out yet
                      </span>
                      <span className="flex items-center gap-0.5">
                        <EyeOff className="size-2.5" /> Hidden
                      </span>
```

  - In the week modal, after the "Current status badge" block inside `<div className="space-y-3 py-2">`,
    add:

```tsx
            {selectedWeek &&
              (() => {
                const vis = modalAccess?.visibility ?? "auto"
                const state = weekState(selectedWeek.weekNumber, selectedWeek.assignment, vis, new Date())
                const date = unlockDate(selectedWeek.weekNumber, selectedWeek.assignment)
                const label =
                  state === "hidden"
                    ? "No, you hid this week"
                    : state === "scheduled"
                      ? date
                        ? `Not yet. It opens on ${formatUnlockDate(date.toISOString())}`
                        : "Not yet. New weeks are paused"
                      : vis === "shown"
                        ? "Yes, you opened it early"
                        : "Yes"
                return (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs">
                      <span className="text-muted-foreground">Can the client see it? </span>
                      {label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {state !== "visible" && (
                        <Button size="sm" variant="outline" onClick={() => setVisibility("shown")} disabled={actionLoading}>
                          <Eye className="size-3 mr-1.5" /> Show now
                        </Button>
                      )}
                      {vis !== "hidden" && (
                        <Button size="sm" variant="outline" onClick={() => setVisibility("hidden")} disabled={actionLoading}>
                          <EyeOff className="size-3 mr-1.5" /> Hide
                        </Button>
                      )}
                      {vis !== "auto" && (
                        <Button size="sm" variant="ghost" onClick={() => setVisibility("auto")} disabled={actionLoading}>
                          Back to the weekly schedule
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })()}
```

  - Change the explainer `<p>` text to: "Choose which weeks each client can see, and handle paid weeks.
    Premium prices are set in **Pricing & access**."

- [ ] **Step 7: Type gate.** It must equal the baseline, with zero errors in the touched files.

- [ ] **Step 8: Commit**

```bash
git add "app/api/admin/assignments/[id]/route.ts" "app/api/admin/programs/[id]/week-access/route.ts" components/admin/WeekAccessPanel.tsx __tests__/api/admin/week-release-controls.test.ts
git commit -m "feat(programs): per-client weekly release switch and show/hide for each week"
```

---

### Task 11: Verification in the real app, screenshots, journal

**Files:**
- Create: `scripts/capture-program-library.mjs` (Playwright capture, clone-only)
- Create: `screenshots/program-library/` (PNGs plus `index.html`)

- [ ] **Step 1: Re-run every suite this branch wrote or touched, by file**

```bash
PATH=/opt/homebrew/bin:$PATH npx vitest run \
  __tests__/lib/programs/week-visibility.test.ts \
  __tests__/lib/services/access-guard-weeks.test.ts __tests__/lib/services/access-guard.test.ts \
  __tests__/api/client/workouts-week-gate.test.ts __tests__/api/client/workout-log-session-link.test.ts \
  __tests__/lib/services/copy-program.test.ts \
  __tests__/lib/db/program-library-readers.test.ts \
  __tests__/lib/services/assign-program-release.test.ts __tests__/lib/services/assign-program.test.ts \
  __tests__/lib/services/resync-week-access.test.ts __tests__/lib/funnels/checkout/grant-program.test.ts \
  __tests__/lib/tenancy/platform-inventory.test.ts \
  __tests__/api/admin/program-library-routes.test.ts __tests__/api/admin/program-give-route.test.ts \
  __tests__/api/admin/week-release-controls.test.ts
```
Expected: all PASS. Then run the tsc gate (= baseline), and both integration gates:
`PATH=/opt/homebrew/bin:$PATH npm run test:integration:selects` and
`PATH=/opt/homebrew/bin:$PATH npm run test:integration:drift`. Both must PASS.

- [ ] **Step 2: Start the dev server from the worktree.** Use webpack, because Turbopack fails on Google
  fonts in a fresh worktree:
  `PATH=/opt/homebrew/bin:$PATH npx next dev --webpack --port 3051` (run in the background).
  - Wait for `Ready`.
  - Do not pipe it through `head`.
  - Check that port 3051 is free first, since a peer session may be using 3050.

- [ ] **Step 3: Drive the real flow on the clone and assert the leak is closed.** Write
  `scripts/capture-program-library.mjs`. It must refuse to run unless `.env.local` points at
  `anjvztjiokcgiyhobknq`. Use the existing dev-only login that earlier capture scripts use (see
  `scripts/capture-pack-price-correction.mjs` for the sign-in pattern). The flow:
  1. As admin, open `/admin/programs?tab=library`. Create the folder "12-week strength".
  2. On the Client programs tab, use "Save to library" on an existing multi-week program on the clone
     that has a distinct exercise in week 2 not present in week 1. Record that week-2-only exercise name.
  3. In the library, use "Give to client" for the copy. Pick the clone's test client, keep "Release one
     week at a time" on, and set 1 week visible.
  4. Sign in as that test client in a fresh browser context. Load `/client/workouts`, then:
     - **assert** `(await page.content()).includes(<week-2-only name>) === false`, then
     - **assert** it includes a week-1 exercise name (the presence control).
     Either assert failing stops the script loudly.
  5. Step to week 2 in the client view. Assert the text "unlocks on" is visible.
  6. As admin, on the copy's program page, open the client week panel, open week 2 and click "Show now".
     Reload as the client, and assert the week-2 name now **is** in the HTML.

  Clean up afterwards, in `finally`, deleting by id on the clone only:
  - delete the test client's assignment and the copy program,
  - delete the library copy, then the folder.

  Log a timestamp per beat.
- [ ] **Step 4: Annotated screenshots.** These are real routes, in light mode only, because admin is
  light-only.
  - **Client view:** check whether the client area supports dark. If it does, add dark shots of the client
    view too.
  - **Markers:** burn numbered markers and captions into each PNG. Place them using
    `boundingBox() × deviceScaleFactor`.
  - **Width:** compose each PNG at the capture's own pixel width.
  - **Pointer:** park the pointer before every capture.

  Shots:
  1. Library tab with folders and the programs table.
  2. The "Give to a client" dialog filled in.
  3. "Save to library" from a client program.
  4. The program page's client week panel: the "One week at a time" switch, a "Not out yet" week and a
     hidden week.
  5. The week modal with Show now / Hide.
  6. The client's workouts page on week 1.
  7. The client's "Week 2 unlocks on …" card.
  8. The empty library state.
  9. The refused folder delete ("Move or delete its programs first").

  Write `screenshots/program-library/index.html` referencing the sibling PNGs (not base64), with one
  plain-language line per shot.

- [ ] **Step 5: Look at every PNG** with the Read tool before claiming it works. A marker covering text,
  or an empty table, means re-capture.

- [ ] **Step 6: Commit the capture script and screenshots**

```bash
git add scripts/capture-program-library.mjs screenshots/program-library
git commit -m "docs(programs): annotated screenshots of the program library and weekly release"
```

- [ ] **Step 7: Journal.** Add a dated `[Feature build-out]` entry at the top of the main checkout's
  `JOURNAL.md`.
  - **Do not stage it.** It is local only.
  - **Where:** this session is pinned to the worktree, so the controller writes it after leaving the
    worktree, or the owner does.
  - **Content:** what was built, the verification actually run (suite list, tsc count, integration gates,
    the HTML leak assert), what was not verified, and the mistakes and lessons.

- [ ] **Step 8: Ship order (owner's go-ahead required; do not do this unasked).**
  1. Push the migration commit alone and wait for the "Apply Supabase Migrations" workflow to go green.
     `getPrograms()` now filters on `is_template`, so this code 500s the programs page on a database
     without the column.
  2. Then push the rest.
  3. Run `npm run test:integration:selects` before merging to `main`.
