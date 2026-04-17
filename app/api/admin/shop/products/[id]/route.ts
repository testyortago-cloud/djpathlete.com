import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { adminUpdateProductSchema } from "@/lib/validators/shop"
import { deleteProduct, getProductById, updateProduct } from "@/lib/db/shop-products"
import { listAllVariantsForProduct } from "@/lib/db/shop-variants"
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import { countLeadsForProduct } from "@/lib/db/shop-leads"
import {
  countClicksForProduct,
  countClicksForProductSince,
} from "@/lib/db/shop-affiliate-clicks"
import { buildAffiliateUrl } from "@/lib/shop/amazon"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  const product = await getProductById(id)
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (product.product_type === "digital") {
    const [files, leadsCount] = await Promise.all([
      listFilesForProduct(product.id),
      product.digital_is_free ? countLeadsForProduct(product.id) : Promise.resolve(0),
    ])
    return NextResponse.json({ product, files, leadsCount })
  }

  if (product.product_type === "affiliate") {
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const [total, last7d, last30d] = await Promise.all([
      countClicksForProduct(product.id),
      countClicksForProductSince(product.id, since7),
      countClicksForProductSince(product.id, since30),
    ])
    const tag = process.env.AMAZON_ASSOCIATES_TAG ?? ""
    let taggedUrlPreview = ""
    if (product.affiliate_url && tag) {
      try {
        taggedUrlPreview = buildAffiliateUrl(product.affiliate_url, tag)
      } catch {
        taggedUrlPreview = ""
      }
    }
    return NextResponse.json({
      product,
      clickStats: { total, last7d, last30d },
      taggedUrlPreview,
    })
  }

  const variants = await listAllVariantsForProduct(product.id)
  return NextResponse.json({ product, variants })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  const body = await request.json()
  const parsed = adminUpdateProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const updated = await updateProduct(id, parsed.data)

  revalidatePath("/shop")
  revalidatePath(`/shop/${updated.slug}`)

  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  const product = await getProductById(id)
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (product.product_type === "pod") {
    return NextResponse.json(
      {
        error:
          "POD products are synced from Printful and cannot be deleted here. Deactivate instead.",
      },
      { status: 400 },
    )
  }

  try {
    await deleteProduct(id)
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e.code === "23503") {
      return NextResponse.json(
        {
          error:
            "Cannot delete: this product has existing orders, downloads, or leads. Deactivate it instead.",
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: e.message ?? "Failed to delete product" },
      { status: 500 },
    )
  }

  revalidatePath("/shop")
  revalidatePath(`/shop/${product.slug}`)
  return NextResponse.json({ success: true })
}
