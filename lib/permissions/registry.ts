/**
 * The single source of truth for what an invited teammate can reach.
 *
 * This module is deliberately pure — no DB, no network, no `next/*` imports —
 * so the middleware, the page guards, the API guards and the sidebar all read
 * the same rules, and so the rules can be unit-tested on their own. If the
 * gate and the navigation ever disagree, a teammate sees a link that bounces
 * them, which reads as a broken app rather than as a permission boundary.
 *
 * Default-deny is the governing property: a path that appears in no rule below
 * is denied to staff. Adding a new admin surface therefore fails closed.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Access level for permissions that distinguish reading from changing. */
export type PermissionTier = "view" | "manage"

/**
 * Stored value for a single permission.
 *   - boolean permissions: `true` (granted) or absent/false (denied)
 *   - tiered permissions:  "view" | "manage", or absent (denied)
 */
export type PermissionValue = boolean | PermissionTier

export type PermissionMap = Partial<Record<PermissionKey, PermissionValue>>

export type BooleanPermissionKey =
  | "clients"
  | "programs"
  | "schedule"
  | "form_reviews"
  | "messages"
  | "blog"
  | "social"
  | "website"
  | "funnels"
  | "seo"
  | "leads"
  | "ai_tools"

/** Money surfaces — separate read and write access. */
export type TieredPermissionKey = "payments" | "accounting" | "commerce" | "ads"

/** Read-only by nature: there is nothing to "manage" on a dashboard. */
export type ViewOnlyPermissionKey = "analytics"

export type PermissionKey = BooleanPermissionKey | TieredPermissionKey | ViewOnlyPermissionKey

export type PermissionGroup = "coaching" | "marketing" | "money" | "tools"

export interface PermissionDef {
  key: PermissionKey
  label: string
  /** Shown under the checkbox on the invite screen. */
  description: string
  group: PermissionGroup
  kind: "boolean" | "tiered" | "view_only"
}

/**
 * Which door a teammate comes through.
 *
 * These are not two separate kinds of person to keep in sync — `editor` is
 * simply what a teammate is when their permission map grants nothing, so the
 * admin panel has nothing to show them and the /editor portal is all that is
 * left. See `roleForPermissions`, which is the only place the choice is made.
 */
export type TeamRole = "staff" | "editor"

/** Roles that represent someone who works for the owner, as opposed to a client. */
export const TEAM_ROLES: readonly TeamRole[] = ["staff", "editor"]

export function isTeamRole(role: string | null | undefined): role is TeamRole {
  return TEAM_ROLES.includes(role as TeamRole)
}

/** The actor shape the guards need. Kept minimal so a session, a JWT or a DB row all fit. */
export interface PermissionActor {
  role: string
  permissions?: PermissionMap | null
  /** Required only for client scoping, which has to look up assignments by user. */
  id?: string
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
  coaching: "Coaching",
  marketing: "Marketing",
  money: "Money",
  tools: "Tools",
}

export const PERMISSIONS: readonly PermissionDef[] = [
  // -- Coaching --------------------------------------------------------------
  {
    key: "clients",
    label: "Clients",
    description: "Client roster and profiles. Limited to the clients you assign them.",
    group: "coaching",
    kind: "boolean",
  },
  {
    key: "programs",
    label: "Programs & Exercises",
    description: "Build programs, generate weeks, edit the exercise library.",
    group: "coaching",
    kind: "boolean",
  },
  {
    key: "schedule",
    label: "Schedule & Bookings",
    description: "Calendar, sessions, check-ins and bookings.",
    group: "coaching",
    kind: "boolean",
  },
  {
    key: "form_reviews",
    label: "Form Reviews & Assessments",
    description: "Video form reviews, performance assessments and test reports.",
    group: "coaching",
    kind: "boolean",
  },
  {
    key: "messages",
    label: "Client Messages",
    description: "The coach-to-client chat.",
    group: "coaching",
    kind: "boolean",
  },

  // -- Marketing -------------------------------------------------------------
  {
    key: "blog",
    label: "Blog & Newsletter",
    description: "Blog posts, newsletter, testimonials, topic suggestions and reviews.",
    group: "marketing",
    kind: "boolean",
  },
  {
    key: "social",
    label: "Social & Content",
    description: "Social scheduling, Content Studio, videos and team media.",
    group: "marketing",
    kind: "boolean",
  },
  {
    key: "website",
    label: "Website Pages",
    description: "FAQs, About, Athletes, Step Up, legal pages and lead magnets.",
    group: "marketing",
    kind: "boolean",
  },
  {
    key: "funnels",
    label: "Funnel Builder",
    description: "Builds and publishes campaign landing pages, and reads their submissions.",
    group: "marketing",
    kind: "boolean",
  },
  {
    key: "seo",
    label: "SEO & Strategy",
    description: "Search Console, SEO memos and the strategy briefs.",
    group: "marketing",
    kind: "boolean",
  },
  {
    key: "leads",
    label: "Leads Inbox",
    description: "Inquiries from the website. Separate from client messages.",
    group: "marketing",
    kind: "boolean",
  },

  // -- Money -----------------------------------------------------------------
  {
    key: "payments",
    label: "Payments",
    description: "View sees transactions. Manage can refund and change status.",
    group: "money",
    kind: "tiered",
  },
  {
    key: "accounting",
    label: "Accounting",
    description: "View sees the books. Manage can import, categorize, post and close.",
    group: "money",
    kind: "tiered",
  },
  {
    key: "commerce",
    label: "Shop, Packs & Memberships",
    description: "View sees products and orders. Manage can set prices and fulfil.",
    group: "money",
    kind: "tiered",
  },
  {
    key: "ads",
    label: "Ads",
    description: "View sees spend and performance. Manage can change budgets and launch.",
    group: "money",
    kind: "tiered",
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Traffic, revenue and engagement dashboards. Read-only.",
    group: "money",
    kind: "view_only",
  },

  // -- Tools -----------------------------------------------------------------
  {
    key: "ai_tools",
    label: "AI Tools",
    description: "AI assistant, insights and templates. Uses paid API credit.",
    group: "tools",
    kind: "boolean",
  },
] as const

const PERMISSION_BY_KEY = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.key, p]))

export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_BY_KEY.has(key)
}

export function getPermissionDef(key: PermissionKey): PermissionDef {
  const def = PERMISSION_BY_KEY.get(key)
  // Unreachable for a PermissionKey, but keeps callers total.
  if (!def) throw new Error(`Unknown permission: ${key}`)
  return def
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface PresetDef {
  key: string
  label: string
  description: string
  /** Empty for the editor preset, which creates a portal user rather than staff. */
  permissions: PermissionMap
  /** `editor` creates a /editor portal user; `staff` creates an admin-panel user. */
  invitedRole: "staff" | "editor"
}

export const PRESETS: readonly PresetDef[] = [
  {
    key: "coach",
    label: "Coach",
    description: "Trains clients. No access to money or marketing.",
    invitedRole: "staff",
    permissions: {
      clients: true,
      programs: true,
      schedule: true,
      form_reviews: true,
      messages: true,
    },
  },
  {
    key: "marketing",
    label: "Marketing Manager",
    description: "Runs content and search. No access to clients or money.",
    invitedRole: "staff",
    permissions: {
      blog: true,
      social: true,
      website: true,
      funnels: true,
      seo: true,
      leads: true,
      analytics: "view",
    },
  },
  {
    key: "bookkeeper",
    label: "Bookkeeper",
    description: "Keeps the books. Can see payments but not issue refunds.",
    invitedRole: "staff",
    permissions: {
      accounting: "manage",
      payments: "view",
      analytics: "view",
    },
  },
  {
    key: "front_desk",
    label: "Front Desk",
    description: "Handles scheduling and inbound messages.",
    invitedRole: "staff",
    permissions: {
      clients: true,
      schedule: true,
      messages: true,
      leads: true,
    },
  },
  {
    key: "editor",
    label: "Video Editor",
    description: "Uploads and revises videos in the editor portal. No admin panel.",
    invitedRole: "editor",
    permissions: {},
  },
  {
    key: "custom",
    label: "Custom",
    description: "Start from nothing and tick exactly what you want.",
    invitedRole: "staff",
    permissions: {},
  },
] as const

const PRESET_BY_KEY = new Map<string, PresetDef>(PRESETS.map((p) => [p.key, p]))

export function getPreset(key: string): PresetDef | null {
  return PRESET_BY_KEY.get(key) ?? null
}

// ---------------------------------------------------------------------------
// Path rules
// ---------------------------------------------------------------------------

/**
 * Surfaces no teammate may reach, whatever their permission map says. These
 * are the ones that would let someone widen their own access, reach into a
 * third-party integration, or read/erase the trail of what they did.
 *
 * `/admin/dashboard` is here because its widgets surface revenue.
 */
export const OWNER_ONLY_PREFIXES: readonly string[] = [
  "/admin/dashboard",
  "/admin/settings",
  "/admin/team",
  "/admin/audit-logs",
  "/admin/automation",
  "/admin/platform-connections",
  "/admin/reset-data",
  "/api/admin/users",
  "/api/admin/team",
  "/api/admin/team-videos",
  "/api/admin/audit-logs",
  "/api/admin/automation",
  "/api/admin/platform-connections",
  "/api/admin/ai-policy",
  "/api/admin/reset-data",
  "/api/admin/internal",
] as const

/** Reachable by any signed-in staff member regardless of permissions. */
export const OPEN_PREFIXES: readonly string[] = ["/admin/guide", "/admin/no-access"] as const

export interface PathRule {
  prefix: string
  permission: PermissionKey
}

/**
 * Path prefix -> permission. Resolution is longest-prefix, so a more specific
 * rule wins: `/api/admin/sessions/fees` resolves to `commerce`, not `schedule`.
 *
 * Matching is segment-aware, so `/admin/team-media` does NOT match the
 * owner-only `/admin/team` prefix.
 */
export const PATH_PERMISSIONS: readonly PathRule[] = [
  // -- Coaching --------------------------------------------------------------
  { prefix: "/admin/clients", permission: "clients" },
  { prefix: "/api/admin/clients", permission: "clients" },

  { prefix: "/admin/programs", permission: "programs" },
  { prefix: "/admin/exercises", permission: "programs" },
  { prefix: "/api/admin/programs", permission: "programs" },
  { prefix: "/api/admin/exercises", permission: "programs" },
  { prefix: "/api/admin/exercise-relationships", permission: "programs" },
  { prefix: "/api/admin/tracked-exercises", permission: "programs" },
  { prefix: "/api/admin/assignments", permission: "programs" },

  { prefix: "/admin/schedule", permission: "schedule" },
  { prefix: "/admin/bookings", permission: "schedule" },
  { prefix: "/api/admin/sessions", permission: "schedule" },
  { prefix: "/api/admin/bookings", permission: "schedule" },

  { prefix: "/admin/form-reviews", permission: "form_reviews" },
  { prefix: "/admin/performance-assessments", permission: "form_reviews" },
  { prefix: "/api/admin/form-reviews", permission: "form_reviews" },
  { prefix: "/api/admin/performance-assessments", permission: "form_reviews" },
  { prefix: "/api/admin/questionnaires", permission: "form_reviews" },

  { prefix: "/admin/messages", permission: "messages" },
  { prefix: "/api/admin/messages", permission: "messages" },

  // -- Marketing -------------------------------------------------------------
  { prefix: "/admin/blog", permission: "blog" },
  { prefix: "/admin/newsletter", permission: "blog" },
  { prefix: "/admin/testimonials", permission: "blog" },
  { prefix: "/admin/topic-suggestions", permission: "blog" },
  { prefix: "/admin/reviews", permission: "blog" },
  { prefix: "/api/admin/blog", permission: "blog" },
  { prefix: "/api/admin/blog-posts", permission: "blog" },
  { prefix: "/api/admin/newsletter", permission: "blog" },
  { prefix: "/api/admin/testimonials", permission: "blog" },
  { prefix: "/api/admin/topic-suggestions", permission: "blog" },
  { prefix: "/api/admin/reviews", permission: "blog" },
  { prefix: "/api/admin/google-reviews", permission: "blog" },

  { prefix: "/admin/social", permission: "social" },
  { prefix: "/admin/calendar", permission: "social" },
  { prefix: "/admin/videos", permission: "social" },
  { prefix: "/admin/content", permission: "social" },
  { prefix: "/admin/team-media", permission: "social" },
  { prefix: "/api/admin/social", permission: "social" },
  { prefix: "/api/admin/content", permission: "social" },
  { prefix: "/api/admin/content-studio", permission: "social" },
  { prefix: "/api/admin/videos", permission: "social" },
  { prefix: "/api/admin/media-assets", permission: "social" },

  { prefix: "/admin/marketing", permission: "website" },
  { prefix: "/admin/legal", permission: "website" },
  { prefix: "/admin/lead-magnets", permission: "website" },
  { prefix: "/api/admin/marketing", permission: "website" },
  { prefix: "/api/admin/legal", permission: "website" },
  { prefix: "/api/admin/lead-magnets", permission: "website" },

  // Longest-prefix resolution means these must come after /admin/marketing
  // above only if they were nested under it — they are not, so order is free.
  // Landing pages and funnels are separate SCREENS but one permission: they are
  // the same capability wearing two vocabularies. A path missing from here is
  // DENIED by default, so adding a screen without adding its prefix bounces
  // staff who legitimately hold `funnels` to /admin/no-access.
  { prefix: "/admin/pages", permission: "funnels" },
  { prefix: "/admin/funnels", permission: "funnels" },
  { prefix: "/api/admin/funnels", permission: "funnels" },

  { prefix: "/admin/integrations/gsc", permission: "seo" },
  { prefix: "/admin/seo-agent", permission: "seo" },
  { prefix: "/admin/strategy", permission: "seo" },
  { prefix: "/api/admin/integrations", permission: "seo" },
  { prefix: "/api/admin/strategy", permission: "seo" },
  { prefix: "/api/admin/indexnow", permission: "seo" },

  { prefix: "/admin/inbox", permission: "leads" },
  { prefix: "/api/admin/inbox", permission: "leads" },
  { prefix: "/api/admin/leads", permission: "leads" },

  // -- Money -----------------------------------------------------------------
  { prefix: "/admin/payments", permission: "payments" },
  { prefix: "/api/admin/payments", permission: "payments" },

  { prefix: "/admin/books", permission: "accounting" },
  { prefix: "/api/admin/bookkeeping", permission: "accounting" },

  { prefix: "/admin/shop", permission: "commerce" },
  { prefix: "/admin/session-packs", permission: "commerce" },
  { prefix: "/admin/memberships", permission: "commerce" },
  { prefix: "/admin/sessions/fees", permission: "commerce" },
  { prefix: "/admin/events", permission: "commerce" },
  { prefix: "/api/admin/shop", permission: "commerce" },
  { prefix: "/api/admin/session-packs", permission: "commerce" },
  { prefix: "/api/admin/memberships", permission: "commerce" },
  { prefix: "/api/admin/sessions/fees", permission: "commerce" },
  { prefix: "/api/admin/events", permission: "commerce" },

  { prefix: "/admin/ads", permission: "ads" },
  { prefix: "/api/admin/ads", permission: "ads" },

  { prefix: "/admin/analytics", permission: "analytics" },
  { prefix: "/api/admin/analytics", permission: "analytics" },

  // -- Tools -----------------------------------------------------------------
  { prefix: "/admin/ai-assistant", permission: "ai_tools" },
  { prefix: "/admin/ai-insights", permission: "ai_tools" },
  { prefix: "/admin/ai-templates", permission: "ai_tools" },
  { prefix: "/admin/ai-usage", permission: "ai_tools" },
  { prefix: "/api/admin/ai", permission: "ai_tools" },
  { prefix: "/api/admin/ai-chat", permission: "ai_tools" },
  { prefix: "/api/admin/ai-templates", permission: "ai_tools" },
] as const

/**
 * Segment-aware prefix test. `/admin/team-media` must not match `/admin/team`,
 * which is owner-only — a plain `startsWith` would lock the wrong page.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/")
}

export type PathRequirement =
  | { kind: "owner_only" }
  | { kind: "open" }
  | { kind: "permission"; permission: PermissionKey }
  | { kind: "unmapped" }

/**
 * What a path demands. Owner-only wins over everything; then the longest
 * matching permission prefix; then `unmapped`, which callers must treat as a
 * denial (that is the default-deny property).
 */
export function resolvePathRequirement(pathname: string): PathRequirement {
  for (const prefix of OWNER_ONLY_PREFIXES) {
    if (matchesPrefix(pathname, prefix)) return { kind: "owner_only" }
  }
  for (const prefix of OPEN_PREFIXES) {
    if (matchesPrefix(pathname, prefix)) return { kind: "open" }
  }

  let best: PathRule | null = null
  for (const rule of PATH_PERMISSIONS) {
    if (!matchesPrefix(pathname, rule.prefix)) continue
    if (best === null || rule.prefix.length > best.prefix.length) best = rule
  }
  if (best) return { kind: "permission", permission: best.permission }

  return { kind: "unmapped" }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Does this permission map grant `key` at `required` level?
 *
 * `view` never implies `manage`. A boolean permission ignores the tier — being
 * granted at all is full access to that area.
 */
export function hasPermission(
  permissions: PermissionMap | null | undefined,
  key: PermissionKey,
  required: PermissionTier = "view",
): boolean {
  const value = permissions?.[key]
  if (value === undefined || value === null || value === false) return false

  const def = PERMISSION_BY_KEY.get(key)
  if (def?.kind === "boolean") return value === true

  // Tiered / view-only. `true` is not a legal stored value here, but treat a
  // stray one as `view` rather than as full access.
  const tier: PermissionTier = value === true ? "view" : (value as PermissionTier)
  if (def?.kind === "view_only") return required === "view" && tier === "view"
  return required === "view" ? tier === "view" || tier === "manage" : tier === "manage"
}

/** Does this map grant anything at all? */
export function grantsAnyPermission(permissions: PermissionMap | null | undefined): boolean {
  return PERMISSIONS.some((def) => hasPermission(permissions, def.key, "view"))
}

/**
 * A teammate's role, derived from their permissions rather than stored as a
 * second fact that can drift out of step with them.
 *
 * Ticking any permission makes someone `staff` and lets them into the admin
 * panel; clearing every permission makes them an `editor`, which is the
 * /editor portal and nothing else. Keeping this derivation in one place is
 * what stops "has no permissions" and "cannot reach the admin panel" from
 * being two separate switches that disagree — a staff row with an empty map
 * lands on `/admin/no-access`, which reads as broken rather than as a boundary.
 */
export function roleForPermissions(permissions: PermissionMap | null | undefined): TeamRole {
  return grantsAnyPermission(permissions) ? "staff" : "editor"
}

/** HTTP methods that only read. Everything else needs `manage` on tiered permissions. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function tierForMethod(method: string | undefined): PermissionTier {
  return READ_METHODS.has((method ?? "GET").toUpperCase()) ? "view" : "manage"
}

/**
 * The one question every guard asks: may this actor touch this path?
 *
 * Returns `true` for `admin` on every path — including unmapped ones — so
 * introducing this function cannot change the owner's behaviour anywhere.
 * That is the whole regression surface of the API sweep, and it is asserted
 * in the tests rather than assumed.
 */
export function canAccessPath(
  actor: PermissionActor | null | undefined,
  pathname: string,
  method?: string,
): boolean {
  if (!actor) return false
  if (actor.role === "admin") return true
  if (actor.role !== "staff") return false

  const requirement = resolvePathRequirement(pathname)
  switch (requirement.kind) {
    case "open":
      return true
    case "permission":
      return hasPermission(actor.permissions, requirement.permission, tierForMethod(method))
    case "owner_only":
    case "unmapped":
      return false
  }
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

/**
 * Where a staff member goes when they sign in or get bounced. There is no
 * shared home — `/admin/dashboard` is owner-only — so we send them to the
 * first area they actually hold.
 */
const HOME_PRIORITY: readonly { permission: PermissionKey; path: string }[] = [
  { permission: "clients", path: "/admin/clients" },
  { permission: "schedule", path: "/admin/schedule" },
  { permission: "messages", path: "/admin/messages" },
  { permission: "leads", path: "/admin/inbox" },
  { permission: "programs", path: "/admin/programs" },
  { permission: "form_reviews", path: "/admin/form-reviews" },
  { permission: "blog", path: "/admin/blog" },
  { permission: "social", path: "/admin/social" },
  { permission: "website", path: "/admin/marketing/faqs" },
  { permission: "funnels", path: "/admin/funnels" },
  { permission: "seo", path: "/admin/integrations/gsc" },
  { permission: "ads", path: "/admin/ads" },
  { permission: "accounting", path: "/admin/books" },
  { permission: "payments", path: "/admin/payments" },
  { permission: "commerce", path: "/admin/shop/products" },
  { permission: "analytics", path: "/admin/analytics" },
  { permission: "ai_tools", path: "/admin/ai-assistant" },
] as const

export const NO_ACCESS_PATH = "/admin/no-access"

/**
 * Request header the middleware stamps with the resolved pathname, so a route
 * handler can re-evaluate the permission rule itself instead of trusting that
 * the middleware ran. Always overwritten on matched paths, so it cannot be
 * forged; absent means the middleware did not run, and the route guard then
 * denies staff rather than assuming they were vetted.
 */
export const ADMIN_PATH_HEADER = "x-djp-admin-path"
export const ADMIN_METHOD_HEADER = "x-djp-admin-method"

export function staffHomePath(permissions: PermissionMap | null | undefined): string {
  for (const entry of HOME_PRIORITY) {
    if (hasPermission(permissions, entry.permission, "view")) return entry.path
  }
  return NO_ACCESS_PATH
}

/**
 * Where a signed-in user belongs when there is no specific destination.
 *
 * One function so the login form, the admin guard and the permission guard
 * cannot disagree: sending a staff member to `/client/dashboard` lands them on
 * a page that is not theirs, and every teammate hits this the first time they
 * sign in after being given access.
 */
export function homeForRole(
  role: string | null | undefined,
  permissions?: PermissionMap | null,
): string {
  if (role === "admin") return "/admin/dashboard"
  if (role === "staff") return staffHomePath(permissions)
  if (role === "editor") return "/editor"
  return "/client/dashboard"
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Coerce untrusted input (an invite payload, a permissions edit) into a legal
 * map. Unknown keys, owner-only concepts and malformed tiers are dropped.
 *
 * Callers that need to *reject* rather than sanitize should compare the input
 * key set against the result — a silently dropped permission looks identical
 * to a granted one in the UI, which is how people end up believing someone has
 * access they do not have.
 */
export function sanitizePermissionMap(input: unknown): PermissionMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const out: PermissionMap = {}

  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (!isPermissionKey(rawKey)) continue
    const def = getPermissionDef(rawKey)

    if (def.kind === "boolean") {
      if (rawValue === true) out[rawKey] = true
      continue
    }
    if (rawValue !== "view" && rawValue !== "manage") continue
    if (def.kind === "view_only" && rawValue === "manage") continue
    out[rawKey] = rawValue
  }

  return out
}

/** Keys present in `input` that `sanitizePermissionMap` would have discarded. */
export function invalidPermissionKeys(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const sanitized = sanitizePermissionMap(input)
  return Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => {
      // A falsy value is an explicit "not granted", not an invalid key.
      if (value === false || value === undefined || value === null) return false
      return sanitized[key as PermissionKey] === undefined
    })
    .map(([key]) => key)
}

/** Human-readable summary for the team list, e.g. "Clients, Programs, Accounting (manage)". */
export function describePermissions(permissions: PermissionMap | null | undefined): string {
  const parts: string[] = []
  for (const def of PERMISSIONS) {
    const value = permissions?.[def.key]
    if (value === undefined || value === null || value === false) continue
    parts.push(def.kind === "boolean" ? def.label : `${def.label} (${String(value)})`)
  }
  return parts.length ? parts.join(", ") : "No access yet"
}
