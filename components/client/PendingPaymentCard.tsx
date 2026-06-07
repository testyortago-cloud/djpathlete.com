import { Lock } from "lucide-react"
import { ClientBuyButton } from "@/app/(client)/client/programs/[id]/ClientBuyButton"

interface PendingPaymentCardProps {
  programId: string
  programName: string
  priceCents: number | null
  isSubscription: boolean
}

export function PendingPaymentCard({ programId, programName, priceCents, isSubscription }: PendingPaymentCardProps) {
  const price = priceCents != null ? `$${(priceCents / 100).toFixed(2)}${isSubscription ? "/mo" : ""}` : ""
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
          <Lock className="size-4 text-warning" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Payment required to unlock {programName}</p>
          <p className="text-xs text-muted-foreground">
            Complete your {price ? `${price} ` : ""}payment to start training.
          </p>
        </div>
      </div>
      <ClientBuyButton programId={programId} label={isSubscription ? "Subscribe" : "Complete payment"} />
    </div>
  )
}
