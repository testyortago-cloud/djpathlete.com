// lib/db/athletes-page.ts — DAL for the single-row athletes_page_content
// table (00163). The admin /admin/marketing/athletes page owns writes; the
// public /athletes page reads.
import { createServiceRoleClient } from "@/lib/supabase"
import {
  STAGE_ICONS,
  type AthletesPageContent,
  type AthleteStage,
} from "@/lib/validators/athletes-page"

/**
 * Hard-coded fallback used when the row is missing OR the DB is unreachable.
 * Mirrors the seed in 00163 so the public page never renders with empty copy
 * even in degraded states.
 */
export const ATHLETES_PAGE_FALLBACK: AthletesPageContent = {
  hero_eyebrow: "Athletes",
  hero_heading_line_1: "Sports performance training",
  hero_heading_line_2: "for every stage of athlete.",
  hero_description:
    "Professional. Collegiate. Youth. Coming back from injury. The same training framework runs each stage, scaled to training age, sport and calendar.",
  stages_eyebrow: "The four stages",
  stages_heading: "One training system, scaled to where you actually are.",
  stages: [
    {
      id: "professional",
      icon: "plane",
      name: "Professional",
      heading: "Performance training for professional athletes",
      summary:
        "Year-round, individualized training built around touring reality: travel, time zones, tournament density and in-season load. Programming adjusts weekly to wellness markers and the equipment available at the venue. Already used by WTA professionals and professional pickleball players among the 500+ athletes coached.",
      pillars: [
        "Travel-friendly programming that moves with the schedule",
        "In-season load monitoring with weekly programming changes",
        "Career longevity prioritized over short peak windows",
      ],
    },
    {
      id: "collegiate",
      icon: "graduation_cap",
      name: "Collegiate & competitive amateur",
      heading: "Sports performance training for collegiate and competitive amateur athletes",
      summary:
        "A diagnostic-driven training plan instead of a roster template. Force production, asymmetry, movement quality and sport-specific output measured first, then strength training and speed training periodized across off-season, pre-season, in-season and post-season blocks. Works alongside school strength staff where they exist, not around them.",
      pillars: [
        "Diagnostic baseline before the program is written",
        "Year-round periodization built around the sport calendar",
        "Strength training that transfers to sprint speed, change of direction and rotational power",
      ],
    },
    {
      id: "youth",
      icon: "sparkles",
      name: "Youth & long-term development",
      heading: "Youth athletic performance training and long-term development",
      summary:
        "Strength training, movement quality and speed work programmed around training age and maturity, not chronological age. The NSCA's position is that supervised, age-appropriate resistance training is safe and effective for young athletes — and is one of the most effective injury-prevention tools available. Multi-sport participation is encouraged through the early teens; early single-sport specialization is not.",
      pillars: [
        "Age and stage-appropriate progression",
        "Movement quality, deceleration and change of direction trained from the foundation",
        "Long-term athletic development that protects the ceiling, not eight-week peaks",
      ],
    },
    {
      id: "return-to-sport",
      icon: "heart_pulse",
      name: "Return to sport",
      heading: "Return-to-performance training for athletes coming back from injury",
      summary:
        "The bridge between medical clearance and competition readiness. Force production, single-leg asymmetry, reactive strength and sport-specific output are measured, then closed with structured strength training and progressive reactive loading. Works alongside the clinical team; does not replace physiotherapy.",
      pillars: [
        "Return-to-performance assessment before the rebuild starts",
        "Asymmetry-targeted strength training programmed from data",
        "Progressive reactive and sport-specific reintegration",
      ],
    },
  ],
}

/** Fetches the single row; falls back to defaults on any error. Never throws. */
export async function getAthletesPageContent(): Promise<AthletesPageContent> {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("athletes_page_content")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
    if (error || !data) return ATHLETES_PAGE_FALLBACK
    return rowToContent(data as Record<string, unknown>)
  } catch {
    return ATHLETES_PAGE_FALLBACK
  }
}

export async function updateAthletesPageContent(
  input: AthletesPageContent,
): Promise<AthletesPageContent> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("athletes_page_content")
    .update(input)
    .eq("id", 1)
    .select("*")
    .single()
  if (error) throw new Error(`updateAthletesPageContent: ${error.message}`)
  return rowToContent(data as Record<string, unknown>)
}

/** Defensive JSONB coercion — same pattern as the about-page DAL. */
function rowToContent(row: Record<string, unknown>): AthletesPageContent {
  const stringField = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value : fallback
  const optionalStringField = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback

  return {
    hero_eyebrow: optionalStringField(row.hero_eyebrow, ATHLETES_PAGE_FALLBACK.hero_eyebrow),
    hero_heading_line_1: stringField(
      row.hero_heading_line_1,
      ATHLETES_PAGE_FALLBACK.hero_heading_line_1,
    ),
    hero_heading_line_2: stringField(
      row.hero_heading_line_2,
      ATHLETES_PAGE_FALLBACK.hero_heading_line_2,
    ),
    hero_description: stringField(row.hero_description, ATHLETES_PAGE_FALLBACK.hero_description),
    stages_eyebrow: optionalStringField(row.stages_eyebrow, ATHLETES_PAGE_FALLBACK.stages_eyebrow),
    stages_heading: stringField(row.stages_heading, ATHLETES_PAGE_FALLBACK.stages_heading),
    stages: stageArray(row.stages, ATHLETES_PAGE_FALLBACK.stages),
  }
}

function stageArray(value: unknown, fallback: AthleteStage[]): AthleteStage[] {
  if (!Array.isArray(value)) return fallback
  const out: AthleteStage[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const r = entry as Record<string, unknown>
    const id = r.id
    const icon = r.icon
    const name = r.name
    const heading = r.heading
    const summary = r.summary
    const pillars = r.pillars
    if (typeof id !== "string" || id.trim().length === 0) continue
    if (typeof icon !== "string" || !(STAGE_ICONS as readonly string[]).includes(icon)) continue
    if (typeof name !== "string" || name.trim().length === 0) continue
    if (typeof heading !== "string" || heading.trim().length === 0) continue
    if (typeof summary !== "string" || summary.trim().length === 0) continue
    if (!Array.isArray(pillars)) continue
    const validPillars = pillars.filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0,
    )
    if (validPillars.length === 0) continue
    out.push({
      id: id.trim(),
      icon: icon as AthleteStage["icon"],
      name: name.trim(),
      heading: heading.trim(),
      summary: summary.trim(),
      pillars: validPillars,
    })
  }
  return out.length > 0 ? out : fallback
}
