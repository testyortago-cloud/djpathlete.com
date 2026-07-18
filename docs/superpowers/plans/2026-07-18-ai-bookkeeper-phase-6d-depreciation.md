# AI Bookkeeper Phase 6d — Equipment Depreciation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A depreciable-asset register (`bookkeeping_assets`, migration 00189), a pure straight-line schedule whose final year absorbs rounding so it sums EXACTLY to basis − salvage, audited CRUD routes + a `/admin/books/assets` page with a per-asset schedule preview, and a Depreciation sheet in the accountant pack + a matching print section — report-layer only, NEVER a ledger row (D-12).

**Architecture:** One new table (no ledger changes — the `source` CHECK stays untouched). One pure zero-IO module `lib/bookkeeping/depreciation.ts` consumed by both the client preview and the pack/print. DAL CRUD in `lib/db/bookkeeping.ts` (Assets section), Zod enums pinned byte-identical to the DB CHECKs, routes with the house single-branch admin gate + inline `void recordAudit`. Pack/print read assets DIRECTLY via `listAssets()` (asset lifetimes cross report windows — `ReportEntry` is windowed and has no `id`), never through the report bundle.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod, Supabase service-role DAL, ExcelJS, Vitest, shadcn/ui, Tailwind v4 semantic classes.

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-6-design.md` §6 (+ D-12, D-13, §7 honesty guardrails, §9 gates). Pinned numbers below are copied from it verbatim.

## Global Constraints

- Branch `feat/ai-bookkeeper-phase-6` (already checked out — 6a/6b/6c commits precede these). Commit per task. NEVER push. Never stage the pre-existing dirty files (`render-worker/*`, `docs/superpowers/2026-07-18-*-kickoff-prompt.md`, `docs/superpowers/plans/2026-06-04-reel-no-audio-support.md`, `exercise-library-match.csv`, `step-up-for-students.html`, `JOURNAL.md`).
- Integer cents everywhere. `Math.round` appears at EXACTLY two defined POINTS IN THE CODE (the first-year-proration branch, the whole-middle-years branch); the final year is `base − accumulated`, never rounded. Reconciling with spec §6.2's phrasing ("`Math.round` per year at ONE defined point"): the spec counts per-YEAR (each year's own charge is rounded at most once — never re-rounded), the plan counts per-BRANCH across the whole algorithm (two branches that can fire, across all years, use `Math.round`). Both describe the same math; re-derived fixtures confirm no double-rounding of any single year. `formatCents` from `@/lib/bookkeeping/money` at display edges only.
- Depreciation NEVER touches `bookkeeping_ledger_entries` (D-12). Any import of `createEntry`/`insertImportedEntries`/etc. in new 6d code is a defect. No feature flag anywhere (downloads/report surfaces are unflagged per the Phase-4 amendment; the asset register is the same class).
- `method` / `convention` / `recovery_years` bounds exist in THREE places that must stay byte-identical: migration CHECKs, Zod enums, `types/database.ts` unions. `straight_line` is the ONLY method (D-13) — no AI anywhere near these fields; everything is accountant-supplied.
- Routes self-gate: `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })` — single 403, copied from `app/api/admin/bookkeeping/accounts/route.ts:8-10`. Audit is inline `void recordAudit({...})` (never `withAudit`); new slugs land in `lib/audit/actions.ts` in the SAME task that first records them (Task 3).
- Tests: pure schedule in `__tests__/lib/bookkeeping/` with ZERO mocks; route tests in `__tests__/app/api/admin/bookkeeping/` with `vi.mock` factories BEFORE imports, the `;(fn as ReturnType<typeof vi.fn>).mockResolvedValue(...)` cast idiom, duck-typed request bodies, `{ params: Promise.resolve({ id }) }` for dynamic segments, `as never` request casts. NEVER `__tests__/db/`. RFC-4122 mnemonic fixture UUIDs (version nibble 4, variant 8; `b…`=book, `ad…`=asset).
- UI: semantic classes only (`text-primary`, `text-muted-foreground`, `border-border`, `bg-card`), `font-heading` headings, no hex, no inline fontFamily; shadcn primitives already in `components/ui/`; dollars→cents via `Math.round(parseFloat(v) * 100)` (the `ManualEntryDialog.tsx:80` house idiom).
- Verification: scoped vitest via `npx vitest run <path>`; `npm run build` as its OWN command, NEVER chained behind `npm run test:run` with `&&` (known-red baseline exits non-zero and silently skips the build). Known-red family: uploads/shop, import-excel-route, admin-nav, webhook-external, events.
- Before writing code that calls an existing helper, READ the helper's real signature in source — do not trust this plan's memory of it (standing lesson, 5 phases running). Every signature below was verified against the working tree, but 6a-6c land first and may shift line numbers — anchor edits on text, not line numbers.

---

### Task 1: Migration `00189_bookkeeping_assets.sql`

**Files:**
- Create: `supabase/migrations/00189_bookkeeping_assets.sql`

**Interfaces:**
- Produces: the `bookkeeping_assets` table. Consumed by Task 3's DAL. No seeds, no settings, no ledger changes.

**Contracts (spec §6.1):** every CHECK below is load-bearing — Zod (Task 3) and `types/database.ts` mirror these exact value sets. `salvage_cents <= basis_cents` is a table-level CHECK. RLS ceremony in the 00183 admin-policy style (`FOR ALL USING (EXISTS … role = 'admin')`) — the DAL uses the service-role client, policy is ceremony, but the house always ships it on new tables.

- [ ] **Step 1: Write the migration file**

```sql
-- 00189_bookkeeping_assets.sql
-- AI Bookkeeper Phase 6d: depreciable-asset register (design §6.1, D-12/D-13).
-- Depreciation is REPORT-LAYER only — no ledger changes, no new `source` value.
-- All fields accountant-supplied; straight_line is the only method (D-13).
-- Money is integer cents. RLS is ceremony (DAL uses service-role) per 00183.

CREATE TABLE IF NOT EXISTS bookkeeping_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  basis_cents     INTEGER NOT NULL CHECK (basis_cents >= 0),
  salvage_cents   INTEGER NOT NULL DEFAULT 0 CHECK (salvage_cents >= 0),
  in_service_on   DATE NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('straight_line')),
  convention      TEXT NOT NULL CHECK (convention IN ('full_month','half_year')),
  recovery_years  INTEGER NOT NULL CHECK (recovery_years BETWEEN 1 AND 50),
  accountant_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (salvage_cents <= basis_cents)
);
CREATE INDEX IF NOT EXISTS idx_bk_assets_book ON bookkeeping_assets(book_id);

ALTER TABLE bookkeeping_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage assets" ON bookkeeping_assets FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
```

- [ ] **Step 2: Sanity-check numbering**

Run: `Get-ChildItem supabase/migrations -Name | Select-String "0018[89]|0019"` (this checks file NAMES; piping `ls` directly into `Select-String` scans file CONTENTS instead and is not the intended check).
Expected: `00188_*.sql` exists (6a), `00189_bookkeeping_assets.sql` is yours, no other 00189+.

**NOTE for the orchestrator (subagents cannot apply migrations):** the orchestrator applies it live via `mcp__supabase__apply_migration` (name `00189_bookkeeping_assets`, query = the file contents) before dependent route tests run — additive/inert precedent, table is dark until Task 3 lands. Route tests mock the DAL so they pass either way; the live apply must happen before the Task 6 sentinel proof.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00189_bookkeeping_assets.sql
git commit -m "feat(bookkeeper): migration 00189 — bookkeeping_assets register (straight-line only, CHECK-pinned)"
```

---

### Task 2: Pure straight-line schedule — `lib/bookkeeping/depreciation.ts`

**Files:**
- Create: `lib/bookkeeping/depreciation.ts`
- Test: `__tests__/lib/bookkeeping/depreciation.test.ts`

**Interfaces:**
- Consumes: nothing (zero imports — fully pure; the input type is structural so Task 3's `BookkeepingAsset` is assignable without this module importing DB types).
- Produces (Tasks 4 and 5 import these EXACT names): `DepreciableAsset`, `DepreciationYear`, `DepreciationScheduleResult`, `depreciationSchedule(asset: DepreciableAsset, throughYear: number): DepreciationScheduleResult`, `depreciationAsOf(asset: DepreciableAsset, year: number): { year_cents: number; accumulated_cents: number; remaining_cents: number }`.

**Pinned semantics (spec §6.2, D-13):** base = basis − salvage. `annual = base / recovery_years` (float, never rounded on its own). `full_month`: the first calendar year gets `(13 − in-service month)/12` of annual — the in-service month counts, so January = 12/12 (full annual) and December = 1/12. `half_year`: the first calendar year gets 6/12 of annual regardless of the in-service month. Middle years get `Math.round(annual)`. **The FINAL year of the span is `base − accumulated` — a remainder, never a rounding — so the schedule sums to base EXACTLY.** Span: `1 + ceil((recovery_years·12 − firstYearMonths)/12)` calendar years. `years` rows are truncated at `throughYear`; `fully_depreciated_in` is the final span year regardless of `throughYear`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/depreciation.test.ts
import { describe, expect, it } from "vitest"
import {
  depreciationAsOf,
  depreciationSchedule,
  type DepreciableAsset,
} from "@/lib/bookkeeping/depreciation"

function asset(over: Partial<DepreciableAsset>): DepreciableAsset {
  return {
    basis_cents: 10000,
    salvage_cents: 0,
    in_service_on: "2024-01-15",
    method: "straight_line",
    convention: "full_month",
    recovery_years: 3,
    ...over,
  }
}

const depSum = (r: { years: { depreciation_cents: number }[] }) =>
  r.years.reduce((s, y) => s + y.depreciation_cents, 0)

describe("depreciationSchedule — pinned spec fixtures", () => {
  it("10000¢/3yr full-month January: 3333/3333/3334 — the final year is the remainder", () => {
    // A naive round-every-year implementation yields 3333×3 = 9999 and never sums to base.
    const r = depreciationSchedule(asset({}), 2026)
    expect(r.years).toEqual([
      { year: 2024, depreciation_cents: 3333, accumulated_cents: 3333, remaining_cents: 6667 },
      { year: 2025, depreciation_cents: 3333, accumulated_cents: 6666, remaining_cents: 3334 },
      { year: 2026, depreciation_cents: 3334, accumulated_cents: 10000, remaining_cents: 0 },
    ])
    expect(r.fully_depreciated_in).toBe(2026)
    expect(depSum(r)).toBe(10000)
  })

  it("mid-year in-service (April) discriminates month-proration from half-year", () => {
    // full_month April = 9/12 of annual in year 1 (2500); a half-year impl would give 1667.
    const fm = depreciationSchedule(asset({ in_service_on: "2024-04-01" }), 2030)
    expect(fm.years.map((y) => y.depreciation_cents)).toEqual([2500, 3333, 3333, 834])
    expect(fm.fully_depreciated_in).toBe(2027)
    expect(depSum(fm)).toBe(10000)
    // half_year on the SAME asset: 6/12 in year 1 regardless of month.
    const hy = depreciationSchedule(asset({ in_service_on: "2024-04-01", convention: "half_year" }), 2030)
    expect(hy.years.map((y) => y.depreciation_cents)).toEqual([1667, 3333, 3333, 1667])
    expect(hy.fully_depreciated_in).toBe(2027)
    expect(depSum(hy)).toBe(10000)
  })

  it("December full-month in-service = 1/12 of annual in year 1 (spec sentence pinned)", () => {
    const r = depreciationSchedule(asset({ in_service_on: "2024-12-05" }), 2030)
    expect(r.years.map((y) => y.depreciation_cents)).toEqual([278, 3333, 3333, 3056])
    expect(depSum(r)).toBe(10000)
  })

  it("Math.round (not trunc) at the defined points: 10001¢/2yr January → 5001 then 5000", () => {
    // annual = 5000.5; trunc would give [5000, 5001] — inverted.
    const r = depreciationSchedule(asset({ basis_cents: 10001, recovery_years: 2 }), 2025)
    expect(r.years.map((y) => y.depreciation_cents)).toEqual([5001, 5000])
    expect(depSum(r)).toBe(10001)
  })

  it("salvage > 0 shrinks the base — remaining lands on 0, never −salvage", () => {
    // base = 90000, annual = 30000 exact; a salvage-ignoring impl gives 33333/33333/33334.
    const r = depreciationSchedule(asset({ basis_cents: 100000, salvage_cents: 10000 }), 2026)
    expect(r.years.map((y) => y.depreciation_cents)).toEqual([30000, 30000, 30000])
    expect(r.years[2].remaining_cents).toBe(0)
    expect(depSum(r)).toBe(90000)
  })

  it("throughYear truncates rows but never changes fully_depreciated_in", () => {
    const a = asset({})
    const before = depreciationSchedule(a, 2023)
    expect(before.years).toEqual([])
    expect(before.fully_depreciated_in).toBe(2026)
    const mid = depreciationSchedule(a, 2025)
    expect(mid.years).toHaveLength(2)
    expect(mid.years[1]).toMatchObject({ accumulated_cents: 6666, remaining_cents: 3334 })
    const after = depreciationSchedule(a, 2030)
    expect(after.years).toHaveLength(3)
  })

  it("recovery_years 1: January is a single-year schedule; March spans two (10/12 then remainder)", () => {
    const jan = depreciationSchedule(asset({ recovery_years: 1 }), 2030)
    expect(jan.years).toEqual([
      { year: 2024, depreciation_cents: 10000, accumulated_cents: 10000, remaining_cents: 0 },
    ])
    const mar = depreciationSchedule(asset({ recovery_years: 1, in_service_on: "2024-03-20" }), 2030)
    expect(mar.years.map((y) => y.depreciation_cents)).toEqual([8333, 1667])
    expect(mar.fully_depreciated_in).toBe(2025)
  })

  it("basis === salvage → all-zero schedule that still spans the recovery life", () => {
    const r = depreciationSchedule(asset({ basis_cents: 5000, salvage_cents: 5000 }), 2030)
    expect(r.years.every((y) => y.depreciation_cents === 0)).toBe(true)
    expect(r.fully_depreciated_in).toBe(2026)
  })
})

describe("depreciationAsOf — the pack's per-year lens", () => {
  const a = asset({}) // 3333/3333/3334 over 2024-2026
  it("before in-service: nothing depreciated, full base remaining", () => {
    expect(depreciationAsOf(a, 2023)).toEqual({ year_cents: 0, accumulated_cents: 0, remaining_cents: 10000 })
  })
  it("during: that year's charge + running accumulated", () => {
    expect(depreciationAsOf(a, 2025)).toEqual({ year_cents: 3333, accumulated_cents: 6666, remaining_cents: 3334 })
    expect(depreciationAsOf(a, 2026)).toEqual({ year_cents: 3334, accumulated_cents: 10000, remaining_cents: 0 })
  })
  it("after exhaustion: zero charge, fully accumulated", () => {
    expect(depreciationAsOf(a, 2028)).toEqual({ year_cents: 0, accumulated_cents: 10000, remaining_cents: 0 })
  })
  it("salvage asset ends at base, not basis", () => {
    const s = asset({ basis_cents: 100000, salvage_cents: 10000 })
    expect(depreciationAsOf(s, 2028)).toEqual({ year_cents: 0, accumulated_cents: 90000, remaining_cents: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/depreciation.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/depreciation`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/depreciation.ts
// Pure straight-line depreciation schedule (Phase 6d, design §6.2 / D-13).
// Zero IO, zero imports. Integer cents. Math.round at EXACTLY two points
// (first-year proration, whole middle years); the FINAL span year is the
// remainder base − accumulated, so every schedule sums to base EXACTLY.
// (Per spec §6.2's framing: each individual year is rounded at most ONCE —
// never re-rounded — these two branches are simply the two places in the
// code where that single per-year rounding can happen.)
// Inputs are DB-validated (CHECKs + Zod) — this module trusts them.
// Depreciation is tracked, not decided: report-layer only, never a ledger row (D-12).

export interface DepreciableAsset {
  basis_cents: number
  salvage_cents: number
  in_service_on: string // YYYY-MM-DD
  method: "straight_line"
  convention: "full_month" | "half_year"
  recovery_years: number
}

export interface DepreciationYear {
  year: number
  depreciation_cents: number
  accumulated_cents: number
  remaining_cents: number
}

export interface DepreciationScheduleResult {
  years: DepreciationYear[]
  fully_depreciated_in: number
}

export function depreciationSchedule(asset: DepreciableAsset, throughYear: number): DepreciationScheduleResult {
  const base = asset.basis_cents - asset.salvage_cents
  const startYear = Number(asset.in_service_on.slice(0, 4))
  const startMonth = Number(asset.in_service_on.slice(5, 7)) // 1-12
  const annual = base / asset.recovery_years // float — rounded per-year below, never here

  // Months credited to the first calendar year: the in-service month counts
  // (January = 12, December = 1); half_year is a flat 6 regardless of month.
  const firstYearMonths = asset.convention === "half_year" ? 6 : 13 - startMonth
  const totalMonths = asset.recovery_years * 12
  const spanYears = 1 + Math.ceil((totalMonths - firstYearMonths) / 12)
  const finalYear = startYear + spanYears - 1

  const years: DepreciationYear[] = []
  let accumulated = 0
  for (let y = startYear; y <= finalYear; y++) {
    let dep: number
    if (y === finalYear) {
      dep = base - accumulated // remainder — the exact-sum guarantee
    } else if (y === startYear) {
      dep = Math.round((annual * firstYearMonths) / 12)
    } else {
      dep = Math.round(annual)
    }
    accumulated += dep
    if (y <= throughYear) {
      years.push({ year: y, depreciation_cents: dep, accumulated_cents: accumulated, remaining_cents: base - accumulated })
    }
  }
  return { years, fully_depreciated_in: finalYear }
}

/** One year's view for the pack/print: that year's charge + accumulated through it. */
export function depreciationAsOf(
  asset: DepreciableAsset,
  year: number,
): { year_cents: number; accumulated_cents: number; remaining_cents: number } {
  const { years } = depreciationSchedule(asset, year)
  const last = years[years.length - 1]
  if (!last) {
    return { year_cents: 0, accumulated_cents: 0, remaining_cents: asset.basis_cents - asset.salvage_cents }
  }
  return {
    year_cents: last.year === year ? last.depreciation_cents : 0,
    accumulated_cents: last.accumulated_cents,
    remaining_cents: last.remaining_cents,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/depreciation.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/depreciation.ts __tests__/lib/bookkeeping/depreciation.test.ts
git commit -m "feat(bookkeeper): pure straight-line depreciation schedule — final-year remainder, conventions, salvage"
```

---

### Task 3: Types + validators + DAL + audited CRUD routes

**Files:**
- Modify: `types/database.ts` (append after the `NewDocument` type alias, ~line 600, inside the AI Bookkeeper section)
- Modify: `lib/validators/bookkeeping.ts` (append at end)
- Modify: `lib/db/bookkeeping.ts` (append an Assets section at end)
- Modify: `lib/audit/actions.ts` (append at the END of the `// bookkeeping` block — after whatever 6a-6c added)
- Create: `app/api/admin/bookkeeping/assets/route.ts`
- Create: `app/api/admin/bookkeeping/assets/[id]/route.ts`
- Test: `__tests__/lib/bookkeeping/asset-validators.test.ts`
- Test: `__tests__/app/api/admin/bookkeeping/assets.test.ts`

**Interfaces:**
- Consumes: `depreciation.ts` NOT consumed here (routes store, they don't compute); `auth`, `recordAudit`, `getBook` (verified `lib/db/bookkeeping.ts:25`, returns `BookkeepingBook | null`).
- Produces: `BookkeepingAsset`, `NewBookkeepingAsset`, `DepreciationMethod`, `DepreciationConvention` (types); `createAssetSchema`, `updateAssetSchema` (Zod); `listAssets(bookId?)`, `getAsset`, `createAsset`, `updateAsset`, `deleteAsset` (DAL — Tasks 4/5 import these EXACT names); audit slugs `bookkeeping.asset_created` / `bookkeeping.asset_updated` / `bookkeeping.asset_deleted` (all `commerce`).

**Contracts:** enums pinned byte-identical to 00189's CHECKs. Delete is a HARD delete (accountant-supplied rows, audited with a full snapshot in metadata). POST 404s when the book doesn't exist; PATCH/DELETE 404 when the asset doesn't exist. PATCH enforces `salvage <= basis` on the MERGED row (schema alone can't see the other field) — DB CHECK is the backstop. Small coach-managed table → `listAssets` reads unpaginated like `listAccountsForReports` (documented; revisit only if the register ever nears 1000 rows).

- [ ] **Step 1: Types (`types/database.ts`)**

Append directly after the `export type NewDocument = Pick<...>` block (the end of the AI Bookkeeper Phase-1 section):

```ts
// ── AI Bookkeeper Phase 6d: depreciable-asset register ────────────────────
export type DepreciationMethod = "straight_line"
export type DepreciationConvention = "full_month" | "half_year"

export interface BookkeepingAsset {
  id: string
  book_id: string
  name: string
  basis_cents: number
  salvage_cents: number
  in_service_on: string
  method: DepreciationMethod
  convention: DepreciationConvention
  recovery_years: number
  accountant_note: string | null
  created_at: string
  updated_at: string
}
export type NewBookkeepingAsset = Omit<BookkeepingAsset, "id" | "created_at" | "updated_at">
```

- [ ] **Step 2: Write the failing validator test**

```ts
// __tests__/lib/bookkeeping/asset-validators.test.ts
import { describe, expect, it } from "vitest"
import { createAssetSchema, updateAssetSchema } from "@/lib/validators/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const valid = {
  book_id: BOOK,
  name: "Squat Rack",
  basis_cents: 10000,
  in_service_on: "2024-01-15",
  method: "straight_line",
  convention: "full_month",
  recovery_years: 3,
}

describe("createAssetSchema", () => {
  it("accepts a valid asset and defaults salvage_cents to 0", () => {
    const r = createAssetSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.salvage_cents).toBe(0)
  })
  it("rejects salvage > basis (the cross-field refine — DB CHECK's twin)", () => {
    expect(createAssetSchema.safeParse({ ...valid, salvage_cents: 10001 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, salvage_cents: 10000 }).success).toBe(true) // equal is legal
  })
  it("pins recovery_years to the DB CHECK bounds: 1 and 50 pass, 0 and 51 fail", () => {
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 1 }).success).toBe(true)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 50 }).success).toBe(true)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 0 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 51 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, recovery_years: 2.5 }).success).toBe(false)
  })
  it("pins the enums byte-identical to the DB CHECKs — no invented methods/conventions", () => {
    expect(createAssetSchema.safeParse({ ...valid, method: "macrs" }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, convention: "mid_quarter" }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, convention: "half_year" }).success).toBe(true)
  })
  it("rejects negative money and bad dates", () => {
    expect(createAssetSchema.safeParse({ ...valid, basis_cents: -1 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, basis_cents: 100.5 }).success).toBe(false)
    expect(createAssetSchema.safeParse({ ...valid, in_service_on: "01/15/2024" }).success).toBe(false)
  })
})

describe("updateAssetSchema", () => {
  it("accepts partial updates and a null note (clears it)", () => {
    expect(updateAssetSchema.safeParse({ name: "New name" }).success).toBe(true)
    expect(updateAssetSchema.safeParse({ accountant_note: null }).success).toBe(true)
  })
  it("still pins enum + bound checks on the fields it does receive", () => {
    expect(updateAssetSchema.safeParse({ method: "macrs" }).success).toBe(false)
    expect(updateAssetSchema.safeParse({ recovery_years: 51 }).success).toBe(false)
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/asset-validators.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Validators (`lib/validators/bookkeeping.ts`)**

Append at end of file:

```ts
export const createAssetSchema = z
  .object({
    book_id: z.string().uuid(),
    name: z.string().min(1).max(200),
    basis_cents: z.number().int().nonnegative(),
    salvage_cents: z.number().int().nonnegative().default(0),
    in_service_on: DATE,
    method: z.enum(["straight_line"]),
    convention: z.enum(["full_month", "half_year"]),
    recovery_years: z.number().int().min(1).max(50),
    accountant_note: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.salvage_cents <= v.basis_cents, { message: "salvage cannot exceed basis" })

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  basis_cents: z.number().int().nonnegative().optional(),
  salvage_cents: z.number().int().nonnegative().optional(),
  in_service_on: DATE.optional(),
  method: z.enum(["straight_line"]).optional(),
  convention: z.enum(["full_month", "half_year"]).optional(),
  recovery_years: z.number().int().min(1).max(50).optional(),
  accountant_note: z.string().max(2000).nullable().optional(),
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/asset-validators.test.ts`
Expected: PASS.

- [ ] **Step 4: DAL (`lib/db/bookkeeping.ts`)**

Add `BookkeepingAsset, NewBookkeepingAsset` to the existing `@/types/database` type-import block at the top, then append at end of file:

```ts
// ── Assets (Phase 6d — depreciation is REPORT-LAYER only, never a ledger row: D-12) ──
/** Small coach-managed register (like accounts) — unpaginated read is safe; the
 *  optional bookId scopes the /admin/books/assets page, absent = all books (pack). */
export async function listAssets(bookId?: string): Promise<BookkeepingAsset[]> {
  const base = db().from("bookkeeping_assets").select("*")
  const filtered = bookId ? base.eq("book_id", bookId) : base
  const { data, error } = await filtered
    .order("in_service_on", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as BookkeepingAsset[]
}

export async function getAsset(id: string): Promise<BookkeepingAsset | null> {
  const { data, error } = await db().from("bookkeeping_assets").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingAsset) ?? null
}

export async function createAsset(input: NewBookkeepingAsset): Promise<BookkeepingAsset> {
  const { data, error } = await db().from("bookkeeping_assets").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingAsset
}

export async function updateAsset(
  id: string,
  updates: Partial<Omit<BookkeepingAsset, "id" | "book_id" | "created_at">>,
): Promise<BookkeepingAsset> {
  const { data, error } = await db()
    .from("bookkeeping_assets")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as BookkeepingAsset
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_assets").delete().eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 5: Audit slugs (`lib/audit/actions.ts`)**

Append at the END of the `// bookkeeping` block (after whatever earlier Phase-6 sub-phases added — anchor on the block, not a line number):

```ts
  { slug: "bookkeeping.asset_created", category: "commerce", description: "Depreciable asset added to the register" },
  { slug: "bookkeeping.asset_updated", category: "commerce", description: "Depreciable asset updated" },
  { slug: "bookkeeping.asset_deleted", category: "commerce", description: "Depreciable asset deleted from the register" },
```

- [ ] **Step 6: Write the failing route test**

```ts
// __tests__/app/api/admin/bookkeeping/assets.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listAssets: vi.fn(),
  getAsset: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  getBook: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { GET, POST } from "@/app/api/admin/bookkeeping/assets/route"
import { PATCH, DELETE } from "@/app/api/admin/bookkeeping/assets/[id]/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { listAssets, getAsset, createAsset, updateAsset, deleteAsset, getBook } from "@/lib/db/bookkeeping"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ASSET = "ad000000-0000-4000-8000-000000000001"

const assetRow = {
  id: ASSET, book_id: BOOK, name: "Squat Rack",
  basis_cents: 10000, salvage_cents: 0, in_service_on: "2024-01-15",
  method: "straight_line", convention: "full_month", recovery_years: 3,
  accountant_note: null, created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
}
const createBody = {
  book_id: BOOK, name: "Squat Rack", basis_cents: 10000, in_service_on: "2024-01-15",
  method: "straight_line", convention: "full_month", recovery_years: 3,
}

const getReq = (qs: string) => new Request(`http://x/api/admin/bookkeeping/assets?${qs}`)
const body = (b: unknown) => ({ json: async () => b }) as never
const params = { params: Promise.resolve({ id: ASSET }) }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(listAssets as ReturnType<typeof vi.fn>).mockResolvedValue([assetRow])
  ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue(assetRow)
  ;(createAsset as ReturnType<typeof vi.fn>).mockResolvedValue(assetRow)
  ;(updateAsset as ReturnType<typeof vi.fn>).mockResolvedValue(assetRow)
  ;(deleteAsset as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
})

describe("GET /api/admin/bookkeeping/assets", () => {
  it("403 when not admin; DAL untouched", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET(getReq(`book_id=${BOOK}`))).status).toBe(403)
    expect(listAssets).not.toHaveBeenCalled()
  })
  it("400 without book_id", async () => {
    expect((await GET(getReq(""))).status).toBe(400)
  })
  it("200 with the book's assets", async () => {
    const res = await GET(getReq(`book_id=${BOOK}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assets: [assetRow] })
    expect(listAssets).toHaveBeenCalledWith(BOOK)
  })
})

describe("POST /api/admin/bookkeeping/assets", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body(createBody))).status).toBe(403)
    expect(createAsset).not.toHaveBeenCalled()
  })
  it("400 on invalid input (salvage > basis caught by the schema refine)", async () => {
    expect((await POST(body({ ...createBody, salvage_cents: 99999 }))).status).toBe(400)
    expect(createAsset).not.toHaveBeenCalled()
  })
  it("404 when the book does not exist — createAsset never runs", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body(createBody))).status).toBe(404)
    expect(createAsset).not.toHaveBeenCalled()
  })
  it("201 + bookkeeping.asset_created audit", async () => {
    const res = await POST(body(createBody))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ asset: assetRow })
    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({ book_id: BOOK, salvage_cents: 0, accountant_note: null }),
    )
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.asset_created", category: "commerce" }),
    )
  })
})

describe("PATCH /api/admin/bookkeeping/assets/[id]", () => {
  it("403 when not admin; DAL untouched", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await PATCH(body({ name: "x" }), params)).status).toBe(403)
    expect(getAsset).not.toHaveBeenCalled()
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("404 when the asset does not exist", async () => {
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await PATCH(body({ name: "x" }), params)).status).toBe(404)
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("400 on an empty update body", async () => {
    expect((await PATCH(body({}), params)).status).toBe(400)
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("400 when the MERGED row breaks salvage <= basis (raising salvage past the stored basis)", async () => {
    // Schema alone passes { salvage_cents: 20000 } — only the merged guard can reject it.
    expect((await PATCH(body({ salvage_cents: 20000 }), params)).status).toBe(400)
    expect(updateAsset).not.toHaveBeenCalled()
  })
  it("400 when lowering basis under the stored salvage", async () => {
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue({ ...assetRow, salvage_cents: 800 })
    expect((await PATCH(body({ basis_cents: 500 }), params)).status).toBe(400)
  })
  it("200 + bookkeeping.asset_updated audit on a legal update", async () => {
    const res = await PATCH(body({ recovery_years: 5 }), params)
    expect(res.status).toBe(200)
    expect(updateAsset).toHaveBeenCalledWith(ASSET, { recovery_years: 5 })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.asset_updated", category: "commerce" }),
    )
  })
})

describe("DELETE /api/admin/bookkeeping/assets/[id]", () => {
  it("403 when not admin; DAL untouched", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await DELETE({} as never, params)).status).toBe(403)
    expect(getAsset).not.toHaveBeenCalled()
    expect(deleteAsset).not.toHaveBeenCalled()
  })
  it("404 when the asset does not exist", async () => {
    ;(getAsset as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await DELETE({} as never, params)).status).toBe(404)
    expect(deleteAsset).not.toHaveBeenCalled()
  })
  it("200 + bookkeeping.asset_deleted audit carrying a full snapshot (hard delete)", async () => {
    const res = await DELETE({} as never, params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteAsset).toHaveBeenCalledWith(ASSET)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.asset_deleted",
        category: "commerce",
        metadata: expect.objectContaining({ basis_cents: 10000, in_service_on: "2024-01-15", recovery_years: 3 }),
      }),
    )
  })
})
```

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/assets.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 7: Collection route**

```ts
// app/api/admin/bookkeeping/assets/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAssets, createAsset, getBook } from "@/lib/db/bookkeeping"
import { createAssetSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const bookId = new URL(request.url).searchParams.get("book_id")
    if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
    const assets = await listAssets(bookId)
    return NextResponse.json({ assets })
  } catch (error) {
    console.error("List bookkeeping assets error:", error)
    return NextResponse.json({ error: "Failed to load assets" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const body = await request.json().catch(() => null)
    const parsed = createAssetSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const book = await getBook(parsed.data.book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })
    const asset = await createAsset({ ...parsed.data, accountant_note: parsed.data.accountant_note ?? null })
    void recordAudit({ action: "bookkeeping.asset_created", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_asset", id: asset.id, label: asset.name },
      metadata: { book_id: asset.book_id, basis_cents: asset.basis_cents, method: asset.method, convention: asset.convention, recovery_years: asset.recovery_years },
      request })
    return NextResponse.json({ asset }, { status: 201 })
  } catch (error) {
    console.error("Create bookkeeping asset error:", error)
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 })
  }
}
```

- [ ] **Step 8: Item route**

```ts
// app/api/admin/bookkeeping/assets/[id]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAsset, updateAsset, deleteAsset } from "@/lib/db/bookkeeping"
import { updateAssetSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const existing = await getAsset(id)
    if (!existing) return NextResponse.json({ error: "asset not found" }, { status: 404 })
    const body = await request.json().catch(() => null)
    const parsed = updateAssetSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 })
    // Cross-field invariant on the MERGED row — the schema can't see the stored half.
    const merged = { ...existing, ...parsed.data }
    if (merged.salvage_cents > merged.basis_cents) {
      return NextResponse.json({ error: "salvage cannot exceed basis" }, { status: 400 })
    }
    const asset = await updateAsset(id, parsed.data)
    void recordAudit({ action: "bookkeeping.asset_updated", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_asset", id, label: asset.name },
      metadata: { updated_fields: Object.keys(parsed.data) }, request })
    return NextResponse.json({ asset })
  } catch (error) {
    console.error("Update bookkeeping asset error:", error)
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 })
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const existing = await getAsset(id)
    if (!existing) return NextResponse.json({ error: "asset not found" }, { status: 404 })
    await deleteAsset(id)
    // Hard delete — the audit row carries the full snapshot so nothing is lost.
    void recordAudit({ action: "bookkeeping.asset_deleted", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_asset", id, label: existing.name },
      metadata: {
        book_id: existing.book_id, basis_cents: existing.basis_cents, salvage_cents: existing.salvage_cents,
        in_service_on: existing.in_service_on, method: existing.method, convention: existing.convention,
        recovery_years: existing.recovery_years, accountant_note: existing.accountant_note,
      }, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Delete bookkeeping asset error:", error)
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 })
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/assets.test.ts __tests__/lib/bookkeeping/asset-validators.test.ts`
Expected: PASS (all).

- [ ] **Step 10: Commit**

```bash
git add types/database.ts lib/validators/bookkeeping.ts lib/db/bookkeeping.ts lib/audit/actions.ts app/api/admin/bookkeeping/assets __tests__/lib/bookkeeping/asset-validators.test.ts __tests__/app/api/admin/bookkeeping/assets.test.ts
git commit -m "feat(bookkeeper): asset CRUD — DAL, CHECK-pinned validators, audited routes"
```

---

### Task 4: `/admin/books/assets` page + AssetsClient + toolbar link

**Files:**
- Create: `app/(admin)/admin/books/assets/page.tsx`
- Create: `components/admin/bookkeeping/AssetsClient.tsx`
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (toolbar right-group — anchor on the Insights link)

**Interfaces:**
- Consumes: `listBooks`, `listAssets` (DAL); `depreciationSchedule` (Task 2, imported CLIENT-side — it is pure and dependency-free); `formatCents`, `formatOccurredOn`; shadcn `Tabs`/`Button`/`Input`/`Label`/`Select`; `BookkeepingAsset`, `BookkeepingBook`, `DepreciationConvention` types.
- Produces: the assets page; an `Assets` link in the BooksClient toolbar.

**Contracts:** the AccountsManager pattern (server page → one client component, per-book `Tabs`, refetch-on-book-change with skip-first ref, inline add card + inline edit rows, `window.confirm` delete). Method/convention are FIXED selects (method has exactly one option — visibly not editable intelligence, D-13). Honesty header VERBATIM from spec §6.3: *"Depreciation is tracked, not decided — enter the basis, method, and life your accountant supplies. Book depreciation for your CPA, not a filing."* Schedule preview is the pure fn run client-side — no API call.

- [ ] **Step 1: Server page**

```tsx
// app/(admin)/admin/books/assets/page.tsx
import { listBooks, listAssets } from "@/lib/db/bookkeeping"
import { AssetsClient } from "@/components/admin/bookkeeping/AssetsClient"

export const metadata = { title: "Equipment & Assets — Books — Admin" }

export default async function AssetsPage() {
  const books = await listBooks()
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const assets = primary ? await listAssets(primary.id) : []
  return <AssetsClient books={books} initialBookId={primary?.id ?? ""} initialAssets={assets} />
}
```

- [ ] **Step 2: AssetsClient**

```tsx
// components/admin/bookkeeping/AssetsClient.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { depreciationSchedule } from "@/lib/bookkeeping/depreciation"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import type { BookkeepingAsset, BookkeepingBook, DepreciationConvention } from "@/types/database"

interface AssetForm {
  name: string
  basis: string // dollars, as typed (ManualEntryDialog convention)
  salvage: string
  in_service_on: string
  convention: DepreciationConvention
  recovery_years: string
  accountant_note: string
}

const EMPTY_FORM: AssetForm = {
  name: "", basis: "", salvage: "0", in_service_on: "",
  convention: "full_month", recovery_years: "5", accountant_note: "",
}

const CONVENTION_LABELS: Record<DepreciationConvention, string> = {
  full_month: "Full month", half_year: "Half year",
}

function toCents(dollars: string): number {
  return Math.round(parseFloat(dollars || "0") * 100)
}

/** Validate + convert the form; returns an error string or the API payload (sans book_id). */
function formToPayload(form: AssetForm): string | Record<string, unknown> {
  const basis = toCents(form.basis)
  const salvage = toCents(form.salvage)
  const years = Number(form.recovery_years)
  if (!form.name.trim()) return "Enter an asset name"
  if (!Number.isFinite(basis) || basis <= 0) return "Enter a valid cost basis"
  if (!Number.isFinite(salvage) || salvage < 0) return "Enter a valid salvage value"
  if (salvage > basis) return "Salvage cannot exceed basis"
  if (!form.in_service_on) return "Pick the in-service date"
  if (!Number.isInteger(years) || years < 1 || years > 50) return "Recovery must be 1–50 years"
  return {
    name: form.name.trim(),
    basis_cents: basis,
    salvage_cents: salvage,
    in_service_on: form.in_service_on,
    method: "straight_line",
    convention: form.convention,
    recovery_years: years,
    accountant_note: form.accountant_note.trim() || null,
  }
}

function assetToForm(a: BookkeepingAsset): AssetForm {
  return {
    name: a.name,
    basis: (a.basis_cents / 100).toString(),
    salvage: (a.salvage_cents / 100).toString(),
    in_service_on: a.in_service_on,
    convention: a.convention,
    recovery_years: a.recovery_years.toString(),
    accountant_note: a.accountant_note ?? "",
  }
}

function AssetFormFields({ form, setForm, idPrefix }: {
  form: AssetForm
  setForm: (f: AssetForm) => void
  idPrefix: string
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Asset name</Label>
          <Input id={`${idPrefix}-name`} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Squat rack" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-date`}>In service on</Label>
          <Input id={`${idPrefix}-date`} type="date" value={form.in_service_on}
            onChange={(e) => setForm({ ...form, in_service_on: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-basis`}>Cost basis ($)</Label>
          <Input id={`${idPrefix}-basis`} type="number" min="0" step="0.01" value={form.basis}
            onChange={(e) => setForm({ ...form, basis: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-salvage`}>Salvage value ($)</Label>
          <Input id={`${idPrefix}-salvage`} type="number" min="0" step="0.01" value={form.salvage}
            onChange={(e) => setForm({ ...form, salvage: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Method</Label>
          {/* Fixed single-option select — straight-line only, accountant-supplied (D-13). */}
          <Select value="straight_line" onValueChange={() => undefined}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="straight_line">Straight line</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Convention</Label>
          <Select value={form.convention}
            onValueChange={(v) => setForm({ ...form, convention: v as DepreciationConvention })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full_month">Full month</SelectItem>
              <SelectItem value="half_year">Half year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-years`}>Recovery (years, 1–50)</Label>
          <Input id={`${idPrefix}-years`} type="number" min="1" max="50" step="1" value={form.recovery_years}
            onChange={(e) => setForm({ ...form, recovery_years: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-note`}>Accountant note (optional)</Label>
          <Input id={`${idPrefix}-note`} value={form.accountant_note}
            onChange={(e) => setForm({ ...form, accountant_note: e.target.value })}
            placeholder="e.g. 7-yr MACRS on the return; book life per CPA" />
        </div>
      </div>
    </>
  )
}

function SchedulePreview({ asset }: { asset: BookkeepingAsset }) {
  // 9999 ≥ any exhaustion year (recovery ≤ 50) — the full schedule, computed client-side.
  const { years, fully_depreciated_in } = depreciationSchedule(asset, 9999)
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1 pr-4 font-medium">Year</th>
            <th className="py-1 pr-4 text-right font-medium">Depreciation</th>
            <th className="py-1 pr-4 text-right font-medium">Accumulated</th>
            <th className="py-1 pr-4 text-right font-medium">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year} className="border-b">
              <td className="py-1 pr-4">{y.year}</td>
              <td className="py-1 pr-4 text-right">{formatCents(y.depreciation_cents)}</td>
              <td className="py-1 pr-4 text-right">{formatCents(y.accumulated_cents)}</td>
              <td className="py-1 pr-4 text-right">{formatCents(y.remaining_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Fully depreciated in {fully_depreciated_in}. The final year absorbs rounding so the schedule sums exactly to basis − salvage.
      </p>
    </div>
  )
}

export function AssetsClient({ books, initialBookId, initialAssets }: {
  books: BookkeepingBook[]
  initialBookId: string
  initialAssets: BookkeepingAsset[]
}) {
  const [bookId, setBookId] = useState(initialBookId)
  const [assets, setAssets] = useState<BookkeepingAsset[]>(initialAssets)
  const [loading, setLoading] = useState(false)
  const isFirstLoad = useRef(true)

  const [form, setForm] = useState<AssetForm>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<AssetForm | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    if (!bookId) {
      setAssets([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/bookkeeping/assets?book_id=${bookId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load assets")
        return res.json()
      })
      .then((body: { assets: BookkeepingAsset[] }) => {
        if (!cancelled) setAssets(body.assets ?? [])
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Failed to load assets: ${(error as Error).message}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  function handleBookChange(next: string) {
    setBookId(next)
    setEditingId(null)
    setEditForm(null)
    setPreviewId(null)
  }

  async function addAsset() {
    const payload = formToPayload(form)
    if (typeof payload === "string") {
      toast.error(payload)
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, ...payload }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to add asset")
      }
      const { asset } = (await res.json()) as { asset: BookkeepingAsset }
      setAssets((list) => [...list, asset])
      setForm(EMPTY_FORM)
      toast.success("Asset added")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit(id: string) {
    if (!editForm) return
    const payload = formToPayload(editForm)
    if (typeof payload === "string") {
      toast.error(payload)
      return
    }
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Update failed")
      }
      const { asset } = (await res.json()) as { asset: BookkeepingAsset }
      setAssets((list) => list.map((x) => (x.id === id ? asset : x)))
      setEditingId(null)
      setEditForm(null)
      toast.success("Asset updated")
    } catch (error) {
      toast.error(`Update failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function removeAsset(a: BookkeepingAsset) {
    const confirmed = window.confirm(`Delete "${a.name}"? The audit log keeps a snapshot, but the register row is removed.`)
    if (!confirmed) return
    setBusyId(a.id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/assets/${a.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.text()) || "Delete failed")
      setAssets((list) => list.filter((x) => x.id !== a.id))
      toast.success("Asset deleted")
    } catch (error) {
      toast.error(`Delete failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  function renderRow(a: BookkeepingAsset) {
    if (editingId === a.id && editForm) {
      return (
        <li key={a.id} className="space-y-3 rounded-lg border border-border bg-card p-3">
          <AssetFormFields form={editForm} setForm={setEditForm} idPrefix={`edit-${a.id}`} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveEdit(a.id)} disabled={busyId === a.id}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditForm(null) }} disabled={busyId === a.id}>Cancel</Button>
          </div>
        </li>
      )
    }
    return (
      <li key={a.id} className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-foreground">{a.name}</p>
            <p className="text-xs text-muted-foreground">
              In service {formatOccurredOn(a.in_service_on)} · Basis {formatCents(a.basis_cents)}
              {a.salvage_cents > 0 ? ` · Salvage ${formatCents(a.salvage_cents)}` : ""}
              {` · Straight line · ${CONVENTION_LABELS[a.convention]} · ${a.recovery_years} yr`}
            </p>
            {a.accountant_note ? <p className="text-xs text-muted-foreground italic">{a.accountant_note}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPreviewId(previewId === a.id ? null : a.id)}>
              {previewId === a.id ? "Hide schedule" : "Schedule"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditingId(a.id); setEditForm(assetToForm(a)) }} disabled={busyId === a.id}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => removeAsset(a)} disabled={busyId === a.id}>
              Delete
            </Button>
          </div>
        </div>
        {previewId === a.id ? <SchedulePreview asset={a} /> : null}
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Equipment &amp; assets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Depreciation is tracked, not decided — enter the basis, method, and life your accountant supplies. Book depreciation for your CPA, not a filing.
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          <Link href="/admin/books" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
            Back to ledger
          </Link>
          <Link href="/admin/books/reports" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
            Reports
          </Link>
          <Link href="/admin/books/insights" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
            Insights
          </Link>
        </div>
      </div>

      {books.length === 0 ? (
        <p className="text-sm text-muted-foreground">No books configured.</p>
      ) : (
        <Tabs value={bookId} onValueChange={handleBookChange}>
          <TabsList>
            {books.map((book) => (
              <TabsTrigger key={book.id} value={book.id}>{book.name}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={bookId} className="mt-4 space-y-6">
            {assets.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">
                No assets in this book yet. Add equipment your accountant wants depreciated.
              </p>
            ) : (
              <ul className="space-y-2">{assets.map(renderRow)}</ul>
            )}

            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h2 className="font-heading text-foreground">New asset</h2>
              <AssetFormFields form={form} setForm={setForm} idPrefix="na" />
              <Button onClick={addAsset} disabled={adding || !form.name.trim()}>
                Add asset
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Toolbar link in BooksClient**

In `components/admin/bookkeeping/BooksClient.tsx`, find the Insights link in the toolbar right-group (anchor on its text, NOT a line number — 6a may have shifted things):

```tsx
            <Link
              href="/admin/books/insights"
              className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
            >
              Insights
            </Link>
```

and insert directly AFTER it (same classes, no `ml-auto` — only the right-group's first link carries it):

```tsx
            <Link
              href="/admin/books/assets"
              className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
            >
              Assets
            </Link>
```

- [ ] **Step 4: Typecheck + scoped suites still green**

Run: `npx tsc --noEmit 2>&1 | Select-String "AssetsClient|books/assets|BooksClient|depreciation"`
Expected: no output.
Run: `npx vitest run __tests__/lib/bookkeeping/depreciation.test.ts __tests__/app/api/admin/bookkeeping/assets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/"(admin)"/admin/books/assets/page.tsx components/admin/bookkeeping/AssetsClient.tsx components/admin/bookkeeping/BooksClient.tsx
git commit -m "feat(bookkeeper): /admin/books/assets page — per-book register + schedule preview + toolbar link"
```

---

### Task 5: Depreciation sheet in the accountant pack + print section

**Files:**
- Modify: `lib/bookkeeping/accountant-pack.ts` (input widening + `addDepreciationSheet` + call site)
- Modify: `app/api/admin/bookkeeping/reports/accountant-pack/route.ts`
- Modify: `app/api/admin/bookkeeping/reports/email-pack/route.ts`
- Modify: `app/api/admin/internal/bookkeeping-quarterly-pack/route.ts`
- Modify: `app/(admin)/admin/books/reports/print/page.tsx`
- Test: `__tests__/lib/bookkeeping/accountant-pack.test.ts` (update fixtures + new describe)
- Test: `__tests__/app/api/admin/bookkeeping/reports-accountant-pack.test.ts`, `__tests__/app/api/admin/bookkeeping/reports-email-pack.test.ts`, `__tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts` (mock-factory additions ONLY)

**Interfaces:**
- Consumes: `depreciationAsOf` (Task 2), `listAssets` (Task 3), existing pack helpers `addSheet`/`headerRow`/`noteRow` (verified `lib/bookkeeping/accountant-pack.ts:36/45/58`), `buildAccountantPack` (:87), the per-book P&L loop (`for (const book of books) { addPnlSheet(...) }` at :128-130) and the `// 7. Document Index` block (:132), print page's `books.map(...)` P&L loop + Document index section (`app/(admin)/admin/books/reports/print/page.tsx:168-212`), `loadPrintData` (:27-33).
- Produces: `AccountantPackInput.assets` (required field), a "Depreciation" sheet AFTER the per-book P&L loop and BEFORE "Documents", and the matching print section.

**Contracts (spec §6.4):** per-asset columns: name, book, in-service, basis, salvage, method, convention, recovery, **this-year depreciation** and **accumulated-through-year** for the report window's END year (`Number(to.slice(0, 4))`), note. Honesty line on both surfaces. Sheet/section OMITTED ENTIRELY when no assets exist (honest empty-state — no empty tab). Assets are read DIRECTLY via `listAssets()` (all books), never through `ReportEntry`. Adding `listAssets` to route imports means the three route-test `vi.mock("@/lib/db/bookkeeping")` factories MUST gain `listAssets: vi.fn()` in the same task (the D-2 mock-factory lesson: an un-enumerated export is `undefined` → TypeError → false red). Phase-4 lesson: the pack test asserts the NON-EMPTY sheet's actual cells and cross-book row labeling, not just the tab name.

- [ ] **Step 1: Write the failing pack test (update `__tests__/lib/bookkeeping/accountant-pack.test.ts`)**

First, add to the imports: `import type { BookkeepingAsset } from "@/types/database"` (merge into the existing type import). Then add `assets: []` to EVERY existing `buildAccountantPack({ ... })` call in the file (six call sites), and strengthen the first tab-list test with the omitted-when-empty pin — in the `"builds the expected tabs..."` test, after the `expect(names).toEqual([...])` assertion add:

```ts
    expect(names).not.toContain("Depreciation") // no assets → no sheet, no empty tab
```

Then append this describe block at the end of the file:

```ts
describe("buildAccountantPack — Depreciation sheet (Phase 6d)", () => {
  const assets = [
    { // Darren: 10000¢/3yr full-month Jan-2024 → 3333/3333/3334; 2026 is the final (remainder) year
      id: "ad000000-0000-4000-8000-000000000001", book_id: B1, name: "Squat Rack",
      basis_cents: 10000, salvage_cents: 0, in_service_on: "2024-01-15",
      method: "straight_line", convention: "full_month", recovery_years: 3,
      accountant_note: "life per CPA", created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
    },
    { // Household: 240000¢/5yr full-month Jun-2025 → 2025 = round(48000·7/12) = 28000; 2026 = 48000; thru 2026 = 76000
      id: "ad000000-0000-4000-8000-000000000002", book_id: B3, name: "Garage Shelving",
      basis_cents: 240000, salvage_cents: 0, in_service_on: "2025-06-10",
      method: "straight_line", convention: "full_month", recovery_years: 5,
      accountant_note: null, created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
    },
  ] as BookkeepingAsset[]

  it("sits after the per-book P&L sheets and before Documents", async () => {
    const buf = await buildAccountantPack({ from: "2026-01-01", to: "2026-07-31", books, accounts, entries, documents, assets })
    const wb = await load(buf)
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Spouse", "P&L — Household", "Depreciation", "Documents",
    ])
  })

  it("computes this-year + accumulated for the window's END year, per row, with the right book label", async () => {
    const buf = await buildAccountantPack({ from: "2026-01-01", to: "2026-07-31", books, accounts, entries, documents, assets })
    const wb = await load(buf)
    const sheet = wb.getWorksheet("Depreciation")!
    // Row 2 = Squat Rack (as passed): final-remainder year 2026 → $33.34 this year, $100.00 accumulated.
    const darren = sheet.getRow(2)
    expect(String(darren.getCell(1).value)).toBe("Squat Rack")
    expect(String(darren.getCell(2).value)).toBe("Darren — DJP Athlete")
    expect(String(darren.getCell(9).value)).toBe("$33.34")
    expect(String(darren.getCell(10).value)).toBe("$100.00")
    // Row 3 = Garage Shelving, labeled with ITS book — cross-book rows never merge or swap.
    const household = sheet.getRow(3)
    expect(String(household.getCell(1).value)).toBe("Garage Shelving")
    expect(String(household.getCell(2).value)).toBe("Household & Personal")
    expect(String(household.getCell(9).value)).toBe("$480.00")
    expect(String(household.getCell(10).value)).toBe("$760.00")
    // Cross-book exclusion at row level (the Phase-4 lesson): the household numbers
    // must not appear anywhere in Darren's row.
    expect(JSON.stringify(darren.values)).not.toContain("$480.00")
    expect(JSON.stringify(darren.values)).not.toContain("$760.00")
  })

  it("carries the tracked-not-decided honesty line", async () => {
    const buf = await buildAccountantPack({ from: "2026-01-01", to: "2026-07-31", books, accounts, entries, documents, assets })
    const wb = await load(buf)
    const text = JSON.stringify(wb.getWorksheet("Depreciation")!.getSheetValues())
    expect(text).toContain("tracked, not decided")
    expect(text).toContain("not a filing")
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/accountant-pack.test.ts`
Expected: FAIL — `assets` not in `AccountantPackInput` (type error) / no Depreciation sheet.

- [ ] **Step 2: Implement in `lib/bookkeeping/accountant-pack.ts`**

(a) Imports — add `depreciationAsOf` and the asset type:

```ts
import { depreciationAsOf } from "@/lib/bookkeeping/depreciation"
```

and extend the type import to `import type { BookkeepingAsset, BookkeepingBook, BookkeepingDocument } from "@/types/database"`.

(b) Widen the input interface:

```ts
export interface AccountantPackInput {
  from: string
  to: string
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  documents: BookkeepingDocument[]
  assets: BookkeepingAsset[]
}
```

(c) Add the sheet helper (place it after `addPnlSheet`):

```ts
/** Depreciation register (Phase 6d, spec §6.4). Report-layer only — never a ledger
 *  row (D-12). Omitted ENTIRELY when no assets exist (honest empty-state). */
function addDepreciationSheet(
  wb: ExcelJS.Workbook, used: Set<string>, books: BookkeepingBook[],
  assets: BookkeepingAsset[], endYear: number,
) {
  if (assets.length === 0) return
  const sheet = addSheet(wb, "Depreciation", TAB_ACCENT, used)
  headerRow(
    sheet,
    ["Asset", "Book", "In service", "Basis", "Salvage", "Method", "Convention", "Years", `Depreciation ${endYear}`, `Accumulated thru ${endYear}`, "Note"],
    [28, 24, 12, 14, 12, 14, 12, 8, 18, 20, 32],
  )
  const bookName = new Map(books.map((b) => [b.id, b.name]))
  for (const a of assets) {
    const asOf = depreciationAsOf(a, endYear)
    // `books` (arg) comes from listBooks(), which filters archived_at IS NULL — an
    // asset on an archived book won't resolve here. Fall back to "—" (never the raw
    // UUID) for parity with the print page's identical fallback below.
    sheet.addRow([
      a.name, bookName.get(a.book_id) ?? "—", a.in_service_on,
      formatCents(a.basis_cents), formatCents(a.salvage_cents),
      a.method, a.convention, a.recovery_years,
      formatCents(asOf.year_cents), formatCents(asOf.accumulated_cents),
      a.accountant_note ?? "",
    ])
  }
  sheet.addRow([])
  noteRow(sheet, "Depreciation is tracked, not decided — straight-line book depreciation from accountant-supplied basis, method, and life. For your CPA, not a filing.")
}
```

(d) In `buildAccountantPack`: destructure `assets` from the input (`const { from, to, books, accounts, entries, documents, assets } = input`) and call the helper between the per-book P&L loop and the `// 7. Document Index` block:

```ts
  // 6b. Depreciation register (Phase 6d) — after the P&L loop, before Documents.
  addDepreciationSheet(wb, used, books, assets, Number(to.slice(0, 4)))
```

Run: `npx vitest run __tests__/lib/bookkeeping/accountant-pack.test.ts`
Expected: PASS (all, including the pre-existing tests now carrying `assets: []`).

- [ ] **Step 3: Wire the three pack-building routes**

Same three-line change in each — `app/api/admin/bookkeeping/reports/accountant-pack/route.ts`, `app/api/admin/bookkeeping/reports/email-pack/route.ts`, `app/api/admin/internal/bookkeeping-quarterly-pack/route.ts`:

1. Extend the `@/lib/db/bookkeeping` import: `import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"`.
2. Extend the `Promise.all`:
```ts
    const [{ books, accounts, entries }, documents, assets] = await Promise.all([
      loadReportBundle(from, to),
      listAllDocuments(),
      listAssets(),
    ])
```
3. Pass it through: `buildAccountantPack({ from, to, books, accounts, entries, documents, assets })`.

(In the accountant-pack route the Promise.all is single-line — keep its style: `const [{ books, accounts, entries }, documents, assets] = await Promise.all([loadReportBundle(from, to), listAllDocuments(), listAssets()])`.)

- [ ] **Step 4: Update the three route-test mock factories (the D-2 lesson — do NOT skip)**

In `__tests__/app/api/admin/bookkeeping/reports-accountant-pack.test.ts`, `__tests__/app/api/admin/bookkeeping/reports-email-pack.test.ts`, and `__tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts`:

1. Extend the factory: `vi.mock("@/lib/db/bookkeeping", () => ({ listAllDocuments: vi.fn(), listAssets: vi.fn() }))`.
2. Extend the import line: `import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"`.
3. Add to `beforeEach`: `;(listAssets as ReturnType<typeof vi.fn>).mockResolvedValue([])`.

(No assertion changes — the existing `expect.objectContaining({ from, to })` calls are additive-safe.)

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/reports-accountant-pack.test.ts __tests__/app/api/admin/bookkeeping/reports-email-pack.test.ts __tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts`
Expected: PASS.

- [ ] **Step 5: Print section (`app/(admin)/admin/books/reports/print/page.tsx`)**

(a) Imports: extend the DAL import to `import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"` and add `import { depreciationAsOf } from "@/lib/bookkeeping/depreciation"`.

(b) `loadPrintData` gains the third read:

```ts
async function loadPrintData(from: string, to: string) {
  const [{ books, accounts, entries }, documents, assets] = await Promise.all([
    loadReportBundle(from, to),
    listAllDocuments(),
    listAssets(),
  ])
  return { books, accounts, entries, documents, assets }
}
```

(c) Destructure it in the page body: `const { books, accounts, entries, documents, assets } = bundle`.

(d) Insert this section AFTER the `{books.map((book) => { ... })}` P&L loop and BEFORE the `<section>` containing "Document index" (matching the pack's attach point; no `.print-document` change needed — it's inside the existing wrapper):

```tsx
        {assets.length > 0 ? (
          <section className="mb-8">
            <h2 className="font-heading mb-3 text-lg font-semibold">Depreciation register — {Number(to.slice(0, 4))}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-4 font-medium">Asset</th>
                  <th className="py-1 pr-4 font-medium">Book</th>
                  <th className="py-1 pr-4 font-medium">In service</th>
                  <th className="py-1 pr-4 font-medium text-right">Basis</th>
                  <th className="py-1 pr-4 font-medium text-right">Salvage</th>
                  <th className="py-1 pr-4 font-medium">Life</th>
                  <th className="py-1 pr-4 font-medium text-right">This year</th>
                  <th className="py-1 pr-4 font-medium text-right">Accumulated</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const asOf = depreciationAsOf(a, Number(to.slice(0, 4)))
                  return (
                    <tr key={a.id} className="border-b">
                      <td className="py-1 pr-4">{a.name}</td>
                      <td className="py-1 pr-4">{bookName.get(a.book_id) ?? "—"}</td>
                      <td className="py-1 pr-4">{formatOccurredOn(a.in_service_on)}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(a.basis_cents)}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(a.salvage_cents)}</td>
                      <td className="py-1 pr-4">{a.recovery_years} yr {a.convention === "half_year" ? "half-year" : "full-month"}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(asOf.year_cents)}</td>
                      <td className="py-1 pr-4 text-right">{formatCents(asOf.accumulated_cents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs">
              Depreciation is tracked, not decided — straight-line book depreciation from accountant-supplied basis, method, and life. For your CPA, not a filing.
            </p>
          </section>
        ) : null}
```

(The `bookName` map already exists at the top of the page body — reuse it. There is no house test for the print page — it is a server-rendered surface covered by tsc + build; the pack test carries the cell-level pins for the shared math.)

- [ ] **Step 6: Full scoped run + typecheck**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | Select-String "accountant-pack|print|depreciation|assets"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/bookkeeping/accountant-pack.ts app/api/admin/bookkeeping/reports/accountant-pack/route.ts app/api/admin/bookkeeping/reports/email-pack/route.ts app/api/admin/internal/bookkeeping-quarterly-pack/route.ts app/"(admin)"/admin/books/reports/print/page.tsx __tests__/lib/bookkeeping/accountant-pack.test.ts __tests__/app/api/admin/bookkeeping/reports-accountant-pack.test.ts __tests__/app/api/admin/bookkeeping/reports-email-pack.test.ts __tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts
git commit -m "feat(bookkeeper): depreciation sheet in accountant pack + print register — window-end-year lens"
```

---

### Task 6: Sub-phase verification gate

**Files:** none committed (scratchpad proof script only, if used).

- [ ] **Step 1: All bookkeeping suites**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping __tests__/api/admin/internal`
Expected: PASS (every bookkeeping root, old and new — including 6a/6b suites landed earlier on this branch).

- [ ] **Step 2: Full suite vs the known-red baseline**

Run: `npm run test:run` (capture output). Compare failures against the known-red family (uploads/shop, import-excel-route, admin-nav, webhook-external, events). Any OTHER red: `git stash` the 6d diff, re-run that file, unstash — only chase it if it's ours.

- [ ] **Step 3: Production build (its own command — NEVER `&&` after tests)**

Run: `npm run build`
Expected: GREEN. (Silent exit-4 at "Running TypeScript" with no diagnostic = memory flake → re-run once before diagnosing.)

- [ ] **Step 4: D-12 grep proof (depreciation never touches the ledger)**

Run: `rg -n "bookkeeping_ledger_entries|createEntry|insertImportedEntries|insertReceiptEntry|insertAmazonEntries" lib/bookkeeping/depreciation.ts app/api/admin/bookkeeping/assets components/admin/bookkeeping/AssetsClient.tsx` (plain `rg` on PATH — ripgrep, verified present; `npx rg` would resolve the unrelated `rg` npm package instead. If ripgrep isn't on the executing agent's PATH, use the Grep tool for both proofs below instead.)
Expected: zero matches.
Run: `rg -n "'straight_line'|\"straight_line\"" supabase/migrations/00189_bookkeeping_assets.sql lib/validators/bookkeeping.ts types/database.ts`
Expected: hits in all three files (the tri-site enum pin is intact).

- [ ] **Step 5: Live sentinel proof (ORCHESTRATOR — requires 00189 applied via `mcp__supabase__apply_migration`)**

Via `mcp__supabase__execute_sql`: (i) insert one sentinel asset `id = 'f6d00000-0000-4000-8000-000000000001'` on the primary business book (basis 10000, salvage 0, in-service `2019-01-15`, straight_line, full_month, 3 years — a far-past window per the §9 sentinel discipline); (ii) select it back and confirm the CHECKs rejected nothing; (iii) attempt `UPDATE ... SET salvage_cents = 20000` and confirm the DB CHECK REJECTS it (the backstop behind the route guard); (iv) hit the schedule math end-to-end by loading `/admin/books/reports/print?from=2019-01-01&to=2021-12-31` (or a scratchpad `tsx` script calling the real `listAssets()` + `depreciationAsOf`) and confirming this-year 2021 = $33.34 / accumulated $100.00; (v) DELETE the sentinel and SQL-verify `count = 0` rows remain with the `f6d0%` prefix. NEVER touch non-sentinel rows.

- [ ] **Step 6: Hand off**

No push (branch-wide HELD per the spec). The final Opus whole-branch review must trace one depreciation schedule's sum === basis − salvage (spec §9) — point it at the `depSum` invariant asserted in every Task-2 fixture and the pack's `$33.34/$100.00` cells.

---

## Self-Review (done at plan time)

1. **Spec coverage:** §6.1→T1, §6.2→T2, §6.3→T3+T4, §6.4→T5, D-12→T1 comment + T6 grep proof, D-13→enum pins in T1/T3 + fixed selects in T4, §7 honesty copy→T4 header + T5 sheet/print lines (verbatim), §9 gates→T6.
2. **Pinned-number fixtures:** 3333/3333/3334 (final-year remainder), April 2500-vs-1667 (month-proration vs half-year), December 278 (1/12 sentence), 5001/5000 (round vs trunc), salvage 30000×3 (base vs basis), throughYear before/at/after, recovery 1 (both in-service months), pack cells $33.34/$100.00 + $480.00/$760.00 with per-row book labels — each names the mutation it kills.
3. **Mock-factory safety:** the only existing-test files 6d touches are the three pack-route tests (Step 5.4 adds `listAssets` to their factories) and `accountant-pack.test.ts` (gets `assets: []`); no other suite imports the widened DAL, so the known-red baseline cannot move.
4. **Signatures verified against source at plan time:** `addSheet`/`headerRow`/`noteRow`/`addPnlSheet`/`buildAccountantPack` (accountant-pack.ts:36/45/58/64/87), `loadPrintData` + `PnlBlock` loop + Document index (print/page.tsx:27/168/184), `getBook` (lib/db/bookkeeping.ts:25), the accounts-route gate (accounts/route.ts:8-10), the `[id]` ctx-params shape (accounts/[id]/route.ts:7), `recordAudit`/`RecordAuditInput` (lib/audit/record.ts:42/11-21), `formatCents` (money.ts), `formatOccurredOn` (format.ts:3), the dollars→cents idiom (ManualEntryDialog.tsx:80), the three pack-route Promise.alls and their test mock factories. Workers still re-read before editing (lines shift under 6a-6c).
