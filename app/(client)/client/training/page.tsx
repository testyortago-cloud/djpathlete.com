import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { LogTrainingSessionForm } from "@/components/client/coach-intel/log-training-session-form"

export default async function ClientTrainingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/training")

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-2 text-3xl font-bold">Log training</h1>
      <p className="text-muted-foreground mb-8">
        RPE + duration. We compute the load and trend automatically.
      </p>
      <LogTrainingSessionForm />
    </div>
  )
}
