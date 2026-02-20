import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, ArrowRight, Dumbbell } from "lucide-react"

export const metadata = { title: "Purchase Successful | DJP Athlete" }

export default async function ClientPurchaseSuccessPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="flex flex-col items-center justify-center text-center py-12">
      <div className="flex items-center justify-center size-20 rounded-full bg-success/10 mb-6">
        <CheckCircle2 className="size-10 text-success" strokeWidth={1.5} />
      </div>

      <h1 className="text-2xl font-heading font-semibold text-primary tracking-tight mb-3">
        Purchase Successful!
      </h1>

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
    </div>
  )
}
