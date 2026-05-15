# Admin Sidebar Restructure — Design Spec

**Date:** 2026-05-15
**Author:** Claude (Opus 4.7) with tayawaaean
**Status:** Draft — awaiting approval
**Related:** [components/admin/AdminSidebar.tsx](../../../components/admin/AdminSidebar.tsx), [components/admin/AdminMobileSidebar.tsx](../../../components/admin/AdminMobileSidebar.tsx)

## Problem

The admin sidebar at [AdminSidebar.tsx](../../../components/admin/AdminSidebar.tsx) currently surfaces **13 top-level collapsible sections containing ~43 individual links**. Concrete UX defects:

1. **Cognitive overload.** 13 groups exceeds the ~7±2 working-memory ceiling. Scanning the list to find a destination is slow.
2. **Four "ghost" sections with one item each.** `Strategy`, `Team Videos`, `Team`, `Legal` each render a collapsible header + chevron for a single child link. Pure chrome with no organizational value. ([AdminSidebar.tsx:141-188](../../../components/admin/AdminSidebar.tsx#L141-L188))
3. **Three overlapping "AI-flavored" buckets.** `AI Tools`, `AI Automation`, and `SEO Agent` all read as "AI stuff." Users hunting for an AI feature must guess between three sections.
4. **Content / AI Automation mental-model collision.** `Content` (Blog, Testimonials, Newsletter) and `AI Automation` (Social, Videos, Calendar, Topic Suggestions) are both "things I publish" but live in separate sections governed by different mental models (content-type vs capability).
5. **`Ads` is a 10-item mini-app inside the sidebar.** Conversions, Audiences, GA4 Overview, Automation Log, and Settings are sub-views of Campaigns, but render as siblings.
6. **Naming collisions.** "Video" appears in three sections with three different meanings: `Form Reviews` (coaching), `Videos` (AI Automation short-form), `Team Videos` (about-page content). `Team` (people) sits next to `Team Videos` (content) creating visual confusion.
7. **No priority signal.** Daily-use destinations (`Dashboard`, `Inbox`, `Clients`) get the same visual weight as yearly-use (`Legal`).
8. **All sections open by default.** Landing on `/admin/dashboard` paints the full firehose; no progressive disclosure. ([AdminSidebar.tsx:201-209](../../../components/admin/AdminSidebar.tsx#L201-L209))
9. **Inconsistent taxonomy.** Sections are simultaneously grouped by capability (`AI Tools`), channel (`Ads`), content type (`Content`), and department (`Team`). No single mental model.

This spec restructures the sidebar to **6 grouped sections + 3 top-level links + Settings/Logout**, with progressive-disclosure defaults, while preserving every existing route. Zero route deletions, zero data migrations.

## Non-goals

- **Command palette (⌘K) / sidebar search.** Acknowledged as the *correct* long-term answer for "I can't find X," but out of scope for this restructure. Spec'd separately if approved.
- **Route consolidation or deletion.** Every existing `/admin/*` route remains reachable. Sub-tab consolidation (e.g. Ads sub-pages becoming tabs in `/admin/ads/campaigns`) is **noted but deferred** — the sidebar restructure does not require it, and conflating them risks scope creep.
- **Visual redesign.** Same colors, same typography, same icon library. Only the **information architecture** and a small number of interaction defaults change.
- **Permissions / role-based filtering.** Out of scope; current behavior preserved.
- **Client-side sidebar.** Only the admin sidebar changes. `(client)/` navigation is untouched.

## Target structure

```
┌──────────────────────────────────────┐
│ ─ Dashboard         [top-level, no group]
│ ─ Inbox             [top-level, no group — hoisted from Business]
│
│ ▾ COACHING
│    Clients
│    Programs
│    Exercises
│    Form Reviews
│    Assessments
│
│ ▾ MARKETING         [merges Content + AI Automation + SEO Agent]
│    Blog
│    Newsletter
│    Testimonials
│    Social
│    Calendar
│    Videos
│    Topic Suggestions
│    SEO Console       → /admin/integrations/gsc
│    SEO Memos         → /admin/seo-agent/memos
│
│ ▾ ADS                [10 → 5 visible; rest stay reachable as deep links]
│    Overview          → /admin/ads
│    Campaigns         → /admin/ads/campaigns
│    Pipeline          → /admin/ads/pipeline
│    AI Agent          → /admin/ads/agent
│    Recommendations   → /admin/ads/recommendations
│
│ ▾ AI                 [consolidates AI Tools, minus AI Policy]
│    Assistant
│    Insights
│    Templates
│    Usage
│
│ ▾ BUSINESS
│    Bookings
│    Events
│    Payments
│    Analytics
│    Reviews
│    Shop Products
│    Shop Orders
│
│ ─ Strategy           [top-level link, single page — no group wrapper]
│
│ ───────────────────  [thin divider]
│
│ ⚙ Settings (bottom)  ← Settings now hosts:
│                         · AI Policy
│                         · Platform Connections
│                         · Automation (rules engine)
│                         · Team (members + invites)
│                         · Team Videos (about-page content)
│                         · Legal Documents
│                         · Ads Settings → /admin/ads/settings
│                         · Conversions / Audiences / GA4 / Automation Log
│                           (these are already child routes of Ads; sidebar
│                           just stops listing them — Campaigns page links to them)
│ ⏻ Logout
└──────────────────────────────────────┘
```

**Result:** 13 sections → 6 grouped + 3 standalone. ~43 visible items → **~28 visible** (the rest remain reachable as Settings entries or via in-page navigation on Ads / SEO / Marketing pages).

## Route mapping (old → new home)

| Current section | Current item | New location |
|---|---|---|
| (top) | Dashboard | (top, unchanged) |
| Coaching | Clients · Programs · Exercises · Form Reviews · Assessments | Coaching (unchanged) |
| Content | Blog · Newsletter · Testimonials | **Marketing** |
| AI Tools | AI Assistant · AI Usage · AI Insights · AI Templates | **AI** |
| AI Tools | AI Policy | **Settings → AI Policy** |
| AI Automation | Social · Calendar · Videos · Topic Suggestions | **Marketing** |
| AI Automation | Platform Connections · Automation | **Settings** |
| AI Automation (Content Studio variant) | Content Studio | **Marketing** (replaces Social/Calendar/Videos when `contentStudioEnabled=true`) |
| SEO Agent | Search Console · Agent Memos | **Marketing → SEO Console / SEO Memos** |
| Strategy | Strategy | **Top-level link** (no group wrapper) |
| Business | Inbox | **Top-level link** (hoisted; daily-use) |
| Business | Bookings · Events · Payments · Analytics · Reviews | Business (unchanged) |
| Ads | Google Ads (Overview) · AI Agent · Campaigns · Pipeline · Recommendations | Ads (5 retained) |
| Ads | Conversions · Audiences · GA4 Overview · Automation Log | **In-page nav inside Campaigns** (sidebar drops them) |
| Ads | Settings | **Settings → Ads Settings** |
| Shop | Products · Orders | **Business → Shop Products / Shop Orders** |
| Team Videos | Team Videos | **Settings → Team Videos** |
| Team | Team | **Settings → Team** |
| Legal | Legal Documents | **Settings → Legal** |

**No route renames. No 301s required.** Every link continues to point at the same `/admin/*` path it points at today.

## Interaction behavior changes

### 1. Default-collapse all groups except the active one

Currently every section opens by default at [AdminSidebar.tsx:201-209](../../../components/admin/AdminSidebar.tsx#L201-L209). Change: on first render, only the section containing `activeHref` is open; everything else is collapsed.

```ts
const initialOpen = navSections.reduce(
  (acc, section) => {
    if (!section.title) return acc
    const hasActiveChild = section.items.some(i => i.href === activeHref)
    acc[section.title] = hasActiveChild
    return acc
  },
  {} as Record<string, boolean>,
)
```

### 2. Persist open/closed state in `localStorage`

Key: `djp:admin-sidebar:open-sections` → `Record<string, boolean>`. Hydrate from storage on mount; write on every toggle. If a stored section title no longer exists in the current `navSections`, drop it on hydration to prevent stale entries accumulating.

SSR/hydration: read inside a `useEffect` after first paint to avoid hydration mismatch. First server render uses the active-section-only default; client effect then merges any persisted overrides.

### 3. Visual divider between operational and admin

Insert a thin `border-t border-white/10` separator between the **Strategy** top-level link and the **Settings** bottom block. Communicates "above = run the business, below = configure the business."

### 4. Icon de-duplication

The `Bot` icon currently renders twice (`AI Assistant` in AI Tools, `AI Agent` in Ads). Two identical glyphs in one sidebar invite mis-clicks. Replacements:

- `AI Assistant` → keep `Bot`
- Ads `AI Agent` → `Sparkles` (already imported) or `Wand2`

## Components changed

### [`components/admin/AdminSidebar.tsx`](../../../components/admin/AdminSidebar.tsx) (rewritten — section list + defaults)

- Replace `getNavSections(contentStudioOn)` body with the new 6-group structure.
- Update `initialOpen` to active-only (see Interaction §1).
- Add `useEffect` for `localStorage` hydration + persistence (Interaction §2).
- Drop section wrappers for single-item top-level links (Dashboard, Inbox, Strategy) — render them as bare `<Link>`s above the grouped sections. New rendering branch in the `navSections.map(...)` JSX, or pre-split the array into `topLinks` + `groupedSections`.

### [`components/admin/AdminMobileSidebar.tsx`](../../../components/admin/AdminMobileSidebar.tsx) (mirror the changes)

Mobile sidebar uses a **static section list**, not a function. After the desktop change, lift the section definitions into a shared module so both files import from one source of truth — otherwise they will drift again.

**Proposed shared module:** [`components/admin/admin-nav.ts`](../../../components/admin/admin-nav.ts) (new) exports:

```ts
export type NavItem = { label: string; href: string; icon: LucideIcon }
export type NavSection = { title: string; items: NavItem[] }
export type AdminNav = {
  topLinks: NavItem[]            // Dashboard, Inbox
  groupedSections: NavSection[]  // Coaching, Marketing, Ads, AI, Business
  standaloneLinks: NavItem[]     // Strategy
}
export function getAdminNav(opts: { contentStudioEnabled: boolean }): AdminNav
```

Both sidebars become pure renderers over this nav graph. **This is the only architectural change** — everything else is data movement and CSS-equivalent tweaks.

### [`app/(admin)/admin/settings/`](../../../app/(admin)/admin/settings/) (additions)

The Settings page becomes the home for the items removed from the sidebar. Inventory check before implementation (see Open Question §1):

- Existing: AI Policy (already lives at `/admin/settings/ai-policy`).
- **To add as Settings tabs/links:** Platform Connections, Automation, Team, Team Videos, Legal, Ads Settings.

If Settings is currently a flat single page, the spec recommends a left-rail tab layout grouping: **Account · AI · Marketing · Ads · Org · Legal**. Tab routing via existing nested `/admin/settings/<slug>` pattern.

This is the only piece of work outside the sidebar files themselves and should land **after** the sidebar restructure ships (Open Question §2 covers ordering).

## Visual hierarchy

| Element | Treatment | Rationale |
|---|---|---|
| Top links (Dashboard, Inbox) | Same row style as section items; no chevron; above all groups | Daily-use destinations get zero-click access |
| Section headers | Existing `text-[10px] uppercase tracking-[0.15em] text-white/30` | Unchanged |
| Section items | Existing `text-sm font-medium text-white/70` | Unchanged |
| Standalone Strategy link | Same as top links but visually after Business group | Single page but conceptually high-level, not admin-y |
| Settings/Logout block | Existing `border-t border-white/10` separator | Unchanged |

No new visual primitives. No font, color, or spacing changes.

## Accessibility

- Section toggle buttons remain `<button>` with `aria-expanded={isOpen}` and `aria-controls={contentId}`. Add these if missing — current implementation has neither ([AdminSidebar.tsx:252-263](../../../components/admin/AdminSidebar.tsx#L252-L263)).
- Active link gets `aria-current="page"`.
- Keyboard nav: collapsed-by-default makes Tab order shorter, which is a real win for keyboard users today blocked by 43 tab stops.
- The collapsed-state animation already uses `max-h` transitions; preserve `prefers-reduced-motion` (currently not honored — note for follow-up, not required for this spec).

## Edge cases & failure modes

1. **`contentStudioEnabled=true` variant.** The current sidebar swaps in a 4-item Content Studio list. Under the new structure, Content Studio replaces Social/Calendar/Videos inside the **Marketing** group; Topic Suggestions / Platform Connections / Automation routing stays the same. The flag still works; only the list shape changes.
2. **`localStorage` unavailable** (private browsing, SSR). Hydration effect is wrapped in `try`; fallback is the active-only default. No crash.
3. **Stored section title no longer exists** after a future restructure. Drop unknown keys during hydration.
4. **Active route under a sub-tab consolidated into Campaigns** (e.g. `/admin/ads/conversions`). The `findActiveHref` logic at [AdminSidebar.tsx:59-66](../../../components/admin/AdminSidebar.tsx#L59-L66) still matches `Campaigns` as the longest prefix because `/admin/ads/conversions` starts with `/admin/ads/campaigns`? **No it doesn't** — `/admin/ads/conversions` does *not* start with `/admin/ads/campaigns`. The active link will fall back to the parent `Ads → Overview` (`/admin/ads`). Acceptable: the user is *somewhere in Ads*, the sidebar shows Ads expanded with Overview highlighted. If we want exact highlighting of consolidated routes, that becomes part of the Ads sub-tab consolidation work (out of scope here).
5. **Deep-linking to a Settings sub-page** (e.g. `/admin/settings/ai-policy`). Bottom `Settings` link highlights via the existing `findActiveHref` longest-prefix logic. Works today, continues to work.

## Verification plan

- [ ] Visit every `/admin/*` route currently linked from either sidebar; confirm the correct sidebar section + item highlights.
- [ ] Resize to mobile width; confirm `AdminMobileSidebar` matches desktop structure.
- [ ] Toggle each collapsible section; reload; confirm state persists.
- [ ] Open in private/incognito; confirm no console errors when `localStorage` is unavailable.
- [ ] Tab through the sidebar with keyboard; confirm `aria-expanded` toggles correctly and active link announces `aria-current=page`.
- [ ] With `contentStudioEnabled=true`, confirm Marketing group swaps to the Content Studio item set.
- [ ] Confirm zero broken links (every `href` in the new nav graph returns 200, not 404).

## Open questions

1. **Settings page audit.** Does `/admin/settings` already exist as a hub page, or is it just an AI-Policy redirect? Before promising "Settings hosts the consolidated items" we should confirm. (Quick check: `app/(admin)/admin/settings/page.tsx`.)
2. **Ordering: sidebar first, or Settings hub first?** Two safe paths:
   - **(a) Sidebar first, Settings hub second.** Ship the restructure; some items (Team, Legal, etc.) become *only* reachable via direct URL until Settings hub ships. Risk: discoverability gap for a few days.
   - **(b) Settings hub first, sidebar second.** Settings hub is built and tested with all sub-pages reachable, *then* the sidebar drops them. Zero discoverability gap.
   - **Recommendation: (b).** Lower-risk, no temporary gaps.
3. **Should Strategy stay top-level or move under Business?** Currently it's a single page with the `Compass` icon, suggesting a high-level executive view. Top-level matches that intent. Confirm with user.
4. **Should `Inbox` get a notification badge?** Out of scope for this spec but a natural follow-up given its promotion to top-level.

## Out of scope (future specs)

- **⌘K command palette** for fuzzy search across all admin routes. This is the *correct* long-term answer to "I can't find X" and would let the sidebar focus on habitual navigation while the palette covers everything else.
- **Ads sub-tab consolidation** — moving Conversions/Audiences/GA4/Automation Log into a tabbed view inside `/admin/ads/campaigns`. The sidebar restructure doesn't require it; spec'd separately.
- **Pin/favorite custom shortcuts.** Allowing users to pin any route to a "Pinned" section at the top. Plausible v2.
- **Mobile bottom-nav** with the 4 most-used destinations. Plausible follow-up if mobile usage justifies it.
