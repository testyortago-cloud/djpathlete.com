import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/performance-tests"
import { Button } from "@/components/ui/button"
import { LogTestDialog } from "@/components/client/performance/log-test-dialog"
import { MyPerformanceTests } from "@/components/client/performance/my-performance-tests"

export default async function ClientPerformancePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/performance")
  const tests = await listByUser(session.user.id)

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-heading text-3xl font-bold">Performance</h1>
        <LogTestDialog trigger={<Button>+ Log test</Button>} />
      </div>
      <MyPerformanceTests tests={tests} />
    </div>
  )
}
