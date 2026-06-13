// lib/db/step-up-page.ts — DAL for the single-row step_up_page_content table
// (00169). The admin /admin/marketing/step-up page owns writes; the public
// /step-up-for-students page reads the Packages section from here.
import { createServiceRoleClient } from "@/lib/supabase"
import type { StepUpPackage, StepUpPageContent } from "@/lib/validators/step-up-page"

/**
 * Hard-coded fallback used when the row is missing OR the DB is unreachable.
 * Mirrors the seed in 00169 so the public Packages section never renders empty
 * even in degraded states.
 */
export const STEP_UP_PAGE_FALLBACK: StepUpPageContent = {
  packages_eyebrow: "Scholarship-Ready Packages",
  packages_heading: "Packages Designed for Step Up Families",
  packages_intro:
    "Every package is structured to align with Step Up's quarterly funding cycle and can be billed directly through the EMA portal — no out-of-pocket payment required for eligible families.",
  packages: [
    {
      badge: "Entry Point · One-Time",
      title: "Athletic Performance Assessment",
      desc: "The diagnostic foundation. Understand exactly where your athlete is — and where they need to go — before committing to a program.",
      items: [
        "Speed & acceleration testing (10/40-yard)",
        "Vertical jump & power output",
        "Agility & change-of-direction testing",
        "Movement quality & mobility screen",
        "Personalized performance report",
        "30-min parent consultation",
      ],
      cta: "Book Assessment",
      featured: false,
    },
    {
      badge: "★ Most Popular",
      title: "Hybrid Performance Package",
      desc: "A hybrid of in-person sessions, small-group training, and online app-based programming — built around your athlete's goals, sport, and competition schedule. Aligns with quarterly scholarship disbursements.",
      items: [
        "In-person performance sessions",
        "Small-group training",
        "Online app-based sessions & programming",
        "Individualized program design",
        "Monthly progress re-testing",
        "Parent progress updates",
        "Direct EMA billing available",
      ],
      cta: "Get Started",
      featured: true,
    },
    {
      badge: "Clinic · Aligned to Funding Quarter",
      title: "Agility Clinic",
      desc: "A structured agility clinic to develop speed, reaction, and movement confidence — run in blocks that line up with each scholarship disbursement.",
      items: [
        "Pre- and post-clinic agility testing",
        "Sport-specific change-of-direction drills",
        "Reaction & decision-making work",
        "Runs as a clinic aligned to each funding quarter",
        "Small-group or individual format",
      ],
      cta: "Enquire",
      featured: false,
    },
    {
      badge: "Homeschool · Year-Round",
      title: "Homeschool Athlete PE Program",
      desc: "Structured athletic development designed specifically for homeschool families. Fulfils PE requirements with measurable, documented progress.",
      items: [
        "Weekly structured training sessions",
        "PE-standard documentation & reporting",
        "Athletic skill progression tracking",
        "Year-round enrollment available",
        "Social group training environment",
        "PEP scholarship-aligned billing",
      ],
      cta: "Book a Spot",
      featured: false,
    },
  ],
}

/** Fetches the single row; falls back to defaults on any error. Never throws. */
export async function getStepUpPageContent(): Promise<StepUpPageContent> {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("step_up_page_content")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
    if (error || !data) return STEP_UP_PAGE_FALLBACK
    return rowToContent(data as Record<string, unknown>)
  } catch {
    return STEP_UP_PAGE_FALLBACK
  }
}

export async function updateStepUpPageContent(
  input: StepUpPageContent,
): Promise<StepUpPageContent> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("step_up_page_content")
    .update(input)
    .eq("id", 1)
    .select("*")
    .single()
  if (error) throw new Error(`updateStepUpPageContent: ${error.message}`)
  return rowToContent(data as Record<string, unknown>)
}

/** Defensive JSONB coercion — same pattern as the athletes-page DAL. */
function rowToContent(row: Record<string, unknown>): StepUpPageContent {
  const stringField = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value : fallback
  const optionalStringField = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback

  return {
    packages_eyebrow: optionalStringField(
      row.packages_eyebrow,
      STEP_UP_PAGE_FALLBACK.packages_eyebrow,
    ),
    packages_heading: stringField(row.packages_heading, STEP_UP_PAGE_FALLBACK.packages_heading),
    packages_intro: stringField(row.packages_intro, STEP_UP_PAGE_FALLBACK.packages_intro),
    packages: packageArray(row.packages, STEP_UP_PAGE_FALLBACK.packages),
  }
}

function packageArray(value: unknown, fallback: StepUpPackage[]): StepUpPackage[] {
  if (!Array.isArray(value)) return fallback
  const out: StepUpPackage[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const r = entry as Record<string, unknown>
    const title = r.title
    const desc = r.desc
    const cta = r.cta
    const items = r.items
    if (typeof title !== "string" || title.trim().length === 0) continue
    if (typeof desc !== "string" || desc.trim().length === 0) continue
    if (typeof cta !== "string" || cta.trim().length === 0) continue
    if (!Array.isArray(items)) continue
    const validItems = items.filter(
      (it): it is string => typeof it === "string" && it.trim().length > 0,
    )
    if (validItems.length === 0) continue
    out.push({
      badge: typeof r.badge === "string" ? r.badge.trim() : "",
      title: title.trim(),
      desc: desc.trim(),
      items: validItems,
      cta: cta.trim(),
      featured: r.featured === true,
    })
  }
  return out.length > 0 ? out : fallback
}
