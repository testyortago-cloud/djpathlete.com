import { Metadata } from "next"
import { auth } from "@/lib/auth"
import { getCoachPolicy } from "@/lib/db/coach-ai-policy"
import { AiPolicyForm } from "@/components/admin/ai-policy-form"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "AI Program Policy — DJP Athlete Admin" }

export default async function AiPolicyPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const policy = await getCoachPolicy(session.user.id)

  return (
    <div className="container py-8 max-w-3xl">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-heading text-primary">AI Program Policy</h1>
        <p className="text-sm text-muted-foreground">
          Control how the AI generates programs across all of your clients. These rules are injected into every program
          generation as coach instructions and override the AI&apos;s defaults.
        </p>
      </div>
      <AiPolicyForm initialPolicy={policy} />
    </div>
  )
}
