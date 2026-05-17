import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { MarketingProductForm } from "@/components/admin/MarketingProductForm"

export const metadata = { title: "New Marketing Product — DJP Athlete" }

export default function NewMarketingProductPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/admin/marketing/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3.5" />
        Back to products
      </Link>
      <h1 className="text-2xl font-heading text-primary">New marketing product</h1>
      <p className="text-sm text-muted-foreground max-w-2xl">
        The ads agent will start considering this program on the next memo run. Slug
        is immutable after create — pick something stable.
      </p>
      <MarketingProductForm mode="create" />
    </div>
  )
}
