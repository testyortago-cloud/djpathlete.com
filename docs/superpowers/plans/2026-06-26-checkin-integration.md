# Check-in Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline; tasks share the client detail page so parallel subagents would conflict). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the standalone "Check-ins" sidebar tab with check-in surfaced as a prominent action button on the client page, a progress badge on the client's assigned program, and the self-check-in QR reached from the Clients list.

**Architecture:** The client detail server component loads pack data once via a new `loadClientPacksView`, derives a pure `summarizeClientPacks` summary, and feeds three consumers (header check-in button, program badge, packs panel). Mutations call `router.refresh()` so the server re-pulls and all three stay consistent. The `/admin/today` page + roster are removed; the QR moves to the Clients list header.

**Tech Stack:** Next.js 16 App Router (RSC + client components), TypeScript, Vitest + Testing Library, Sonner, `qrcode`, Supabase DAL.

## Global Constraints

- No `src/`; path alias `@/*` = project root.
- Semantic Tailwind classes only (no hardcoded hex); icons from `lucide-react`.
- DB reads go through `lib/db/*`; cross-table orchestration lives in `lib/services/*`.
- A `Map` may be passed only to server-rendered code, never across the client boundary.
- The `GET /api/admin/session-packs` response shape (`{ packages: PackWithCheckins[] }`) must not change.
- Commit after each task. Local commits on `main`; **do not push**.

---

### Task 1: `client-packs-view.ts` — shared loader + pure summary

**Files:**
- Create: `lib/services/client-packs-view.ts`
- Modify: `app/api/admin/session-packs/route.ts` (use the new loader)
- Test: `__tests__/lib/services/client-packs-view.test.ts`

**Interfaces:**
- Produces:
  - `type PackWithCheckins = ClientPackage & { checkins: SessionCheckin[]; program_name: string | null }`
  - `loadClientPacksView(clientUserId: string): Promise<PackWithCheckins[]>`
  - `interface ClientPacksSummary { activeRemaining: number; hasActiveCredits: boolean; byAssignment: Map<string, { remaining: number; total: number }> }`
  - `summarizeClientPacks(packs: Array<Pick<ClientPackage,"status"|"credits_total"|"credits_used"|"expires_at"|"assignment_id">>, now: Date): ClientPacksSummary`

- [ ] **Step 1: Write failing tests** for `summarizeClientPacks`:

```ts
import { describe, it, expect } from "vitest"
import { summarizeClientPacks } from "@/lib/services/client-packs-view"
import type { ClientPackage } from "@/types/database"

const NOW = new Date("2026-06-26T12:00:00Z")
function pack(o: Partial<ClientPackage>): ClientPackage {
  return {
    id: "p", client_user_id: "c", product_id: null, assignment_id: null,
    session_type: "1-on-1", credits_total: 10, credits_used: 0, price_cents: 0,
    payment_method: "cash", payment_status: "paid", stripe_session_id: null,
    stripe_payment_id: null, purchased_at: NOW.toISOString(), expires_at: null,
    status: "active", last_reminded_threshold: null, notes: null, created_by: null,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...o,
  } as ClientPackage
}

describe("summarizeClientPacks", () => {
  it("sums remaining across active packs", () => {
    const s = summarizeClientPacks([pack({ credits_used: 3 }), pack({ credits_total: 5, credits_used: 1 })], NOW)
    expect(s.activeRemaining).toBe(7 + 4)
    expect(s.hasActiveCredits).toBe(true)
  })
  it("ignores expired, depleted, and non-active packs", () => {
    const s = summarizeClientPacks([
      pack({ status: "active", credits_used: 10 }),               // depleted
      pack({ status: "expired", credits_used: 0 }),               // not active
      pack({ status: "active", expires_at: "2026-06-01T00:00:00Z" }), // expired by date
    ], NOW)
    expect(s.activeRemaining).toBe(0)
    expect(s.hasActiveCredits).toBe(false)
  })
  it("groups linked-assignment progress, summing multiple packs", () => {
    const s = summarizeClientPacks([
      pack({ assignment_id: "a1", credits_total: 8, credits_used: 5 }),
      pack({ assignment_id: "a1", credits_total: 4, credits_used: 0 }),
      pack({ assignment_id: "a2", credits_total: 6, credits_used: 6 }), // depleted → excluded
    ], NOW)
    expect(s.byAssignment.get("a1")).toEqual({ remaining: 7, total: 12 })
    expect(s.byAssignment.has("a2")).toBe(false)
  })
  it("handles no packs", () => {
    const s = summarizeClientPacks([], NOW)
    expect(s).toEqual({ activeRemaining: 0, hasActiveCredits: false, byAssignment: new Map() })
  })
})
```

- [ ] **Step 2: Run test → FAIL** (`module not found`).
  Run: `npx vitest run __tests__/lib/services/client-packs-view.test.ts`

- [ ] **Step 3: Implement** `lib/services/client-packs-view.ts`:

```ts
import type { ClientPackage, SessionCheckin } from "@/types/database"
import { listPackagesForClient } from "@/lib/db/client-packages"
import { listCheckinsForPackage } from "@/lib/db/session-checkins"
import { getAssignmentById } from "@/lib/db/assignments"
import { getProgramById } from "@/lib/db/programs"
import { remainingCredits, isExpired } from "@/lib/services/session-credits"

export type PackWithCheckins = ClientPackage & { checkins: SessionCheckin[]; program_name: string | null }

/** A client's packages (newest first), each with check-in history + linked program name. */
export async function loadClientPacksView(clientUserId: string): Promise<PackWithCheckins[]> {
  const packages = await listPackagesForClient(clientUserId)

  const programNameByAssignment = new Map<string, string | null>()
  for (const a of new Set(packages.map((p) => p.assignment_id).filter((x): x is string => !!x))) {
    try {
      const assignment = await getAssignmentById(a)
      const program = await getProgramById(assignment.program_id)
      programNameByAssignment.set(a, program?.name ?? null)
    } catch {
      programNameByAssignment.set(a, null)
    }
  }

  return Promise.all(
    packages.map(async (p) => ({
      ...p,
      checkins: await listCheckinsForPackage(p.id),
      program_name: p.assignment_id ? (programNameByAssignment.get(p.assignment_id) ?? null) : null,
    })),
  )
}

type PackSlice = Pick<ClientPackage, "status" | "credits_total" | "credits_used" | "expires_at" | "assignment_id">

export interface ClientPacksSummary {
  activeRemaining: number
  hasActiveCredits: boolean
  byAssignment: Map<string, { remaining: number; total: number }>
}

/** A pack contributes credits iff it would actually be deducted on check-in
 *  (status active, not expired, remaining > 0) — mirrors getActivePackageForClient. */
export function summarizeClientPacks(packs: PackSlice[], now: Date): ClientPacksSummary {
  let activeRemaining = 0
  const byAssignment = new Map<string, { remaining: number; total: number }>()
  for (const p of packs) {
    if (p.status !== "active" || isExpired(p, now)) continue
    const rem = remainingCredits(p)
    if (rem <= 0) continue
    activeRemaining += rem
    if (p.assignment_id) {
      const prev = byAssignment.get(p.assignment_id) ?? { remaining: 0, total: 0 }
      byAssignment.set(p.assignment_id, { remaining: prev.remaining + rem, total: prev.total + p.credits_total })
    }
  }
  return { activeRemaining, hasActiveCredits: activeRemaining > 0, byAssignment }
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Refactor the GET route** to reuse the loader — replace its body's package-building with:

```ts
import { loadClientPacksView } from "@/lib/services/client-packs-view"
// ...
const packages = await loadClientPacksView(clientUserId)
return NextResponse.json({ packages })
```
Drop the now-unused imports (`listPackagesForClient`, `listCheckinsForPackage`, `getAssignmentById`, `getProgramById`) from the route.

- [ ] **Step 6: Run** `npx vitest run __tests__/api/session-packs` → existing GET-related tests still green. Commit.

---

### Task 2: `ClientCheckinButton` (prominent action button)

**Files:**
- Create: `components/admin/packs/ClientCheckinButton.tsx`
- Test: `__tests__/components/admin/packs/ClientCheckinButton.test.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/session-packs/checkin` (`{ clientUserId }` → `{ ok, reason?, remaining? }`).
- Produces: `<ClientCheckinButton clientUserId={string} hasActiveCredits={boolean} />` (renders nothing when `!hasActiveCredits`).

- [ ] **Step 1: Write failing component tests:**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ClientCheckinButton } from "@/components/admin/packs/ClientCheckinButton"

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock("sonner", () => ({ toast }))

beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks() })

describe("ClientCheckinButton", () => {
  it("renders nothing without active credits", () => {
    const { container } = render(<ClientCheckinButton clientUserId="c1" hasActiveCredits={false} />)
    expect(container).toBeEmptyDOMElement()
  })
  it("checks in and toasts remaining", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, remaining: 4 }), { status: 200 }),
    )
    render(<ClientCheckinButton clientUserId="c1" hasActiveCredits />)
    await userEvent.click(screen.getByRole("button", { name: /check in/i }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/session-packs/checkin",
      expect.objectContaining({ method: "POST" }),
    )
  })
  it("surfaces a 409 as an error toast", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "No active credits" }), { status: 409 }),
    )
    render(<ClientCheckinButton clientUserId="c1" hasActiveCredits />)
    await userEvent.click(screen.getByRole("button", { name: /check in/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ClientCheckinButton({
  clientUserId,
  hasActiveCredits,
}: {
  clientUserId: string
  hasActiveCredits: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  if (!hasActiveCredits) return null

  async function checkIn() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/session-packs/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not check in")
        return
      }
      if (data.reason === "duplicate") toast.info("Already checked in recently")
      else toast.success(`Checked in — ${data.remaining} left`)
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={checkIn} disabled={busy} size="sm">
      <Check className="size-4" />
      Check in
    </Button>
  )
}
```

- [ ] **Step 4: Run → PASS.** Commit.

---

### Task 3: `ClientPackagesPanel` → seeded + refresh-driven, no own check-in button

**Files:**
- Modify: `components/admin/packs/ClientPackagesPanel.tsx`

- [ ] **Step 1:** Change the signature to accept seeded data and import the shared type + router:

```tsx
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ticket, Plus, Undo2 } from "lucide-react"   // drop Check
import { Button } from "@/components/ui/button"
import { SellPackDialog } from "./SellPackDialog"
import type { PackWithCheckins } from "@/lib/services/client-packs-view"

export function ClientPackagesPanel({
  clientUserId,
  initialPacks,
}: {
  clientUserId: string
  initialPacks: PackWithCheckins[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const packages = initialPacks
  // ...
}
```

- [ ] **Step 2:** Delete the local `PackWithCheckins` type, `packages`/`loading` state, the `load` callback, the `useEffect`, and the whole `checkIn` function. Replace `await load()` in `voidCheckin` with `router.refresh()`; replace `onSold={load}` with `onSold={() => router.refresh()}`.

- [ ] **Step 3:** Remove the "Check in" button block from the header (the `activePacks.length > 0 && <Button …>Check in</Button>`), and delete the now-unused `activePacks` const. Remove the `loading ? …` branch (no async load anymore) — render the empty state when `packages.length === 0`, else the list.

- [ ] **Step 4:** Run `npx vitest run` for any panel test (none exists today) and `npx tsc --noEmit` scoped check later in Task 7. Commit.

---

### Task 4: Wire the client detail page

**Files:**
- Modify: `app/(admin)/admin/clients/[id]/page.tsx`

- [ ] **Step 1:** Imports — add:

```ts
import { loadClientPacksView, summarizeClientPacks } from "@/lib/services/client-packs-view"
import { ClientCheckinButton } from "@/components/admin/packs/ClientCheckinButton"
import { Ticket } from "lucide-react"
```

- [ ] **Step 2:** In the data-loading section, load packs and summarize (use the existing `id`):

```ts
const packs = await loadClientPacksView(id)
const packSummary = summarizeClientPacks(packs, new Date())
```

- [ ] **Step 3:** In the **Quick Actions** row, add the button before the assessment link:

```tsx
<ClientCheckinButton clientUserId={id} hasActiveCredits={packSummary.hasActiveCredits} />
```
(Wrap the row in a `flex flex-wrap items-center gap-3` container so the button and link sit side by side.)

- [ ] **Step 4:** Pass the map into `ProgramsSection` and seed the panel:

```tsx
<ProgramsSection
  assignments={assignments as AssignmentWithProgram[]}
  clientName={`${user.first_name} ${user.last_name}`}
  packByAssignment={packSummary.byAssignment}
/>
// ...
<ClientPackagesPanel clientUserId={id} initialPacks={packs} />
```

- [ ] **Step 5:** Extend `ProgramsSection` signature + render the badge under the program name cell:

```tsx
function ProgramsSection({ assignments, clientName, packByAssignment }: {
  assignments: AssignmentWithProgram[]
  clientName: string
  packByAssignment: Map<string, { remaining: number; total: number }>
}) {
  // inside the Program name <td>, after the name:
  // {packByAssignment.get(assignment.id) && (
  //   <span className="mt-0.5 flex items-center gap-1 text-xs text-accent">
  //     <Ticket className="size-3" strokeWidth={1.5} />
  //     {packByAssignment.get(assignment.id)!.remaining} / {packByAssignment.get(assignment.id)!.total} sessions · advances on check-in
  //   </span>
  // )}
}
```
(Render the name cell as a flex column so the badge sits beneath the name.)

- [ ] **Step 6:** `npx tsc --noEmit` on these files clean (full check in Task 7). Commit.

---

### Task 5: Self check-in QR on the Clients list

**Files:**
- Create: `components/admin/packs/SelfCheckinQrDialog.tsx`
- Modify: `app/(admin)/admin/clients/ClientsPageHeader.tsx`
- Modify: `app/(admin)/admin/clients/page.tsx`

- [ ] **Step 1:** Create `SelfCheckinQrDialog.tsx` (client) — button opens a dialog with the QR + copy link (markup lifted from the old `TodayCheckinList` QR card):

```tsx
"use client"
import Image from "next/image"
import { useState } from "react"
import { toast } from "sonner"
import { QrCode, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

export function SelfCheckinQrDialog({ qrDataUrl, checkinUrl }: { qrDataUrl: string; checkinUrl: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4 mr-1.5" />
          Self check-in QR
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Self check-in QR</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Clients scan this, tap their name, and the credit comes off automatically.
        </p>
        <div className="flex flex-col items-center gap-3">
          <Image src={qrDataUrl} alt="Check-in QR code" width={240} height={240} unoptimized className="rounded-lg border border-border" />
          <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(checkinUrl); toast.success("Link copied") }}>
            <Copy className="size-4" />
            Copy check-in link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2:** `ClientsPageHeader` — accept props + render the QR button next to "Add Client":

```tsx
export function ClientsPageHeader({ qrDataUrl, checkinUrl }: { qrDataUrl: string | null; checkinUrl: string | null }) {
  // ...
  <div className="flex items-center gap-2">
    {qrDataUrl && checkinUrl && <SelfCheckinQrDialog qrDataUrl={qrDataUrl} checkinUrl={checkinUrl} />}
    <Button onClick={() => setDialogOpen(true)} size="sm"><Plus className="size-4 mr-1.5" />Add Client</Button>
  </div>
}
```

- [ ] **Step 3:** `clients/page.tsx` (server) — generate the QR and pass it down:

```ts
import QRCode from "qrcode"
import { auth } from "@/lib/auth"
import { signCheckinToken } from "@/lib/qr/checkin-token"

function baseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://www.darrenjpaul.com"
}
// inside the component, after session:
const session = await auth()
let qrDataUrl: string | null = null
let checkinUrl: string | null = null
if (session?.user?.id) {
  checkinUrl = `${baseUrl()}/checkin?token=${encodeURIComponent(signCheckinToken(session.user.id, new Date()))}`
  qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 320, margin: 1 })
}
// <ClientsPageHeader qrDataUrl={qrDataUrl} checkinUrl={checkinUrl} />
```

- [ ] **Step 4:** `npx tsc --noEmit` clean (Task 7). Commit.

---

### Task 6: Remove the standalone surfaces

**Files:**
- Modify: `components/admin/admin-nav.ts` (remove the Check-ins item; drop unused `CalendarCheck` import only if no longer used — note Bookings also uses it, so keep the import).
- Delete: `app/(admin)/admin/today/page.tsx`
- Delete: `components/admin/packs/TodayCheckinList.tsx`
- Modify: `app/api/admin/internal/pack-renewals/route.ts` (`link: "/admin/today"` → `link: "/admin/clients"`)

- [ ] **Step 1:** Remove the nav item line. Confirm `CalendarCheck` is still referenced by Bookings (`Business` section) — it is, so leave the import.
- [ ] **Step 2:** Delete the two files.
- [ ] **Step 3:** Repoint the renewal link.
- [ ] **Step 4:** `git grep -n "/admin/today"` and `git grep -n "TodayCheckinList"` → no source references remain (docs/plan references are fine). Commit.

---

### Task 7: Full verification

- [ ] `npx tsc --noEmit` — confirm no **new** production-source errors vs. the known baseline (test/.next noise only).
- [ ] `npm run test:run` — full suite green.
- [ ] Commit any test fixups.

## Self-Review (done)

- **Spec coverage:** remove tab (T6), one-source-of-truth loader/summary (T1), header button (T2/T4), program badge (T4), panel refactor (T3), QR on Clients list (T5). ✓
- **Placeholder scan:** all code blocks concrete. ✓
- **Type consistency:** `PackWithCheckins`, `ClientPacksSummary`, `summarizeClientPacks`, `loadClientPacksView`, `ClientCheckinButton` props, `packByAssignment` map shape consistent across tasks. ✓
