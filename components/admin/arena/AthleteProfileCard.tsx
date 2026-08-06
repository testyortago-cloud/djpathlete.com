import type { AthleteProfileData } from "@/lib/profile-share/data"
import { buildProgressions } from "@/lib/profile-share/progression"
import { AthleteHero } from "./AthleteHero"
import { StatTiles } from "./StatTiles"
import { RecordsSection } from "./RecordsSection"
import { ProgressionSection } from "./ProgressionSection"
import { TrainingLoadChart } from "./TrainingLoadChart"
import { TestTrendCharts } from "./TestTrendCharts"
import { AssessmentsSection } from "./AssessmentsSection"
import { AthleteRadarSection } from "./AthleteRadarSection"
import { ProgramSection } from "./ProgramSection"
import { BadgesSection } from "./BadgesSection"
import { ProfilePrintButton } from "@/components/shared/ProfilePrintButton"
import { FooterCta } from "./FooterCta"
import { ArenaTabs, type ArenaTab } from "./ArenaTabs"

/**
 * Public athlete card — "Full Arena" broadcast package. The `.athlete-arena`
 * scope (globals.css) remaps the semantic tokens to the dark theme, so every
 * child styles itself with the usual semantic classes.
 *
 * Layout: hero + stat strip always visible, then the sections grouped into
 * tabs (Progress / Performance / Program / Awards). Tabs with no content for
 * this athlete are omitted; one populated tab renders without a tab bar; the
 * PDF prints every tab stacked (see the arena print rules in globals.css).
 */
export function AthleteProfileCard({ data }: { data: AthleteProfileData }) {
  const progressions = buildProgressions(data.radarTests)
  const hasRecords = data.gymRecords.length > 0 || data.fieldRecords.length > 0
  const hasProgram = data.program !== null || data.career.length > 0
  const hasBadges = data.badges.length > 0 || data.milestones.length > 0
  const hasRadar = data.radarTests.length > 0

  const tabs: ArenaTab[] = []
  if (progressions.length > 0 || data.monthlyTraining.length > 0 || hasRadar) {
    tabs.push({
      value: "progress",
      label: "Progress",
      content: (
        <>
          <ProgressionSection progressions={progressions} />
          <TrainingLoadChart data={data.monthlyTraining} />
          <AthleteRadarSection tests={data.radarTests} />
        </>
      ),
    })
  }
  if (hasRecords || progressions.length > 0 || data.assessments.length > 0) {
    tabs.push({
      value: "performance",
      label: "Performance",
      content: (
        <>
          {hasRecords && (
            <RecordsSection gym={data.gymRecords} field={data.fieldRecords} weightUnit={data.weightUnit} />
          )}
          <TestTrendCharts progressions={progressions} />
          <AssessmentsSection assessments={data.assessments} />
        </>
      ),
    })
  }
  if (hasProgram) {
    tabs.push({
      value: "program",
      label: "Program",
      content: <ProgramSection program={data.program} career={data.career} />,
    })
  }
  if (hasBadges) {
    tabs.push({
      value: "awards",
      label: "Awards",
      content: <BadgesSection badges={data.badges} milestones={data.milestones} />,
    })
  }

  return (
    <main className="athlete-arena print-document relative flex min-h-screen flex-col bg-background font-body text-foreground">
      {/* Ambient arena field — warm broadcast glow top-right, cool floor bounce
          bottom-left, plus a faint court grid. Behind all content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 45% at 85% 0%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 55%), radial-gradient(ellipse 50% 40% at 0% 100%, color-mix(in oklab, var(--primary) 8%, transparent), transparent 60%), radial-gradient(ellipse 40% 30% at 10% 8%, oklch(1 0 0 / 0.04), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(oklch(1 0 0 / 0.03) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 0.03) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <ProfilePrintButton />
      <AthleteHero data={data} />
      {/* flex-1 pins the footer to the viewport bottom on sparse cards. */}
      <div className="relative z-10 mx-auto w-full max-w-4xl flex-1 px-4 md:px-6">
        <StatTiles stats={data.stats} />
        <ArenaTabs tabs={tabs} />
      </div>
      <FooterCta />
    </main>
  )
}
