import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { listByUser } from "@/lib/db/performance-tests"
import { signAthleteProfileToken } from "@/lib/profile-share/token"
import { Button } from "@/components/ui/button"
import { LogTestDialog } from "@/components/client/performance/log-test-dialog"
import { MyPerformanceTests } from "@/components/client/performance/my-performance-tests"

export default async function ClientPerformancePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/performance")
  const tests = await listByUser(session.user.id)
  // The client's own public test report — same permanent token family the coach
  // issues from the admin dialog; deactivating the client kills it.
  const cardUrl = `/athlete/${signAthleteProfileToken(session.user.id)}`

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold">Performance</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href={cardUrl} target="_blank">
              <ExternalLink className="size-4" />
              My test report
            </Link>
          </Button>
          <LogTestDialog trigger={<Button>+ Log test</Button>} />
        </div>
      </div>
      <MyPerformanceTests tests={tests} />
    </div>
  )
}
