import type { AthleteProfileData } from "@/lib/profile-share/data"
import { AthleteHero } from "./AthleteHero"
import { StatTiles } from "./StatTiles"
import { RecordsSection } from "./RecordsSection"
import { AthleteRadarSection } from "./AthleteRadarSection"
import { ProgramSection } from "./ProgramSection"
import { BadgesSection } from "./BadgesSection"
import { ProfilePrintButton } from "./ProfilePrintButton"
import { FooterCta } from "./FooterCta"

/**
 * Public FIBA-style athlete card ("Dark Arena"). Hero + stat tiles always
 * render; every other section hides itself when the athlete has no data for
 * it, so a brand-new client still gets an honest, complete-looking card.
 */
export function AthleteProfileCard({ data }: { data: AthleteProfileData }) {
  const hasRecords = data.gymRecords.length > 0 || data.fieldRecords.length > 0
  const hasProgram = data.program !== null || data.career.length > 0
  const hasBadges = data.badges.length > 0 || data.milestones.length > 0

  return (
    <main className="print-document min-h-screen bg-background font-body text-foreground">
      <ProfilePrintButton />
      <AthleteHero data={data} />
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 md:px-6">
        <StatTiles stats={data.stats} />
        {hasRecords && <RecordsSection gym={data.gymRecords} field={data.fieldRecords} weightUnit={data.weightUnit} />}
        <AthleteRadarSection tests={data.radarTests} />
        {hasProgram && <ProgramSection program={data.program} career={data.career} />}
        {hasBadges && <BadgesSection badges={data.badges} milestones={data.milestones} />}
      </div>
      <FooterCta />
    </main>
  )
}
