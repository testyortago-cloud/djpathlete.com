import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle, ArrowRight } from "lucide-react"

export const metadata: Metadata = {
  title: "Purchase Successful",
  description: "Your program purchase was successful. Start training now.",
}

export default function PurchaseSuccessPage() {
  return (
    <section className="pt-32 pb-16 lg:pt-40 lg:pb-24 px-4 sm:px-8">
      <div className="max-w-lg mx-auto text-center">
        <div className="flex items-center justify-center size-20 rounded-full bg-success/10 mx-auto mb-6">
          <CheckCircle className="size-10 text-success" strokeWidth={1.5} />
        </div>

        <h1 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
          Purchase Successful!
        </h1>

        <p className="text-lg text-muted-foreground leading-relaxed mb-8">
          Your program has been added to your account. You can start training
          right away from your dashboard.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/client/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start Training
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/programs"
            className="inline-flex items-center rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-surface transition-colors"
          >
            Browse More Programs
          </Link>
        </div>
      </div>
    </section>
  )
}
