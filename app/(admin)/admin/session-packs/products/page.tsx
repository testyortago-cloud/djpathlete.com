import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listAllProducts } from "@/lib/db/session-pack-products"
import { ProductCatalogueManager } from "@/components/admin/packs/ProductCatalogueManager"

export const metadata = { title: "Session Pack Catalogue" }

export default async function PackCataloguePage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")
  const products = await listAllProducts()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Session Pack Catalogue</h1>
        <p className="text-sm text-muted-foreground">
          Standard packs clients can buy themselves. Prices in USD. Deactivate a product to hide it from the client
          storefront.
        </p>
      </div>
      <ProductCatalogueManager initialProducts={products} />
    </div>
  )
}
