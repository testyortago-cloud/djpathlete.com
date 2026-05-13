import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { LogTrainingSessionForm } from "@/components/client/coach-intel/log-training-session-form"

export default async function AdminLogSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-6 text-2xl font-bold">Log training session</h1>
      <LogTrainingSessionForm clientUserId={id} />
    </div>
  )
}
