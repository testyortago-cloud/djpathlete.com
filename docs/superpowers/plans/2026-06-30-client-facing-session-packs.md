# Client-Facing Session Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the athlete (role `client`) a read-only session-credit balance, a guarded self check-in, and self-purchase of packs — closing the three coach-only gaps.

**Architecture:** Three flag-gated phases reusing the existing pack services/DALs. Phase 1 adds a client-scoped loader + read-only UI. Phase 2 makes the existing `/checkin` page identity-aware via a new auth-gated endpoint. Phase 3 adds a client storefront + checkout endpoint (mirrors the admin Stripe path) and a small admin catalogue manager.

**Tech Stack:** Next.js 16 App Router (server components), NextAuth v5 (`auth()`), Supabase service-role DALs, Zod, Vitest + Testing Library, Stripe.

## Global Constraints

- **Identity from `auth()`, never the request body.** Every new client endpoint derives `userId` from the session; ignore any client-supplied id.
- **Feature flags DB-backed in `system_settings`, default OFF** (`getSetting<boolean>(key, false)`). Keys: `client_pack_balance_enabled`, `client_self_checkin_enabled`, `client_self_purchase_enabled`.
- **Reuse pure credit math** (`remainingCredits`, `isExpired`, `summarizeClientPacks`, `buildPackageInsert`) — no new balance math.
- **No new DB tables/migrations.** Uses existing `client_packages`, `session_checkins`, `session_pack_products`, `system_settings`.
- **Path alias** `@/*` → project root. **No hardcoded hex** — semantic Tailwind classes. **Test style:** mocked DALs via `vi.mock`, mirror `__tests__/api/session-packs/`.
- **Commit after each task.** Do NOT push (solo-dev works on `main` locally; push deploys to prod).

---

## Phase 1 — "My Sessions" balance widget (read-only)

### Task 1: Client feature-flag readers

**Files:**
- Modify: `lib/packs/flags.ts`
- Test: `__tests__/lib/packs/client-flags.test.ts`

**Interfaces:**
- Consumes: `getSetting<T>(key, fallback)` from `lib/db/system-settings.ts`.
- Produces: `clientPackBalanceEnabled()`, `clientSelfCheckinEnabled()`, `clientSelfPurchaseEnabled()` → `Promise<boolean>`; key constants `CLIENT_PACK_BALANCE_KEY`, `CLIENT_SELF_CHECKIN_KEY`, `CLIENT_SELF_PURCHASE_KEY`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/packs/client-flags.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const getSettingMock = vi.fn()
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
import { clientPackBalanceEnabled, clientSelfCheckinEnabled, clientSelfPurchaseEnabled, CLIENT_PACK_BALANCE_KEY } from "@/lib/packs/flags"

beforeEach(() => vi.clearAllMocks())

describe("client pack flags", () => {
  it("defaults each flag to false", async () => {
    getSettingMock.mockImplementation(async (_k: string, fallback: boolean) => fallback)
    expect(await clientPackBalanceEnabled()).toBe(false)
    expect(await clientSelfCheckinEnabled()).toBe(false)
    expect(await clientSelfPurchaseEnabled()).toBe(false)
  })
  it("reads the balance flag under the right key with false default", async () => {
    getSettingMock.mockResolvedValue(true)
    expect(await clientPackBalanceEnabled()).toBe(true)
    expect(getSettingMock).toHaveBeenCalledWith(CLIENT_PACK_BALANCE_KEY, false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npm run test:run -- client-flags` → FAIL (exports not defined).

- [ ] **Step 3: Append to `lib/packs/flags.ts`**

```ts
// ── Client-facing pack feature flags (DB-backed, admin-togglable, default OFF) ──
export const CLIENT_PACK_BALANCE_KEY = "client_pack_balance_enabled"
export const CLIENT_SELF_CHECKIN_KEY = "client_self_checkin_enabled"
export const CLIENT_SELF_PURCHASE_KEY = "client_self_purchase_enabled"

export const clientPackBalanceEnabled = () => getSetting<boolean>(CLIENT_PACK_BALANCE_KEY, false)
export const clientSelfCheckinEnabled = () => getSetting<boolean>(CLIENT_SELF_CHECKIN_KEY, false)
export const clientSelfPurchaseEnabled = () => getSetting<boolean>(CLIENT_SELF_PURCHASE_KEY, false)
```

- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** — `git add lib/packs/flags.ts __tests__/lib/packs/client-flags.test.ts && git commit -m "feat(client-packs): client pack feature flags (default off)"`

---

### Task 2: Client-scoped pack loader + nearest-expiry helper

**Files:**
- Modify: `lib/services/client-packs-view.ts`
- Test: `__tests__/lib/services/my-packs-view.test.ts`

**Interfaces:**
- Consumes: `auth()` from `@/lib/auth`; existing `loadClientPacksView`, `summarizeClientPacks` (same module).
- Produces:
  - `nearestActiveExpiry(packs, now): string | null` — earliest `expires_at` among active, non-expired, remaining>0 packs (ISO) or null.
  - `loadMyPacksView(now?: Date): Promise<MyPacksView | null>` where `MyPacksView = { packs: PackWithCheckins[]; summary: ClientPacksSummary; nearestExpiry: string | null }`. Returns null when no client session.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/services/my-packs-view.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const authMock = vi.fn()
const listPackagesMock = vi.fn()
const listCheckinsMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/client-packages", () => ({ listPackagesForClient: (...a: unknown[]) => listPackagesMock(...a) }))
vi.mock("@/lib/db/session-checkins", () => ({ listCheckinsForPackage: (...a: unknown[]) => listCheckinsMock(...a) }))
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
import { loadMyPacksView, nearestActiveExpiry } from "@/lib/services/client-packs-view"

const NOW = new Date("2026-06-30T00:00:00Z")
const pack = (over: Record<string, unknown> = {}) => ({
  id: "p1", client_user_id: "c1", assignment_id: null, status: "active",
  credits_total: 10, credits_used: 4, expires_at: "2026-07-14T00:00:00Z", ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listCheckinsMock.mockResolvedValue([])
})

describe("nearestActiveExpiry", () => {
  it("returns the earliest active expiry and ignores expired/depleted", () => {
    const r = nearestActiveExpiry(
      [pack({ expires_at: "2026-08-01T00:00:00Z" }), pack({ expires_at: "2026-07-10T00:00:00Z" }), pack({ status: "depleted", expires_at: "2026-07-01T00:00:00Z" })],
      NOW,
    )
    expect(r).toBe("2026-07-10T00:00:00Z")
  })
  it("returns null when nothing active", () => {
    expect(nearestActiveExpiry([pack({ status: "expired" })], NOW)).toBeNull()
  })
})

describe("loadMyPacksView", () => {
  it("returns null when there is no client session", async () => {
    authMock.mockResolvedValue(null)
    expect(await loadMyPacksView(NOW)).toBeNull()
  })
  it("loads the session user's packs + summary", async () => {
    authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
    listPackagesMock.mockResolvedValue([pack()])
    const view = await loadMyPacksView(NOW)
    expect(listPackagesMock).toHaveBeenCalledWith("c1")
    expect(view?.summary.activeRemaining).toBe(6)
    expect(view?.nearestExpiry).toBe("2026-07-14T00:00:00Z")
  })
  it("ignores a non-client session", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
    expect(await loadMyPacksView(NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run** — FAIL (exports missing).

- [ ] **Step 3: Append to `lib/services/client-packs-view.ts`** (add `import { auth } from "@/lib/auth"` at top):

```ts
export function nearestActiveExpiry(packs: PackSlice[], now: Date): string | null {
  let earliest: string | null = null
  for (const p of packs) {
    if (p.status !== "active" || isExpired(p, now) || remainingCredits(p) <= 0) continue
    if (!p.expires_at) continue
    if (!earliest || new Date(p.expires_at) < new Date(earliest)) earliest = p.expires_at
  }
  return earliest
}

export interface MyPacksView {
  packs: PackWithCheckins[]
  summary: ClientPacksSummary
  nearestExpiry: string | null
}

/** The logged-in client's own pack view (null for non-client sessions). Id comes
 *  from the verified session, never from input. */
export async function loadMyPacksView(now: Date = new Date()): Promise<MyPacksView | null> {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "client") return null
  const packs = await loadClientPacksView(session.user.id)
  return { packs, summary: summarizeClientPacks(packs, now), nearestExpiry: nearestActiveExpiry(packs, now) }
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git add lib/services/client-packs-view.ts __tests__/lib/services/my-packs-view.test.ts && git commit -m "feat(client-packs): loadMyPacksView + nearestActiveExpiry"`

---

### Task 3: MySessionsCard + dashboard integration

**Files:**
- Create: `components/client/MySessionsCard.tsx`
- Modify: `app/(client)/client/dashboard/page.tsx` (add the card, flag-gated)
- Test: `__tests__/components/client/MySessionsCard.test.tsx`

**Interfaces:**
- Produces: `MySessionsCard({ activeRemaining, nearestExpiry }: { activeRemaining: number; nearestExpiry: string | null })` — renders `null` when `activeRemaining <= 0`; otherwise a `Link` to `/client/sessions`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/client/MySessionsCard.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MySessionsCard } from "@/components/client/MySessionsCard"

describe("MySessionsCard", () => {
  it("renders the remaining count and links to the sessions page", () => {
    const { container } = render(<MySessionsCard activeRemaining={6} nearestExpiry="2026-07-14T00:00:00Z" />)
    expect(screen.getByText(/6/)).toBeInTheDocument()
    expect(container.querySelector('a[href="/client/sessions"]')).toBeTruthy()
  })
  it("renders nothing when there are no active credits", () => {
    const { container } = render(<MySessionsCard activeRemaining={0} nearestExpiry={null} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Create `components/client/MySessionsCard.tsx`**

```tsx
import Link from "next/link"
import { Ticket } from "lucide-react"

export function MySessionsCard({
  activeRemaining,
  nearestExpiry,
}: {
  activeRemaining: number
  nearestExpiry: string | null
}) {
  if (activeRemaining <= 0) return null
  const expiry = nearestExpiry
    ? new Date(nearestExpiry).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null
  return (
    <Link
      href="/client/sessions"
      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm transition-colors hover:bg-surface"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Ticket className="size-5" strokeWidth={1.5} />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">In-person sessions</p>
          <p className="text-xs text-muted-foreground">
            {expiry ? `Soonest expiry ${expiry}` : "No expiry"}
          </p>
        </div>
      </div>
      <span className="text-2xl font-semibold text-primary">{activeRemaining}</span>
    </Link>
  )
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Integrate into the dashboard** — in `app/(client)/client/dashboard/page.tsx` add near the top imports:

```tsx
import { clientPackBalanceEnabled } from "@/lib/packs/flags"
import { loadMyPacksView } from "@/lib/services/client-packs-view"
import { MySessionsCard } from "@/components/client/MySessionsCard"
```

In the server component body, before the return, resolve the view when the flag is on, then render the card high in the page (e.g. just under the greeting/stats):

```tsx
const packsView = (await clientPackBalanceEnabled()) ? await loadMyPacksView() : null
```

```tsx
{packsView && (
  <MySessionsCard
    activeRemaining={packsView.summary.activeRemaining}
    nearestExpiry={packsView.nearestExpiry}
  />
)}
```

- [ ] **Step 6: Run full file's typecheck via test run** — `npm run test:run -- MySessionsCard` → PASS.
- [ ] **Step 7: Commit** — `git add components/client/MySessionsCard.tsx app/\(client\)/client/dashboard/page.tsx __tests__/components/client/MySessionsCard.test.tsx && git commit -m "feat(client-packs): My Sessions dashboard card (flag-gated)"`

---

### Task 4: Sessions page + list + nav entry

**Files:**
- Create: `components/client/MySessionsList.tsx`
- Create: `app/(client)/client/sessions/page.tsx`
- Modify: `components/client/ClientLayout.tsx` (conditional nav item)
- Modify: `app/(client)/layout.tsx` (read flags, pass to ClientLayout)
- Test: `__tests__/components/client/MySessionsList.test.tsx`

**Interfaces:**
- Consumes: `MyPacksView` (Task 2), `clientPackBalanceEnabled` (Task 1).
- Produces: `MySessionsList({ packs }: { packs: PackWithCheckins[] })`; `ClientLayout` gains prop `flags?: { sessions?: boolean }`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/client/MySessionsList.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MySessionsList } from "@/components/client/MySessionsList"

const base = {
  id: "p1", client_user_id: "c1", product_id: null, assignment_id: null,
  session_type: "1-on-1", credits_total: 10, credits_used: 4, price_cents: 0,
  payment_method: "comp", payment_status: "not_required", stripe_session_id: null,
  stripe_payment_id: null, purchased_at: "2026-06-01T00:00:00Z", expires_at: null,
  status: "active", last_reminded_threshold: null, notes: null, created_by: null,
  created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
  checkins: [], program_name: null,
}

describe("MySessionsList", () => {
  it("shows remaining/total for an active pack", () => {
    render(<MySessionsList packs={[base as never]} />)
    expect(screen.getByText(/6/)).toBeInTheDocument()
    expect(screen.getByText(/1-on-1/i)).toBeInTheDocument()
  })
  it("renders an empty state when there are no packs", () => {
    render(<MySessionsList packs={[]} />)
    expect(screen.getByText(/no .*sessions/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Create `components/client/MySessionsList.tsx`**

```tsx
import type { PackWithCheckins } from "@/lib/services/client-packs-view"
import { remainingCredits } from "@/lib/services/session-credits"

const STATUS_LABEL: Record<string, string> = {
  active: "Active", depleted: "Used up", expired: "Expired", refunded: "Refunded", cancelled: "Cancelled",
}

export function MySessionsList({ packs }: { packs: PackWithCheckins[] }) {
  if (packs.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          You have no session packs yet. Contact your coach to get started.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {packs.map((p) => {
        const remaining = remainingCredits(p)
        return (
          <div key={p.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">{p.session_type}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[p.status] ?? p.status}
                  {p.expires_at ? ` · expires ${new Date(p.expires_at).toLocaleDateString()}` : ""}
                  {p.program_name ? ` · ${p.program_name}` : ""}
                </p>
              </div>
              <span className="text-lg font-semibold text-primary">
                {remaining}
                <span className="text-sm font-normal text-muted-foreground"> / {p.credits_total}</span>
              </span>
            </div>
            {p.checkins.filter((c) => !c.voided).length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                {p.checkins
                  .filter((c) => !c.voided)
                  .slice(0, 5)
                  .map((c) => (
                    <li key={c.id} className="flex justify-between">
                      <span>{new Date(c.checked_in_at).toLocaleDateString()}</span>
                      <span>{c.method === "qr_self" ? "Self check-in" : c.method === "coach_tap" ? "Coach" : "Manual"}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Create `app/(client)/client/sessions/page.tsx`** (server, flag-gated, redirect when off)

```tsx
import { redirect } from "next/navigation"
import { clientPackBalanceEnabled, clientSelfPurchaseEnabled } from "@/lib/packs/flags"
import { loadMyPacksView } from "@/lib/services/client-packs-view"
import { MySessionsList } from "@/components/client/MySessionsList"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export const metadata = { title: "My Sessions" }

export default async function MySessionsPage() {
  if (!(await clientPackBalanceEnabled())) redirect("/client/dashboard")
  const view = await loadMyPacksView()
  const canBuy = await clientSelfPurchaseEnabled()
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">My Sessions</h1>
        {canBuy && (
          <Button asChild>
            <Link href="/client/sessions/buy">Buy sessions</Link>
          </Button>
        )}
      </div>
      <MySessionsList packs={view?.packs ?? []} />
    </div>
  )
}
```

- [ ] **Step 6: Conditional nav** — in `components/client/ClientLayout.tsx`, change the signature to accept flags and compute nav items:

```tsx
import { Ticket } from "lucide-react"
// ...
const baseNavItems = [
  { label: "Dashboard", href: "/client/dashboard", icon: LayoutDashboard },
  { label: "Programs", href: "/client/programs", icon: ShoppingBag },
  { label: "Workouts", href: "/client/workouts", icon: Dumbbell },
  { label: "Progress", href: "/client/progress", icon: TrendingUp },
  { label: "Achievements", href: "/client/achievements", icon: Trophy },
  { label: "Form Reviews", href: "/client/form-reviews", icon: Video },
  { label: "Assessments", href: "/client/performance-assessments", icon: ClipboardCheck },
  { label: "Questionnaire", href: "/client/questionnaire", icon: ClipboardList },
  { label: "Profile", href: "/client/profile", icon: User },
  { label: "Settings", href: "/client/settings", icon: Settings },
]

export function ClientLayout({ children, flags }: { children: React.ReactNode; flags?: { sessions?: boolean } }) {
  // ... inside component body, before usage:
  const navItems = flags?.sessions
    ? [baseNavItems[0], { label: "My Sessions", href: "/client/sessions", icon: Ticket }, ...baseNavItems.slice(1)]
    : baseNavItems
  // keep bottomTabs referencing Dashboard/Form Reviews/Workouts/Progress by href lookup:
  const bottomTabs = [
    navItems.find((n) => n.href === "/client/dashboard")!,
    navItems.find((n) => n.href === "/client/form-reviews")!,
    navItems.find((n) => n.href === "/client/workouts")!,
    navItems.find((n) => n.href === "/client/progress")!,
  ]
  const bottomTabHrefs = new Set(bottomTabs.map((t) => t.href))
  const moreItems = navItems.filter((item) => !bottomTabHrefs.has(item.href))
  // ... rest unchanged
}
```

(Delete the old module-level `navItems`/`bottomTabs`/`moreItems` constants; they are now computed in-body.)

- [ ] **Step 7: Pass flags from the server layout** — in `app/(client)/layout.tsx`:

```tsx
import { clientPackBalanceEnabled } from "@/lib/packs/flags"
// ...
const showSessions = await clientPackBalanceEnabled()
// ...
<ClientLayout flags={{ sessions: showSessions }}>{children}</ClientLayout>
```

- [ ] **Step 8: Run** — `npm run test:run -- MySessionsList` → PASS.
- [ ] **Step 9: Commit** — `git add components/client/MySessionsList.tsx app/\(client\)/client/sessions/page.tsx components/client/ClientLayout.tsx app/\(client\)/layout.tsx __tests__/components/client/MySessionsList.test.tsx && git commit -m "feat(client-packs): My Sessions page + nav entry (flag-gated)"`

---

## Phase 2 — Guarded client self check-in

### Task 5: Self check-in endpoint

**Files:**
- Modify: `lib/validators/session-packs.ts` (add `selfCheckinSchema`)
- Create: `app/api/checkin/self/route.ts`
- Test: `__tests__/api/checkin/self-checkin-auth.test.ts`

**Interfaces:**
- Consumes: `auth()`, `verifyCheckinToken`, `checkInClient`, `clientSelfCheckinEnabled`.
- Produces: `POST /api/checkin/self` — body `{ token }`; derives client id from session; returns `{ ok, remaining, reason? }`. 403 flag-off / non-client; 401 no session / bad token; 409 no credits.

- [ ] **Step 1: Add the validator** to `lib/validators/session-packs.ts`:

```ts
export const selfCheckinSchema = z.object({ token: z.string().min(1) })
```

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/api/checkin/self-checkin-auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const authMock = vi.fn()
const verifyMock = vi.fn()
const checkInMock = vi.fn()
const flagMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/qr/checkin-token", () => ({ verifyCheckinToken: (...a: unknown[]) => verifyMock(...a) }))
vi.mock("@/lib/services/session-credits", () => ({ checkInClient: (...a: unknown[]) => checkInMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({ clientSelfCheckinEnabled: () => flagMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
import { POST } from "@/app/api/checkin/self/route"

const req = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/checkin/self", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
  verifyMock.mockReturnValue({ valid: true, coachId: "coach-1" })
})

describe("POST /api/checkin/self", () => {
  it("403 when the feature flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await POST(req({ token: "t" }))).status).toBe(403)
  })
  it("401 when there is no client session", async () => {
    authMock.mockResolvedValue(null)
    expect((await POST(req({ token: "t" }))).status).toBe(401)
  })
  it("403 for a non-client session", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
    expect((await POST(req({ token: "t" }))).status).toBe(403)
  })
  it("401 on an invalid token", async () => {
    verifyMock.mockReturnValue({ valid: false })
    expect((await POST(req({ token: "bad" }))).status).toBe(401)
    expect(checkInMock).not.toHaveBeenCalled()
  })
  it("checks in as the SESSION user, ignoring any body id", async () => {
    checkInMock.mockResolvedValue({ ok: true, remaining: 5, packageId: "p1" })
    const res = await POST(req({ token: "t", clientUserId: "EVIL" }))
    expect(res.status).toBe(200)
    expect((await res.json()).remaining).toBe(5)
    expect(checkInMock).toHaveBeenCalledWith(expect.objectContaining({ clientUserId: "c1", method: "qr_self", createdBy: "c1" }))
  })
  it("409 when no credits", async () => {
    checkInMock.mockResolvedValue({ ok: false, reason: "no_credits" })
    expect((await POST(req({ token: "t" }))).status).toBe(409)
  })
})
```

- [ ] **Step 3: Run** — FAIL (route missing).

- [ ] **Step 4: Create `app/api/checkin/self/route.ts`**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { selfCheckinSchema } from "@/lib/validators/session-packs"
import { verifyCheckinToken } from "@/lib/qr/checkin-token"
import { checkInClient } from "@/lib/services/session-credits"
import { clientSelfCheckinEnabled } from "@/lib/packs/flags"
import { recordAudit } from "@/lib/audit/record"

/** Client-portal self check-in: token proves presence, session proves identity. */
export async function POST(request: Request) {
  try {
    if (!(await clientSelfCheckinEnabled())) {
      return NextResponse.json({ error: "Self check-in is not enabled" }, { status: 403 })
    }
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = selfCheckinSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const v = verifyCheckinToken(parsed.data.token, new Date())
    if (!v.valid) return NextResponse.json({ error: "Check-in code expired" }, { status: 401 })

    const result = await checkInClient({
      clientUserId: session.user.id,
      method: "qr_self",
      createdBy: session.user.id,
      now: new Date(),
    })
    if (!result.ok && result.reason === "no_credits") {
      return NextResponse.json({ error: "No active credits on your pack." }, { status: 409 })
    }
    if (result.reason !== "duplicate") {
      void recordAudit({
        action: "pack.checkin",
        category: "client_action",
        outcome: "success",
        target: { type: "client_package", id: result.packageId ?? null },
        metadata: { method: "qr_self", self_initiated: true, coach_id: v.coachId },
        request,
      })
    }
    return NextResponse.json({ ok: true, remaining: result.remaining, reason: result.reason })
  } catch (error) {
    console.error("Self check-in error:", error)
    return NextResponse.json({ error: "Failed to check in" }, { status: 500 })
  }
}
```

> Note: confirm `pack.checkin` exists in `lib/audit/actions.ts` (it does — used by the admin checkin route). If the `category`/`target` shape differs, mirror the admin `app/api/checkin/route.ts` audit call exactly.

- [ ] **Step 5: Run** — `npm run test:run -- self-checkin-auth` → PASS.
- [ ] **Step 6: Commit** — `git add lib/validators/session-packs.ts app/api/checkin/self/route.ts __tests__/api/checkin/self-checkin-auth.test.ts && git commit -m "feat(client-packs): guarded self check-in endpoint (auth identity + token presence)"`

---

### Task 6: Identity-aware /checkin page

**Files:**
- Modify: `components/checkin/CheckinClient.tsx` (add optional `me` self-mode)
- Modify: `app/checkin/page.tsx` (resolve session + flag, pass `me`)
- Test: `__tests__/components/checkin/CheckinClient.self.test.tsx`

**Interfaces:**
- Consumes: `POST /api/checkin/self` (Task 5), `loadMyPacksView` (Task 2), `clientSelfCheckinEnabled` (Task 1).
- Produces: `CheckinClient({ token, me }: { token: string; me?: { firstName: string; remaining: number } | null })`. When `me` is set → single self-check-in button; else the existing roster.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/checkin/CheckinClient.self.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CheckinClient } from "@/components/checkin/CheckinClient"

beforeEach(() => {
  vi.restoreAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, remaining: 4 }) }) as never
})

describe("CheckinClient self mode", () => {
  it("shows a single self check-in button when `me` is provided and posts to /api/checkin/self", async () => {
    render(<CheckinClient token="t" me={{ firstName: "Aean", remaining: 5 }} />)
    const btn = screen.getByRole("button", { name: /check in/i })
    expect(screen.queryByPlaceholderText(/search your name/i)).toBeNull()
    fireEvent.click(btn)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/checkin/self", expect.objectContaining({ method: "POST" })))
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Modify `components/checkin/CheckinClient.tsx`** — change the signature and add a self-mode branch. Add a `me` prop and, when present, short-circuit the roster:

```tsx
export function CheckinClient({ token, me }: { token: string; me?: { firstName: string; remaining: number } | null }) {
  // existing state ...
  const [selfSubmitting, setSelfSubmitting] = useState(false)

  // Skip the roster fetch entirely in self mode.
  useEffect(() => {
    if (me) { setStatus("ready"); return }
    if (!token) { setStatus("invalid"); return }
    // ... existing roster fetch unchanged ...
  }, [token, me])

  async function checkSelf() {
    setSelfSubmitting(true)
    setErrorMsg("")
    try {
      const res = await fetch("/api/checkin/self", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (res.status === 401) { setStatus("invalid"); return }
      if (res.status === 409) { setErrorMsg(data.error ?? "No credits left on your pack."); return }
      if (!res.ok) { setErrorMsg(data.error ?? "Something went wrong."); return }
      setResult({ name: me!.firstName, remaining: data.remaining ?? Math.max(0, me!.remaining - 1) })
      setStatus("done")
    } catch {
      setErrorMsg("Something went wrong.")
    } finally {
      setSelfSubmitting(false)
    }
  }

  // ... keep loading/invalid/error/done branches unchanged ...

  // SELF MODE render (place before the roster return):
  if (me) {
    return (
      <div className={card}>
        <h1 className="text-xl font-semibold text-primary mb-1">Check in</h1>
        <p className="text-sm text-muted-foreground mb-5">{me.remaining} session{me.remaining === 1 ? "" : "s"} left on your pack.</p>
        {errorMsg && <p className="text-sm text-destructive mb-3">{errorMsg}</p>}
        <Button className="w-full h-12" onClick={checkSelf} disabled={selfSubmitting}>
          Check in as {me.firstName}
        </Button>
      </div>
    )
  }

  // ... existing roster return unchanged ...
}
```

- [ ] **Step 4: Wire the page** — `app/checkin/page.tsx`:

```tsx
import { CheckinClient } from "@/components/checkin/CheckinClient"
import { auth } from "@/lib/auth"
import { clientSelfCheckinEnabled } from "@/lib/packs/flags"
import { loadMyPacksView } from "@/lib/services/client-packs-view"

export const metadata = { title: "Check in", robots: { index: false, follow: false } }

export default async function CheckinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  let me: { firstName: string; remaining: number } | null = null
  if (await clientSelfCheckinEnabled()) {
    const session = await auth()
    if (session?.user?.role === "client") {
      const view = await loadMyPacksView()
      if (view) me = { firstName: (session.user.name ?? "You").split(" ")[0], remaining: view.summary.activeRemaining }
    }
  }
  return (
    <main className="min-h-screen flex items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <CheckinClient token={token ?? ""} me={me} />
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Run** — `npm run test:run -- CheckinClient` (runs both roster + self tests) → PASS.
- [ ] **Step 6: Commit** — `git add components/checkin/CheckinClient.tsx app/checkin/page.tsx __tests__/components/checkin/CheckinClient.self.test.tsx && git commit -m "feat(client-packs): identity-aware /checkin self mode (flag-gated)"`

---

## Phase 3 — Client self-purchase + admin catalogue manager

### Task 7: Admin product update endpoint

**Files:**
- Modify: `lib/validators/session-packs.ts` (add `packProductUpdateSchema`)
- Create: `app/api/admin/session-packs/products/[id]/route.ts`
- Test: `__tests__/api/session-packs/products-update.test.ts`

**Interfaces:**
- Consumes: `auth()`, `updateProduct`.
- Produces: `PATCH /api/admin/session-packs/products/[id]` — admin-only; body partial product; returns `{ product }`.

- [ ] **Step 1: Add validator** to `lib/validators/session-packs.ts`:

```ts
export const packProductUpdateSchema = packProductSchema.partial()
```

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/api/session-packs/products-update.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const authMock = vi.fn()
const updateMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/session-pack-products", () => ({ updateProduct: (...a: unknown[]) => updateMock(...a) }))
import { PATCH } from "@/app/api/admin/session-packs/products/[id]/route"

const ctx = { params: Promise.resolve({ id: "prod-1" }) }
const req = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/admin/session-packs/products/prod-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
  updateMock.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ id: "prod-1", ...patch }))
})

describe("PATCH /api/admin/session-packs/products/[id]", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await PATCH(req({ isActive: false }), ctx)).status).toBe(403)
  })
  it("updates is_active", async () => {
    const res = await PATCH(req({ isActive: false }), ctx)
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith("prod-1", expect.objectContaining({ is_active: false }))
  })
})
```

- [ ] **Step 3: Run** — FAIL.

- [ ] **Step 4: Create `app/api/admin/session-packs/products/[id]/route.ts`**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { packProductUpdateSchema } from "@/lib/validators/session-packs"
import { updateProduct } from "@/lib/db/session-pack-products"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params
    const parsed = packProductUpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid product", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const p = parsed.data
    const patch: Record<string, unknown> = {}
    if (p.name !== undefined) patch.name = p.name
    if (p.sessionType !== undefined) patch.session_type = p.sessionType
    if (p.credits !== undefined) patch.credits = p.credits
    if (p.priceCents !== undefined) patch.price_cents = p.priceCents
    if (p.validityDays !== undefined) patch.validity_days = p.validityDays
    if (p.stripePriceId !== undefined) patch.stripe_price_id = p.stripePriceId
    if (p.isActive !== undefined) patch.is_active = p.isActive
    if (p.sortOrder !== undefined) patch.sort_order = p.sortOrder
    return NextResponse.json({ product: await updateProduct(id, patch) })
  } catch (error) {
    console.error("Update pack product error:", error)
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `git add lib/validators/session-packs.ts app/api/admin/session-packs/products/\[id\]/route.ts __tests__/api/session-packs/products-update.test.ts && git commit -m "feat(client-packs): admin product update/deactivate endpoint"`

---

### Task 8: Admin catalogue manager page

**Files:**
- Create: `components/admin/packs/ProductCatalogueManager.tsx` (client component)
- Create: `app/(admin)/admin/session-packs/products/page.tsx` (server page)
- Test: `__tests__/components/admin/packs/ProductCatalogueManager.test.tsx`

**Interfaces:**
- Consumes: GET/POST `/api/admin/session-packs/products`, PATCH `/api/admin/session-packs/products/[id]` (Task 7).
- Produces: `ProductCatalogueManager({ initialProducts }: { initialProducts: SessionPackProduct[] })` — lists products, a create form (name/sessionType/credits/price/validity), and an activate/deactivate toggle.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/admin/packs/ProductCatalogueManager.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProductCatalogueManager } from "@/components/admin/packs/ProductCatalogueManager"

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ products: [] }) }) as never
})

describe("ProductCatalogueManager", () => {
  it("renders existing products and a create form", () => {
    render(
      <ProductCatalogueManager
        initialProducts={[
          { id: "x", name: "10× 1-on-1", session_type: "1-on-1", credits: 10, price_cents: 50000, validity_days: 90, stripe_price_id: null, is_active: true, sort_order: 0, created_at: "", updated_at: "" } as never,
        ]}
      />,
    )
    expect(screen.getByText(/10× 1-on-1/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add product/i })).toBeInTheDocument()
  })
  it("shows an empty hint when there are no products", () => {
    render(<ProductCatalogueManager initialProducts={[]} />)
    expect(screen.getByText(/no products/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Create `components/admin/packs/ProductCatalogueManager.tsx`** — a `"use client"` component holding `products` state seeded from `initialProducts`; a create form that POSTs to `/api/admin/session-packs/products` and prepends the result; each row has an activate/deactivate button that PATCHes `is_active`. Use existing `@/components/ui/{input,button,label}` and `sonner` `toast`. Keep it minimal and functional (no drag-sort). Render `"No products yet — add one below."` when empty. Mirror the form-handling style of `components/admin/packs/SellPackDialog.tsx`.

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SessionPackProduct } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ProductCatalogueManager({ initialProducts }: { initialProducts: SessionPackProduct[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [form, setForm] = useState({ name: "", sessionType: "", credits: "10", price: "", validityDays: "" })
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/session-packs/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sessionType: form.sessionType,
          credits: Number(form.credits),
          priceCents: Math.round(Number(form.price) * 100),
          validityDays: form.validityDays ? Number(form.validityDays) : null,
        }),
      })
      if (!res.ok) throw new Error()
      const { product } = await res.json()
      setProducts((p) => [product, ...p])
      setForm({ name: "", sessionType: "", credits: "10", price: "", validityDays: "" })
      toast.success("Product added")
    } catch {
      toast.error("Could not add product")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(p: SessionPackProduct) {
    const res = await fetch(`/api/admin/session-packs/products/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !p.is_active }),
    })
    if (!res.ok) return toast.error("Update failed")
    const { product } = await res.json()
    setProducts((list) => list.map((x) => (x.id === product.id ? product : x)))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {products.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.credits} × {p.session_type} · ${(p.price_cents / 100).toFixed(2)}
                    {p.validity_days ? ` · ${p.validity_days}d` : ""} · {p.is_active ? "Active" : "Archived"}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggle(p)}>
                  {p.is_active ? "Deactivate" : "Activate"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm space-y-3">
        <h2 className="font-medium text-foreground">New product</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Session type</Label><Input value={form.sessionType} onChange={(e) => setForm({ ...form, sessionType: e.target.value })} /></div>
          <div><Label>Credits</Label><Input type="number" value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} /></div>
          <div><Label>Price (USD)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div><Label>Validity days (optional)</Label><Input type="number" value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: e.target.value })} /></div>
        </div>
        <Button onClick={add} disabled={busy || !form.name || !form.sessionType || !form.price}>Add product</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the server page** `app/(admin)/admin/session-packs/products/page.tsx`:

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listAllProducts } from "@/lib/db/session-pack-products"
import { ProductCatalogueManager } from "@/components/admin/packs/ProductCatalogueManager"

export const metadata = { title: "Session Pack Catalogue" }

export default async function PackCataloguePage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")
  const products = await listAllProducts()
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Session Pack Catalogue</h1>
      <p className="text-sm text-muted-foreground">Products clients can buy themselves. Keep prices in USD.</p>
      <ProductCatalogueManager initialProducts={products} />
    </div>
  )
}
```

- [ ] **Step 5: Run** — `npm run test:run -- ProductCatalogueManager` → PASS.
- [ ] **Step 6: Commit** — `git add components/admin/packs/ProductCatalogueManager.tsx app/\(admin\)/admin/session-packs/products/page.tsx __tests__/components/admin/packs/ProductCatalogueManager.test.tsx && git commit -m "feat(client-packs): admin session-pack catalogue manager"`

---

### Task 9: Client self-purchase endpoint (+ Stripe cancelUrl, coach notify)

**Files:**
- Modify: `lib/stripe.ts:401` (add optional `cancelUrl`)
- Modify: `lib/validators/session-packs.ts` (add `selfCheckoutSchema`)
- Create: `app/api/client/session-packs/checkout/route.ts`
- Test: `__tests__/api/client/session-packs-checkout.test.ts`

**Interfaces:**
- Consumes: `auth()`, `getProductById`, `buildPackageInsert`, `createClientPackage`, `updateClientPackage`, `createPackCheckoutSession`, `clientSelfPurchaseEnabled`.
- Produces: `POST /api/client/session-packs/checkout` — body `{ productId }`; client-only; creates a pending unlinked stripe pack + checkout session; returns `{ url }`.

- [ ] **Step 1: Extend `createPackCheckoutSession`** in `lib/stripe.ts` — add `cancelUrl?: string` to the opts type and use it:

```ts
// in the opts type: add `cancelUrl?: string`
const cancelUrl = opts.cancelUrl
  ? `${baseUrl}${opts.cancelUrl}`
  : `${baseUrl}/admin/clients/${opts.clientUserId}?pack=cancelled`
```

(Replace the existing hardcoded `cancelUrl` line. The admin path passes no `cancelUrl`, so its behavior is unchanged.)

- [ ] **Step 2: Add validator** to `lib/validators/session-packs.ts`:

```ts
export const selfCheckoutSchema = z.object({ productId: z.string().uuid() })
```

- [ ] **Step 3: Write the failing test**

```ts
// __tests__/api/client/session-packs-checkout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const authMock = vi.fn()
const getProductMock = vi.fn()
const createPkgMock = vi.fn()
const updatePkgMock = vi.fn()
const checkoutMock = vi.fn()
const flagMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/session-pack-products", () => ({ getProductById: (...a: unknown[]) => getProductMock(...a) }))
vi.mock("@/lib/db/client-packages", () => ({
  createClientPackage: (...a: unknown[]) => createPkgMock(...a),
  updateClientPackage: (...a: unknown[]) => updatePkgMock(...a),
}))
vi.mock("@/lib/stripe", () => ({ createPackCheckoutSession: (...a: unknown[]) => checkoutMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({ clientSelfPurchaseEnabled: () => flagMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/notifications", () => ({ createNotification: vi.fn() }))
import { POST } from "@/app/api/client/session-packs/checkout/route"

const PRODUCT = "22222222-2222-4222-8222-222222222222"
const req = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/client/session-packs/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  authMock.mockResolvedValue({ user: { id: "c1", role: "client" } })
  getProductMock.mockResolvedValue({ id: PRODUCT, name: "10×", session_type: "1-on-1", credits: 10, price_cents: 50000, validity_days: 90, stripe_price_id: null, is_active: true })
  createPkgMock.mockImplementation(async (p) => ({ id: "pkg-1", ...p }))
  checkoutMock.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" })
})

describe("POST /api/client/session-packs/checkout", () => {
  it("403 when the flag is off", async () => { flagMock.mockResolvedValue(false); expect((await POST(req({ productId: PRODUCT }))).status).toBe(403) })
  it("403 for non-clients", async () => { authMock.mockResolvedValue({ user: { id: "a", role: "admin" } }); expect((await POST(req({ productId: PRODUCT }))).status).toBe(403) })
  it("404 for an inactive/unknown product", async () => { getProductMock.mockResolvedValue({ id: PRODUCT, is_active: false }); expect((await POST(req({ productId: PRODUCT }))).status).toBe(404) })
  it("creates a pending UNLINKED stripe pack for the session user and returns the url", async () => {
    const res = await POST(req({ productId: PRODUCT }))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe("https://stripe.test/cs_1")
    expect(createPkgMock).toHaveBeenCalledWith(expect.objectContaining({
      client_user_id: "c1", assignment_id: null, payment_method: "stripe", payment_status: "pending", stripe_session_id: "cs_1",
    }))
  })
})
```

- [ ] **Step 4: Run** — FAIL.

- [ ] **Step 5: Create `app/api/client/session-packs/checkout/route.ts`**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { selfCheckoutSchema } from "@/lib/validators/session-packs"
import { getProductById } from "@/lib/db/session-pack-products"
import { createClientPackage, updateClientPackage } from "@/lib/db/client-packages"
import { buildPackageInsert } from "@/lib/services/session-credits"
import { createPackCheckoutSession } from "@/lib/stripe"
import { clientSelfPurchaseEnabled } from "@/lib/packs/flags"
import { recordAudit } from "@/lib/audit/record"
import { createNotification } from "@/lib/db/notifications"

/** Client self-purchase of a session pack. Stripe only; pack stays unlinked. */
export async function POST(request: Request) {
  try {
    if (!(await clientSelfPurchaseEnabled())) {
      return NextResponse.json({ error: "Self-purchase is not enabled" }, { status: 403 })
    }
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = selfCheckoutSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const product = await getProductById(parsed.data.productId).catch(() => null)
    if (!product || !product.is_active) {
      return NextResponse.json({ error: "Product not available" }, { status: 404 })
    }

    const now = new Date()
    const checkout = await createPackCheckoutSession({
      clientUserId: session.user.id,
      name: product.name,
      sessionType: product.session_type,
      credits: product.credits,
      priceCents: product.price_cents,
      validityDays: product.validity_days,
      productId: product.id,
      stripePriceId: product.stripe_price_id,
      returnUrl: "/client/sessions",
      cancelUrl: "/client/sessions/buy",
    })

    const pkg = await createClientPackage(
      buildPackageInsert({
        clientUserId: session.user.id,
        productId: product.id,
        assignmentId: null,
        sessionType: product.session_type,
        credits: product.credits,
        priceCents: product.price_cents,
        validityDays: product.validity_days,
        paymentMethod: "stripe",
        createdBy: session.user.id,
        now,
        stripeSessionId: checkout.id,
      }),
    )

    void recordAudit({
      action: "pack.sold",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id: pkg.id, label: product.name },
      metadata: { payment_method: "stripe", self_purchase: true, client_user_id: session.user.id, credits: product.credits },
      request,
    })
    // Best-effort coach heads-up (non-blocking).
    void createNotification({
      user_id: session.user.id,
      title: "Pack purchase started",
      message: `You're buying ${product.name}. Credits unlock once payment completes.`,
      type: "info",
      is_read: false,
      link: "/client/sessions",
    }).catch(() => {})

    return NextResponse.json({ url: checkout.url, packageId: pkg.id })
  } catch (error) {
    console.error("Client pack checkout error:", error)
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 })
  }
}
```

> Note: `updateClientPackage` is imported for parity with the admin flow but the pack already stores `stripe_session_id` via `buildPackageInsert`, so no post-update is needed. Remove the unused import if the linter flags it. Confirm `createNotification`'s field shape against `lib/db/notifications.ts` and adjust (it's used the same way in `lib/services/program-progression.ts`).

- [ ] **Step 6: Run** — `npm run test:run -- session-packs-checkout` → PASS.
- [ ] **Step 7: Commit** — `git add lib/stripe.ts lib/validators/session-packs.ts app/api/client/session-packs/checkout/route.ts __tests__/api/client/session-packs-checkout.test.ts && git commit -m "feat(client-packs): client self-purchase checkout endpoint (stripe, unlinked)"`

---

### Task 10: Client storefront page

**Files:**
- Create: `components/client/BuySessionsClient.tsx` (client component)
- Create: `app/(client)/client/sessions/buy/page.tsx` (server page, flag-gated)
- Test: `__tests__/components/client/BuySessionsClient.test.tsx`

**Interfaces:**
- Consumes: `POST /api/client/session-packs/checkout` (Task 9), `listActiveProducts` (DAL).
- Produces: `BuySessionsClient({ products }: { products: SessionPackProduct[] })` — a card per product with a Buy button that POSTs and redirects to the Stripe `url`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/client/BuySessionsClient.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { BuySessionsClient } from "@/components/client/BuySessionsClient"

beforeEach(() => { global.fetch = vi.fn() as never })

describe("BuySessionsClient", () => {
  it("lists products with prices and a buy button", () => {
    render(<BuySessionsClient products={[
      { id: "x", name: "10× 1-on-1", session_type: "1-on-1", credits: 10, price_cents: 50000, validity_days: 90, stripe_price_id: null, is_active: true, sort_order: 0, created_at: "", updated_at: "" } as never,
    ]} />)
    expect(screen.getByText(/10× 1-on-1/)).toBeInTheDocument()
    expect(screen.getByText(/\$500/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /buy/i })).toBeInTheDocument()
  })
  it("shows an empty state when no products are available", () => {
    render(<BuySessionsClient products={[]} />)
    expect(screen.getByText(/no sessions available/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Create `components/client/BuySessionsClient.tsx`**

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SessionPackProduct } from "@/types/database"
import { Button } from "@/components/ui/button"

export function BuySessionsClient({ products }: { products: SessionPackProduct[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No sessions available to buy right now. Check back soon.</p>
      </div>
    )
  }
  async function buy(p: SessionPackProduct) {
    setBusy(p.id)
    try {
      const res = await fetch("/api/client/session-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: p.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error()
      window.location.href = data.url
    } catch {
      toast.error("Could not start checkout")
      setBusy(null)
    }
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {products.map((p) => (
        <div key={p.id} className="flex flex-col rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="font-medium text-foreground">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            {p.credits} × {p.session_type}
            {p.validity_days ? ` · valid ${p.validity_days} days` : ""}
          </p>
          <p className="my-3 text-2xl font-semibold text-primary">${(p.price_cents / 100).toFixed(0)}</p>
          <Button className="mt-auto" onClick={() => buy(p)} disabled={busy === p.id}>
            {busy === p.id ? "Starting…" : "Buy"}
          </Button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create the server page** `app/(client)/client/sessions/buy/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { clientSelfPurchaseEnabled } from "@/lib/packs/flags"
import { listActiveProducts } from "@/lib/db/session-pack-products"
import { BuySessionsClient } from "@/components/client/BuySessionsClient"

export const metadata = { title: "Buy Sessions" }

export default async function BuySessionsPage() {
  if (!(await clientSelfPurchaseEnabled())) redirect("/client/sessions")
  const products = await listActiveProducts()
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Buy Sessions</h1>
      <BuySessionsClient products={products} />
    </div>
  )
}
```

- [ ] **Step 5: Run** — `npm run test:run -- BuySessionsClient` → PASS.
- [ ] **Step 6: Commit** — `git add components/client/BuySessionsClient.tsx app/\(client\)/client/sessions/buy/page.tsx __tests__/components/client/BuySessionsClient.test.tsx && git commit -m "feat(client-packs): client buy-sessions storefront (flag-gated)"`

---

## Final verification (after all tasks)

- [ ] **Run the full suite** — `npm run test:run` → all green (baseline reds documented in memory `test_baseline_not_green` excluded).
- [ ] **Typecheck the new prod source** — `npx tsc --noEmit` (expect only the pre-existing test/.next noise per memory).
- [ ] **Holistic review** — request a code review over the diff; address findings.
- [ ] **Update JOURNAL.md + memory.**
- [ ] **Commit anything outstanding on `main` (do NOT push).**

## Self-Review (plan vs spec)

- **Spec coverage:** Phase 1 → Tasks 1–4; Phase 2 → Tasks 5–6; Phase 3 (+ admin catalogue prerequisite) → Tasks 7–10. Flags (cross-cutting) → Task 1, consumed throughout. ✓
- **Identity-from-session constraint:** enforced in Tasks 5 & 9 (ignore body id), tested explicitly. ✓
- **Default-off flags:** Task 1 default `false`; pages redirect / cards render null when off. ✓
- **Type consistency:** `MyPacksView`, `loadMyPacksView`, `nearestActiveExpiry`, `CheckinClient({token, me})`, `selfCheckinSchema`, `selfCheckoutSchema`, `packProductUpdateSchema` defined once and consumed with matching names. ✓
- **No new migrations:** confirmed — only `system_settings` rows (created lazily by `setSetting` when the admin toggles; reads default off). ✓
