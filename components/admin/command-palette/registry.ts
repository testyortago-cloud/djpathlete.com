import type { LucideIcon } from "lucide-react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Download,
  FileText,
  Landmark,
  Lightbulb,
  Mail,
  Package,
  Plug,
  Scale,
  Settings,
  ShieldCheck,
  Timer,
  TrendingUp,
  Workflow,
} from "lucide-react"
import { getAdminNav, type NavItem } from "@/components/admin/admin-nav"
import { canAccessPath, type PermissionActor } from "@/lib/permissions/registry"

export interface CommandPaletteItem {
  id: string
  label: string
  href: string
  section: string
  icon: LucideIcon
  keywords: string[]
}

/**
 * Synonyms and action-verb phrases layered on top of the real sidebar labels,
 * keyed by href. This is what lets "create a client" surface the Clients
 * page even though nothing in the app is literally labelled "create client" —
 * the label alone only ever matches literal nav text.
 */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/admin/dashboard": ["home", "overview"],
  "/admin/inbox": ["leads", "new leads", "inquiries", "contact form"],
  "/admin/funnels": [
    "landing page",
    "build a landing page",
    "funnel builder",
    "page builder",
    "campaign page",
    "opt in page",
    "sales page",
    "go high level",
    "gohighlevel",
  ],
  "/admin/messages": ["client chat", "message client", "conversation", "dm"],

  "/admin/clients": [
    "create client",
    "add client",
    "new client",
    "add athlete",
    "new athlete",
    "register client",
    "onboard client",
    "roster",
    "athletes",
  ],
  "/admin/schedule": ["book session", "schedule session", "calendar", "appointments", "availability"],
  "/admin/programs": [
    "create program",
    "new program",
    "add program",
    "build program",
    "workout plan",
    "training program",
    "assign program",
    "program builder",
  ],
  "/admin/exercises": ["create exercise", "add exercise", "new exercise", "exercise library", "movement library"],
  "/admin/form-reviews": ["review form", "video review", "technique check", "upload form video"],
  "/admin/performance-assessments": [
    "new assessment",
    "create assessment",
    "add assessment",
    "performance test",
    "testing day",
    "benchmarks",
  ],

  "/admin/blog": ["write post", "new post", "add post", "create article", "blog post"],
  "/admin/newsletter": ["send newsletter", "email blast", "new newsletter", "campaign email"],
  "/admin/testimonials": ["add testimonial", "new testimonial", "client feedback", "success story", "reviews"],
  "/admin/content": ["content studio", "edit video", "clip video", "captions", "create clip"],
  "/admin/team-media": ["team video", "upload team media"],
  "/admin/topic-suggestions": ["blog ideas", "content ideas", "topic research", "what to write about"],
  "/admin/marketing/products": ["new product page", "product landing page"],
  "/admin/integrations/gsc": ["search console", "seo console", "google search console"],
  "/admin/seo-agent/memos": ["seo memo", "seo agent", "seo strategy"],
  "/admin/social": ["social media", "post scheduler", "instagram", "facebook"],
  "/admin/calendar": ["content calendar", "posting schedule"],
  "/admin/videos": ["video library"],

  "/admin/marketing/faqs": ["edit faq", "new faq", "add faq", "frequently asked questions"],
  "/admin/marketing/about": ["edit about page", "about us"],
  "/admin/marketing/athletes": ["edit athletes page"],
  "/admin/marketing/step-up": ["step up for students"],

  "/admin/ads": ["google ads overview", "ad spend"],
  "/admin/ads/campaigns": ["new campaign", "ad campaign", "create campaign"],
  "/admin/ads/pipeline": ["ads pipeline", "lead pipeline"],
  "/admin/ads/agent": ["ai ads agent"],
  "/admin/ads/recommendations": ["ad recommendations"],

  "/admin/ai-assistant": ["chat with ai", "ai chat", "ask ai"],
  "/admin/ai-insights": ["ai insights"],
  "/admin/ai-templates": ["prompt templates", "ai templates"],
  "/admin/ai-usage": ["token usage", "ai cost", "api usage"],

  "/admin/bookings": ["new booking", "book event", "event signup"],
  "/admin/events": ["new event", "create event", "add event", "camp", "clinic"],
  "/admin/payments": ["invoices", "transactions", "refund", "payment history"],
  "/admin/books": ["accounting", "bookkeeping", "ledger", "expenses", "statements", "books"],
  "/admin/session-packs/products": ["new session pack", "create session pack", "packages"],
  "/admin/memberships/plans": ["new membership", "create membership", "subscription plan"],
  "/admin/sessions/fees": ["session pricing", "fees"],
  "/admin/analytics": ["site analytics", "traffic", "ga4", "website traffic"],
  "/admin/audit-logs": ["security log", "activity log", "who did what", "audit trail"],
  "/admin/reviews": ["google reviews"],
  "/admin/shop/products": ["new shop product", "create product", "merch", "add product"],
  "/admin/shop/orders": ["view orders", "order history"],

  "/admin/team": ["invite staff", "add coach", "new team member", "permissions", "roles"],
  "/admin/strategy": ["strategy brief", "weekly brief"],
  "/admin/guide": ["help", "how to", "docs", "documentation"],
}

/**
 * Real, reachable admin pages that aren't in the sidebar tree (`admin-nav.ts`
 * intentionally keeps the visible nav short). Included here so the palette
 * covers the full app surface, not just what's pinned to the sidebar.
 */
const EXTRA_ROUTES: CommandPaletteItem[] = [
  {
    id: "/admin/insights/client-risk",
    label: "Client Risk",
    href: "/admin/insights/client-risk",
    section: "Insights",
    icon: AlertTriangle,
    keywords: ["at risk clients", "churn risk", "client engagement", "daily pulse"],
  },
  {
    id: "/admin/insights/revenue",
    label: "Revenue Digest",
    href: "/admin/insights/revenue",
    section: "Insights",
    icon: TrendingUp,
    keywords: ["mrr", "weekly revenue", "revenue snapshot", "subscriptions revenue"],
  },
  {
    id: "/admin/insights/automation-health",
    label: "Automation Health",
    href: "/admin/insights/automation-health",
    section: "Insights",
    icon: Activity,
    keywords: ["cron health", "failed jobs", "watchdog status"],
  },
  {
    id: "/admin/insights/content-revenue",
    label: "Content Revenue",
    href: "/admin/insights/content-revenue",
    section: "Insights",
    icon: BarChart3,
    keywords: ["content attribution", "blog revenue", "which post makes money"],
  },
  {
    id: "/admin/insights/inbox-sla",
    label: "Inbox SLA",
    href: "/admin/insights/inbox-sla",
    section: "Insights",
    icon: Timer,
    keywords: ["response time", "lead response", "sla report"],
  },
  {
    id: "/admin/books/accounts",
    label: "Accounts",
    href: "/admin/books/accounts",
    section: "Accounting",
    icon: Landmark,
    keywords: ["chart of accounts", "bank accounts"],
  },
  {
    id: "/admin/books/assets",
    label: "Assets",
    href: "/admin/books/assets",
    section: "Accounting",
    icon: Package,
    keywords: ["fixed assets", "depreciation"],
  },
  {
    id: "/admin/books/email-receipts",
    label: "Email Receipts",
    href: "/admin/books/email-receipts",
    section: "Accounting",
    icon: Mail,
    keywords: ["forwarded receipts", "gmail receipts", "receipt inbox"],
  },
  {
    id: "/admin/books/reports",
    label: "Accountant Reports",
    href: "/admin/books/reports",
    section: "Accounting",
    icon: FileText,
    keywords: ["qbo export", "tax pack", "print report", "accountant pack", "xlsx export"],
  },
  {
    id: "/admin/books/insights",
    label: "Bookkeeping Insights",
    href: "/admin/books/insights",
    section: "Accounting",
    icon: Lightbulb,
    keywords: ["books insights", "spending trends"],
  },
  {
    id: "/admin/books/guide",
    label: "Books Guide",
    href: "/admin/books/guide",
    section: "Accounting",
    icon: BookOpen,
    keywords: ["bookkeeping help", "how to use books"],
  },
  {
    id: "/admin/automation",
    label: "Automation",
    href: "/admin/automation",
    section: "More",
    icon: Workflow,
    keywords: ["cron jobs", "scheduled jobs", "watchdog", "system automation"],
  },
  {
    id: "/admin/settings",
    label: "Settings",
    href: "/admin/settings",
    section: "More",
    icon: Settings,
    keywords: ["account settings", "profile settings", "password", "security settings"],
  },
  {
    id: "/admin/settings/ai-policy",
    label: "AI Policy",
    href: "/admin/settings/ai-policy",
    section: "More",
    icon: ShieldCheck,
    keywords: ["ai spending limit", "ai budget", "model policy"],
  },
  {
    id: "/admin/platform-connections",
    label: "Platform Connections",
    href: "/admin/platform-connections",
    section: "More",
    icon: Plug,
    keywords: ["connect google", "connect meta", "oauth", "integrations", "link account"],
  },
  {
    id: "/admin/lead-magnets",
    label: "Lead Magnets",
    href: "/admin/lead-magnets",
    section: "More",
    icon: Download,
    keywords: ["free download", "opt in", "gated content"],
  },
  {
    id: "/admin/legal",
    label: "Legal Documents",
    href: "/admin/legal",
    section: "More",
    icon: Scale,
    keywords: ["terms of service", "privacy policy", "waiver", "legal pages"],
  },
]

function toItems(navItems: NavItem[], section: string): CommandPaletteItem[] {
  return navItems.map((item) => ({
    id: item.href,
    label: item.label,
    href: item.href,
    section,
    icon: item.icon,
    keywords: NAV_KEYWORDS[item.href] ?? [],
  }))
}

/**
 * Builds the full searchable item set for the command palette: every nav
 * item from `getAdminNav` (already permission-filtered) enriched with
 * synonyms, plus the extra reachable-but-unlisted pages, filtered the same
 * way the sidebar filters itself so the palette never suggests a page an
 * actor can't actually open.
 */
export function getCommandPaletteItems(opts: {
  contentStudioEnabled: boolean
  actor?: PermissionActor | null
}): CommandPaletteItem[] {
  const nav = getAdminNav(opts)

  const items: CommandPaletteItem[] = [
    ...toItems(nav.topLinks, "General"),
    ...nav.groupedSections.flatMap((section) => toItems(section.items, section.title)),
    ...toItems(nav.standaloneLinks, "More"),
    ...EXTRA_ROUTES.filter((item) => !opts.actor || canAccessPath(opts.actor, item.href, "GET")),
  ]

  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.href)) return false
    seen.add(item.href)
    return true
  })
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "my",
  "me",
  "please",
  "i",
  "want",
  "need",
  "go",
  "how",
  "do",
  "does",
  "can",
  "is",
  "are",
  "and",
  "or",
  "with",
])

function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** How well a single query word matches one haystack string. 0 = no match. */
function wordScore(haystack: string, word: string): number {
  if (haystack === word) return 100
  if (haystack.startsWith(word)) return 90
  if (new RegExp(`\\b${escapeRegExp(word)}`).test(haystack)) return 70
  if (haystack.includes(word)) return 45
  return 0
}

function rank(items: CommandPaletteItem[], words: string[], requireAll: boolean): CommandPaletteItem[] {
  const scored: { item: CommandPaletteItem; score: number }[] = []

  for (const item of items) {
    const label = item.label.toLowerCase()
    const haystacks = [label, item.section.toLowerCase(), ...item.keywords.map((k) => k.toLowerCase())]

    let total = 0
    let matched = 0
    for (const word of words) {
      let best = 0
      for (const h of haystacks) {
        const s = wordScore(h, word)
        best = Math.max(best, s === 0 ? 0 : s + (h === label ? 10 : 0))
      }
      if (best > 0) {
        matched++
        total += best
      } else if (requireAll) {
        matched = -1
        break
      }
    }

    if (matched > 0) scored.push({ item, score: total })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.item)
}

/**
 * Ranks items against a free-text query. Every non-filler word must match
 * something first ("create a client" -> requires "create" AND "client");
 * if that's too strict to return anything (the query used a synonym we
 * haven't curated), falls back to a looser any-word match so the palette
 * degrades gracefully instead of going blank.
 */
export function searchCommandPaletteItems(items: CommandPaletteItem[], query: string): CommandPaletteItem[] {
  const words = tokenize(query)
  if (words.length === 0) return items

  const strict = rank(items, words, true)
  if (strict.length > 0) return strict
  return rank(items, words, false)
}
