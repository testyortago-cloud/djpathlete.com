// functions/src/lib/topic-themes.ts
//
// Coarse thematic buckets for sport-science blog topics, used to stop one
// research niche from monopolising the weekly brief.
//
// WHY THIS EXISTS. The weekly scan runs a fixed query list against Tavily with
// no per-theme quota. Tavily happily returns eight force-velocity papers for a
// query set that contains ONE force-velocity query, because the same handful of
// heavily-cited F-V studies also rank for the sprint, plyometric and
// periodization queries. Between 2026-07-14 and 2026-09-10 that produced four
// near-identical "Force Velocity Profile ..." drafts and two "RMSSD ..." drafts
// out of roughly sixteen. Near-duplicate TITLE matching (research-candidates.ts)
// does not catch this: "Force-Velocity Profile Reliability by Exercise Mode" and
// "F-V Profile Imbalance as a Training Target" are genuinely different papers
// about the same thing, and score well under the 0.55 similarity threshold.
//
// The fix is a quota, not a better similarity metric: cap how many candidates
// from any one theme are allowed to reach the ranking model at all.
//
// TWIN FILE. `functions/` has rootDir "src" and cannot import from `lib/`, and
// both runtimes need this: the scanner caps candidates (functions/), the
// auto-blog cron avoids repeating a recently-published theme (app/ -> lib/).
// The twin is `lib/blog/topic-themes.ts` and the two MUST stay identical —
// `__tests__/lib/blog/topic-themes-twin.test.ts` fails if they drift.

export interface TopicTheme {
  key: string
  label: string
  patterns: RegExp[]
}

/**
 * FIRST MATCH WINS, so order matters: the more specific mechanism sits above
 * the broader surface it shows up in. "Individual Load-Velocity Profiling for
 * Resisted Sprint Prescription" is a force-velocity topic that mentions sprint,
 * not a sprint topic — so `force_velocity` is tested before `sprint_speed`.
 */
export const TOPIC_THEMES: readonly TopicTheme[] = [
  {
    key: "force_velocity",
    label: "Force–velocity profiling & velocity-based training",
    patterns: [/force[-\s]?velocity/i, /\bf-?v\s+profil/i, /velocity[-\s]?based/i, /\bvbt\b/i, /load[-\s]?velocity/i],
  },
  {
    key: "eccentric_rfd",
    label: "Eccentric loading, plyometrics & rate of force development",
    patterns: [/eccentric/i, /plyometric/i, /rate of force development/i, /\brfd\b/i, /stretch[-\s]?shortening/i],
  },
  {
    key: "deceleration_cod",
    label: "Deceleration, braking & change of direction",
    patterns: [/deceleration/i, /braking/i, /change[-\s]of[-\s]direction/i, /\bcod\b/i, /agility/i, /cutting/i],
  },
  {
    key: "conditioning_aerobic",
    label: "Energy systems & aerobic conditioning",
    patterns: [
      /aerobic/i,
      /\bvo2/i,
      /\bmas\b/i,
      /maximal aerobic speed/i,
      /conditioning/i,
      /\bhiit\b/i,
      /interval/i,
      /yo-?yo/i,
      /repeated[-\s]sprint/i,
    ],
  },
  {
    key: "sprint_speed",
    label: "Sprint mechanics & speed development",
    // NOTE the negative lookbehind on \bspeed\b: "maximal aerobic speed" and
    // "change-of-direction speed" are not sprint topics, and the bare word was
    // silently claiming both before conditioning_aerobic or deceleration_cod
    // could be reached.
    patterns: [/sprint/i, /acceleration/i, /(?<!aerobic )(?<!direction )\bspeed\b/i, /horizontal force/i, /stride/i],
  },
  // These two sit ABOVE monitoring_recovery deliberately. Their vocabulary is
  // specific ("nutrition", "creatine", "psycholog", "anxiet") while
  // monitoring_recovery owns the generic words "recovery" and "readiness" —
  // tested the other way round, a fuelling paper that mentions recovery, or a
  // psychology paper about readiness, was filed as athlete monitoring. Both
  // themes then looked empty and the cap had nothing to protect them from.
  {
    key: "nutrition_fueling",
    label: "Nutrition, fuelling & supplementation",
    patterns: [
      /nutrition/i,
      /fuelling/i,
      /fueling/i,
      /carbohydrate/i,
      /protein intake/i,
      /creatine/i,
      /hydration/i,
      /supplement/i,
    ],
  },
  {
    key: "psychology_readiness",
    label: "Sport psychology & mental performance",
    patterns: [
      /psycholog/i,
      /mental/i,
      /motivation/i,
      /anxiet/i,
      /confidence/i,
      /burnout/i,
      /psychosocial/i,
      /fear of re-?injury/i,
    ],
  },
  {
    key: "monitoring_recovery",
    label: "Athlete monitoring, sleep & recovery",
    patterns: [
      /\bhrv\b/i,
      /rmssd/i,
      /heart rate variability/i,
      /\bacwr\b/i,
      /workload/i,
      /\bsleep\b/i,
      /monitoring/i,
      /readiness/i,
      /recovery/i,
    ],
  },
  {
    key: "periodization_strength",
    label: "Periodization & resistance-training programming",
    patterns: [
      /periodi[sz]ation/i,
      /undulating/i,
      /\b1rm\b/i,
      /resistance training/i,
      /hypertroph/i,
      /strength gain/i,
      /progressive overload/i,
    ],
  },
  {
    key: "return_to_sport",
    label: "Injury, rehabilitation & return to sport",
    patterns: [
      /\bacl\b/i,
      /return[-\s]to[-\s](sport|play|performance)/i,
      /\brts\b/i,
      /rehabilitat/i,
      /reconditioning/i,
      /injur/i,
      /re-?injury/i,
      /hamstring strain/i,
      /tendon/i,
    ],
  },
  {
    key: "youth_ltad",
    label: "Youth development & maturation",
    patterns: [
      /youth/i,
      /\bltad\b/i,
      /maturation/i,
      /adolescen/i,
      /\bphv\b/i,
      /long[-\s]term athletic development/i,
      /biological age/i,
    ],
  },
] as const

export const OTHER_THEME_KEY = "other"

/**
 * Classifies a topic title into one of TOPIC_THEMES, or OTHER_THEME_KEY when
 * nothing matches. Matching is first-match-wins over the ordered table above.
 */
export function themeOf(title: string): string {
  if (!title) return OTHER_THEME_KEY
  for (const theme of TOPIC_THEMES) {
    if (theme.patterns.some((p) => p.test(title))) return theme.key
  }
  return OTHER_THEME_KEY
}

export function themeLabel(key: string): string {
  return TOPIC_THEMES.find((t) => t.key === key)?.label ?? "Other"
}

/**
 * Caps how many items share a theme, preserving input order so an upstream
 * relevance ordering survives. Items classified OTHER_THEME_KEY are NOT capped
 * as a group — "other" is a catch-all, not a topic, and throttling it would
 * suppress genuinely novel material that no pattern has learned to name yet.
 */
export function capPerTheme<T>(items: T[], maxPerTheme: number, titleOf: (item: T) => string): T[] {
  if (maxPerTheme <= 0) return []
  const counts = new Map<string, number>()
  const kept: T[] = []
  for (const item of items) {
    const key = themeOf(titleOf(item))
    if (key === OTHER_THEME_KEY) {
      kept.push(item)
      continue
    }
    const seen = counts.get(key) ?? 0
    if (seen >= maxPerTheme) continue
    counts.set(key, seen + 1)
    kept.push(item)
  }
  return kept
}

/** Distinct themes present in a list of titles, in first-seen order. */
export function themesPresent(titles: string[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const t of titles) {
    const key = themeOf(t)
    if (!seen.has(key)) {
      seen.add(key)
      order.push(key)
    }
  }
  return order
}
