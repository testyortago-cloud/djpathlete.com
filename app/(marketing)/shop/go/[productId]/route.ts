import { NextResponse } from "next/server"
import { getProductById } from "@/lib/db/shop-products"
import { recordAffiliateClick } from "@/lib/db/shop-affiliate-clicks"
import { buildAffiliateUrl } from "@/lib/shop/amazon"
import { isShopAffiliateEnabled } from "@/lib/shop/feature-flag"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  if (!isShopAffiliateEnabled()) {
    return new NextResponse("Not found", { status: 404 })
  }
  const { productId } = await params
  const product = await getProductById(productId)
  if (!product || product.product_type !== "affiliate" || !product.affiliate_url) {
    return new NextResponse("Not found", { status: 404 })
  }

  const tag = process.env.AMAZON_ASSOCIATES_TAG
  if (!tag) {
    return new NextResponse("Affiliate not configured", { status: 500 })
  }

  let target: string
  try {
    target = buildAffiliateUrl(product.affiliate_url, tag)
  } catch {
    return new NextResponse("Invalid affiliate URL", { status: 400 })
  }

  recordAffiliateClick({
    product_id: product.id,
    ip_address: req.headers.get("x-forwarded-for"),
    user_agent: req.headers.get("user-agent"),
    referrer: req.headers.get("referer"),
  }).catch((e) => console.error("affiliate-click log failed", e))

  const res = NextResponse.redirect(target, 307)
  res.headers.set("X-Robots-Tag", "noindex, nofollow")
  return res
}

export const dynamic = "force-dynamic"
