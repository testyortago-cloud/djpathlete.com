# Content Studio Phase 1 — Shell + Routing Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Content Studio shell (`/admin/content`) with tab switcher, routed detail drawer placeholder, sidebar update, and feature-flagged redirects from legacy URLs (`/admin/videos`, `/admin/social`, `/admin/calendar`). All tab content is placeholder in Phase 1 — real UI lands in Phase 2-5.

**Architecture:** A Next.js App Router nested layout at `app/(admin)/admin/content/layout.tsx` wraps all Content Studio tabs and the drawer. Tab switching is driven by a client-side `<TabSwitcher>` reading a `?tab=` search param. The drawer uses a dynamic segment `[videoId]` so the URL is shareable; when that segment is present, a `<DetailDrawer>` mounts over the tab content. Feature flag `CONTENT_STUDIO_ENABLED` gates both the sidebar entry and the legacy-page redirects.

**Tech Stack:** Next.js 16 App Router (React 19), TypeScript strict, Tailwind v4, Vitest + Testing Library, Playwright, Lucide icons.

**Spec:** [docs/superpowers/specs/2026-04-20-content-studio-design.md](../specs/2026-04-20-content-studio-design.md)

---

## File Structure

**Create:**

- `lib/content-studio/feature-flag.ts` — `isContentStudioEnabled()` helper
- `__tests__/lib/content-studio/feature-flag.test.ts` — flag tests
- `app/(admin)/admin/content/layout.tsx` — shell wrapper, mounts `<ContentStudioShell>` around children
- `app/(admin)/admin/content/page.tsx` — renders the currently-selected tab's placeholder based on `?tab=`
- `app/(admin)/admin/content/[videoId]/page.tsx` — same as root page but with `<DetailDrawer>` open for the given videoId
- `components/admin/content-studio/ContentStudioShell.tsx` — persistent shell: top bar (tab switcher + placeholder search + Upload button)
- `components/admin/content-studio/TabSwitcher.tsx` — client component that reads `?tab=` and renders tab links
- `components/admin/content-studio/DetailDrawer.tsx` — placeholder drawer with header + close button (real content in Phase 2)
- `components/admin/content-studio/TabPlaceholder.tsx` — single placeholder component, takes a `tabName` prop
- `__tests__/components/admin/content-studio/TabSwitcher.test.tsx`
- `__tests__/components/admin/content-studio/DetailDrawer.test.tsx`
- `__tests__/e2e/content-studio-shell.spec.ts`

**Modify:**

- `components/admin/AdminSidebar.tsx` — when flag is on, replace the three "AI Automation" entries (Social, Calendar, Videos) with a single "Content Studio" entry
- `app/(admin)/admin/videos/page.tsx` — add `redirect()` at top when flag is on
- `app/(admin)/admin/social/page.tsx` — same
- `app/(admin)/admin/calendar/page.tsx` — same
- `.env.example` — document `CONTENT_STUDIO_ENABLED`

---

## Task 1: Feature flag helper

**Files:**
- Create: `lib/content-studio/feature-flag.ts`
- Test: `__tests__/lib/content-studio/feature-flag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/feature-flag.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"

describe("content studio feature flag", () => {
  const origEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("is disabled by default", () => {
    delete process.env.CONTENT_STUDIO_ENABLED
    expect(isContentStudioEnabled()).toBe(false)
  })

  it("is enabled when env var is 'true'", () => {
    process.env.CONTENT_STUDIO_ENABLED = "true"
    expect(isContentStudioEnabled()).toBe(true)
  })

  it("is disabled when env var is anything other than 'true'", () => {
    process.env.CONTENT_STUDIO_ENABLED = "1"
    expect(isContentStudioEnabled()).toBe(false)
    process.env.CONTENT_STUDIO_ENABLED = "yes"
    expect(isContentStudioEnabled()).toBe(false)
    process.env.CONTENT_STUDIO_ENABLED = ""
    expect(isContentStudioEnabled()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/content-studio/feature-flag.test.ts`
Expected: FAIL — module not found `@/lib/content-studio/feature-flag`

- [ ] **Step 3: Write minimal implementation**

Create `lib/content-studio/feature-flag.ts`:

```typescript
export function isContentStudioEnabled(): boolean {
  return process.env.CONTENT_STUDIO_ENABLED === "true"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/content-studio/feature-flag.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Document env var**

Edit `.env.example` — add under the feature-flag section (find a spot near `SHOP_ENABLED` or similar):

```
# Enables the new Content Studio admin surface (unified videos/social/calendar).
# When 'true', /admin/videos, /admin/social, /admin/calendar redirect into
# /admin/content, and the sidebar shows a single "Content Studio" entry.
CONTENT_STUDIO_ENABLED=false
```

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/feature-flag.ts __tests__/lib/content-studio/feature-flag.test.ts .env.example
git commit -m "feat(content-studio): feature flag helper + env var"
```

---

## Task 2: TabSwitcher component

**Files:**
- Create: `components/admin/content-studio/TabSwitcher.tsx`
- Test: `__tests__/components/admin/content-studio/TabSwitcher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/TabSwitcher.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TabSwitcher } from "@/components/admin/content-studio/TabSwitcher"

// Mock next/navigation for client components
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=calendar"),
  usePathname: () => "/admin/content",
}))

describe("<TabSwitcher>", () => {
  it("renders all four tab labels", () => {
    render(<TabSwitcher />)
    expect(screen.getByRole("link", { name: /Pipeline/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Calendar/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Videos/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Posts/i })).toBeInTheDocument()
  })

  it("marks the tab matching the ?tab= search param as active", () => {
    render(<TabSwitcher />)
    const calendarLink = screen.getByRole("link", { name: /Calendar/i })
    expect(calendarLink).toHaveAttribute("aria-current", "page")
  })

  it("defaults to Pipeline when no ?tab= is set", async () => {
    vi.doMock("next/navigation", () => ({
      useSearchParams: () => new URLSearchParams(""),
      usePathname: () => "/admin/content",
    }))
    vi.resetModules()
    const { TabSwitcher: Fresh } = await import("@/components/admin/content-studio/TabSwitcher")
    render(<Fresh />)
    const pipelineLink = screen.getByRole("link", { name: /Pipeline/i })
    expect(pipelineLink).toHaveAttribute("aria-current", "page")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/TabSwitcher.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `components/admin/content-studio/TabSwitcher.tsx`:

```typescript
"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { LayoutGrid, CalendarDays, Film, Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { id: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "videos", label: "Videos", icon: Film },
  { id: "posts", label: "Posts", icon: Megaphone },
] as const

type TabId = (typeof TABS)[number]["id"]

function getActiveTab(searchParams: URLSearchParams): TabId {
  const tab = searchParams.get("tab")
  if (tab === "calendar" || tab === "videos" || tab === "posts") return tab
  return "pipeline"
}

export function TabSwitcher() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = getActiveTab(searchParams)

  // Preserve the /admin/content/[videoId] drawer when switching tabs
  const basePath = pathname.startsWith("/admin/content/")
    ? pathname
    : "/admin/content"

  return (
    <nav className="flex items-center gap-1 border-b border-border">
      {TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id
        const href = id === "pipeline" ? basePath : `${basePath}?tab=${id}`
        return (
          <Link
            key={id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/TabSwitcher.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/TabSwitcher.tsx __tests__/components/admin/content-studio/TabSwitcher.test.tsx
git commit -m "feat(content-studio): add TabSwitcher component"
```

---

## Task 3: DetailDrawer placeholder component

**Files:**
- Create: `components/admin/content-studio/DetailDrawer.tsx`
- Test: `__tests__/components/admin/content-studio/DetailDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/DetailDrawer.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  usePathname: () => "/admin/content/abc-123",
  useSearchParams: () => new URLSearchParams(""),
}))

describe("<DetailDrawer>", () => {
  it("renders the videoId in the header", () => {
    render(<DetailDrawer videoId="abc-123" />)
    expect(screen.getByText(/abc-123/)).toBeInTheDocument()
  })

  it("renders a close button labelled for accessibility", () => {
    render(<DetailDrawer videoId="abc-123" />)
    expect(screen.getByRole("button", { name: /close drawer/i })).toBeInTheDocument()
  })

  it("navigates to /admin/content when close is clicked", () => {
    pushMock.mockClear()
    render(<DetailDrawer videoId="abc-123" />)
    fireEvent.click(screen.getByRole("button", { name: /close drawer/i }))
    expect(pushMock).toHaveBeenCalledWith("/admin/content")
  })

  it("renders a placeholder indicating Phase 2 content is coming", () => {
    render(<DetailDrawer videoId="abc-123" />)
    expect(screen.getByText(/video player \+ transcript \+ posts/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/DetailDrawer.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `components/admin/content-studio/DetailDrawer.tsx`:

```typescript
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { X } from "lucide-react"

interface DetailDrawerProps {
  videoId: string
}

export function DetailDrawer({ videoId }: DetailDrawerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleClose = () => {
    // Preserve the current tab when closing (e.g., stay on Calendar tab)
    const tab = searchParams.get("tab")
    router.push(tab ? `/admin/content?tab=${tab}` : "/admin/content")
  }

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Video detail: ${videoId}`}
        className="fixed top-0 right-0 h-screen w-full max-w-[700px] bg-background border-l border-border z-50 flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-heading text-lg">Video · {videoId}</h2>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Phase 2 will render the video player + transcript + posts here.
          </div>
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/DetailDrawer.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/DetailDrawer.tsx __tests__/components/admin/content-studio/DetailDrawer.test.tsx
git commit -m "feat(content-studio): add DetailDrawer placeholder with close + ESC"
```

---

## Task 4: TabPlaceholder component

**Files:**
- Create: `components/admin/content-studio/TabPlaceholder.tsx`

- [ ] **Step 1: Write the implementation**

This is a trivial presentational component — a visible unit test would add no value. Create `components/admin/content-studio/TabPlaceholder.tsx`:

```typescript
import { Sparkles } from "lucide-react"

interface TabPlaceholderProps {
  tabName: string
  phaseLabel: string
}

export function TabPlaceholder({ tabName, phaseLabel }: TabPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Sparkles className="size-10 text-muted-foreground mb-3" strokeWidth={1.5} />
      <h3 className="font-heading text-xl mb-1">{tabName}</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Lands in {phaseLabel}. The shell is in place — real UI is next.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/TabPlaceholder.tsx
git commit -m "feat(content-studio): add TabPlaceholder for empty tabs"
```

---

## Task 5: ContentStudioShell component

**Files:**
- Create: `components/admin/content-studio/ContentStudioShell.tsx`

- [ ] **Step 1: Write the implementation**

This component composes TabSwitcher + top bar and wraps children. Pure composition — no test needed beyond what TabSwitcher already covers and the Playwright e2e in Task 9.

Create `components/admin/content-studio/ContentStudioShell.tsx`:

```typescript
import { Upload, Search } from "lucide-react"
import { TabSwitcher } from "./TabSwitcher"

export function ContentStudioShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-border bg-background">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-heading text-2xl">Content Studio</h1>
            <p className="text-sm text-muted-foreground">
              Videos, posts, and scheduling in one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search videos, transcripts, posts..."
                disabled
                className="pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-muted/30 w-80 placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
              />
            </div>
            <button
              type="button"
              disabled
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Upload className="size-4" />
              Upload Video
            </button>
          </div>
        </div>
        <TabSwitcher />
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  )
}
```

Note: Search input and Upload button are disabled in Phase 1 — they become functional in Phase 3/5.

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/ContentStudioShell.tsx
git commit -m "feat(content-studio): add ContentStudioShell with top bar + tabs"
```

---

## Task 6: Content Studio route — layout and index page

**Files:**
- Create: `app/(admin)/admin/content/layout.tsx`
- Create: `app/(admin)/admin/content/page.tsx`

- [ ] **Step 1: Create the layout**

The `(admin)` route group's existing layout already gates admin access via `requireAdmin()`. We only need a nested layout to mount the shell.

Create `app/(admin)/admin/content/layout.tsx`:

```typescript
import { notFound } from "next/navigation"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
import { ContentStudioShell } from "@/components/admin/content-studio/ContentStudioShell"

export default function ContentStudioLayout({ children }: { children: React.ReactNode }) {
  if (!isContentStudioEnabled()) {
    notFound()
  }
  return <ContentStudioShell>{children}</ContentStudioShell>
}
```

- [ ] **Step 2: Create the index page**

Create `app/(admin)/admin/content/page.tsx`:

```typescript
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab } = await searchParams

  switch (tab) {
    case "calendar":
      return <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
    case "videos":
      return <TabPlaceholder tabName="Videos" phaseLabel="Phase 3" />
    case "posts":
      return <TabPlaceholder tabName="Posts" phaseLabel="Phase 3" />
    default:
      return <TabPlaceholder tabName="Pipeline" phaseLabel="Phase 3" />
  }
}
```

- [ ] **Step 3: Manual smoke test**

In one terminal: `CONTENT_STUDIO_ENABLED=true npm run dev`

On Windows bash, set the env var inline:
```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

In browser, log in as admin, visit:
- `http://localhost:3050/admin/content` → Pipeline placeholder
- `http://localhost:3050/admin/content?tab=calendar` → Calendar placeholder
- `http://localhost:3050/admin/content?tab=videos` → Videos placeholder
- Click tabs → should navigate without full page reload

Expected: shell renders with tabs, each tab shows its placeholder.

Without the env var: `http://localhost:3050/admin/content` → 404 (notFound).

- [ ] **Step 4: Commit**

```bash
git add app/(admin)/admin/content/layout.tsx app/(admin)/admin/content/page.tsx
git commit -m "feat(content-studio): add /admin/content route with tab placeholders"
```

---

## Task 7: Drawer route — `/admin/content/[videoId]`

**Files:**
- Create: `app/(admin)/admin/content/[videoId]/page.tsx`

- [ ] **Step 1: Write the implementation**

Because `layout.tsx` is already in place one level up, this nested page inherits the shell. We additionally render the drawer on top. Next.js App Router preserves the parent layout so the tab content behind the drawer stays mounted.

Create `app/(admin)/admin/content/[videoId]/page.tsx`:

```typescript
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab } = await searchParams

  // Render the same tab content behind the drawer, so closing the drawer
  // leaves the user on the tab they came from.
  let tabContent: React.ReactNode
  switch (tab) {
    case "calendar":
      tabContent = <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
      break
    case "videos":
      tabContent = <TabPlaceholder tabName="Videos" phaseLabel="Phase 3" />
      break
    case "posts":
      tabContent = <TabPlaceholder tabName="Posts" phaseLabel="Phase 3" />
      break
    default:
      tabContent = <TabPlaceholder tabName="Pipeline" phaseLabel="Phase 3" />
  }

  return (
    <>
      {tabContent}
      <DetailDrawer videoId={videoId} />
    </>
  )
}
```

- [ ] **Step 2: Manual smoke test**

Dev server still running. Visit:
- `http://localhost:3050/admin/content/test-video-123` → shell + Pipeline behind + drawer open with "Video · test-video-123" header
- `http://localhost:3050/admin/content/test-video-123?tab=calendar` → shell + Calendar behind + drawer open
- Press ESC → navigates to `/admin/content` (or `/admin/content?tab=calendar` if `?tab=` was set)
- Click backdrop → same
- Click X → same

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/content/[videoId]/page.tsx
git commit -m "feat(content-studio): add deep-linkable drawer route"
```

---

## Task 8: Update AdminSidebar to show Content Studio when flag is on

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Read the current file**

Read `components/admin/AdminSidebar.tsx`. The relevant section is the "AI Automation" `NavSection` with items for Social, Calendar, and Videos.

- [ ] **Step 2: Make the nav sections flag-aware**

Change the file: import the flag helper, move the `navSections` constant into a `getNavSections()` function that branches on the flag, and call it inside the component.

Edit `components/admin/AdminSidebar.tsx`:

At the top of the file, after the existing imports, add:

```typescript
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
```

Also add `Layers` to the existing `lucide-react` import block:

```typescript
import {
  // ...existing icons...
  Layers,
} from "lucide-react"
```

Replace the entire `const navSections: NavSection[] = [...]` block (lines ~52-116) with a function:

```typescript
function getNavSections(): NavSection[] {
  const contentStudioOn = isContentStudioEnabled()

  const aiAutomationItems: NavItem[] = contentStudioOn
    ? [
        { label: "Content Studio", href: "/admin/content", icon: Layers },
        { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
        { label: "Platform Connections", href: "/admin/platform-connections", icon: Link2 },
      ]
    : [
        { label: "Social", href: "/admin/social", icon: Megaphone },
        { label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
        { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
        { label: "Videos", href: "/admin/videos", icon: Film },
        { label: "Platform Connections", href: "/admin/platform-connections", icon: Link2 },
      ]

  return [
    {
      title: "",
      items: [{ label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard }],
    },
    {
      title: "Coaching",
      items: [
        { label: "Clients", href: "/admin/clients", icon: Users },
        { label: "Programs", href: "/admin/programs", icon: ClipboardList },
        { label: "Exercises", href: "/admin/exercises", icon: Dumbbell },
        { label: "Form Reviews", href: "/admin/form-reviews", icon: Video },
        { label: "Assessments", href: "/admin/performance-assessments", icon: ClipboardCheck },
      ],
    },
    {
      title: "Content",
      items: [
        { label: "Blog", href: "/admin/blog", icon: FileText },
        { label: "Testimonials", href: "/admin/testimonials", icon: MessageSquareQuote },
        { label: "Newsletter", href: "/admin/newsletter", icon: Mail },
      ],
    },
    {
      title: "AI Tools",
      items: [
        { label: "AI Assistant", href: "/admin/ai-assistant", icon: Bot },
        { label: "AI Usage", href: "/admin/ai-usage", icon: Brain },
        { label: "AI Insights", href: "/admin/ai-insights", icon: Lightbulb },
        { label: "AI Templates", href: "/admin/ai-templates", icon: FileText },
        { label: "AI Policy", href: "/admin/settings/ai-policy", icon: Sparkles },
      ],
    },
    {
      title: "AI Automation",
      items: aiAutomationItems,
    },
    {
      title: "Business",
      items: [
        { label: "Bookings", href: "/admin/bookings", icon: CalendarCheck },
        { label: "Events", href: "/admin/events", icon: CalendarDays },
        { label: "Payments", href: "/admin/payments", icon: CreditCard },
        { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
        { label: "Reviews", href: "/admin/reviews", icon: Star },
      ],
    },
    {
      title: "Shop",
      items: [
        { label: "Products", href: "/admin/shop/products", icon: ShoppingBag },
        { label: "Orders", href: "/admin/shop/orders", icon: Package },
      ],
    },
    {
      title: "Legal",
      items: [{ label: "Legal Documents", href: "/admin/legal", icon: Scale }],
    },
  ]
}
```

Then inside the `AdminSidebar` component, replace the top-of-component usage:

```typescript
export function AdminSidebar() {
  const pathname = usePathname()
  const navSections = getNavSections()
  // ...rest unchanged
```

- [ ] **Step 3: Manual smoke test**

With `CONTENT_STUDIO_ENABLED=true npm run dev`: sidebar shows "Content Studio" in AI Automation, NOT Social/Calendar/Videos.

Without the env var (or `=false`): sidebar shows the original three entries.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdminSidebar.tsx
git commit -m "feat(content-studio): sidebar shows Content Studio entry when flag on"
```

---

## Task 9: Redirect legacy admin pages when flag is on

**Files:**
- Modify: `app/(admin)/admin/videos/page.tsx`
- Modify: `app/(admin)/admin/social/page.tsx`
- Modify: `app/(admin)/admin/calendar/page.tsx`

- [ ] **Step 1: Add redirect to /admin/videos**

Read the file first to see its current top. Add at the very top of the `default export` function body (before any other logic), and import `redirect` if not already imported.

Edit `app/(admin)/admin/videos/page.tsx`:

Add to the imports at the top of the file:

```typescript
import { redirect } from "next/navigation"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
```

Then at the very top of the default-exported page function:

```typescript
export default async function VideosPage(/* existing params */) {
  if (isContentStudioEnabled()) {
    redirect("/admin/content?tab=videos")
  }
  // ...existing body unchanged
}
```

If the existing function signature is different (e.g., not async), leave it as it was — `redirect()` throws, so it works in both sync and async functions.

- [ ] **Step 2: Same for /admin/social**

Edit `app/(admin)/admin/social/page.tsx`:

```typescript
import { redirect } from "next/navigation"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
// ...
export default async function SocialPage(/* existing params */) {
  if (isContentStudioEnabled()) {
    redirect("/admin/content?tab=posts")
  }
  // ...existing body unchanged
}
```

- [ ] **Step 3: Same for /admin/calendar**

Edit `app/(admin)/admin/calendar/page.tsx`:

```typescript
import { redirect } from "next/navigation"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
// ...
export default async function CalendarPage(/* existing params */) {
  if (isContentStudioEnabled()) {
    redirect("/admin/content?tab=calendar")
  }
  // ...existing body unchanged
}
```

- [ ] **Step 4: Manual smoke test**

With flag on: visiting `/admin/videos` lands on `/admin/content?tab=videos`. Same for `/admin/social` → `?tab=posts` and `/admin/calendar` → `?tab=calendar`.

With flag off: all three legacy pages render their original content unchanged.

- [ ] **Step 5: Commit**

```bash
git add app/(admin)/admin/videos/page.tsx app/(admin)/admin/social/page.tsx app/(admin)/admin/calendar/page.tsx
git commit -m "feat(content-studio): redirect legacy admin URLs when flag on"
```

---

## Task 10: E2E smoke test

**Files:**
- Create: `__tests__/e2e/content-studio-shell.spec.ts`

- [ ] **Step 1: Check the existing e2e setup**

Read `__tests__/e2e/` directory and `playwright.config.ts` to understand the existing login helper and base URL. If there's an existing `login()` helper, use it; otherwise write a minimal one inline.

Run: `npm run test:e2e -- --list` to confirm Playwright is configured.

- [ ] **Step 2: Write the e2e test**

Create `__tests__/e2e/content-studio-shell.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

// This suite requires CONTENT_STUDIO_ENABLED=true to be set when the dev server is started.
// If the flag is off, /admin/content returns 404 and these tests will be skipped.

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com"
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin-password"

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/admin\//)
}

test.describe("Content Studio shell", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("pipeline is the default tab", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible()
    await expect(page.getByRole("link", { name: /Pipeline/ })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("heading", { name: /Pipeline/ })).toBeVisible()
  })

  test("clicking Calendar tab switches content", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await page.getByRole("link", { name: /Calendar/ }).click()
    await expect(page).toHaveURL(/\?tab=calendar/)
    await expect(page.getByRole("heading", { name: /Calendar/ })).toBeVisible()
  })

  test("deep-link /admin/content/[videoId] opens drawer over tab", async ({ page }) => {
    const response = await page.goto("/admin/content/test-video-xyz")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("dialog", { name: /Video detail: test-video-xyz/ })).toBeVisible()
    await expect(page.getByText(/Video · test-video-xyz/)).toBeVisible()
  })

  test("ESC closes the drawer and returns to tab", async ({ page }) => {
    const response = await page.goto("/admin/content/test-video-xyz?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page).toHaveURL(/\/admin\/content\?tab=calendar/)
    await expect(page.getByRole("dialog")).toBeHidden()
  })

  test("legacy /admin/videos redirects into Videos tab", async ({ page }) => {
    const response = await page.goto("/admin/videos")
    // If flag is off, /admin/videos renders the legacy page — skip.
    if (!page.url().includes("/admin/content")) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page).toHaveURL(/\/admin\/content\?tab=videos/)
    await expect(page.getByRole("link", { name: /Videos/ })).toHaveAttribute("aria-current", "page")
  })
})
```

- [ ] **Step 3: Run the e2e suite**

Run in two terminals. Terminal 1:
```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

Terminal 2 (wait for dev server to be ready):
```bash
E2E_ADMIN_EMAIL=<your admin test account email> E2E_ADMIN_PASSWORD=<password> npm run test:e2e -- content-studio-shell
```

Expected: all 5 tests pass on Chromium, Firefox, WebKit.

If your repo already has a cleaner admin-login helper, replace the inline `loginAsAdmin` with it.

- [ ] **Step 4: Commit**

```bash
git add __tests__/e2e/content-studio-shell.spec.ts
git commit -m "test(content-studio): e2e smoke test for shell + drawer + redirects"
```

---

## Task 11: Final lint + typecheck + full test sweep

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: zero errors. Fix any warnings in files you touched.

- [ ] **Step 2: Run format check**

```bash
npm run format:check
```

If files need formatting: `npm run format` then re-run the check.

- [ ] **Step 3: Run full unit test suite**

```bash
npm run test:run
```

Expected: all tests pass, including the three new ones (feature-flag, TabSwitcher, DetailDrawer).

- [ ] **Step 4: Commit any formatter fixes**

```bash
git add -u
git commit -m "chore(content-studio): prettier fixes from Phase 1" --allow-empty
```

(Skip if there were no changes.)

---

## Verification Before Calling Phase 1 Done

Before marking this phase complete, confirm ALL of the following:

1. **Flag off = no change.** With `CONTENT_STUDIO_ENABLED` unset or `=false`:
   - Sidebar shows Social / Calendar / Videos as before
   - `/admin/videos`, `/admin/social`, `/admin/calendar` render their existing pages
   - `/admin/content` returns 404
2. **Flag on = new shell.** With `CONTENT_STUDIO_ENABLED=true`:
   - Sidebar shows "Content Studio" instead of three entries
   - `/admin/videos` redirects to `/admin/content?tab=videos`
   - `/admin/social` redirects to `/admin/content?tab=posts`
   - `/admin/calendar` redirects to `/admin/content?tab=calendar`
   - `/admin/content` shows Pipeline placeholder
   - Tab switching updates URL and content without full page reload
   - `/admin/content/test-id` shows drawer over current tab
   - ESC, X button, and backdrop all close the drawer and preserve the `?tab=` param
3. **Admin-only enforcement still works.** Log out or log in as a non-admin → `/admin/content` redirects to login/client per existing middleware.
4. **All tests pass.** `npm run test:run` and `npm run test:e2e -- content-studio-shell` both green.
5. **No regressions.** Run `npm run test:run` for the full suite — nothing in other areas broke.

---

## Phase 1 Scope Boundaries

**In this phase:**
- Feature flag
- Shell, tab switcher, drawer placeholder
- Sidebar update
- Legacy URL redirects
- E2E smoke test

**NOT in this phase** (handled in later phases):
- Real video player / transcript / posts UI inside drawer → **Phase 2**
- Pipeline Kanban board → **Phase 3**
- Full calendar with filters and unscheduled panel → **Phase 4**
- Global search, user preferences persistence, legacy page cleanup → **Phase 5**

When Phase 1 is deployed and the flag is enabled for internal testing, the navigation and routing scaffolding will be validated before we build the rich UI on top.
