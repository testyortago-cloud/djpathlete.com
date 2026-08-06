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
  MessageCircle,
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
  Search,
  Workflow,
  Compass,
  Users2,
  Activity,
  HelpCircle,
  UserSquare,
  GraduationCap,
  Ticket,
  CalendarClock,
  Repeat,
  Ban,
  BookOpen,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { canAccessPath, type PermissionActor } from "@/lib/permissions/registry"

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface NavSection {
  title: string
  items: NavItem[]
  /** When true, the section is always expanded and renders no toggle. */
  pinned?: boolean
}

export interface AdminNav {
  topLinks: NavItem[]
  groupedSections: NavSection[]
  standaloneLinks: NavItem[]
}

export function getAdminNav(opts: { contentStudioEnabled: boolean; actor?: PermissionActor | null }): AdminNav {
  const marketingItems: NavItem[] = opts.contentStudioEnabled
    ? [
        { label: "Blog", href: "/admin/blog", icon: FileText },
        { label: "Newsletter", href: "/admin/newsletter", icon: Mail },
        { label: "Testimonials", href: "/admin/testimonials", icon: MessageSquareQuote },
        { label: "Content Studio", href: "/admin/content", icon: Layers },
        { label: "Team Media", href: "/admin/team-media", icon: Video },
        { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
        { label: "Products", href: "/admin/marketing/products", icon: Package },
        { label: "SEO Console", href: "/admin/integrations/gsc", icon: Search },
        { label: "SEO Memos", href: "/admin/seo-agent/memos", icon: Workflow },
        { label: "Editor Invites", href: "/admin/team", icon: Users2 },
      ]
    : [
        { label: "Blog", href: "/admin/blog", icon: FileText },
        { label: "Newsletter", href: "/admin/newsletter", icon: Mail },
        { label: "Testimonials", href: "/admin/testimonials", icon: MessageSquareQuote },
        { label: "Social", href: "/admin/social", icon: Megaphone },
        { label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
        { label: "Videos", href: "/admin/videos", icon: Film },
        { label: "Team Media", href: "/admin/team-media", icon: Video },
        { label: "Topic Suggestions", href: "/admin/topic-suggestions", icon: TrendingUp },
        { label: "Products", href: "/admin/marketing/products", icon: Package },
        { label: "SEO Console", href: "/admin/integrations/gsc", icon: Search },
        { label: "SEO Memos", href: "/admin/seo-agent/memos", icon: Workflow },
        { label: "Editor Invites", href: "/admin/team", icon: Users2 },
      ]

  // FAQs + per-page CMS tools live in their own "Edit page" group so the
  // boss can find the page-content editors without scrolling past the
  // marketing pipeline tools.
  const editPageItems: NavItem[] = [
    { label: "FAQs", href: "/admin/marketing/faqs", icon: HelpCircle },
    { label: "About page", href: "/admin/marketing/about", icon: UserSquare },
    { label: "Athletes page", href: "/admin/marketing/athletes", icon: Users },
    { label: "Step Up packages", href: "/admin/marketing/step-up", icon: GraduationCap },
  ]

  const nav: AdminNav = {
    topLinks: [
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Inbox", href: "/admin/inbox", icon: Inbox },
      // Distinct from Inbox, which is lead inquiries. This is client chat.
      { label: "Messages", href: "/admin/messages", icon: MessageCircle },
    ],
    groupedSections: [
      {
        title: "Coaching",
        pinned: true,
        items: [
          { label: "Clients", href: "/admin/clients", icon: Users },
          { label: "Schedule", href: "/admin/schedule", icon: CalendarClock },
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
        title: "Edit page",
        items: editPageItems,
      },
      {
        title: "Ads",
        items: [
          { label: "Overview", href: "/admin/ads", icon: Target },
          { label: "Campaigns", href: "/admin/ads/campaigns", icon: BarChart3 },
          { label: "Pipeline", href: "/admin/ads/pipeline", icon: Layers },
          { label: "AI Agent", href: "/admin/ads/agent", icon: Sparkles },
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
          { label: "Accounting", href: "/admin/books", icon: BookOpen },
          { label: "Session Packs", href: "/admin/session-packs/products", icon: Ticket },
          { label: "Memberships", href: "/admin/memberships/plans", icon: Repeat },
          { label: "Session Fees", href: "/admin/sessions/fees", icon: Ban },
          { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
          { label: "Audit Logs", href: "/admin/audit-logs", icon: Activity },
          { label: "Reviews", href: "/admin/reviews", icon: Star },
          { label: "Shop Products", href: "/admin/shop/products", icon: ShoppingBag },
          { label: "Shop Orders", href: "/admin/shop/orders", icon: Package },
        ],
      },
    ],
    standaloneLinks: [
      { label: "Strategy", href: "/admin/strategy", icon: Compass },
      { label: "How-to Guide", href: "/admin/guide", icon: BookOpen },
    ],
  }

  return opts.actor ? filterNavForActor(nav, opts.actor) : nav
}

/**
 * Drop links the actor cannot open, and any section left empty as a result.
 * Reads the same registry as the gate, so a link that is visible always works
 * — a nav item that bounces you reads as a bug, not as a permission boundary.
 */
export function filterNavForActor(nav: AdminNav, actor: PermissionActor): AdminNav {
  if (actor.role === "admin") return nav

  const allowed = (item: NavItem) => canAccessPath(actor, item.href, "GET")

  return {
    topLinks: nav.topLinks.filter(allowed),
    groupedSections: nav.groupedSections
      .map((section) => ({ ...section, items: section.items.filter(allowed) }))
      .filter((section) => section.items.length > 0),
    standaloneLinks: nav.standaloneLinks.filter(allowed),
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

/** Longest-prefix active-href resolution. Prevents parent + child both highlighting. */
export function findActiveHref(pathname: string, candidates: string[]): string | null {
  let best: string | null = null
  for (const href of candidates) {
    if (pathname !== href && !pathname.startsWith(href + "/")) continue
    if (best === null || href.length > best.length) best = href
  }
  return best
}
