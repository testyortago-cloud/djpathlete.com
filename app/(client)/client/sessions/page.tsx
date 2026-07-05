import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { clientPackBalanceEnabled, clientSelfPurchaseEnabled, cardOnFileEnabled } from "@/lib/packs/flags"
import { loadMyPacksView } from "@/lib/services/client-packs-view"
import { getDefaultPaymentMethod } from "@/lib/db/payment-methods"
import { MySessionsList } from "@/components/client/MySessionsList"
import { MyCardPanel } from "@/components/client/MyCardPanel"
import { Button } from "@/components/ui/button"

export const metadata = { title: "My Sessions | DJP Athlete" }

export default async function MySessionsPage() {
  if (!(await clientPackBalanceEnabled())) redirect("/client/dashboard")
  const session = await auth()
  const view = await loadMyPacksView()
  const canBuy = await clientSelfPurchaseEnabled()

  const showCard = await cardOnFileEnabled()
  const card = showCard && session?.user?.id ? await getDefaultPaymentMethod(session.user.id).catch(() => null) : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">My Sessions</h1>
        {canBuy && (
          <Button asChild>
            <Link href="/client/sessions/buy">Buy sessions</Link>
          </Button>
        )}
      </div>
      <MySessionsList packs={view?.packs ?? []} />
      {showCard && <MyCardPanel card={card} />}
    </div>
  )
}
