// FAQ page registry.
//
// Static FAQ pages are DERIVED from `NAV_ITEMS` (the site navigation config in
// `@/lib/constants`) — so when a nav item is added it automatically appears in
// the FAQ tool — plus an explicit `EXTRA_FAQ_ROUTES` list for non-nav pages
// that still carry FAQ content (e.g. /faq itself, comparison pages, programs).
//
// Curated metadata (rich label / supportsCategories / contextSummary) for the
// pages we have hand-written copy for lives in the `CURATED` map below. Routes
// not in `CURATED` get the nav label (if any) or a Title-Cased last segment,
// and a generic context summary.
//
// Note: per-sport (/sports/[sport]) and per-athlete-type (/athletes/[type])
// pages are NOT FAQ targets — the Sports section was removed from the site and
// the athlete pages were consolidated into a single /athletes page.
import { NAV_ITEMS } from "@/lib/constants"

export interface FaqPage {
  /** Stable key stored in faqs.page_key. */
  key: string
  /** Human label shown in the admin page picker. */
  label: string
  /** Route the page renders at — used for revalidatePath. */
  routePath: string
  /** Picker group. */
  group: "Static" | "Sports" | "Athletes" | "Events"
  /** Whether the admin may set a category (grouped rendering). Only /faq. */
  supportsCategories: boolean
  /** Short factual description used to ground the AI assist. */
  contextSummary: string
}

/** Hand-curated metadata for routes we have written rich copy for, keyed by routePath. */
const CURATED: Record<
  string,
  { label: string; supportsCategories: boolean; contextSummary: string }
> = {
  "/faq": {
    label: "FAQ page",
    supportsCategories: true,
    contextSummary:
      "The central FAQ page for DJP Athlete — sports performance coaching by Darren J Paul, PhD in Zephyrhills, FL. Covers the brand, online and in-person coaching, return-to-performance assessment, pricing, youth athletes, and how coaching compares to apps.",
  },
  "/online": {
    label: "Online Coaching",
    supportsCategories: false,
    contextSummary:
      "The online sports performance coaching page — application-only, diagnostic-driven remote programming with weekly video review and load monitoring.",
  },
  "/in-person": {
    label: "In-Person Coaching",
    supportsCategories: false,
    contextSummary:
      "In-person sports performance training at the Zephyrhills, FL facility in the Tampa Bay area — assessment-led, coach-led sessions.",
  },
  "/assessment": {
    label: "Assessment",
    supportsCategories: false,
    contextSummary:
      "Return-to-performance assessment — criterion-based testing that bridges medical clearance and competition readiness for athletes returning from injury.",
  },
  "/services/online-vs-in-person": {
    label: "Online vs In-Person",
    supportsCategories: false,
    contextSummary:
      "Comparison page for online versus in-person sports performance coaching — same methodology, different delivery.",
  },
  "/services/coaching-vs-training-app": {
    label: "Coaching vs Training App",
    supportsCategories: false,
    contextSummary:
      "Comparison page positioning supervised sports performance coaching against self-service training apps.",
  },
  "/programs/rotational-reboot": {
    label: "Rotational Reboot",
    supportsCategories: false,
    contextSummary:
      "The Rotational Reboot program — for athletes in rotational sports (tennis, golf, baseball, lacrosse).",
  },
}

/**
 * Pages that carry FAQ content but are not in the site navigation. Kept
 * explicit so the FAQ registry stays correct even though they aren't nav items.
 */
const EXTRA_FAQ_ROUTES: readonly string[] = [
  "/faq",
  "/services/online-vs-in-person",
  "/services/coaching-vs-training-app",
  "/programs/rotational-reboot",
]

/** Flatten NAV_ITEMS into a map of href -> nav label (top-level links + every child link). */
function navLinkLabels(): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of NAV_ITEMS) {
    if (item.href) map.set(item.href, item.label)
    for (const child of item.children ?? []) {
      map.set(child.href, child.label)
    }
  }
  return map
}

/** Title-case the last route segment, e.g. "/services/coaching-vs-training-app" → "Coaching Vs Training App". */
function labelFromRoute(routePath: string): string {
  const lastSegment = routePath.split("/").filter(Boolean).pop() ?? ""
  return lastSegment
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Build the static FAQ page list from nav routes ∪ extra FAQ routes. */
function buildStaticFaqPages(): FaqPage[] {
  const navLabels = navLinkLabels()
  const routes = Array.from(new Set([...navLabels.keys(), ...EXTRA_FAQ_ROUTES])).sort()

  return routes.map((routePath) => {
    const key = routePath === "/" ? "home" : routePath.replace(/^\//, "")
    const curated = CURATED[routePath]
    if (curated) {
      return {
        key,
        label: curated.label,
        routePath,
        group: "Static" as const,
        supportsCategories: curated.supportsCategories,
        contextSummary: curated.contextSummary,
      }
    }
    const label = navLabels.get(routePath) ?? (labelFromRoute(routePath) || "Home")
    return {
      key,
      label,
      routePath,
      group: "Static" as const,
      supportsCategories: false,
      contextSummary: `The ${label} page of the DJP Athlete sports performance coaching website.`,
    }
  })
}

/**
 * Static FAQ pages — derived from `NAV_ITEMS` plus `EXTRA_FAQ_ROUTES`,
 * de-duplicated and sorted by routePath.
 */
export const STATIC_FAQ_PAGES: FaqPage[] = buildStaticFaqPages()

/** All non-event FAQ pages — known at build time. */
export function getStaticAndTemplatedFaqPages(): FaqPage[] {
  return [...STATIC_FAQ_PAGES]
}

/** Resolve a non-event page_key to its registry entry. */
export function resolveFaqPage(key: string): FaqPage | undefined {
  return getStaticAndTemplatedFaqPages().find((p) => p.key === key)
}
