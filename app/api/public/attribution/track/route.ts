import { NextRequest, NextResponse } from "next/server"
import { attributionTrackBodySchema } from "@/lib/validators/marketing"
import { hasAnyTrackingParam } from "@/lib/marketing/attribution"
import { upsertAttributionBySession } from "@/lib/db/marketing-attribution"

/**
 * POST /api/public/attribution/track
 *
 * Public endpoint called from middleware on landings that include any
 * tracking query param. Idempotent UPSERT by session_id. Always returns
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
  if (!hasAnyTrackingParam(params)) {
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
