"use client"

import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type {
  DailyReadiness,
  Injury,
  PerformanceTest,
  PerformanceTestPR,
} from "@/types/database"
import { ReadinessScoreGauge } from "./readiness-score-gauge"
import { ReadinessTrendChart } from "./readiness-trend-chart"
import { ActiveInjuriesCard } from "./active-injuries-card"
import { InjuryTimelineList } from "./injury-timeline-list"
import { PRsShelfCard } from "./prs-shelf-card"
import { PerformanceTestCard } from "./performance-test-card"

export function AthletePerformanceHub({
  clientUserId,
  tab,
  latestReadiness,
  readinessTrend,
  activeInjuries,
  allInjuries,
  prs,
  recentTests,
}: {
  clientUserId: string
  tab: string
  latestReadiness: DailyReadiness | null
  readinessTrend: { date: string; readiness_score: number }[]
  activeInjuries: Injury[]
  allInjuries: Injury[]
  prs: PerformanceTestPR[]
  recentTests: PerformanceTest[]
}) {
  const grouped = recentTests.reduce<Record<string, PerformanceTest[]>>((acc, t) => {
    const key = t.test_type === "custom" ? `custom:${t.custom_name}` : t.test_type
    acc[key] = acc[key] ?? []
    acc[key].push(t)
    return acc
  }, {})

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-3xl font-bold">Performance</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link
              href={`/admin/clients/${clientUserId}/performance/injuries/new`}
            >
              + Report injury
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/admin/clients/${clientUserId}/performance/log-test`}>
              + Log test
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="overview" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=overview`}>
              Overview
            </Link>
          </TabsTrigger>
          <TabsTrigger value="readiness" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=readiness`}>
              Readiness
            </Link>
          </TabsTrigger>
          <TabsTrigger value="injuries" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=injuries`}>
              Injuries
            </Link>
          </TabsTrigger>
          <TabsTrigger value="tests" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=tests`}>
              Tests
            </Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 grid gap-6 md:grid-cols-2">
          <ReadinessScoreGauge readiness={latestReadiness} />
          <ActiveInjuriesCard injuries={activeInjuries} clientUserId={clientUserId} />
          <PRsShelfCard prs={prs} />
          {recentTests[0] && (
            <PerformanceTestCard
              latest={recentTests[0]}
              history={recentTests
                .filter((t) => t.test_type === recentTests[0].test_type)
                .slice(0, 10)}
              clientUserId={clientUserId}
            />
          )}
        </TabsContent>

        <TabsContent value="readiness" className="mt-6">
          <ReadinessTrendChart data={readinessTrend} />
        </TabsContent>

        <TabsContent value="injuries" className="mt-6">
          <InjuryTimelineList injuries={allInjuries} clientUserId={clientUserId} />
        </TabsContent>

        <TabsContent value="tests" className="mt-6 grid gap-4 md:grid-cols-2">
          {Object.entries(grouped).map(([key, list]) => (
            <PerformanceTestCard
              key={key}
              latest={list[0]}
              history={list}
              clientUserId={clientUserId}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}
