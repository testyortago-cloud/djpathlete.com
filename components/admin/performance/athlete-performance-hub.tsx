"use client"

import Link from "next/link"
import {
  LayoutDashboard,
  Activity,
  Gauge,
  AlertTriangle,
  User,
  HeartPulse,
  Trophy,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PerformanceActionButtons } from "./performance-action-buttons"
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

  const alertCount = coachIntel.openFlags.length

  return (
    <div className="py-2">
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-[0.18em]">
            Athlete
          </p>
          <h1 className="font-heading text-primary text-3xl font-bold tracking-tight">
            Performance
          </h1>
        </div>
        <PerformanceActionButtons clientUserId={clientUserId} />
      </div>

      <Tabs defaultValue={tab}>
        <TabsList
          variant="line"
          className="border-border h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-0"
        >
          <TabsTrigger
            value="overview"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link href={`/admin/clients/${clientUserId}/performance?tab=overview`}>
              <LayoutDashboard className="size-4" strokeWidth={1.75} />
              Overview
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="readiness"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link href={`/admin/clients/${clientUserId}/performance?tab=readiness`}>
              <Activity className="size-4" strokeWidth={1.75} />
              Readiness
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="load"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link href={`/admin/clients/${clientUserId}/performance?tab=load`}>
              <Gauge className="size-4" strokeWidth={1.75} />
              Load
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="alerts"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link
              href={`/admin/clients/${clientUserId}/performance?tab=alerts`}
              className="flex items-center gap-1.5"
            >
              <AlertTriangle className="size-4" strokeWidth={1.75} />
              Alerts
              {alertCount > 0 && (
                <span className="bg-error/10 text-error inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {alertCount}
                </span>
              )}
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="profile"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link href={`/admin/clients/${clientUserId}/performance?tab=profile`}>
              <User className="size-4" strokeWidth={1.75} />
              Profile
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="injuries"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link href={`/admin/clients/${clientUserId}/performance?tab=injuries`}>
              <HeartPulse className="size-4" strokeWidth={1.75} />
              Injuries
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="tests"
            asChild
            className="font-heading h-10 px-3 text-sm font-medium tracking-wide"
          >
            <Link href={`/admin/clients/${clientUserId}/performance?tab=tests`}>
              <Trophy className="size-4" strokeWidth={1.75} />
              Tests
            </Link>
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
