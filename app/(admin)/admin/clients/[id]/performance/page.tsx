import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getLatest, getReadinessTrend } from "@/lib/db/daily-readiness"
import { listByUser, getActive } from "@/lib/db/injuries"
import {
  getPRsByUser,
  listByUser as listTests,
} from "@/lib/db/performance-tests"
import { AthletePerformanceHub } from "@/components/admin/performance/athlete-performance-hub"

export default async function AdminPerformanceHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  const { tab = "overview" } = await searchParams

  const [latestReadiness, trend, allInjuries, activeInjuries, prs, recentTests] =
    await Promise.all([
      getLatest(id),
      getReadinessTrend(id, 30),
      listByUser(id),
      getActive(id),
      getPRsByUser(id),
      listTests(id).then((t) => t.slice(0, 10)),
    ])

  return (
    <AthletePerformanceHub
      clientUserId={id}
      tab={tab}
      latestReadiness={latestReadiness}
      readinessTrend={trend}
      activeInjuries={activeInjuries}
      allInjuries={allInjuries}
      prs={prs}
      recentTests={recentTests}
    />
  )
}
