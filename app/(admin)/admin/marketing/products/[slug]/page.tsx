import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { MarketingProductForm } from "@/components/admin/MarketingProductForm"
import { getMarketingProduct } from "@/lib/db/marketing-products"

export const metadata = { title: "Edit Marketing Product — DJP Athlete" }
export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ slug: string }>
}

export default async function EditMarketingProductPage({ params }: Props) {
  const { slug } = await params
  const product = await getMarketingProduct(slug)
  if (!product) notFound()

  return (
    <div className="space-y-6">
      <Link
        href="/admin/marketing/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3.5" />
        Back to products
      </Link>
      <h1 className="text-2xl font-heading text-primary">{product.name}</h1>
      <p className="text-sm text-muted-foreground font-mono">{product.slug}</p>
      <MarketingProductForm mode="edit" initial={product} />
    </div>
  )
}
