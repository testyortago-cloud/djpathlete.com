import { SPORTS } from "@/lib/data/sports"
import { ATHLETES } from "@/lib/data/athletes"

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

export const STATIC_FAQ_PAGES: FaqPage[] = [
  {
    key: "faq",
    label: "FAQ page",
    routePath: "/faq",
    group: "Static",
    supportsCategories: true,
    contextSummary:
      "The central FAQ page for DJP Athlete — sports performance coaching by Darren J Paul, PhD in Zephyrhills, FL. Covers the brand, online and in-person coaching, return-to-performance assessment, pricing, youth athletes, and how coaching compares to apps.",
  },
  {
    key: "online",
    label: "Online Coaching",
    routePath: "/online",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "The online sports performance coaching page — application-only, diagnostic-driven remote programming with weekly video review and load monitoring.",
  },
  {
    key: "in-person",
    label: "In-Person Coaching",
    routePath: "/in-person",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "In-person sports performance training at the Zephyrhills, FL facility in the Tampa Bay area — assessment-led, coach-led sessions.",
  },
  {
    key: "assessment",
    label: "Assessment",
    routePath: "/assessment",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "Return-to-performance assessment — criterion-based testing that bridges medical clearance and competition readiness for athletes returning from injury.",
  },
  {
    key: "services/online-vs-in-person",
    label: "Online vs In-Person",
    routePath: "/services/online-vs-in-person",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "Comparison page for online versus in-person sports performance coaching — same methodology, different delivery.",
  },
  {
    key: "services/coaching-vs-training-app",
    label: "Coaching vs Training App",
    routePath: "/services/coaching-vs-training-app",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "Comparison page positioning supervised sports performance coaching against self-service training apps.",
  },
  {
    key: "programs/rotational-reboot",
    label: "Rotational Reboot",
    routePath: "/programs/rotational-reboot",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "The Rotational Reboot program — for athletes in rotational sports (tennis, golf, baseball, lacrosse).",
  },
]

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
