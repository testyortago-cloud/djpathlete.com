// lib/quizzes/seed/rpi-athlete-quiz.ts — the RPI quiz, reconstructed.
//
// A TYPED MODULE, NOT A SQL SEED, for one reason: a SQL seed cannot be run
// through `quizGate`. This one can, and a unit test asserting the gate passes
// means the seed physically cannot ship in a state the activation gate would
// reject. A seed the gate validates in CI beats a seed that is merely
// idempotent.
//
// PROVENANCE. `ghl-export/2026-08-17T02-41-39/` does NOT contain the quiz.
// GHL exports form definitions; the Athlete Quiz is a *survey*, and all twelve
// quiz workflows exported as bare metadata — id, name, status, timestamps,
// nothing else. What survived is the 201 custom-field definitions, and the
// prompts and option labels below are lifted verbatim from them.
//
// WHAT DID NOT SURVIVE: the weights, the tier cutoffs and the routing rules.
// They lived in the workflow steps. Every number in this file is therefore
// INVENTED — a documented, defensible default, marked by SEED_MARKER so the
// editor can say so on screen. Nobody should mistake it for Darren's
// judgement. See spec §6.2.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §6

import type { QuizDefinition, QuizOption, QuizProfile, QuizQuestion, QuizTier } from "@/lib/quizzes/types"

/** Cleared the first time a human saves the quiz; drives the editor banner. */
export const SEED_MARKER = "reconstructed-from-ghl-export-2026-08-23"

export interface SeedOption {
  label: string
  weight: number
  routesToBranch?: string
  profile?: string
}

export interface SeedQuestion {
  /** Stable within the seed; also the synthetic id in `toDefinition`. */
  key: string
  branch: string | null
  position: number
  prompt: string
  options: SeedOption[]
}

export interface SeedQuiz {
  key: string
  name: string
  introHeadline: string
  introBody: string
  gateHeadline: string
  gateBody: string
  resultHeadline: string
  branches: { key: string; name: string; description: string | null; position: number }[]
  profiles: { key: string; name: string; description: string; position: number }[]
  tiers: { key: string; position: number; minScore: number; maxScore: number; headline: string; body: string }[]
  questions: SeedQuestion[]
}

/**
 * Weights run 3 / 2 / 1 / 0 across the four options as listed, best first,
 * except where a question is marked segmentation (all zero) or states its own.
 *
 * TWO GHL TYPOS ARE CORRECTED HERE, and the correction is deliberate rather
 * than silent: ". Cleared 3-12 months ago" and ". Sport-related but generic"
 * both carried a stray leading period in the export.
 */
const BEST_FIRST = [3, 2, 1, 0]

function scored(labels: string[], weights: number[] = BEST_FIRST): SeedOption[] {
  return labels.map((label, i) => ({ label, weight: weights[i] ?? 0 }))
}

/** All-zero: the documented segmentation marker. Cannot move the percentage. */
function segmentation(labels: string[]): SeedOption[] {
  return labels.map((label) => ({ label, weight: 0 }))
}

// Questions re-asked on more than one branch. Declared once so a copy edit
// cannot drift between two branches that are supposed to ask the same thing.
const Q_STRUCTURE = {
  prompt: "How would you describe the structure behind your current training?",
  labels: [
    "Built around individual diagnostics with a clear system",
    "Programmed by a coach but generic",
    "Self-directed / pieced together from multiple sources",
    "Inconsistent or no real structure",
  ],
}
const Q_SPECIFICITY = {
  prompt: "How specific is your training to the actual physical demands of your sport?",
  labels: [
    "Highly specific — built around my sport's profile",
    "Sport-aware but largely generic",
    "General athletic training",
    "Not sport-specific at all",
  ],
}
const Q_ASSESSED = {
  prompt: "When were you last formally assessed for performance — not a movement screen or rehab clearance?",
  labels: [
    "Within the last 6 months — full system assessment",
    "Within the last 2 years",
    "Movement screen / rehab clearance only",
    "Never",
  ],
}
const Q_ROTATIONAL = {
  prompt: "How confident are you in your rotational power and control — cutting, throwing, twisting, change of direction?",
  labels: [
    "Strong, refined, and tested",
    "Adequate but never specifically trained",
    "A weak point I haven't addressed",
    "Never trained or assessed it",
  ],
}
const Q_ASYMMETRY = {
  prompt: "Do you know how asymmetric your body is — left vs. right — in strength and power?",
  labels: [
    "Yes, measured and addressed",
    "Roughly aware, not tested",
    "Assume there's a difference but never quantified",
    "Never thought about it",
  ],
}
const Q_HOLD_UP = {
  prompt: "How confident are you that current training will hold up over the next 3–5 years?",
  labels: [
    "Very — there's a clear long-term plan",
    "Hopeful but unsure",
    "Doubtful — currently short-term focused",
    "No long-term plan in place",
  ],
}

export const RPI_ATHLETE_QUIZ: SeedQuiz = {
  key: "rpi_athlete_quiz",
  name: "Athlete Quiz (RPI)",
  introHeadline: "Find out what's silently limiting your performance",
  introBody:
    "A few questions about your sport, your training and how your body is holding up. It takes about three minutes, and you'll get a readout at the end.",
  gateHeadline: "Where should we send your readout?",
  gateBody: "Your answers are scored against the same profile we use in a full assessment.",
  resultHeadline: "Your Readiness & Performance Index",

  branches: [
    { key: "ceiling_breaker", name: "Ceiling Breaker", description: "Pushing performance to a higher level.", position: 1 },
    { key: "rebuilder", name: "Rebuilder", description: "Coming back from injury or recurring breakdown.", position: 2 },
    { key: "aspiring_pro", name: "Aspiring Pro", description: "Young athlete building toward something serious.", position: 3 },
    { key: "parent_coach", name: "Parent or Coach", description: "Looking for the right system for an athlete.", position: 4 },
  ],

  // `not_sure` sits at position 0 so it is the no-vote fallback — which is
  // exactly what an answer set with no signal means. Descriptions are the
  // export's own, split on the ─ that separated name from gloss.
  profiles: [
    { key: "not_sure", name: "Not sure where it's leaking", description: "Something's off but hard to pinpoint.", position: 0 },
    { key: "explosive_but_tight", name: "Explosive but tight", description: "The power's there, but stiffness limits it.", position: 1 },
    { key: "mobile_but_weak", name: "Mobile but weak", description: "Flexibility is fine, force transfer isn't.", position: 2 },
    { key: "struggle_in_transitions", name: "Struggle in transitions", description: "Direction changes and rotation feel disconnected.", position: 3 },
    { key: "strong_but_slow", name: "Strong but slow", description: "Strength is there but it doesn't translate.", position: 4 },
  ],

  // Higher is better, so RED IS THE MOST URGENT. That is why Red and Orange
  // are the tiers that alert and open a pipeline card.
  tiers: [
    { key: "red", position: 1, minScore: 0, maxScore: 39, headline: "Large gaps worth addressing now", body: "Several of the things that decide whether your body holds up are missing. That is fixable, and it is worth knowing which ones." },
    { key: "orange", position: 2, minScore: 40, maxScore: 59, headline: "Real gaps, and they are findable", body: "You have a base to work from, but there are clear holes that will keep costing you until they are identified." },
    { key: "yellow", position: 3, minScore: 60, maxScore: 79, headline: "Mostly holding up", body: "The foundation is largely there. What is left is the specific work that separates consistent from exceptional." },
    { key: "green", position: 4, minScore: 80, maxScore: 100, headline: "Well prepared", body: "You are doing most of the right things. The value now is in precision — finding the small asymmetries that still cost output." },
  ],

  questions: [
    // ---- Router ------------------------------------------------------------
    {
      key: "router",
      branch: null,
      position: 10,
      prompt: "Which describes you best?",
      options: [
        { label: "I'm an athlete looking to push my performance to a higher level", weight: 0, routesToBranch: "ceiling_breaker" },
        { label: "I'm an athlete coming back from injury or recurring breakdown", weight: 0, routesToBranch: "rebuilder" },
        { label: "I'm a young athlete building toward something serious", weight: 0, routesToBranch: "aspiring_pro" },
        { label: "I'm a parent or coach looking for the right system for an athlete", weight: 0, routesToBranch: "parent_coach" },
      ],
    },

    // ---- Shared segmentation ----------------------------------------------
    {
      key: "sport_demand",
      branch: null,
      position: 20,
      prompt: "What's your sport's primary physical demand?",
      options: segmentation([
        "Rotational / multi-directional (golf, tennis, baseball, hockey, MMA, throwing)",
        "Repeated sprint and change of direction (soccer, rugby, field sports)",
        "Contact and collision",
        "Endurance dominant",
      ]),
    },
    {
      key: "six_month_goal",
      branch: null,
      position: 30,
      prompt: "What are you working toward in the next 6 months?",
      options: segmentation([
        "A defined competition, selection, or performance target",
        "General improvement and consistency",
        "Returning to full performance after injury or setback",
        "Building long-term foundation",
      ]),
    },

    // The profile is ANSWERED, not inferred. All five votes sit on this one
    // question, which is why §1.9's vote mechanism needs no special case.
    {
      key: "profile_self_select",
      branch: null,
      position: 40,
      prompt: "Which of these sounds most like you?",
      options: [
        { label: "Explosive but tight — the power's there, but stiffness limits it", weight: 0, profile: "explosive_but_tight" },
        { label: "Mobile but weak — flexibility is fine, force transfer isn't", weight: 0, profile: "mobile_but_weak" },
        { label: "Struggle in transitions — direction changes and rotation feels disconnected", weight: 0, profile: "struggle_in_transitions" },
        { label: "Strong but slow — strength is there but it doesn't translate", weight: 0, profile: "strong_but_slow" },
        { label: "Not sure where it's leaking — something's off but hard to pinpoint", weight: 0, profile: "not_sure" },
      ],
    },

    // ---- ceiling_breaker ---------------------------------------------------
    {
      key: "cb_trajectory",
      branch: "ceiling_breaker",
      position: 50,
      prompt: "How do you feel about your current performance trajectory?",
      options: scored([
        "Hitting new ceilings consistently",
        "Stalled at the same level for a while",
        "Inconsistent — high and low days",
        "Frustrated and unable to identify why",
      ]),
    },
    {
      key: "cb_fatigue",
      branch: "ceiling_breaker",
      position: 55,
      prompt: "When competition gets long or fatigue sets in, what tends to drop first?",
      options: scored([
        "Nothing — I hold output throughout",
        "Decision-making and focus",
        "Speed and explosiveness",
        "Multiple things — the wheels come off",
      ]),
    },
    { key: "cb_structure", branch: "ceiling_breaker", position: 60, prompt: Q_STRUCTURE.prompt, options: scored(Q_STRUCTURE.labels) },
    { key: "cb_specificity", branch: "ceiling_breaker", position: 65, prompt: Q_SPECIFICITY.prompt, options: scored(Q_SPECIFICITY.labels) },
    { key: "cb_assessed", branch: "ceiling_breaker", position: 70, prompt: Q_ASSESSED.prompt, options: scored(Q_ASSESSED.labels) },
    { key: "cb_rotational", branch: "ceiling_breaker", position: 75, prompt: Q_ROTATIONAL.prompt, options: scored(Q_ROTATIONAL.labels) },
    { key: "cb_asymmetry", branch: "ceiling_breaker", position: 80, prompt: Q_ASYMMETRY.prompt, options: scored(Q_ASYMMETRY.labels) },

    // ---- rebuilder ---------------------------------------------------------
    // STATES ITS OWN WEIGHTS. "Currently still recovering" and "chronic
    // recurrence" are both the worst case here, so the band is 0 / 2 / 1 / 0
    // rather than the usual descent — recency alone is not a ranking.
    {
      key: "rb_recency",
      branch: "rebuilder",
      position: 50,
      prompt: "How recent is your injury or breakdown?",
      options: scored(
        [
          "Currently still recovering / not cleared",
          "Recently cleared (within 3 months)",
          "Cleared 3–12 months ago but still hesitant",
          "Multiple cycles or chronic recurrence",
        ],
        [0, 2, 1, 0],
      ),
    },
    {
      key: "rb_confidence",
      branch: "rebuilder",
      position: 55,
      prompt: "How confident do you feel during high-speed or explosive movements?",
      options: scored([
        "Very confident",
        "Some hesitation",
        "Quite hesitant",
        "Avoiding them due to injury concern",
      ]),
    },
    {
      key: "rb_deceleration",
      branch: "rebuilder",
      position: 60,
      prompt: "When you decelerate or change direction at full speed, how does your body respond?",
      options: scored([
        "Stable and aggressive",
        "In control but tentative",
        "Cautious — I don't trust the brakes",
        "I avoid full-speed deceleration",
      ]),
    },
    {
      key: "rb_cause",
      branch: "rebuilder",
      position: 65,
      prompt: "How confident are you that the underlying cause of the injury has been addressed?",
      options: scored([
        "Fully confident",
        "Mostly confident",
        "Doubtful",
        "The cause was never properly identified",
      ]),
    },
    {
      key: "rb_rehab_focus",
      branch: "rebuilder",
      position: 70,
      prompt: "What was your rehab focused on?",
      options: scored([
        "Both clearance and return to performance",
        "Clearance and basic strength",
        "Mostly mobility / pain management",
        "Not sure / it ended early",
      ]),
    },
    {
      key: "rb_post_rehab_assessment",
      branch: "rebuilder",
      position: 75,
      prompt: "Have you ever had a full performance assessment after rehab — separate from medical clearance?",
      options: scored([
        "Yes, comprehensive",
        "Brief screening only",
        "No",
        "No — and I didn't know that was a thing",
      ]),
    },

    // ---- aspiring_pro ------------------------------------------------------
    { key: "ap_structure", branch: "aspiring_pro", position: 50, prompt: Q_STRUCTURE.prompt, options: scored(Q_STRUCTURE.labels) },
    { key: "ap_specificity", branch: "aspiring_pro", position: 55, prompt: Q_SPECIFICITY.prompt, options: scored(Q_SPECIFICITY.labels) },
    { key: "ap_assessed", branch: "aspiring_pro", position: 60, prompt: Q_ASSESSED.prompt, options: scored(Q_ASSESSED.labels) },
    { key: "ap_hold_up", branch: "aspiring_pro", position: 65, prompt: Q_HOLD_UP.prompt, options: scored(Q_HOLD_UP.labels) },
    { key: "ap_asymmetry", branch: "aspiring_pro", position: 70, prompt: Q_ASYMMETRY.prompt, options: scored(Q_ASYMMETRY.labels) },
    { key: "ap_rotational", branch: "aspiring_pro", position: 75, prompt: Q_ROTATIONAL.prompt, options: scored(Q_ROTATIONAL.labels) },

    // ---- parent_coach ------------------------------------------------------
    // Re-voiced in the third person in the export, and kept that way here.
    {
      key: "pc_stage",
      branch: "parent_coach",
      position: 50,
      prompt: "What stage of development is the athlete at?",
      options: segmentation([
        "Under 13 — early development",
        "13–16 — adolescent",
        "17–19 — late development / academy stage",
        "Adult amateur / college pathway",
      ]),
    },
    {
      key: "pc_pathway",
      branch: "parent_coach",
      position: 55,
      prompt: "What pathway is the athlete aiming for?",
      options: segmentation([
        "Pro / elite competition",
        "Scholarship or academy selection",
        "High-level club competition",
        "Still developing the goal",
      ]),
    },
    {
      key: "pc_specificity",
      branch: "parent_coach",
      position: 60,
      prompt: "How specific is the athlete's current training to their sport's demands?",
      options: scored([
        "Highly specific and individualised",
        "Sport-related but generic",
        "General gym / fitness",
        "Inconsistent or no formal training",
      ]),
    },
    {
      key: "pc_coaching_structure",
      branch: "parent_coach",
      position: 65,
      prompt: "How would you describe the coaching structure around the athlete?",
      options: scored([
        "Integrated — sport coach, strength coach, recovery all coordinated",
        "Sport coach plus one other (S&C or physio)",
        "Sport coach only",
        "Limited or fragmented",
      ]),
    },
    {
      key: "pc_assessment",
      branch: "parent_coach",
      position: 70,
      prompt: "Has the athlete had a foundational performance assessment — separate from sport-skill testing?",
      options: scored([
        "Yes — full physical profile completed",
        "Some testing, not comprehensive",
        "School / club basic testing only",
        "Never",
      ]),
    },
    {
      key: "pc_concern",
      branch: "parent_coach",
      position: 75,
      prompt: "What's the biggest concern about the athlete's development right now?",
      options: segmentation([
        "Pushing to the next level",
        "Avoiding overtraining or burnout",
        "Reducing injury risk during growth",
        "Not sure where they actually stand physically",
      ]),
    },
    { key: "pc_hold_up", branch: "parent_coach", position: 80, prompt: Q_HOLD_UP.prompt, options: scored(Q_HOLD_UP.labels) },

    // ---- Shared closers ----------------------------------------------------
    {
      key: "location",
      branch: null,
      position: 85,
      prompt: "Where are you based?",
      options: segmentation([
        "Tampa area",
        "Within reasonable travel distance to Tampa area",
        "Outside region but can travel",
        "Remote only / can't travel",
      ]),
    },
    {
      key: "intent",
      branch: null,
      position: 90,
      prompt:
        "If we could identify the single biggest factor silently limiting your performance right now, would you want to know what it is?",
      options: segmentation([
        "Yes — and I'm ready to act on it",
        "Yes — but I'd want to understand the process first",
        "Maybe — depends on cost or timing",
        "Not right now",
      ]),
    },
  ],
}

/**
 * Projects the seed into the runtime shape, using the stable seed keys as
 * synthetic ids.
 *
 * THIS IS WHAT LETS THE SEED BE GATED. `quizGate` and `scoreQuiz` speak
 * `QuizDefinition`, so running the seed through this in a unit test means the
 * seed cannot ship in a state the activation gate would reject — a property a
 * SQL seed could not have.
 */
export function toDefinition(seed: SeedQuiz): QuizDefinition {
  const questions: QuizQuestion[] = seed.questions.map((question) => {
    const options: QuizOption[] = question.options.map((option, index) => ({
      id: `${question.key}:${index}`,
      questionId: question.key,
      position: index + 1,
      label: option.label,
      weight: option.weight,
      routesToBranchId: option.routesToBranch ?? null,
      profileId: option.profile ?? null,
    }))
    return {
      id: question.key,
      quizId: seed.key,
      branchId: question.branch,
      position: question.position,
      prompt: question.prompt,
      helpText: null,
      isActive: true,
      options,
    }
  })

  const tiers: QuizTier[] = seed.tiers.map((tier) => ({
    id: tier.key,
    quizId: seed.key,
    key: tier.key,
    position: tier.position,
    minScore: tier.minScore,
    maxScore: tier.maxScore,
    headline: tier.headline,
    body: tier.body,
    ctaLabel: null,
    ctaHref: null,
  }))

  const profiles: QuizProfile[] = seed.profiles.map((profile) => ({
    id: profile.key,
    quizId: seed.key,
    key: profile.key,
    name: profile.name,
    description: profile.description,
    position: profile.position,
  }))

  return {
    id: seed.key,
    key: seed.key,
    name: seed.name,
    status: "draft",
    introHeadline: seed.introHeadline,
    introBody: seed.introBody,
    gateHeadline: seed.gateHeadline,
    gateBody: seed.gateBody,
    resultHeadline: seed.resultHeadline,
    seedMarker: SEED_MARKER,
    branches: seed.branches.map((branch) => ({
      id: branch.key,
      quizId: seed.key,
      key: branch.key,
      name: branch.name,
      description: branch.description,
      position: branch.position,
    })),
    questions,
    tiers,
    profiles,
  }
}
