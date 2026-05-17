import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, ArrowRight, Dumbbell } from "lucide-react"
import { stripe } from "@/lib/stripe"
import { ConversionTracker } from "@/components/shared/ConversionTracker"
import { getSendTo } from "@/lib/ads/conversion-registry"

export const metadata = { title: "Purchase Successful | DJP Athlete" }

interface PageProps {
  searchParams: Promise<{ session_id?: string }>
}

export default async function ClientPurchaseSuccessPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // Look up the Stripe session for conversion value + tx id. Skipped silently
  // if no session_id (e.g. direct nav). Lookup failure also fails silent —
  // page must still render even if Stripe is rate-limiting us.
  const { session_id } = await searchParams
  let valueCents: number | undefined
  let transactionId: string | undefined
  let ready = false
  if (session_id) {
    try {
      const s = await stripe.checkout.sessions.retrieve(session_id)
      transactionId = s.id
      valueCents = s.amount_total ?? undefined
      ready = s.payment_status === "paid"
    } catch {
      // Stripe down / invalid session — skip the conversion fire; webhook
      // pipeline still recorded the purchase server-side.
    }
  }

  return (
    <div className="flex flex-col items-center justify-center text-center py-12">
      <div className="flex items-center justify-center size-20 rounded-full bg-success/10 mb-6">
        <CheckCircle2 className="size-10 text-success" strokeWidth={1.5} />
      </div>

      <h1 className="text-2xl font-heading font-semibold text-primary tracking-tight mb-3">Purchase Successful!</h1>

      <p className="text-base text-muted-foreground leading-relaxed mb-8 max-w-md">
        Your program has been added to your account. You can start training right away.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/client/workouts"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Dumbbell className="size-4" />
          Start Training
          <ArrowRight className="size-4" />
        </Link>
        <Link
          href="/client/programs"
          className="inline-flex items-center rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-surface transition-colors"
        >
          Browse More Programs
        </Link>
      </div>
      <ConversionTracker
        sendTo={getSendTo("program_purchase")}
        valueCents={valueCents}
        transactionId={transactionId}
        ready={ready}
      />
    </div>
  )
}
