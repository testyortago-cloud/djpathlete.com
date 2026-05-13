import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getReadinessTrend } from "@/lib/db/daily-readiness"
import { MyReadinessHistory } from "@/components/client/performance/my-readiness-history"

export default async function ReadinessHistoryPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/readiness/history")

  const trend = await getReadinessTrend(session.user.id, 30)

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">Readiness history</h1>
      <MyReadinessHistory data={trend} />
    </div>
  )
}
