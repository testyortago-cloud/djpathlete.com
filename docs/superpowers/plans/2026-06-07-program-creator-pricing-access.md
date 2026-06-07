# Unified Program Creator — Pricing & Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the program maker one coherent flow — the AI builder and the manual creator both hand off into a single "Pricing & Access" sheet — and fix the payment-gate bug by routing every assignment through one `assignProgram()` service.

**Architecture:** A new `program_week_pricing` table stores the per-program premium-week template. A pure-logic + service module (`lib/services/assign-program.ts`) becomes the single path that creates assignments + seeds `program_week_access` correctly. A shared `PricingAccessSheet` React component (used by AI builder, manual creator, and program page) writes program pricing, premium weeks, and triggers the assignment. The AI orchestrator stops auto-assigning. Phase 2 surfaces a client pay prompt; Phase 3 enforces payment server-side on the workout APIs.

**Tech Stack:** Next.js 16 App Router, TypeScript (strict), Supabase Postgres (service-role DAL), Zod, Vitest + Testing Library, Tailwind v4 + shadcn/ui, Firebase Functions (orchestrator).

**Spec:** [docs/superpowers/specs/2026-06-07-program-creator-pricing-access-design.md](../specs/2026-06-07-program-creator-pricing-access-design.md)

**Conventions to follow (already in this repo):**
- DAL files use `createServiceRoleClient()` and live in `lib/db/<table>.ts`. Cast results (`as Type`), no `Database` generic.
- Migrations: `supabase/migrations/NNNNN_name.sql`; **apply via `mcp__supabase__apply_migration`** (CLI is not linked). Latest number is `00166`, so use `00167`.
- Tests live under `__tests__/` mirroring source paths; run with `npm run test:run`.
- Commit directly to `main` (solo dev). Do **not** stage `JOURNAL.md`.

---

## Phase 1 — Creator + correct assignment (ships the gate fix)

### Task 1: Migration — `program_week_pricing` table

**Files:**
- Create: `supabase/migrations/00167_program_week_pricing.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Program-level premium-week template.
-- A row means "week N of this program is a paid add-on at price_cents".
-- Absence of a row = that week is included with program entry.
CREATE TABLE program_week_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number integer NOT NULL CHECK (week_number >= 1),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, week_number)
);

CREATE INDEX idx_week_pricing_program ON program_week_pricing(program_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON program_week_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Apply the migration**

Use the MCP tool `mcp__supabase__apply_migration` with name `program_week_pricing` and the SQL above.
Expected: success, no error.

- [ ] **Step 3: Verify the table exists**

Run via `mcp__supabase__execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'program_week_pricing' order by ordinal_position;
```
Expected: rows for `id, program_id, week_number, price_cents, created_at, updated_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00167_program_week_pricing.sql
git commit -m "feat(db): add program_week_pricing table for premium-week template"
```

---

### Task 2: Type — `ProgramWeekPricing`

**Files:**
- Modify: `types/database.ts` (add interface near `ProgramWeekAccess`, ~line 453)

- [ ] **Step 1: Add the interface**

After the `ProgramWeekAccess` interface (ends ~line 453) add:

```typescript
export interface ProgramWeekPricing {
  id: string
  program_id: string
  week_number: number
  price_cents: number
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): add ProgramWeekPricing"
```

---

### Task 3: DAL — `lib/db/program-week-pricing.ts`

**Files:**
- Create: `lib/db/program-week-pricing.ts`

- [ ] **Step 1: Write the DAL**

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramWeekPricing } from "@/types/database"

/** Service-role client bypasses RLS — called only from server-side admin routes/services. */
function getClient() {
  return createServiceRoleClient()
}

/** All premium-week rows for a program, ascending by week. */
export async function getPremiumWeeks(programId: string): Promise<ProgramWeekPricing[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_week_pricing")
    .select("*")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
  if (error) throw error
  return (data ?? []) as ProgramWeekPricing[]
}

/**
 * Replace-all: the given list becomes the complete set of premium weeks for the program.
 * Weeks not in the list are removed (i.e. become included).
 */
export async function setPremiumWeeks(
  programId: string,
  weeks: { week_number: number; price_cents: number }[],
): Promise<ProgramWeekPricing[]> {
  const supabase = getClient()
  const { error: delError } = await supabase.from("program_week_pricing").delete().eq("program_id", programId)
  if (delError) throw delError
  if (weeks.length === 0) return []
  const rows = weeks.map((w) => ({
    program_id: programId,
    week_number: w.week_number,
    price_cents: w.price_cents,
  }))
  const { data, error } = await supabase.from("program_week_pricing").insert(rows).select()
  if (error) throw error
  return (data ?? []) as ProgramWeekPricing[]
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/program-week-pricing.ts
git commit -m "feat(db): program-week-pricing DAL (get/setPremiumWeeks)"
```

---

### Task 4: Service — `lib/services/assign-program.ts` (the core fix)

**Files:**
- Create: `lib/services/assign-program.ts`
- Test: `__tests__/lib/services/assign-program.test.ts`

- [ ] **Step 1: Write the failing test (pure logic only)**

```typescript
import { describe, it, expect } from "vitest"
import { computeAssignmentPaymentStatus, buildWeekAccessRows } from "@/lib/services/assign-program"

describe("computeAssignmentPaymentStatus", () => {
  it("free entry is not_required", () => {
    expect(computeAssignmentPaymentStatus("free", false)).toBe("not_required")
  })
  it("complimentary is not_required even when paid", () => {
    expect(computeAssignmentPaymentStatus("one_time", true)).toBe("not_required")
    expect(computeAssignmentPaymentStatus("subscription", true)).toBe("not_required")
  })
  it("one_time entry is pending", () => {
    expect(computeAssignmentPaymentStatus("one_time", false)).toBe("pending")
  })
  it("subscription entry is pending", () => {
    expect(computeAssignmentPaymentStatus("subscription", false)).toBe("pending")
  })
})

describe("buildWeekAccessRows", () => {
  it("marks premium weeks paid/pending and the rest included/not_required", () => {
    const rows = buildWeekAccessRows("asg-1", 6, [{ week_number: 5, price_cents: 4000 }, { week_number: 6, price_cents: 4000 }])
    expect(rows).toHaveLength(6)
    expect(rows[0]).toEqual({
      assignment_id: "asg-1",
      week_number: 1,
      access_type: "included",
      price_cents: null,
      payment_status: "not_required",
      stripe_session_id: null,
      stripe_payment_id: null,
    })
    expect(rows[4]).toEqual({
      assignment_id: "asg-1",
      week_number: 5,
      access_type: "paid",
      price_cents: 4000,
      payment_status: "pending",
      stripe_session_id: null,
      stripe_payment_id: null,
    })
  })
  it("free entry plus premium weeks still locks the premium weeks", () => {
    const rows = buildWeekAccessRows("asg-2", 3, [{ week_number: 3, price_cents: 1500 }])
    expect(rows[2].access_type).toBe("paid")
    expect(rows[2].payment_status).toBe("pending")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- assign-program`
Expected: FAIL — cannot import `computeAssignmentPaymentStatus` / `buildWeekAccessRows`.

- [ ] **Step 3: Implement the service**

```typescript
import type {
  AssignmentPaymentStatus,
  PaymentType,
  ProgramAssignment,
  ProgramWeekAccess,
} from "@/types/database"
import { getProgramById } from "@/lib/db/programs"
import { getPremiumWeeks } from "@/lib/db/program-week-pricing"
import { createAssignment, getAssignmentByUserAndProgram } from "@/lib/db/assignments"
import { createWeekAccessBulk } from "@/lib/db/week-access"
import { getUserById } from "@/lib/db/users"
import { sendProgramReadyEmail } from "@/lib/email"

type NewWeekAccessRow = Omit<ProgramWeekAccess, "id" | "created_at" | "updated_at">

/** Pure: entry payment type + complimentary flag -> assignment payment_status. */
export function computeAssignmentPaymentStatus(
  paymentType: PaymentType,
  complimentary: boolean,
): AssignmentPaymentStatus {
  if (complimentary || paymentType === "free") return "not_required"
  // one_time and subscription both start pending; the Stripe webhook promotes them.
  return "pending"
}

/** Pure: seed week-access rows from the program's premium-week template. */
export function buildWeekAccessRows(
  assignmentId: string,
  durationWeeks: number,
  premiumWeeks: { week_number: number; price_cents: number }[],
): NewWeekAccessRow[] {
  const priceByWeek = new Map(premiumWeeks.map((w) => [w.week_number, w.price_cents]))
  return Array.from({ length: Math.max(durationWeeks, 1) }, (_, i) => {
    const week = i + 1
    const premiumPrice = priceByWeek.get(week)
    if (premiumPrice != null) {
      return {
        assignment_id: assignmentId,
        week_number: week,
        access_type: "paid" as const,
        price_cents: premiumPrice,
        payment_status: "pending" as const,
        stripe_session_id: null,
        stripe_payment_id: null,
      }
    }
    return {
      assignment_id: assignmentId,
      week_number: week,
      access_type: "included" as const,
      price_cents: null,
      payment_status: "not_required" as const,
      stripe_session_id: null,
      stripe_payment_id: null,
    }
  })
}

export interface AssignProgramInput {
  programId: string
  userId: string
  startDate: string
  notes?: string | null
  assignedBy?: string | null
  complimentary?: boolean
}

export interface AssignProgramResult {
  assignment: ProgramAssignment | null
  skipped: boolean
}

/**
 * THE single path to assign a program to a client. Every caller (admin dialog,
 * Pricing & Access sheet, any future flow) must use this so payment_status and
 * week-access are always seeded correctly. Skips clients with an existing active assignment.
 */
export async function assignProgram(input: AssignProgramInput): Promise<AssignProgramResult> {
  const { programId, userId, startDate, notes = null, assignedBy = null, complimentary = false } = input

  const existing = await getAssignmentByUserAndProgram(userId, programId)
  if (existing && existing.status === "active") return { assignment: null, skipped: true }

  const program = await getProgramById(programId)
  const premiumWeeks = await getPremiumWeeks(programId)
  const totalWeeks = program.duration_weeks ?? 1
  const paymentStatus = computeAssignmentPaymentStatus(program.payment_type, complimentary)

  const assignment = await createAssignment({
    program_id: programId,
    user_id: userId,
    assigned_by: assignedBy,
    start_date: startDate,
    end_date: null,
    status: "active",
    notes,
    current_week: 1,
    total_weeks: totalWeeks,
    payment_status: paymentStatus,
    expires_at: null,
  })

  await createWeekAccessBulk(buildWeekAccessRows(assignment.id, totalWeeks, premiumWeeks))

  // Notify the client — best-effort, never blocks assignment.
  try {
    const client = await getUserById(userId)
    await sendProgramReadyEmail(client.email, client.first_name, program.name, userId)
  } catch (err) {
    console.error(`[assignProgram] email failed for ${userId}:`, err)
  }

  return { assignment, skipped: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- assign-program`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/assign-program.ts __tests__/lib/services/assign-program.test.ts
git commit -m "feat(assign): centralized assignProgram() service + pure-logic tests"
```

---

### Task 5: Route the admin assign endpoint through `assignProgram`

**Files:**
- Modify: `app/api/admin/programs/[id]/assign/route.ts` (replace the per-user loop body, ~L55-102)

- [ ] **Step 1: Replace the inner handler body**

Replace the whole `try { ... }` block inside the handler (currently fetching program, computing `isPaid`, looping with `createAssignment` + `createWeekAccessBulk` + email) with:

```typescript
    try {
      const { id } = await params
      const body = await request.json()
      const result = assignmentSchema.safeParse(body)

      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid form data", details: result.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const { user_ids, start_date, notes, complimentary } = result.data

      let assigned = 0
      let skipped = 0
      const errors: string[] = []

      for (const userId of user_ids) {
        try {
          const { skipped: wasSkipped } = await assignProgram({
            programId: id,
            userId,
            startDate: start_date,
            notes: notes ?? null,
            complimentary,
          })
          if (wasSkipped) skipped++
          else assigned++
        } catch (err) {
          errors.push(`Failed to assign to user ${userId}`)
          console.error(`[assign] Error for user ${userId}:`, err)
        }
      }

      return NextResponse.json({ assigned, skipped, errors }, { status: 201 })
    } catch {
      return NextResponse.json({ error: "Failed to assign program. Please try again." }, { status: 500 })
    }
```

- [ ] **Step 2: Fix imports**

At the top of the file, remove now-unused imports (`createAssignment`, `getAssignmentByUserAndProgram`, `getProgramById`, `getUserById`, `sendProgramReadyEmail`, `createWeekAccessBulk`) and add:

```typescript
import { assignProgram } from "@/lib/services/assign-program"
```
Keep `assignmentSchema` and `withAudit` imports.

- [ ] **Step 3: Typecheck + verify no week_access is hardcoded here anymore**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm the file no longer references `createWeekAccessBulk` or `payment_status: ... "not_required"`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/programs/[id]/assign/route.ts"
git commit -m "refactor(assign): admin assign route delegates to assignProgram()"
```

---

### Task 6: Stop the AI orchestrator from auto-assigning

**Files:**
- Modify: `functions/src/ai/orchestrator.ts` (remove the auto-assign block ~L956-975 and the now-unused `createWeekAccessRecords` ~L146-160)

- [ ] **Step 1: Remove the auto-assign block**

Delete the `// Auto-assign` block that runs when `request.client_id` is set (the `if (request.client_id) { ... createAssignment(...) ... createWeekAccessRecords(...) }` section, ~L956-975). The function still creates the program and exercises; it just no longer creates an assignment or week-access. Assignment now happens when the coach clicks **Publish & assign** in the sheet.

- [ ] **Step 2: Remove dead helpers**

Delete the now-unused `createAssignment` (~L139-144) and `createWeekAccessRecords` (~L146-160) helpers in this file if they have no other callers (grep `createAssignment(` and `createWeekAccessRecords(` within `functions/src/ai/orchestrator.ts` — should be zero after Step 1).

- [ ] **Step 3: Build the functions package**

Run: `cd functions; npm run build` (or the repo's functions build script)
Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add functions/src/ai/orchestrator.ts
git commit -m "refactor(ai): orchestrator no longer auto-assigns; assignment happens at publish"
```

---

### Task 7: Premium-weeks API — `PUT/GET /api/admin/programs/[id]/premium-weeks`

**Files:**
- Create: `lib/validators/premium-weeks.ts`
- Create: `app/api/admin/programs/[id]/premium-weeks/route.ts`

- [ ] **Step 1: Write the validator**

```typescript
import { z } from "zod"

export const premiumWeeksSchema = z.object({
  weeks: z
    .array(
      z.object({
        week_number: z.coerce.number().int().positive(),
        price_cents: z.coerce.number().int().positive(),
      }),
    )
    .max(52),
})

export type PremiumWeeksData = z.infer<typeof premiumWeeksSchema>
```

- [ ] **Step 2: Write the route**

```typescript
import { NextResponse } from "next/server"
import { premiumWeeksSchema } from "@/lib/validators/premium-weeks"
import { getPremiumWeeks, setPremiumWeeks } from "@/lib/db/program-week-pricing"
import { getProgramById } from "@/lib/db/programs"
import { withAudit } from "@/lib/audit/with-audit"

export const GET = withAudit(
  {
    action: "program.updated",
    category: "admin_read_sensitive",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "program", id }
    },
  },
  async (_request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    const { id } = await params
    const weeks = await getPremiumWeeks(id)
    return NextResponse.json({ weeks })
  },
)

export const PUT = withAudit(
  {
    action: "program.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "program", id }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const { id } = await params
      const result = premiumWeeksSchema.safeParse(await request.json())
      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid data", details: result.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const program = await getProgramById(id)
      const maxWeek = program.duration_weeks ?? 1
      const bad = result.data.weeks.find((w) => w.week_number > maxWeek)
      if (bad) {
        return NextResponse.json(
          { error: `Week ${bad.week_number} is beyond the program's ${maxWeek} weeks.` },
          { status: 400 },
        )
      }
      const weeks = await setPremiumWeeks(id, result.data.weeks)
      return NextResponse.json({ weeks })
    } catch {
      return NextResponse.json({ error: "Failed to save premium weeks." }, { status: 500 })
    }
  },
)
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/validators/premium-weeks.ts "app/api/admin/programs/[id]/premium-weeks/route.ts"
git commit -m "feat(api): premium-weeks GET/PUT endpoint"
```

---

### Task 8: `PricingAccessSheet` component (the one surface)

**Files:**
- Create: `components/admin/PricingAccessSheet.tsx`

This is the shared sheet used by the AI builder, the manual creator, and (later) the program page. It is a self-contained dialog. On **Publish** it: (1) PATCHes the program's pricing + visibility, (2) PUTs the premium weeks, (3) if `assignTo` is set, POSTs the assignment.

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Gift, CreditCard, RefreshCw, Lock, Unlock, Lightbulb, Globe, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PaymentType, Program } from "@/types/database"

interface PricingAccessSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program: Program
  /** When set, "Publish" also assigns the program to this client. */
  assignTo?: { clientId: string; clientName?: string }
  /** Week numbers the AI suggested as premium (pre-checked, price empty). */
  suggestedPremiumWeeks?: number[]
  onPublished?: () => void
}

export function PricingAccessSheet({
  open,
  onOpenChange,
  program,
  assignTo,
  suggestedPremiumWeeks = [],
  onPublished,
}: PricingAccessSheetProps) {
  const [paymentType, setPaymentType] = useState<PaymentType>(program.payment_type ?? "one_time")
  const [priceDollars, setPriceDollars] = useState(program.price_cents != null ? (program.price_cents / 100).toFixed(2) : "")
  const [billingInterval, setBillingInterval] = useState(program.billing_interval ?? "month")
  const [isPublic, setIsPublic] = useState(program.is_public ?? false)
  // week_number -> price string ("" = premium but unpriced). Absent = included.
  const [premium, setPremium] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const totalWeeks = program.duration_weeks ?? 1

  // Load existing premium weeks; fall back to AI suggestions for a fresh program.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/programs/${program.id}/premium-weeks`)
        if (res.ok) {
          const data = await res.json()
          const map: Record<number, string> = {}
          for (const w of data.weeks ?? []) map[w.week_number] = (w.price_cents / 100).toFixed(2)
          if (Object.keys(map).length === 0) for (const w of suggestedPremiumWeeks) map[w] = ""
          if (!cancelled) setPremium(map)
        }
      } catch {
        /* ignore — start empty */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, program.id])

  const toggleWeek = useCallback((week: number) => {
    setPremium((prev) => {
      const next = { ...prev }
      if (week in next) delete next[week]
      else next[week] = ""
      return next
    })
  }, [])

  const paymentOptions: { value: PaymentType; label: string; icon: React.ReactNode }[] = [
    { value: "free", label: "Free", icon: <Gift className="size-4" /> },
    { value: "one_time", label: "One-time", icon: <CreditCard className="size-4" /> },
    { value: "subscription", label: "Subscription", icon: <RefreshCw className="size-4" /> },
  ]

  async function handlePublish() {
    // Validate entry price
    if (paymentType !== "free" && (!priceDollars || parseFloat(priceDollars) <= 0)) {
      toast.error("Set an entry price (or choose Free).")
      return
    }
    // Validate premium prices
    const premiumWeeks: { week_number: number; price_cents: number }[] = []
    for (const [week, price] of Object.entries(premium)) {
      const cents = Math.round(parseFloat(price) * 100)
      if (!price || cents <= 0) {
        toast.error(`Set a price for premium week ${week}.`)
        return
      }
      premiumWeeks.push({ week_number: Number(week), price_cents: cents })
    }

    setSaving(true)
    try {
      // 1) Program pricing + visibility (reuses existing PATCH + Stripe sync)
      const patchPayload = {
        name: program.name,
        description: program.description,
        category: program.category,
        difficulty: program.difficulty,
        tier: program.tier,
        duration_weeks: program.duration_weeks,
        sessions_per_week: program.sessions_per_week,
        split_type: program.split_type,
        periodization: program.periodization,
        payment_type: paymentType,
        billing_interval: paymentType === "subscription" ? billingInterval : null,
        price_cents: paymentType === "free" ? null : Math.round(parseFloat(priceDollars) * 100),
        is_public: isPublic,
      }
      const patchRes = await fetch(`/api/admin/programs/${program.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchPayload),
      })
      if (!patchRes.ok) throw new Error("Failed to save pricing")

      // 2) Premium weeks (replace-all)
      const weeksRes = await fetch(`/api/admin/programs/${program.id}/premium-weeks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks: premiumWeeks }),
      })
      if (!weeksRes.ok) throw new Error("Failed to save premium weeks")

      // 3) Assign (only when launched with a target client)
      if (assignTo) {
        const today = new Date().toISOString().split("T")[0]
        const assignRes = await fetch(`/api/admin/programs/${program.id}/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_ids: [assignTo.clientId], start_date: today, notes: null, complimentary: false }),
        })
        if (!assignRes.ok) throw new Error("Saved pricing, but assigning failed")
      }

      toast.success(assignTo ? "Published & assigned" : "Pricing & access saved")
      onPublished?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish")
    } finally {
      setSaving(false)
    }
  }

  const previewLine = (() => {
    const entry = paymentType === "free" ? "Free to start" : `Pay $${priceDollars || "0"}`
    const premiumNums = Object.keys(premium).map(Number).sort((a, b) => a - b)
    const premiumPart = premiumNums.length
      ? ` Weeks ${premiumNums.join(", ")} are paid add-ons.`
      : ""
    return `${entry} → included weeks unlock.${premiumPart}`
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Pricing &amp; Access</DialogTitle>
        </DialogHeader>

        {/* Coach guide */}
        <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Lightbulb className="size-4 text-primary shrink-0" />
          <div>
            <p className="font-medium text-foreground">How this works</p>
            <ol className="list-decimal pl-4 mt-1 space-y-0.5">
              <li>Choose how clients get in — Free, one-time, or subscription.</li>
              <li>Tap any week to make it a paid add-on.</li>
              <li>Publish — clients are gated automatically.</li>
            </ol>
          </div>
        </div>

        {/* Entry */}
        <div className="space-y-2">
          <Label>How clients get in</Label>
          <div className="grid grid-cols-3 gap-2">
            {paymentOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentType(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-xs font-medium transition-colors",
                  paymentType === opt.value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          {paymentType !== "free" && (
            <div className="flex items-center gap-2 pt-1">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  min="0.50"
                  step="0.01"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  placeholder="285.00"
                  className="pl-7 w-32"
                />
              </div>
              {paymentType === "subscription" && (
                <select
                  value={billingInterval}
                  onChange={(e) => setBillingInterval(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="month">/ month</option>
                  <option value="week">/ week</option>
                </select>
              )}
            </div>
          )}
        </div>

        {/* Weeks */}
        <div className="space-y-2">
          <Label>Weeks — tap to make premium</Label>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
              const isPremium = week in premium
              return (
                <button
                  key={week}
                  type="button"
                  onClick={() => toggleWeek(week)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isPremium ? "border-warning text-warning bg-warning/5" : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {isPremium ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                  W{week}
                </button>
              )
            })}
          </div>
          {Object.keys(premium).length > 0 && (
            <div className="space-y-1.5 pt-1">
              {Object.keys(premium).map(Number).sort((a, b) => a - b).map((week) => (
                <div key={week} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-12">Week {week}</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min="0.50"
                      step="0.01"
                      value={premium[week]}
                      onChange={(e) => setPremium((p) => ({ ...p, [week]: e.target.value }))}
                      placeholder="40.00"
                      className="pl-7 h-8 w-28"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                !isPublic ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
              )}
            >
              <EyeOff className="size-4" /> Private
            </button>
            <button
              type="button"
              onClick={() => setIsPublic(true)}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                isPublic ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
              )}
            >
              <Globe className="size-4" /> Public store
            </button>
          </div>
        </div>

        {/* Preview */}
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Client sees: </span>
          {previewLine}
        </p>

        <DialogFooter>
          <Button onClick={handlePublish} disabled={saving}>
            {saving ? "Publishing..." : assignTo ? `Publish & assign${assignTo.clientName ? ` to ${assignTo.clientName}` : ""}` : "Save pricing & access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/PricingAccessSheet.tsx
git commit -m "feat(admin): shared PricingAccessSheet component"
```

---

### Task 9: Wire the AI builder result → sheet

**Files:**
- Modify: `components/admin/AiProgramChatDialog.tsx` (result card CTA + sheet swap)

- [ ] **Step 1: Add sheet state + derive the program + client**

Near the other state in `AiProgramChatDialog` (~L560), add:

```tsx
const [pricingProgram, setPricingProgram] = useState<Program | null>(null)
```
Add `Program` to the `@/types/database` import. Add a fetch helper to load the generated program by id (the result event only carries `programId`):

```tsx
const openPricingForProgram = useCallback(async (programId: string) => {
  try {
    const res = await fetch(`/api/admin/programs/${programId}`)
    if (res.ok) {
      const program = (await res.json()) as Program
      setPricingProgram(program)
    } else {
      // Fall back to the program page if we can't load it inline
      router.push(`/admin/programs/${programId}`)
    }
  } catch {
    router.push(`/admin/programs/${programId}`)
  }
}, [router])
```

> Note: this needs a `GET /api/admin/programs/[id]` handler. If one does not exist, add it in this task: a `withAudit`-wrapped GET that returns `await getProgramById(id)` (mirror the PATCH file's structure in `app/api/admin/programs/[id]/route.ts`).

- [ ] **Step 2: Derive the chat's client for assignment**

Add a helper that finds the most recent proposed client from the `items` list:

```tsx
function latestClient(): { clientId: string; clientName?: string } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "params" && it.data.client_id) {
      return { clientId: it.data.client_id, clientName: it.data.client_name }
    }
  }
  return undefined
}
```

- [ ] **Step 3: Change the result card CTA**

In `ProgramResultCard` (~L284-313) replace the "View Program" / "Assign" buttons with a primary "Set pricing & access" plus a secondary "View program":

```tsx
<div className="flex items-center gap-2">
  <Button size="sm" onClick={onSetPricing}>
    Set pricing &amp; access
  </Button>
  <Link href={`/admin/programs/${event.programId}`}>
    <Button size="sm" variant="outline">View program</Button>
  </Link>
</div>
```
Change the card's prop from `onAssign` to `onSetPricing` and update its type.

- [ ] **Step 4: Render the result card + the sheet**

Where the `program_created` event renders (~L1223), pass the new handler:

```tsx
if (evt.type === "program_created") {
  return (
    <ProgramResultCard
      key={evt.id}
      event={evt}
      onSetPricing={() => evt.programId && openPricingForProgram(evt.programId)}
    />
  )
}
```
And near the bottom of the component's JSX (before the closing `</Dialog>`), render the sheet:

```tsx
{pricingProgram && (
  <PricingAccessSheet
    open={!!pricingProgram}
    onOpenChange={(o) => !o && setPricingProgram(null)}
    program={pricingProgram}
    assignTo={latestClient()}
    onPublished={() => {
      setPricingProgram(null)
      router.refresh()
    }}
  />
)}
```
Import `PricingAccessSheet` at the top.

- [ ] **Step 5: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → no errors.
Manual: `npm run dev`, open the AI builder, generate a program, confirm the result card shows **Set pricing & access** and clicking it opens the sheet.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AiProgramChatDialog.tsx "app/api/admin/programs/[id]/route.ts"
git commit -m "feat(ai): AI builder hands off into PricingAccessSheet"
```

---

### Task 10: Wire the manual creator → sheet (2-step wizard)

**Files:**
- Modify: `components/admin/ProgramFormDialog.tsx`

- [ ] **Step 1: Reduce the wizard to Info → Schedule**

- Change `STEPS` (~L107) to two entries: `[{ label: "Info", number: 1 }, { label: "Schedule", number: 2 }]`.
- In `Step2Schedule`, remove the Payment Type block, the Price block, and the Billing Interval block — keep only **Duration** and **Sessions/Week**. Remove the now-unused `paymentType/billingInterval/priceDollars` props from `Step2Schedule`.
- Delete `Step3Audience` and its render branch (`step === 2`). The wizard's max step is now `1`.
- In `validateStep`, drop the `s === 1` price/subscription checks and the `s === 2` branch.

- [ ] **Step 2: Create the program as a private free shell, then open the sheet**

In `handleSubmit`, build the create payload with neutral pricing (the sheet sets the real values):

```tsx
const data = {
  name: name.trim(),
  description: description.trim() || null,
  category: selectedCategories,
  difficulty,
  tier: selectedTier,
  duration_weeks: durationWeeks,
  sessions_per_week: sessionsPerWeek,
  payment_type: "free" as const,
  billing_interval: null,
  price_cents: null,
  split_type: splitType || null,
  periodization: periodization || null,
  is_public: false,
}
```
After a successful create response, instead of the success view, store the created program and open the sheet:

```tsx
const responseData = await response.json()
setCreatedProgram(responseData as Program)  // POST returns the created program row
```
Add state `const [createdProgram, setCreatedProgram] = useState<Program | null>(null)` and import `Program` + `PricingAccessSheet`.

- [ ] **Step 3: Render the sheet after create**

Replace the `savedProgramId` success view with:

```tsx
if (createdProgram) {
  return (
    <PricingAccessSheet
      open={open}
      onOpenChange={handleDialogClose}
      program={createdProgram}
      onPublished={() => {
        setCreatedProgram(null)
        router.refresh()
      }}
    />
  )
}
```
(Editing an existing program still saves via the wizard as before, or — preferred — opens the sheet for pricing; for this task, keep edit-mode pricing in the sheet only when `program` is paid. Minimum: new programs flow through the sheet.)

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → no errors.
Manual: create a program manually → after "Create" the Pricing & Access sheet opens → set one-time $99 → Save → program shows the price.

- [ ] **Step 5: Commit**

```bash
git add components/admin/ProgramFormDialog.tsx
git commit -m "feat(admin): manual creator is 2-step, hands off to PricingAccessSheet"
```

---

### Phase 1 verification

- [ ] Generate an AI program for a client → result card → **Set pricing & access** → one-time $150 → **Publish & assign**.
- [ ] Query the new assignment:
```sql
select pa.payment_status, pwa.week_number, pwa.access_type, pwa.payment_status
from program_assignments pa
join program_week_access pwa on pwa.assignment_id = pa.id
where pa.program_id = '<id>' order by pwa.week_number;
```
Expected: assignment `payment_status = 'pending'`; premium weeks `paid/pending`, rest `included/not_required`. **The gate bug is fixed for new programs.**

---

## Phase 2 — Visible client pay prompt

### Task 11: `PendingPaymentCard` component

**Files:**
- Create: `components/client/PendingPaymentCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Lock } from "lucide-react"
import { ClientBuyButton } from "@/app/(client)/client/programs/[id]/ClientBuyButton"

interface PendingPaymentCardProps {
  programId: string
  programName: string
  priceCents: number | null
  isSubscription: boolean
}

export function PendingPaymentCard({ programId, programName, priceCents, isSubscription }: PendingPaymentCardProps) {
  const price = priceCents != null ? `$${(priceCents / 100).toFixed(2)}${isSubscription ? "/mo" : ""}` : ""
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
          <Lock className="size-4 text-warning" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Payment required to unlock {programName}</p>
          <p className="text-xs text-muted-foreground">
            Complete your {price ? `${price} ` : ""}payment to start training.
          </p>
        </div>
      </div>
      <ClientBuyButton programId={programId} label={isSubscription ? "Subscribe" : "Complete payment"} />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/client/PendingPaymentCard.tsx
git commit -m "feat(client): PendingPaymentCard pay prompt"
```

---

### Task 12: Surface pending payments on dashboard + workouts

**Files:**
- Modify: `app/(client)/client/dashboard/page.tsx`
- Modify: `app/(client)/client/workouts/page.tsx`

- [ ] **Step 1: Dashboard — compute pending assignments**

In `dashboard/page.tsx`, after `activeAssignments`/`expiredAssignments` are filtered (~L55-60) add:

```tsx
const pendingPaymentAssignments = typedAssignments.filter(
  (a) => a.status === "active" && a.payment_status === "pending" && !isAssignmentExpired(a.expires_at),
)
```

- [ ] **Step 2: Dashboard — render the cards**

Import the card at the top: `import { PendingPaymentCard } from "@/components/client/PendingPaymentCard"`. Render above the main dashboard content (e.g. right after `<PageHeader .../>` or the banners):

```tsx
{pendingPaymentAssignments.length > 0 && (
  <div className="space-y-2 mb-6">
    {pendingPaymentAssignments.map((a) => (
      <PendingPaymentCard
        key={a.id}
        programId={a.program_id}
        programName={a.programs?.name ?? "Your program"}
        priceCents={a.programs?.price_cents ?? null}
        isSubscription={a.programs?.payment_type === "subscription"}
      />
    ))}
  </div>
)}
```

- [ ] **Step 3: Workouts — same treatment**

In `workouts/page.tsx`, after `activeAssignments` is computed (~L83-85) add the same `pendingPaymentAssignments` filter against the fetched `assignments`, import `PendingPaymentCard`, and render the cards inside `<WaiverGate>` above the `EmptyState`/`WorkoutViewToggle` block (so a client with only a pending program sees the pay prompt instead of "No active programs").

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → no errors.
Manual: assign a one-time program to a test client (now `pending`) → log in as that client → dashboard + workouts show **Payment required** with a Complete payment button.

- [ ] **Step 5: Commit**

```bash
git add "app/(client)/client/dashboard/page.tsx" "app/(client)/client/workouts/page.tsx"
git commit -m "feat(client): surface pending-payment programs with a pay prompt"
```

---

## Phase 3 — Server-side enforcement

### Task 13: Payment guard — `lib/services/access-guard.ts`

**Files:**
- Create: `lib/services/access-guard.ts`
- Test: `__tests__/lib/services/access-guard.test.ts`

- [ ] **Step 1: Write the failing test (pure logic)**

```typescript
import { describe, it, expect } from "vitest"
import { isAccessAllowed } from "@/lib/services/access-guard"

describe("isAccessAllowed", () => {
  it("blocks when entry payment is pending", () => {
    expect(isAccessAllowed({ payment_status: "pending" }, null)).toBe(false)
  })
  it("allows when entry is not_required / paid / subscription_active", () => {
    expect(isAccessAllowed({ payment_status: "not_required" }, null)).toBe(true)
    expect(isAccessAllowed({ payment_status: "paid" }, null)).toBe(true)
    expect(isAccessAllowed({ payment_status: "subscription_active" }, null)).toBe(true)
  })
  it("blocks a paid week that is still pending", () => {
    expect(
      isAccessAllowed({ payment_status: "paid" }, { access_type: "paid", payment_status: "pending" }),
    ).toBe(false)
  })
  it("allows an included week and a paid-but-paid week", () => {
    expect(isAccessAllowed({ payment_status: "paid" }, { access_type: "included", payment_status: "not_required" })).toBe(true)
    expect(isAccessAllowed({ payment_status: "paid" }, { access_type: "paid", payment_status: "paid" })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- access-guard`
Expected: FAIL — cannot import `isAccessAllowed`.

- [ ] **Step 3: Implement the guard**

```typescript
import type { ProgramAssignment, ProgramWeekAccess } from "@/types/database"
import { getAssignmentById } from "@/lib/db/assignments"
import { getWeekAccess } from "@/lib/db/week-access"

/** Pure: may this client train against this assignment (and optionally this week)? */
export function isAccessAllowed(
  assignment: Pick<ProgramAssignment, "payment_status">,
  weekAccess: Pick<ProgramWeekAccess, "access_type" | "payment_status"> | null,
): boolean {
  if (assignment.payment_status === "pending") return false
  if (weekAccess && weekAccess.access_type === "paid" && weekAccess.payment_status === "pending") return false
  return true
}

/** Loads the assignment (and week, if given) and applies isAccessAllowed. */
export async function assertAssignmentPayable(
  assignmentId: string,
  weekNumber?: number,
): Promise<{ ok: boolean }> {
  const assignment = await getAssignmentById(assignmentId)
  const weekAccess = weekNumber != null ? await getWeekAccess(assignmentId, weekNumber) : null
  return { ok: isAccessAllowed(assignment, weekAccess) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- access-guard`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/access-guard.ts __tests__/lib/services/access-guard.test.ts
git commit -m "feat(access): payment access guard + pure-logic tests"
```

---

### Task 14: Enforce the guard on the workout APIs

**Files:**
- Modify: `app/api/client/workouts/log/route.ts`
- Modify: `app/api/client/workouts/complete-week/route.ts`

- [ ] **Step 1: Enforce on log**

In `log/route.ts`, after `parsed.data` is destructured and before `logProgress(...)` (~L40), add:

```typescript
    if (assignment_id) {
      const { ok } = await assertAssignmentPayable(assignment_id)
      if (!ok) {
        return NextResponse.json({ error: "Payment required to access this program." }, { status: 402 })
      }
    }
```
Import at top: `import { assertAssignmentPayable } from "@/lib/services/access-guard"`.

- [ ] **Step 2: Enforce on complete-week**

In `complete-week/route.ts`, after the ownership check (`assignment.user_id !== session.user.id`) and the `status !== "active"` check (~L38), add:

```typescript
    const { ok } = await assertAssignmentPayable(assignmentId, assignment.current_week)
    if (!ok) {
      return NextResponse.json({ error: "Payment required to advance this program." }, { status: 402 })
    }
```
Import `assertAssignmentPayable` at the top.

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → no errors.
Manual: as a client with a `pending` assignment, attempt to POST `/api/client/workouts/log` with that `assignment_id` (e.g. via devtools) → expect `402`. After payment (`paid`) → expect `201`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/client/workouts/log/route.ts" "app/api/client/workouts/complete-week/route.ts"
git commit -m "feat(access): enforce payment on workout log + complete-week APIs"
```

---

### Task 15: Grandfather the 3 existing ungated paid assignments

These are already `not_required` (free access) — grandfathering means **leaving them as-is** so nobody is surprise-locked. No migration; just confirm + annotate for clarity.

**Files:** none (data only)

- [ ] **Step 1: Confirm the rows are the known three**

Run via `mcp__supabase__execute_sql`:
```sql
select pa.id, u.email, p.name, p.price_cents, pa.payment_status
from program_assignments pa
join programs p on p.id = pa.program_id
left join users u on u.id = pa.user_id
where pa.status = 'active' and pa.payment_status = 'not_required' and coalesce(p.price_cents,0) > 0;
```
Expected: the Sid's / Luca / test-account rows, all `not_required`.

- [ ] **Step 2 (optional): Annotate for auditability**

```sql
update program_assignments
set notes = coalesce(notes || ' | ', '') || 'grandfathered free access (pre-gate-fix)'
where status = 'active' and payment_status = 'not_required'
  and program_id in (select id from programs where coalesce(price_cents,0) > 0);
```

- [ ] **Step 3: Decide per real client (coach call)** — if any should actually pay, flip that single row to `pending` manually; otherwise leave grandfathered. No code change.

---

## Self-Review (completed during planning)

**Spec coverage:** §4.1 table → Task 1–3; §4.2 `assignProgram` → Task 4–5; §4.3 sheet → Task 8; §4.4 AI handoff → Task 6, 9; §4.5 manual → Task 10; §5.1 pay prompt → Task 11–12; §5.2 enforcement → Task 13–14; §7 grandfather → Task 15. All sections mapped.

**Type consistency:** `computeAssignmentPaymentStatus`, `buildWeekAccessRows`, `assignProgram`, `getPremiumWeeks`/`setPremiumWeeks`, `isAccessAllowed`/`assertAssignmentPayable`, `ProgramWeekPricing`, `PricingAccessSheet` props — names used identically across tasks. `assignProgram` returns `{ assignment, skipped }`; the assign route consumes `.skipped`. ✓

**Known follow-ups (not blockers):**
- `GET /api/admin/programs/[id]` is added in Task 9 if missing — both the AI builder and the manual creator rely on receiving the full `Program` object (the POST `/api/admin/programs` already returns it).
- Per-week server enforcement on `log` is assignment-level only (no week in the log payload); `complete-week` enforces the current week. Documented in §5.2.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-07-program-creator-pricing-access.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?** (And do you want all three phases now, or just Phase 1 — the gate fix — first?)
