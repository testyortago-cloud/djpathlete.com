// lib/db/about-page.ts — DAL for the single-row about_page_content table
// (00161). The admin /admin/marketing/about page owns writes; the public
// /about page reads.
import { createServiceRoleClient } from "@/lib/supabase"
import type { AboutPageContent } from "@/lib/validators/about-page"

/**
 * Hard-coded fallback used when the row is missing OR the DB is unreachable.
 * Mirrors the seed in 00161 so the public page never renders with empty copy
 * even in degraded states. Keep in sync with the migration on intentional
 * default changes.
 */
export const ABOUT_PAGE_FALLBACK: AboutPageContent = {
  hero_eyebrow: "Meet Your Coach",
  hero_heading: "About Darren J Paul",
  hero_credentials_line: "PhD · Sports Performance Coach · CSCS · NASM",
  hero_bio_paragraphs: [
    "Performance strategist, coach, and researcher. Two decades inside high-performance environments. 500+ athletes coached across 15+ sports and 3 continents — including WTA professional tennis players and pro pickleball players.",
    "I think in systems, not exercises. I look for patterns, not shortcuts. Every program is built from diagnostic data and adjusted in real time.",
  ],
  aeo_eyebrow: "In short",
  aeo_question: "Who is Darren J Paul?",
  aeo_answer:
    "Darren J Paul, PhD, is a sports performance coach and the founder of DJP Athlete, based in Zephyrhills, Florida (Tampa Bay area). He has spent two decades inside high-performance environments and has coached 500+ athletes across 15+ sports and three continents, including WTA professional tennis players and professional pickleball players. His certifications include CSCS (NSCA) and NASM-CPT, alongside a PhD and a degree in exercise science. He delivers in-person training at his Tampa Bay facility and online coaching for athletes worldwide, plus return-to-performance assessments for athletes coming back from injury. His approach is diagnostic-driven and individualized: systems over exercises, patterns over shortcuts.",
  story_heading: "The Journey",
  story_paragraphs: [
    "I grew up as a multi-sport athlete — competing in track and field, football, and basketball through college. Along the way, I experienced firsthand what it is like to train without proper guidance. Nagging injuries, plateaus, and burnout were constant companions.",
    "When I discovered the science of athletic performance — periodization, biomechanics, and sport psychology — everything changed. I realized that with the right approach, athletes could train harder while staying healthier and performing at levels they never thought possible.",
    "That realization became my mission. I went back to school for Exercise Science, earned my certifications, and started coaching. DJP Athlete is the culmination of everything I have learned — a platform where every athlete, regardless of level, can access the coaching and tools they need to reach their full potential.",
  ],
  cta_eyebrow: "Ready to start training?",
  cta_heading: "Ready to start training?",
  cta_description:
    "Whether you are an aspiring athlete or a seasoned competitor, there is a place for you here.",
  cta_button_label: "Get in Touch",
  cta_button_href: "/contact",
}

/** Fetches the single row; falls back to defaults on any error. Never throws. */
export async function getAboutPageContent(): Promise<AboutPageContent> {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("about_page_content")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
    if (error || !data) return ABOUT_PAGE_FALLBACK
    return rowToContent(data as Record<string, unknown>)
  } catch {
    return ABOUT_PAGE_FALLBACK
  }
}

/** Persists the full content set. Throws on error so the API layer can surface it. */
export async function updateAboutPageContent(
  input: AboutPageContent,
): Promise<AboutPageContent> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("about_page_content")
    .update(input)
    .eq("id", 1)
    .select("*")
    .single()
  if (error) throw new Error(`updateAboutPageContent: ${error.message}`)
  return rowToContent(data as Record<string, unknown>)
}

/**
 * The DB returns JSONB columns as plain arrays/objects, but typed loosely as
 * `unknown` through the Supabase client. Coerce defensively so a hand-edited
 * row with bad JSON shape can't crash the public page.
 */
function rowToContent(row: Record<string, unknown>): AboutPageContent {
  const stringArray = (value: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(value)) return fallback
    const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    return out.length > 0 ? out : fallback
  }
  const stringField = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value : fallback

  return {
    hero_eyebrow: stringField(row.hero_eyebrow, ABOUT_PAGE_FALLBACK.hero_eyebrow),
    hero_heading: stringField(row.hero_heading, ABOUT_PAGE_FALLBACK.hero_heading),
    hero_credentials_line: stringField(
      row.hero_credentials_line,
      ABOUT_PAGE_FALLBACK.hero_credentials_line,
    ),
    hero_bio_paragraphs: stringArray(
      row.hero_bio_paragraphs,
      ABOUT_PAGE_FALLBACK.hero_bio_paragraphs,
    ),
    aeo_eyebrow: stringField(row.aeo_eyebrow, ABOUT_PAGE_FALLBACK.aeo_eyebrow),
    aeo_question: stringField(row.aeo_question, ABOUT_PAGE_FALLBACK.aeo_question),
    aeo_answer: stringField(row.aeo_answer, ABOUT_PAGE_FALLBACK.aeo_answer),
    story_heading: stringField(row.story_heading, ABOUT_PAGE_FALLBACK.story_heading),
    story_paragraphs: stringArray(
      row.story_paragraphs,
      ABOUT_PAGE_FALLBACK.story_paragraphs,
    ),
    cta_eyebrow: stringField(row.cta_eyebrow, ABOUT_PAGE_FALLBACK.cta_eyebrow),
    cta_heading: stringField(row.cta_heading, ABOUT_PAGE_FALLBACK.cta_heading),
    cta_description: stringField(row.cta_description, ABOUT_PAGE_FALLBACK.cta_description),
    cta_button_label: stringField(row.cta_button_label, ABOUT_PAGE_FALLBACK.cta_button_label),
    cta_button_href: stringField(row.cta_button_href, ABOUT_PAGE_FALLBACK.cta_button_href),
  }
}
