import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogTestDialog } from "@/components/client/performance/log-test-dialog"

export default async function AdminLogTestPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  return (
    <div className="container max-w-xl py-8">
      <h1 className="font-heading mb-6 text-2xl font-bold">Log test for client</h1>
      <LogTestDialog clientUserId={id} trigger={<Button>Open log dialog</Button>} />
    </div>
  )
}
