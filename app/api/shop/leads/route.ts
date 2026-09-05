import { NextResponse } from "next/server"
import { leadFormSchema } from "@/lib/validators/shop-phase2"
import { getProductById } from "@/lib/db/shop-products"
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import { upsertLead, markLeadSynced, markLeadFailed } from "@/lib/db/shop-leads"
import { addContactToAudience } from "@/lib/shop/resend-audience"
import { sendFreeDownloadEmail } from "@/lib/shop/emails"
import { isShopDigitalEnabled } from "@/lib/shop/feature-flag"
import { rateLimit } from "@/lib/shop/rate-limit"
import { recordAudit } from "@/lib/audit/record"
import { captureLead } from "@/lib/lead-engine/capture"
import { resolvePublicTenant } from "@/lib/tenancy/public"

export async function POST(req: Request) {
  if (!isShopDigitalEnabled()) {
    return NextResponse.json({ error: "disabled" }, { status: 404 })
  }
  const ip = req.headers.get("x-forwarded-for") ?? "unknown"
  const { ok } = rateLimit(`shop-leads:${ip}`, 3, 60_000)
  if (!ok) {
    return NextResponse.json({ error: "rate limit" }, { status: 429 })
  }

  const parsed = leadFormSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { email, product_id } = parsed.data

  // PUBLIC ROUTE, NO SESSION. The tenant is resolved from the request's Host
  // by lib/tenancy/public.ts (business_domains), and is the platform's own
  // only when no domain row claims the host. Resolved once here and
  // threaded; the DAL does not default it.
  const businessId = await resolvePublicTenant()

  const product = await getProductById(product_id)
  if (!product || product.product_type !== "digital" || !product.digital_is_free) {
    return NextResponse.json({ error: "not a free digital product" }, { status: 404 })
  }

  const files = await listFilesForProduct(product.id)
  if (files.length === 0) {
    return NextResponse.json({ error: "product has no files" }, { status: 409 })
  }

  const lead = await upsertLead({ product_id, email, ip_address: ip })

  // Join the contact spine as early as the lead itself exists — captureLead
  // never throws (lib/lead-engine/capture.ts swallows its own errors), so
  // this can never change what happens next, including a later 502 from the
  // download email. The delivery is transactional, not marketing consent,
  // so no consent row is written here.
  await captureLead({ source: "lead_magnet", email, metadata: { product_id }, businessId })

  try {
    await sendFreeDownloadEmail({
      to: email,
      productName: product.name,
      files,
      ttlSeconds: product.digital_signed_url_ttl_seconds,
    })
  } catch (e) {
    console.error("free-download email failed", e)
    return NextResponse.json({ error: "email failed" }, { status: 502 })
  }

  try {
    const contactId = await addContactToAudience({
      email,
      firstName: null,
      lastName: null,
      tag: `lead-magnet:${product.slug}`,
    })
    await markLeadSynced(lead.id, contactId)
  } catch (e: unknown) {
    await markLeadFailed(lead.id, String((e as Error).message ?? e))
  }

  // Audit AFTER lead row exists. Lead capture is anonymous from a session
  // standpoint; record DAL falls back to actor_role="anonymous".
  await recordAudit({
    action: "shop.lead_captured",
    category: "commerce",
    target: { type: "shop_lead", id: lead.id, label: email },
    metadata: {
      product_id,
      product_slug: product.slug,
    },
    request: req,
  })

  return NextResponse.json({ ok: true })
}
