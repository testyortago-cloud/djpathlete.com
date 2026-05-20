// FAQ page registry.
//
// Static marketing pages are AUTO-DERIVED from `marketing-routes.generated.ts`,
// which a build-time codegen script (scripts/generate-faq-pages.ts) regenerates
// on every build and dev start (wired via prebuild/predev in package.json).
// New marketing pages auto-appear and deleted ones auto-drop — no manual edits.
//
// Curated metadata (rich label / supportsCategories / contextSummary) for the
// pages we have hand-written copy for lives in the `CURATED` map below. Routes
// not in `CURATED` get a Title-Cased label and a generic context summary.
import { SPORTS } from "@/lib/data/sports"
import { ATHLETES } from "@/lib/data/athletes"
import { MARKETING_FAQ_ROUTES } from "./marketing-routes.generated"

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

/** Title-case the last route segment, e.g. "/services/coaching-vs-training-app" → "Coaching Vs Training App". */
function labelFromRoute(routePath: string): string {
  const lastSegment = routePath.split("/").filter(Boolean).pop() ?? ""
  return lastSegment
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Static marketing pages — derived from the auto-generated route list. */
export const STATIC_FAQ_PAGES: FaqPage[] = MARKETING_FAQ_ROUTES.map((routePath) => {
  const key = routePath.replace(/^\//, "")
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
  const label = labelFromRoute(routePath)
  return {
    key,
    label,
    routePath,
    group: "Static" as const,
    supportsCategories: false,
    contextSummary: `The ${label} page of the DJP Athlete sports performance coaching website.`,
  }
})

function sportFaqPages(): FaqPage[] {
  return SPORTS.map((s) => ({
    key: `sports/${s.slug}`,
    label: `${s.name} (sport)`,
    routePath: `/sports/${s.slug}`,
    group: "Sports" as const,
    supportsCategories: false,
    contextSummary: `${s.name} performance training page. ${s.description ?? ""}`.trim(),
  }))
}

function athleteFaqPages(): FaqPage[] {
  return ATHLETES.map((a) => ({
    key: `athletes/${a.slug}`,
    label: `${a.name} (athlete type)`,
    routePath: `/athletes/${a.slug}`,
    group: "Athletes" as const,
    supportsCategories: false,
    contextSummary: `Athlete-type page for ${a.name}. ${a.description ?? ""}`.trim(),
  }))
}

/** All non-event FAQ pages — known at build time. */
export function getStaticAndTemplatedFaqPages(): FaqPage[] {
  return [...STATIC_FAQ_PAGES, ...sportFaqPages(), ...athleteFaqPages()]
}

/** Resolve a non-event page_key to its registry entry. */
export function resolveFaqPage(key: string): FaqPage | undefined {
  return getStaticAndTemplatedFaqPages().find((p) => p.key === key)
}
