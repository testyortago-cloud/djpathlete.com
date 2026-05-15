# Admin Sidebar Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Solo-dev project — commit directly to `main`, no branches.

**Goal:** Cut the admin sidebar from 13 sections / ~43 items down to **6 grouped sections + 3 standalone links + Settings/Logout** (~28 visible items), with active-section-only default-collapse and `localStorage` persistence. Zero route deletions, zero route renames, zero data migrations. Desktop ([components/admin/AdminSidebar.tsx](../../../components/admin/AdminSidebar.tsx)) and mobile ([components/admin/AdminMobileSidebar.tsx](../../../components/admin/AdminMobileSidebar.tsx)) sidebars share a single source-of-truth nav module so they stop drifting.

**Architecture:** Introduce a new pure data module [components/admin/admin-nav.ts](../../../components/admin/admin-nav.ts) that exports `getAdminNav({ contentStudioEnabled })` returning `{ topLinks, groupedSections, standaloneLinks }`. Both sidebars become thin renderers over that nav graph. Settings page gains a "Configuration" card cluster surfacing the items the sidebar is dropping (Team, Team Videos, Legal, Platform Connections, Automation, Ads Settings, AI Policy) — these routes all already exist; we're adding entry points, not new pages. Sequencing follows the spec's open-question §2 recommendation: **Settings hub first, sidebar second**, to avoid a temporary discoverability gap.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Lucide icons, NextAuth v5. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-15-admin-sidebar-restructure-design.md](../specs/2026-05-15-admin-sidebar-restructure-design.md)

**Verification:** Mostly manual — sidebars are UI and the value is qualitative. One light unit test on the nav module to catch duplicate hrefs / orphaned hrefs. End-to-end check is a checklist of routes to visit and confirm correct highlighting + section expansion.

**Out of scope (per spec):**
- ⌘K command palette / sidebar search.
- Ads sub-tab consolidation (Conversions/Audiences/GA4/Automation Log → tabs inside Campaigns).
- Visual redesign — same colors, fonts, spacing.
- New `/admin/*` pages — every route already exists.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `components/admin/admin-nav.ts` | Create | Single source of truth: `NavItem`, `NavSection`, `AdminNav`, `getAdminNav()` |
| `__tests__/components/admin/admin-nav.test.ts` | Create | Sanity tests: no duplicate hrefs, every section non-empty, Content Studio flag swap works |
| `components/admin/AdminSidebar.tsx` | Rewrite | Render `getAdminNav()`; add top-link branch, default-collapse, `localStorage` persistence, `aria-*` |
| `components/admin/AdminMobileSidebar.tsx` | Rewrite | Render `getAdminNav()`; static (no collapse) but using the same data graph |
| `app/(admin)/admin/settings/page.tsx` | Modify | Add a "Configuration" card cluster linking to the items the sidebar is dropping |

---

## Phase 1: Settings hub additions (ship first — no discoverability gap)

The spec's recommended ordering (Open Question §2). Surface the items the sidebar will drop **before** dropping them.

**Files:**
- Modify: `app/(admin)/admin/settings/page.tsx`

### Step 1: Add a "Configuration" card to Settings

The existing Settings page at [app/(admin)/admin/settings/page.tsx](../../../app/(admin)/admin/settings/page.tsx) is a card-based hub. Add one new card after the existing "Platform Settings" card containing internal links to the items the sidebar will drop. Use the page's existing card pattern (`bg-white rounded-xl border border-border p-6 mb-6`).

Card title: **"Configuration"**. Icon: `Settings` from lucide (already imported).

Links inside (use a 2-column grid like other cards):

| Label | Href | Icon |
|---|---|---|
| AI Policy | `/admin/settings/ai-policy` | `Sparkles` |
| Platform Connections | `/admin/platform-connections` | `Link2` |
| Automation Rules | `/admin/automation` | `PlayCircle` |
| Team Members | `/admin/team` | `Users2` |
| Team Videos | `/admin/team-videos` | `Video` |
| Legal Documents | `/admin/legal` | `Scale` |
| Ads Settings | `/admin/ads/settings` | `Target` |

Each row: icon (size-5, `text-primary`), label (font-medium), chevron-right or arrow at far right. Hover state: subtle bg shift.

- [ ] Add new "Configuration" card after Platform Settings card in `app/(admin)/admin/settings/page.tsx`
- [ ] Confirm every linked route returns 200 by visiting each in the running dev server
- [ ] `npm run lint` and `npm run format:check` clean
- [ ] Commit: `feat(admin): add Configuration card to Settings hub`

**Phase 1 deliverable:** Every item the sidebar is about to drop is discoverable from `/admin/settings`. Even if a user updates `AdminSidebar.tsx` before clearing browser cache, the Settings page already has the new entries.

---

## Phase 2: Shared admin-nav module

The architectural change. Eliminates the existing drift between [AdminSidebar.tsx](../../../components/admin/AdminSidebar.tsx) and [AdminMobileSidebar.tsx](../../../components/admin/AdminMobileSidebar.tsx) (different item sets today — `Testimonials` and `Strategy` exist on desktop but not mobile, for example).

**Files:**
- Create: `components/admin/admin-nav.ts`
- Create: `__tests__/components/admin/admin-nav.test.ts`

### Step 1: Define the data module

Create `components/admin/admin-nav.ts`:

```ts
import {
  LayoutDashboard,
  Bot,
  Users,
  Dumbbell,
  ClipboardList,
  FileText,
  Mail,
  CreditCard,
  BarChart3,
  Brain,
  CalendarDays,
  Sparkles,
  Lightbulb,
  Star,
  MessageSquareQuote,
  Video,
  ClipboardCheck,
  CalendarCheck,
  Inbox,
  ShoppingBag,
  Package,
  Megaphone,
  Film,
  TrendingUp,
  Layers,
  Target,
  LineChart,
  Search,
  Workflow,
  Compass,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export interface AdminNav {
  topLinks: NavItem[]            // Dashboard, Inbox — rendered above all groups, no group wrapper
  groupedSections: NavSection[]  // Coaching, Marketing, Ads, AI, Business — collapsible
  standaloneLinks: NavItem[]     // Strategy — rendered after groups, no group wrapper
}

export function getAdminNav(opts: { contentStudioEnabled: boolean }): AdminNav {
  const marketingItems: NavItem[] = opts.contentStudioEnabled
    ? [
        { label: "Blog", href: "/admin/blog", icon: FileText },
        { label: "Newsletter", href: "/admin/newsletter", icon: Mail },
        { label: "Testimonials", href: "/admin/testimonials", icon: MessageSquareQuote },
        { label: "Content Studio", href: "/admin/content", icon: Layers },
        { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
        { label: "SEO Console", href: "/admin/integrations/gsc", icon: Search },
        { label: "SEO Memos", href: "/admin/seo-agent/memos", icon: Workflow },
      ]
    : [
        { label: "Blog", href: "/admin/blog", icon: FileText },
        { label: "Newsletter", href: "/admin/newsletter", icon: Mail },
        { label: "Testimonials", href: "/admin/testimonials", icon: MessageSquareQuote },
        { label: "Social", href: "/admin/social", icon: Megaphone },
        { label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
        { label: "Videos", href: "/admin/videos", icon: Film },
        { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
        { label: "SEO Console", href: "/admin/integrations/gsc", icon: Search },
        { label: "SEO Memos", href: "/admin/seo-agent/memos", icon: Workflow },
      ]

  return {
    topLinks: [
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Inbox", href: "/admin/inbox", icon: Inbox },
    ],
    groupedSections: [
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
        title: "Marketing",
        items: marketingItems,
      },
      {
        title: "Ads",
        items: [
          { label: "Overview", href: "/admin/ads", icon: Target },
          { label: "Campaigns", href: "/admin/ads/campaigns", icon: BarChart3 },
          { label: "Pipeline", href: "/admin/ads/pipeline", icon: Layers },
          { label: "AI Agent", href: "/admin/ads/agent", icon: Sparkles }, // de-dup: was Bot, conflicted with AI Assistant
          { label: "Recommendations", href: "/admin/ads/recommendations", icon: Lightbulb },
        ],
      },
      {
        title: "AI",
        items: [
          { label: "Assistant", href: "/admin/ai-assistant", icon: Bot },
          { label: "Insights", href: "/admin/ai-insights", icon: Lightbulb },
          { label: "Templates", href: "/admin/ai-templates", icon: FileText },
          { label: "Usage", href: "/admin/ai-usage", icon: Brain },
        ],
      },
      {
        title: "Business",
        items: [
          { label: "Bookings", href: "/admin/bookings", icon: CalendarCheck },
          { label: "Events", href: "/admin/events", icon: CalendarDays },
          { label: "Payments", href: "/admin/payments", icon: CreditCard },
          { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
          { label: "Reviews", href: "/admin/reviews", icon: Star },
          { label: "Shop Products", href: "/admin/shop/products", icon: ShoppingBag },
          { label: "Shop Orders", href: "/admin/shop/orders", icon: Package },
        ],
      },
    ],
    standaloneLinks: [
      { label: "Strategy", href: "/admin/strategy", icon: Compass },
    ],
  }
}

/** Flattened href list — used by both sidebars to compute the active link. */
export function getAllHrefs(nav: AdminNav): string[] {
  return [
    ...nav.topLinks.map((l) => l.href),
    ...nav.groupedSections.flatMap((s) => s.items.map((i) => i.href)),
    ...nav.standaloneLinks.map((l) => l.href),
    "/admin/settings",
  ]
}
```

### Step 2: Write the failing test first (TDD)

Create `__tests__/components/admin/admin-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { getAdminNav, getAllHrefs } from "@/components/admin/admin-nav"

describe("getAdminNav", () => {
  it("returns the expected top-link count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.topLinks).toHaveLength(2) // Dashboard, Inbox
  })

  it("returns the expected grouped-section count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.groupedSections).toHaveLength(5) // Coaching, Marketing, Ads, AI, Business
  })

  it("has no empty sections", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    for (const section of nav.groupedSections) {
      expect(section.items.length).toBeGreaterThan(0)
    }
  })

  it("has no duplicate hrefs across the entire nav", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    const hrefs = getAllHrefs(nav)
    const unique = new Set(hrefs)
    expect(unique.size).toBe(hrefs.length)
  })

  it("swaps Marketing items when contentStudioEnabled=true", () => {
    const off = getAdminNav({ contentStudioEnabled: false })
    const on = getAdminNav({ contentStudioEnabled: true })
    const marketingOff = off.groupedSections.find((s) => s.title === "Marketing")
    const marketingOn = on.groupedSections.find((s) => s.title === "Marketing")
    expect(marketingOff?.items.some((i) => i.label === "Social")).toBe(true)
    expect(marketingOn?.items.some((i) => i.label === "Content Studio")).toBe(true)
    expect(marketingOn?.items.some((i) => i.label === "Social")).toBe(false)
  })

  it("includes Settings in the flattened hrefs", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(getAllHrefs(nav)).toContain("/admin/settings")
  })
})
```

- [ ] Run `npm run test:run __tests__/components/admin/admin-nav.test.ts` — tests fail (module doesn't exist)
- [ ] Create `components/admin/admin-nav.ts` with the module above
- [ ] Run tests — pass
- [ ] `npm run lint`
- [ ] Commit: `feat(admin): add shared admin-nav module`

---

## Phase 3: Desktop sidebar rewrite

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

### Step 1: Replace the inline section list with the shared module

Delete the existing `getNavSections()` function and the `NavItem` / `NavSection` interfaces. Import from the new module instead:

```ts
import { getAdminNav, getAllHrefs, type NavItem, type NavSection } from "./admin-nav"
```

### Step 2: Split rendering into top-links / grouped-sections / standalone-links

Inside the component, after `const nav = getAdminNav({ contentStudioEnabled })`, replace the single `navSections.map(...)` block with three rendering passes in order:

1. **`nav.topLinks.map(...)`** — render each as a bare `<Link>` using the same row styling as section items. No section header, no chevron.
2. **`nav.groupedSections.map(...)`** — the existing collapsible-section JSX, unchanged structurally.
3. **`nav.standaloneLinks.map(...)`** — same bare-link style as topLinks. Render after the grouped block.

Insert a `border-t border-white/10 my-2` divider between the standalone links and the bottom Settings/Logout block to visually separate "operational" from "admin."

### Step 3: Active-section-only default-collapse

Replace the existing `initialOpen` block ([AdminSidebar.tsx:201-209](../../../components/admin/AdminSidebar.tsx#L201-L209)) with:

```ts
const allHrefs = getAllHrefs(nav)
const activeHref = findActiveHref(pathname, allHrefs)

const initialOpen = nav.groupedSections.reduce(
  (acc, section) => {
    acc[section.title] = section.items.some((i) => i.href === activeHref)
    return acc
  },
  {} as Record<string, boolean>,
)
```

### Step 4: `localStorage` persistence

Add a `useEffect` that hydrates from `localStorage` after first paint, and a wrapped `toggleSection` that writes through:

```ts
const STORAGE_KEY = "djp:admin-sidebar:open-sections"

useEffect(() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const stored = JSON.parse(raw) as Record<string, boolean>
    const validTitles = new Set(nav.groupedSections.map((s) => s.title))
    const filtered = Object.fromEntries(
      Object.entries(stored).filter(([k]) => validTitles.has(k)),
    )
    setOpenSections((prev) => ({ ...prev, ...filtered }))
  } catch {
    // localStorage unavailable (private mode) — fall back to active-only default
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])

function toggleSection(title: string) {
  setOpenSections((prev) => {
    const next = { ...prev, [title]: !prev[title] }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
    return next
  })
}
```

### Step 5: Accessibility attributes

On each section toggle `<button>`:
- Add `aria-expanded={isOpen}`
- Add `aria-controls={`section-${section.title}`}` and the matching `id` on the section's content `<div>`

On each `<Link>`:
- Add `aria-current={isActive ? "page" : undefined}`

### Step 6: Test

- [ ] `npm run dev` (port 3050)
- [ ] Visit `/admin/dashboard` — only Dashboard top-link highlighted; no group open
- [ ] Visit `/admin/clients` — Coaching group auto-expanded, Clients highlighted
- [ ] Visit `/admin/blog` — Marketing group auto-expanded, Blog highlighted
- [ ] Visit `/admin/ads/campaigns` — Ads group auto-expanded, Campaigns highlighted
- [ ] Toggle a section closed → reload → confirm section stays closed (localStorage)
- [ ] Open dev tools → `localStorage.removeItem('djp:admin-sidebar:open-sections')` → reload → confirm reset to active-only default
- [ ] Tab through with keyboard; check section button announces aria-expanded
- [ ] `npm run lint` and `npm run format:check`
- [ ] Commit: `feat(admin): restructure desktop sidebar — 6 groups + active-only default-collapse`

---

## Phase 4: Mobile sidebar rewrite

**Files:**
- Modify: `components/admin/AdminMobileSidebar.tsx`

The mobile drawer doesn't collapse sections (it's a one-time drawer view), so it's a simpler rewrite. It just renders the same data graph in three blocks.

### Step 1: Import and consume `getAdminNav`

Delete the inline `navSections` constant at [AdminMobileSidebar.tsx:69-138](../../../components/admin/AdminMobileSidebar.tsx#L69-L138). Replace with:

```ts
import { getAdminNav, getAllHrefs, type NavItem } from "./admin-nav"
```

Add a `contentStudioEnabled?: boolean` prop to `AdminMobileSidebarProps`. Wire it through from the parent admin layout (same parent that already passes the flag to `AdminSidebar`).

### Step 2: Render the three blocks

Inside the `<nav>`, render in order:

```tsx
{/* Top links */}
<div className="space-y-0.5">
  {nav.topLinks.map((item) => <SidebarLink key={item.href} item={item} ... />)}
</div>

{/* Grouped sections */}
{nav.groupedSections.map((section) => (
  <div key={section.title}>
    <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
      {section.title}
    </p>
    <div className="space-y-0.5">
      {section.items.map((item) => <SidebarLink key={item.href} item={item} ... />)}
    </div>
  </div>
))}

{/* Standalone links */}
<div className="space-y-0.5">
  {nav.standaloneLinks.map((item) => <SidebarLink key={item.href} item={item} ... />)}
</div>
```

Extracting `SidebarLink` as a local component eliminates the triple JSX duplication.

### Step 3: Test

- [ ] In dev, resize browser to mobile width or use device toolbar
- [ ] Open the drawer — confirm: Dashboard, Inbox at top → 5 group sections → Strategy → Settings/Logout
- [ ] Tap each section item — confirm route works and drawer closes (existing `onClose` behavior)
- [ ] `npm run lint`
- [ ] Commit: `feat(admin): restructure mobile sidebar to match desktop`

---

## Phase 5: End-to-end verification

**No code changes — manual smoke pass.**

- [ ] `npm run test:run` — all tests pass (admin-nav module + any incidentally affected tests)
- [ ] `npm run build` — clean build, no TypeScript errors
- [ ] Click every link in the desktop sidebar — confirm 200 + correct active highlighting
- [ ] Click every link in the mobile sidebar — confirm parity with desktop
- [ ] From the Settings page, click every Configuration card link — confirm 200
- [ ] Visit a deep route the sidebar dropped from the top level (e.g. `/admin/team-videos`) — confirm bottom Settings link highlights via longest-prefix match (existing behavior)
- [ ] Test with `contentStudioEnabled=true` (whatever flag/env triggers this in current setup) — confirm Marketing group swaps Social/Calendar/Videos for Content Studio
- [ ] Keyboard nav: Tab order is materially shorter than before (was 43 stops, should be ~12 with all groups collapsed)
- [ ] Commit any minor follow-up fixes: `fix(admin): <whatever surfaced>`

---

## Rollback plan

If something breaks badly post-deploy:

1. **Quick rollback:** `git revert` the three sidebar-restructure commits (Phase 2, 3, 4). The Phase 1 Settings additions can stay — they're purely additive and harmless.
2. **Targeted rollback:** Revert only Phase 3 (desktop) or Phase 4 (mobile) independently — they're isolated.

Risk profile: **low**. No data changes, no API changes, no route changes. Worst case is a UI regression on one nav surface.

---

## Out-of-scope follow-ups (separate plans if approved)

- **⌘K command palette** — the long-term answer to "I can't find X." Spec separately.
- **Ads sub-tab consolidation** — Conversions, Audiences, GA4 Overview, Automation Log become tabs inside `/admin/ads/campaigns`. The sidebar will then auto-pick up the correct active state for those deep links without needing to list them.
- **Pin/favorite custom shortcuts** — let users pin any route to a top "Pinned" section.
- **Inbox notification badge** — natural follow-up given Inbox's promotion to top-level.
- **`prefers-reduced-motion` support** on the section collapse animation.
