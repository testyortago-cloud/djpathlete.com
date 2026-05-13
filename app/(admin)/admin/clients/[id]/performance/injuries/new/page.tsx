import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ReportInjuryForm } from "@/components/client/performance/report-injury-form"

export default async function AdminReportInjuryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-6 text-2xl font-bold">Report injury</h1>
      <ReportInjuryForm clientUserId={id} />
    </div>
  )
}
