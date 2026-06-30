import { redirect } from "next/navigation"
import { clientSelfPurchaseEnabled } from "@/lib/packs/flags"
import { listActiveProducts } from "@/lib/db/session-pack-products"
import { BuySessionsClient } from "@/components/client/BuySessionsClient"

export const metadata = { title: "Buy Sessions | DJP Athlete" }

export default async function BuySessionsPage() {
  if (!(await clientSelfPurchaseEnabled())) redirect("/client/sessions")
  const products = await listActiveProducts()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Buy Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Purchase a pack of in-person sessions. Credits unlock as soon as payment completes.
        </p>
      </div>
      <BuySessionsClient products={products} />
    </div>
  )
}
