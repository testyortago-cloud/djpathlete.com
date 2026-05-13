"use client"

import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type {
  DailyReadiness,
  Injury,
  PerformanceTest,
  PerformanceTestPR,
  RiskFlag,
} from "@/types/database"
import { ReadinessScoreGauge } from "./readiness-score-gauge"
import { ReadinessTrendChart } from "./readiness-trend-chart"
import { ActiveInjuriesCard } from "./active-injuries-card"
import { InjuryTimelineList } from "./injury-timeline-list"
import { PRsShelfCard } from "./prs-shelf-card"
import { PerformanceTestCard } from "./performance-test-card"
import { TrainingLoadCard } from "@/components/admin/coach-intel/training-load-card"
import { TrainingLoadChart } from "@/components/admin/coach-intel/training-load-chart"
import { ACWRChart } from "@/components/admin/coach-intel/acwr-chart"
import { MonotonyStrainCard } from "@/components/admin/coach-intel/monotony-strain-card"
import { WeekOverWeekCard } from "@/components/admin/coach-intel/week-over-week-card"
import { RiskFlagsCard } from "@/components/admin/coach-intel/risk-flags-card"
import { RiskFlagsList } from "@/components/admin/coach-intel/risk-flags-list"
import { BodyMapDisplay } from "@/components/shared/body-map/body-map-display"
import { AthleteRadarCard } from "@/components/client/profile/athlete-radar-card"
import { TrainingStreakHeatmap } from "@/components/client/profile/training-streak-heatmap"
import { BadgeShelfCard } from "@/components/client/profile/badge-shelf-card"
import { OpenGoalsCard } from "@/components/client/profile/open-goals-card"
import type {
  AthleteGoal,
  Badge as BadgeType,
  TrainingSession,
} from "@/types/database"

export interface ProfileSummary {
  tests: PerformanceTest[]
  sessions: TrainingSession[]
  goals: AthleteGoal[]
  badges: BadgeType[]
}

export interface CoachIntelSummary {
  acuteLoad: number
  chronicLoad: number
  acwr: number | null
  weeklyTotal: number
  monotony: number | null
  strain: number | null
  weekOverWeek: {
    current: { weekStart: string; totalLoad: number }
    previous: { weekStart: string; totalLoad: number }
    deltaPct: number | null
  }
  dailyLoadSeries: { date: string; load: number }[]
  acuteSeries: { date: string; value: number }[]
  chronicSeries: { date: string; value: number }[]
  openFlags: RiskFlag[]
}

export function AthletePerformanceHub({
  clientUserId,
  tab,
  latestReadiness,
  readinessTrend,
  activeInjuries,
  allInjuries,
  prs,
  recentTests,
  coachIntel,
  profile,
}: {
  clientUserId: string
  tab: string
  latestReadiness: DailyReadiness | null
  readinessTrend: { date: string; readiness_score: number }[]
  activeInjuries: Injury[]
  allInjuries: Injury[]
  prs: PerformanceTestPR[]
  recentTests: PerformanceTest[]
  coachIntel: CoachIntelSummary
  profile: ProfileSummary
}) {
  const grouped = recentTests.reduce<Record<string, PerformanceTest[]>>((acc, t) => {
    const key = t.test_type === "custom" ? `custom:${t.custom_name}` : t.test_type
    acc[key] = acc[key] ?? []
    acc[key].push(t)
    return acc
  }, {})

  const sparkline = coachIntel.dailyLoadSeries.slice(-7)

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
          <Button asChild variant="outline">
            <Link
              href={`/admin/clients/${clientUserId}/performance/log-session`}
            >
              + Log session
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
          <TabsTrigger value="load" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=load`}>Load</Link>
          </TabsTrigger>
          <TabsTrigger value="alerts" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=alerts`}>
              Alerts ({coachIntel.openFlags.length})
            </Link>
          </TabsTrigger>
          <TabsTrigger value="profile" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=profile`}>
              Profile
            </Link>
          </TabsTrigger>
          <TabsTrigger value="injuries" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=injuries`}>
              Injuries
            </Link>
          </TabsTrigger>
          <TabsTrigger value="tests" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=tests`}>Tests</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 grid gap-6 md:grid-cols-2">
          <ReadinessScoreGauge readiness={latestReadiness} />
          <TrainingLoadCard
            weeklyTotal={coachIntel.weeklyTotal}
            sparkline={sparkline}
          />
          <ActiveInjuriesCard injuries={activeInjuries} clientUserId={clientUserId} />
          <RiskFlagsCard flags={coachIntel.openFlags} />
          <OpenGoalsCard
            goals={profile.goals}
            goalsHref={`/admin/clients/${clientUserId}/performance?tab=profile`}
          />
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

        <TabsContent value="load" className="mt-6 space-y-6">
          <TrainingLoadChart
            daily={coachIntel.dailyLoadSeries}
            acute={coachIntel.acuteSeries}
            chronic={coachIntel.chronicSeries}
          />
          <ACWRChart
            acute={coachIntel.acuteSeries}
            chronic={coachIntel.chronicSeries}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <MonotonyStrainCard
              monotony={coachIntel.monotony}
              strain={coachIntel.strain}
            />
            <WeekOverWeekCard
              current={coachIntel.weekOverWeek.current}
              previous={coachIntel.weekOverWeek.previous}
              deltaPct={coachIntel.weekOverWeek.deltaPct}
            />
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="mt-6">
          <RiskFlagsList flags={coachIntel.openFlags} />
        </TabsContent>

        <TabsContent value="profile" className="mt-6 grid gap-6 md:grid-cols-2">
          <AthleteRadarCard tests={profile.tests} />
          <TrainingStreakHeatmap sessions={profile.sessions} />
          <BadgeShelfCard badges={profile.badges} />
          <OpenGoalsCard
            goals={profile.goals}
            goalsHref={`/admin/clients/${clientUserId}/performance?tab=profile`}
          />
        </TabsContent>

        <TabsContent value="injuries" className="mt-6 space-y-6">
          <BodyMapDisplay injuries={allInjuries} clientUserId={clientUserId} />
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
