import { NextResponse } from "next/server"
import { downloadSignRequestSchema } from "@/lib/validators/shop-phase2"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import {
  getOrderDownload,
  consumeDownload,
} from "@/lib/db/shop-order-downloads"
import { getProductFile } from "@/lib/db/shop-product-files"
import { getProductById } from "@/lib/db/shop-products"
import { generateSignedDownloadUrl } from "@/lib/shop/downloads"
import { rateLimit } from "@/lib/shop/rate-limit"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown"
  const { ok } = rateLimit(`shop-dl:${ip}`, 20, 60_000)
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 })

  const parsed = downloadSignRequestSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { order_number, email, download_id } = parsed.data

  const order = await getOrderByNumber(order_number)
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (order.customer_email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "email mismatch" }, { status: 403 })
  }

  const download = await getOrderDownload(download_id)
  if (!download || download.order_id !== order.id) {
    return NextResponse.json({ error: "download not found" }, { status: 404 })
  }

  const file = await getProductFile(download.file_id)
  if (!file) return NextResponse.json({ error: "file missing" }, { status: 404 })

  const product = await getProductById(download.product_id)
  if (!product) {
    return NextResponse.json({ error: "product missing" }, { status: 404 })
  }

  const consumed = await consumeDownload(download.id)
  if (!consumed) {
    return NextResponse.json(
      { error: "access expired or download limit reached" },
      { status: 410 },
    )
  }

  const url = await generateSignedDownloadUrl(
    file.storage_path,
    product.digital_signed_url_ttl_seconds,
  )
  return NextResponse.json({ url })
}
