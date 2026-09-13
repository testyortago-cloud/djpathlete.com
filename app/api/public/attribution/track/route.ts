import { NextRequest, NextResponse } from "next/server"
import { attributionTrackBodySchema } from "@/lib/validators/marketing"
import { hasAnyTrackingParam } from "@/lib/marketing/attribution"
import { upsertAttributionBySession } from "@/lib/db/marketing-attribution"

/**
 * POST /api/public/attribution/track
 *
 * Public endpoint called from middleware on landings that include any
 * tracking query param, or any /go landing (see captureAttribution in
 * proxy.ts — a funnel landing earns a session whether it is tagged or not).
 * Idempotent UPSERT by session_id. Always returns
 * 204 on success (no body), 400 on schema failure. Errors during DB write
 * are swallowed and 204'd — this endpoint must NEVER block a landing.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = attributionTrackBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const { session_id, ...params } = parsed.data
  // A body must say SOMETHING about where this visitor came from: one of the
  // nine tracking identifiers, or — for an untagged /go landing, which has
  // none of them — the landing_url itself. A bare session_id says nothing at
  // all, so it still gets a 400 rather than an empty attribution row.
  if (!hasAnyTrackingParam(params) && !params.landing_url) {
    return NextResponse.json({ error: "No tracking params" }, { status: 400 })
  }

  try {
    await upsertAttributionBySession(session_id, params)
  } catch (err) {
    console.error("[attribution/track]", err)
    // Fall through to 204 — never block a landing.
  }

  return new NextResponse(null, { status: 204 })
}
