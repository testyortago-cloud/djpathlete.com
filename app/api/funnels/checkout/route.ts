// Anonymous purchase of a program from a published funnel page.
//
// ---------------------------------------------------------------------------
// THIS ROUTE TAKES NO MONEY AND GRANTS NOTHING. It creates a Stripe Checkout
// session and hands back its URL. Everything that matters — the account, the
// grant, the set-password email — happens in the webhook once Stripe says the
// card actually settled. A route that granted anything here would be granting
// on an intention to pay.
//
// /api/* is NOT covered by middleware.ts, so this route gates itself. It is
// anonymous BY DESIGN: the whole point is that a cold visitor from an ad can
// buy without making an account first. The precedent is
// app/api/events/[id]/checkout/route.ts, which has no auth() call either.
//
// Spec: docs/superpowers/specs/2026-08-15-funnel-anonymous-checkout-design.md

import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceRoleClient } from "@/lib/supabase"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { getProgramById } from "@/lib/db/programs"
import { getSetting } from "@/lib/db/system-settings"
import { createFunnelProgramCheckoutSession } from "@/lib/stripe"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getAttributionBySession } from "@/lib/db/marketing-attribution"
import { getBaseUrl } from "@/lib/url"
import { FUNNEL_CHECKOUT_FLAG, FUNNEL_CHECKOUT_DEFAULT } from "@/lib/funnels/checkout/flag"

/** Bots submit instantly; a person cannot read a page and type an email this fast. */
const MIN_ELAPSED_MS = 1500

const bodySchema = z.object({
  funnelId: z.string().uuid(),
  stepId: z.string().uuid(),
  // ONE KIND FOR NOW, AND THE SCHEMA SAYS SO RATHER THAN THE CODE. Packs carry
  // billing baggage (auto-renew consent, a mirror payments row) and events need
  // a waiver — see spec §8 and §4. A wider enum here would let a crafted
  // payload reach a grant path that does not exist.
  productKind: z.literal("program"),
  productId: z.string().uuid(),
  email: z.string().email().max(200),
  name: z.string().max(120).optional(),
  website: z.string().optional(),
  elapsedMs: z.number().optional(),
})

function reject(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: Request) {
  // Money AND mass email, which is exactly the bar for a flag in this repo.
  // 404 rather than 403 when it is off: a 403 confirms the endpoint exists and
  // is merely disabled, which is a map of what to come back for.
  if (!(await getSetting<boolean>(FUNNEL_CHECKOUT_FLAG, FUNNEL_CHECKOUT_DEFAULT))) {
    return reject(404, "Not found")
  }

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return reject(400, "Invalid request.")
    body = parsed.data
  } catch {
    return reject(400, "Invalid request.")
  }

  // Honeypot and time-to-submit, matching /api/funnels/submit. Answered 200 with
  // no session URL so a bot learns nothing from the difference.
  if (body.website && body.website.length > 0) return NextResponse.json({ ok: true })
  if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_ELAPSED_MS) {
    return NextResponse.json({ ok: true })
  }

  const [funnel, step] = await Promise.all([getFunnelById(body.funnelId), getStep(body.stepId)])
  if (!funnel || !step || step.funnel_id !== funnel.id) return reject(404, "Not found")

  // A DRAFT FUNNEL CANNOT SELL. `/go` only serves published funnels, so a
  // checkout against a draft could only have come from a crafted request or a
  // stale tab — and taking money for a page that is not live is worse than
  // refusing it.
  if (funnel.status !== "published") return reject(404, "Not found")

  let program
  try {
    program = await getProgramById(body.productId)
  } catch {
    return reject(404, "That program is not available.")
  }
  // A price is the difference between a purchase and a free grant. The Stripe
  // helper throws on a missing one; refusing here makes it a clean 400 instead
  // of a 502 from the payment provider.
  if (program.price_cents == null || program.price_cents <= 0) {
    return reject(400, "That program is not available for purchase.")
  }

  // THE LEAD IS CAPTURED BEFORE STRIPE, and this is the reason the page asks for
  // an email at all when Stripe would collect one itself: an abandoned checkout
  // is otherwise invisible here. Stripe saw them, you did not. A failure to
  // record the lead must NOT block the sale, so it is caught and dropped — the
  // purchase is worth more than the attribution.
  let leadId: string | null = null
  try {
    leadId = await upsertBuyerLead(body.email, body.name ?? null)
  } catch (error) {
    console.error("[funnels/checkout] lead capture failed, continuing to checkout:", error)
  }

  const attrSessionId = parseAttrCookie(request.headers.get("cookie"))
  const attrRow = attrSessionId ? await getAttributionBySession(attrSessionId).catch(() => null) : null
  const tracking = attrRow
    ? { gclid: attrRow.gclid, gbraid: attrRow.gbraid, wbraid: attrRow.wbraid, fbclid: attrRow.fbclid }
    : undefined

  const base = getBaseUrl()
  const pageUrl = `${base}/go/${funnel.slug}/${step.slug}`

  let session
  try {
    session = await createFunnelProgramCheckoutSession({
      program,
      buyerEmail: body.email,
      funnelId: funnel.id,
      stepId: step.id,
      leadId,
      successUrl: `${base}/go/${funnel.slug}/${step.slug}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${pageUrl}?purchase=cancelled`,
      tracking,
    })
  } catch (error) {
    console.error("[funnels/checkout] Stripe error", error)
    return reject(502, "Payment provider unavailable, please try again.")
  }

  return NextResponse.json({ sessionUrl: session.url, leadId })
}

/**
 * A buyer becomes a `status: "lead"` users row, exactly as
 * `/api/funnels/submit` does it — same shape, same reasons, so a buyer who
 * abandons checkout sits in the Clients list beside every other inbound lead
 * rather than in a category of their own.
 *
 * FIND BEFORE CREATE here as well as in the webhook. A returning customer who
 * buys a second program must not gain a second account, and this is the first
 * place that could give them one.
 */
async function upsertBuyerLead(email: string, name: string | null): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data: existing } = await supabase.from("users").select("id").ilike("email", email).maybeSingle()
  if (existing) return (existing as { id: string }).id

  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  const { data: created, error } = await supabase
    .from("users")
    .insert({
      email,
      first_name: parts[0] ?? email.split("@")[0],
      last_name: parts.slice(1).join(" "),
      role: "client",
      status: "lead",
      email_verified: false,
    })
    .select("id")
    .single()
  if (error) throw new Error(error.message)
  return (created as { id: string }).id
}
