import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/training-sessions"
import { MyTrainingHistory } from "@/components/client/coach-intel/my-training-history"

export default async function ClientTrainingHistoryPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/training/history")
  const sessions = await listByUser(session.user.id)

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">Training history</h1>
      <MyTrainingHistory sessions={sessions} />
    </div>
  )
}
