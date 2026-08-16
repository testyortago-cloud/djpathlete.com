// GET /api/admin/funnels/offers?kind=program|session_pack|event
//
// Backs the create dialog's offer picker.
//
// IT READS `loadCatalogues().offer`, AND THAT CHOICE IS THE WHOLE POINT. That
// set's own documentation defines it as "currently valid rows only — what may a
// NEW cta point at?", which is exactly the question a picker asks. Querying the
// three tables directly here would be a second, weaker definition of "sellable"
// that drifts from the one `resolveDoc` enforces at render — and the owner would
// meet the drift as a CTA that silently degrades to a disabled placeholder on a
// live page.
//
// It deliberately does NOT read `recognition`: that set exists to answer "is
// this id still a real row?" and includes retired products on purpose.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { loadCatalogues } from "@/lib/funnels/sections/resolve"
import type { OfferKind } from "@/types/database"

const OFFER_KINDS: readonly OfferKind[] = ["program", "session_pack", "event"]

function isOfferKind(value: string | null): value is OfferKind {
  return value !== null && (OFFER_KINDS as readonly string[]).includes(value)
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const kind = request.nextUrl.searchParams.get("kind")
  if (!isOfferKind(kind)) {
    // `leads` and `booking` are real FunnelGoals but sell nothing, so they are
    // not OfferKinds. Saying so beats returning an empty list, which reads as
    // "you have no programs".
    return NextResponse.json(
      { error: `kind must be one of ${OFFER_KINDS.join(", ")}` },
      { status: 400 },
    )
  }

  try {
    const catalogues = await loadCatalogues()
    return NextResponse.json({ offers: catalogues.offer[kind] })
  } catch (error) {
    // `loadCatalogues` THROWS on a truncated read and its own comment requires
    // every caller to wrap it. 503 rather than 500: the catalogue is
    // temporarily unreadable, the dialog can say so, and the owner can still
    // create the funnel without linking an offer.
    console.error("[funnels/offers] catalogue read failed:", error)
    return NextResponse.json({ error: (error as Error).message }, { status: 503 })
  }
}
