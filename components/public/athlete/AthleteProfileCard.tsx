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
 * Public athlete card — "Full Arena" broadcast package. The `.athlete-arena`
 * scope (globals.css) remaps the semantic tokens to the dark theme, so every
 * child styles itself with the usual semantic classes. Hero + stat strip
 * always render; every other section hides itself when the athlete has no
 * data for it, so a brand-new client still gets an honest, complete card.
 */
export function AthleteProfileCard({ data }: { data: AthleteProfileData }) {
  const hasRecords = data.gymRecords.length > 0 || data.fieldRecords.length > 0
  const hasProgram = data.program !== null || data.career.length > 0
  const hasBadges = data.badges.length > 0 || data.milestones.length > 0

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
        {hasRecords && <RecordsSection gym={data.gymRecords} field={data.fieldRecords} weightUnit={data.weightUnit} />}
        <AthleteRadarSection tests={data.radarTests} />
        {hasProgram && <ProgramSection program={data.program} career={data.career} />}
        {hasBadges && <BadgesSection badges={data.badges} milestones={data.milestones} />}
      </div>
      <FooterCta />
    </main>
  )
}
