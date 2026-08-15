// lib/funnels/admin-path.ts — where a funnel row is administered.
//
// A landing page and a funnel are the SAME ROW with a different `kind`, and for
// a long time they shared one set of admin routes under `/admin/funnels/[id]`.
// That is invisible everywhere except the one place it cannot be hidden: the
// sidebar highlights by PATH PREFIX (`findActiveHref` in admin-nav.ts), so
// editing a landing page lit up "Funnels" and there was no pathname-only rule
// that could tell them apart.
//
// The owner reported it as what it looks like from outside: "IM CREATING A
// LANDING PAGE WHEN I GO BACK IM IN THE FUNNEL TAB".
//
// So each kind gets its own base, and every link is built from here rather than
// written out. The funnels routes still exist and REDIRECT a `page` to its own
// URL, so an old bookmark, a stale tab or a link this file was not threaded
// through still lands in the right place instead of relighting the wrong tab.

import type { FunnelKind } from "@/types/database"

/** `/admin/pages` for a landing page, `/admin/funnels` for a funnel. */
export function adminFunnelBase(kind: FunnelKind | string): string {
  return kind === "page" ? "/admin/pages" : "/admin/funnels"
}

/** The settings / steps screen for one row. */
export function adminFunnelHref(kind: FunnelKind | string, funnelId: string): string {
  return `${adminFunnelBase(kind)}/${funnelId}`
}

/** The builder for one step of one row. */
export function adminStepHref(kind: FunnelKind | string, funnelId: string, stepId: string): string {
  return `${adminFunnelBase(kind)}/${funnelId}/edit/${stepId}`
}
