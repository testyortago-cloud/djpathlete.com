import { notFound } from "next/navigation"
import { getProductById } from "@/lib/db/shop-products"
import { listAllVariantsForProduct } from "@/lib/db/shop-variants"
import { ProductEditor } from "@/components/admin/shop/products/ProductEditor"
import { VariantsPanel } from "@/components/admin/shop/products/VariantsPanel"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Edit Product · Admin" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function ShopProductDetailPage({ params }: Props) {
  const { id } = await params
  const [product, variants] = await Promise.all([
    getProductById(id),
    listAllVariantsForProduct(id),
  ])

  if (!product) notFound()

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link
          href="/admin/shop/products"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to Products
        </Link>
        <h1 className="text-2xl font-heading text-primary">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          Slug: <code className="font-mono text-xs bg-surface px-1 py-0.5 rounded">{product.slug}</code>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ProductEditor product={product} />
        </div>
        <div className="lg:col-span-1">
          <VariantsPanel variants={variants} />
        </div>
      </div>
    </div>
  )
}
