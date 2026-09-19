// lib/quizzes/seed/rotational-performance-index.ts — the Rotational Performance
// Index, the top-of-funnel magnet for Rotational Reboot.
//
// A TYPED MODULE, NOT A SQL SEED, for the same reason as its sibling: a SQL
// seed cannot be run through `quizGate`. This one can, and a unit test asserting
// the gate passes means the seed physically cannot ship in a state the
// activation gate would reject.
//
// PROVENANCE, AND HOW THIS DIFFERS FROM rpi-athlete-quiz.ts. That file's numbers
// are INVENTED, because the GHL export lost them. These are not. The five tests,
// their three scoring points and the two scored questions come from the owner's
// own scoring document, and the per-test criteria below are transcribed from the
// narration of the five demo videos he recorded (`media/quiz-rotational-reboot/
// t1..t5.srt`). Where the document and the video disagree, THE VIDEO WINS — it
// is what the visitor is watching while they answer.
//
// Four corrections to the document are deliberate and are argued in the spec:
//   1. A zero floor. The document's worst option scores 1, which puts the floor
//      at 31% and makes `red` nearly unreachable. Every test gains an honest
//      "I couldn't do it at all" at 0.
//   2. Q2 ("where do you feel it") is SEGMENTATION, not scored. As written it
//      scores "I feel fine" lowest, i.e. marks the healthiest athlete as the
//      most broken, and three of its five options share one value.
//   3. The four tests with a real left/right are asked ONCE PER SIDE. Asymmetry
//      is the product's whole pitch and a single score discards it.
//   4. A sport router, because `quizGate` refuses a quiz with no branch. It
//      earns its place by re-voicing Q1 in the visitor's own sport.
//
// Spec: docs/superpowers/specs/2026-09-19-rotational-performance-index-design.md

import type { QuizDefinition, QuizOption, QuizProfile, QuizQuestion, QuizTier } from "@/lib/quizzes/types"

/** Cleared the first time a human saves the quiz; drives the editor banner. */
export const SEED_MARKER = "authored-from-owner-scoring-doc-2026-09-19"

const BUCKET = "darrenjpaulcom.firebasestorage.app"

/**
 * Built rather than pasted so a bucket rename is one edit, and so the path can
 * never drift from `quizMediaStoragePath`'s `quiz-media/{quizKey}/{file}` shape
 * — which is the shape storage.rules matches. A hand-typed URL one level deep
 * uploads fine and 404s for every visitor.
 */
function clip(file: string): string {
  const path = `quiz-media/rotational-reboot/${file}`
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`
}

export interface SeedOption {
  label: string
  weight: number
  routesToBranch?: string
  profile?: string
}

export interface SeedQuestion {
  key: string
  branch: string | null
  position: number
  prompt: string
  helpText?: string | null
  mediaUrl?: string | null
  mediaPosterUrl?: string | null
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
  tiers: {
    key: string
    position: number
    minScore: number
    maxScore: number
    headline: string
    body: string
    ctaLabel: string
    ctaHref: string
  }[]
  questions: SeedQuestion[]
}

/** All-zero: the documented segmentation marker. Cannot move the percentage. */
function segmentation(labels: string[]): SeedOption[] {
  return labels.map((label) => ({ label, weight: 0 }))
}

// ---------------------------------------------------------------------------
// The five movement tests.
// ---------------------------------------------------------------------------
// `points` are the three things that make a rep good, IN THE OWNER'S OWN WORDS
// from the narration. They are written as observable facts rather than as a
// judgement ("your hip stays down" beats "no compensations") because the person
// least able to spot their own compensation is exactly the person this quiz is
// for, and a self-graded judgement inflates every score toward green.
interface MovementTest {
  key: string
  name: string
  file: string
  /** null = a movement with no meaningful left/right. */
  sides: readonly ["left", "right"] | null
  setup: string
  points: [string, string, string]
}

const MOVEMENT_TESTS: MovementTest[] = [
  {
    key: "prone_hip_abduction",
    name: "Prone hip abduction with external rotation",
    file: "1-prone-hip-abduction",
    sides: ["left", "right"],
    setup: "Lie face down. Turn the leg out, then lift it out and away from you.",
    points: [
      "your hip stayed down — the pelvis did not rotate to help",
      "your foot stayed turned outwards, not pointing straight",
      "the whole leg stayed off the ground through the range",
    ],
  },
  {
    key: "rocking_hollow",
    name: "Rocking hollow",
    file: "2-rocking-hollow",
    // Sagittal: there is no left or right to compare, so one score is honest.
    sides: null,
    setup: "On your back, arms overhead, legs straight. Rock like the bottom of a bowl, about 15 reps.",
    points: [
      "your legs stayed low instead of riding up high",
      "your arms stayed overhead instead of swinging forward into a V-sit",
      "your back stayed rounded and rocked smoothly, not flat and box-like",
    ],
  },
  {
    key: "copenhagen",
    name: "Short lever Copenhagen",
    file: "3-short-lever-copenhagen",
    sides: ["left", "right"],
    setup: "On your side, top leg supported at 90-90. Lift the hips and the bottom leg, and hold.",
    points: [
      "you held it for a full 10 seconds",
      "nothing touched the floor — not the knee, not the ankle",
      "your torso stayed straight, hips forward, without rotating",
    ],
  },
  {
    key: "windshield_wipers",
    name: "Windshield wipers",
    file: "4-windshield-wipers",
    // Rotating to the left and to the right are genuinely different sides.
    sides: ["left", "right"],
    setup: "On your back, arms out wide, legs straight up. Rotate the legs down to one side and back.",
    points: [
      "your ankles stayed together the whole way down and back",
      "your knees stayed straight",
      "your shoulders stayed flat on the floor",
    ],
  },
  {
    key: "retro_hop",
    name: "Retro backwards hop",
    file: "5-retro-backwards-hop",
    sides: ["left", "right"],
    setup: "Hop forward, then hop backwards, landing softly.",
    points: [
      "you got a real distance going backwards, not just a token hop",
      "you landed balanced, in a bent-knee position",
      "you kept control without stumbling or falling back",
    ],
  },
]

/**
 * 3 / 2 / 1 / 0.
 *
 * THE ZERO IS THE CORRECTION. The scoring document's lowest option is 1, which
 * puts the whole-quiz floor at 31% and squeezes `red` into three raw totals out
 * of nineteen. "I couldn't do it at all" is also simply a true answer — plenty
 * of people cannot hold a Copenhagen — and a scale that cannot express it is
 * not measuring the people this quiz exists to find.
 */
function movementOptions(): SeedOption[] {
  return [
    { label: "All three — clean, no compensation", weight: 3 },
    { label: "Two of the three", weight: 2 },
    { label: "One of the three, or a real struggle", weight: 1 },
    { label: "I couldn't do it at all", weight: 0 },
  ]
}

function movementQuestions(): SeedQuestion[] {
  const out: SeedQuestion[] = []
  let position = 30
  for (const test of MOVEMENT_TESTS) {
    const sides = test.sides ?? [null]
    for (const side of sides) {
      const sideLabel = side ? ` — ${side} side` : ""
      out.push({
        key: side ? `${test.key}_${side}` : test.key,
        branch: null,
        position,
        prompt: `${test.name}${sideLabel}: how many of the three did you hold?`,
        // The criteria live in help text rather than in the option labels so
        // the visitor reads them BEFORE attempting, which is the only order in
        // which they can honestly answer.
        helpText: `${test.setup} Watch the clip, try it, then score yourself: ${test.points.join("; ")}.`,
        mediaUrl: clip(`${test.file}.mp4`),
        mediaPosterUrl: clip(`${test.file}-poster.jpg`),
        options: movementOptions(),
      })
      position += 10
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The sport router, and Q1 re-voiced per branch.
// ---------------------------------------------------------------------------
// The branch exists because `quizGate` blocks a quiz with no router and blocks
// a branch with no questions. Rather than weaken the gate, the router asks the
// one thing worth segmenting on and each branch re-voices Q1 in that sport's
// own language — the same device the athlete quiz uses for parent/coach.
interface SportBranch {
  key: string
  name: string
  description: string
  routerLabel: string
  /** Completes "…, do you ever feel unstable, stiff, or disconnected?" */
  q1Moment: string
}

const SPORT_BRANCHES: SportBranch[] = [
  {
    key: "racquet",
    name: "Racquet",
    description: "Tennis, pickleball, padel, squash.",
    routerLabel: "Tennis, pickleball, padel or squash",
    q1Moment: "When you swing hard, or push off for a wide ball",
  },
  {
    key: "golf",
    name: "Golf",
    description: "Golf.",
    routerLabel: "Golf",
    q1Moment: "Through the downswing and into your follow-through",
  },
  {
    key: "throwing",
    name: "Throwing and batting",
    description: "Baseball, softball, cricket, quarterback.",
    routerLabel: "Baseball, softball, cricket or quarterback",
    q1Moment: "When you throw hard, or swing for power",
  },
  {
    key: "field_court",
    name: "Field and court",
    description: "Soccer, rugby, hockey, lacrosse, basketball.",
    routerLabel: "Soccer, rugby, hockey, lacrosse or basketball",
    q1Moment: "When you cut or change direction at full speed",
  },
  {
    key: "other",
    name: "Other",
    description: "Everything else, including combat sports and general training.",
    // A GENUINE CATCH-ALL. Without it the router strands anyone whose sport is
    // not listed, and `quizGate` cannot catch that — every branch is reachable,
    // it is the VISITOR who is not.
    routerLabel: "Something else",
    q1Moment: "When you rotate or change direction quickly",
  },
]

function q1Questions(): SeedQuestion[] {
  return SPORT_BRANCHES.map((branch) => ({
    key: `q1_${branch.key}`,
    branch: branch.key,
    position: 20,
    prompt: `${branch.q1Moment}, do you ever feel unstable, stiff, or like the power does not connect?`,
    options: [
      { label: "Never", weight: 3 },
      { label: "Occasionally", weight: 2 },
      { label: "Frequently", weight: 1 },
      { label: "Constantly", weight: 0 },
    ],
  }))
}

export const ROTATIONAL_PERFORMANCE_INDEX: SeedQuiz = {
  key: "rotational-reboot-score",
  name: "Rotational Performance Index",
  introHeadline: "Find the rotational leak that is costing you speed and power",
  introBody:
    "Five movement tests you can do at home with no equipment, and four quick questions. Watch each clip, try the movement, score yourself honestly. It takes about five minutes and you get a readout at the end.",
  gateHeadline: "Where should we send your index?",
  gateBody: "Your score is worked out the same way we score a movement screen in person.",
  resultHeadline: "Your Rotational Performance Index",

  branches: SPORT_BRANCHES.map((branch, index) => ({
    key: branch.key,
    name: branch.name,
    description: branch.description,
    position: index + 1,
  })),

  // The five the owner's document names, which are the five already seeded on
  // the athlete quiz — same keys, so a contact who takes both quizzes is
  // described the same way by each.
  profiles: [
    { key: "not_sure", name: "Not sure where it's leaking", description: "Something's off but hard to pinpoint.", position: 0 },
    { key: "explosive_but_tight", name: "Explosive but tight", description: "The power's there, but stiffness limits it.", position: 1 },
    { key: "mobile_but_weak", name: "Mobile but weak", description: "Flexibility is fine, force transfer isn't.", position: 2 },
    { key: "struggle_in_transitions", name: "Struggle in transitions", description: "Direction changes and rotation feel disconnected.", position: 3 },
    { key: "strong_but_slow", name: "Strong but slow", description: "Strength is there but it doesn't translate.", position: 4 },
  ],

  // The document's own four names. Cutoffs match the athlete quiz's deliberately,
  // so a colour means the same thing to the operator across both quizzes.
  // Higher is better, so RED IS THE MOST URGENT — which is why red and orange
  // are the two that alert and open a pipeline card.
  tiers: [
    {
      key: "red",
      position: 1,
      minScore: 0,
      maxScore: 39,
      headline: "High compensation and disconnection",
      body: "Your body is finding ways around the work rather than doing it. That is the pattern that leaks speed and power, and it is the most fixable one on this list.",
      ctaLabel: "See if Rotational Reboot is right for you",
      ctaHref: "/go/rotational-reboot-score/offer",
    },
    {
      key: "orange",
      position: 2,
      minScore: 40,
      maxScore: 59,
      headline: "Movement inefficiencies limiting performance",
      body: "You held some of it together and lost the rest. The gaps that showed up here are the ones costing you output when you are tired.",
      ctaLabel: "See if Rotational Reboot is right for you",
      ctaHref: "/go/rotational-reboot-score/offer",
    },
    {
      key: "yellow",
      position: 3,
      minScore: 60,
      maxScore: 79,
      headline: "Potential performance leaks",
      body: "A solid base with specific leaks in it. Worth closing before they decide a result for you.",
      ctaLabel: "See if Rotational Reboot is right for you",
      ctaHref: "/go/rotational-reboot-score/offer",
    },
    {
      key: "green",
      position: 4,
      minScore: 80,
      maxScore: 100,
      headline: "Good rotational connection and control",
      body: "You control rotation well. The value now is precision — the small side-to-side differences that still cost output.",
      ctaLabel: "See what an assessment covers",
      ctaHref: "/assessment",
    },
  ],

  questions: [
    // ---- Router ------------------------------------------------------------
    {
      key: "sport_router",
      branch: null,
      position: 10,
      prompt: "What do you play?",
      options: SPORT_BRANCHES.map((branch) => ({
        label: branch.routerLabel,
        weight: 0,
        routesToBranch: branch.key,
      })),
    },

    // ---- Q1, once per branch, same weights, different words ----------------
    ...q1Questions(),

    // ---- The nine movement questions, positions 30..110 --------------------
    ...movementQuestions(),

    // ---- Q3: the only scored training-history question ---------------------
    // Scored so that NOT training rotation costs you, which is both true and
    // commercially correct: the person who scores 0 here is the person
    // Rotational Reboot is built for.
    {
      key: "rotational_training_frequency",
      branch: null,
      position: 120,
      prompt: "How often do you train rotational power specifically — not just playing your sport?",
      options: [
        { label: "More than 3 times a week", weight: 3 },
        { label: "2 to 3 times a week", weight: 2 },
        { label: "About once a week", weight: 1 },
        { label: "Never, not with any real intent", weight: 0 },
      ],
    },

    // ---- Q2: SEGMENTATION, and the correction is deliberate ----------------
    // The document scores this 3/3/3/2/1 with "I feel fine" LOWEST, which marks
    // the athlete who recovers well as the most broken — backwards against
    // every other item and against `normalise`, where green means well
    // prepared. Three options also shared one value, so it discriminated
    // between nothing. It is worth much more as results-page copy: "you feel it
    // in your lower back" is a rotational finding, not a back finding.
    {
      key: "post_session_soreness",
      branch: null,
      position: 130,
      prompt: "After a heavy session or a competition, where do you feel it most?",
      options: segmentation(["Lower back", "Hips", "Core", "Shoulders", "I feel fine"]),
    },

    // ---- Q4: the profile vote ----------------------------------------------
    // All five votes sit on this one question, which is why §1.9's vote
    // mechanism needs no special case.
    {
      key: "profile_self_select",
      branch: null,
      position: 140,
      prompt: "Which of these sounds most like you?",
      options: [
        { label: "Explosive but tight — the power's there, but stiffness limits it", weight: 0, profile: "explosive_but_tight" },
        { label: "Mobile but weak — flexibility is fine, force transfer isn't", weight: 0, profile: "mobile_but_weak" },
        { label: "I struggle in transitions — direction changes and rotation feel disconnected", weight: 0, profile: "struggle_in_transitions" },
        { label: "Strong but slow — the strength is there but it doesn't translate", weight: 0, profile: "strong_but_slow" },
        { label: "Not sure where it's leaking — something's off but hard to pinpoint", weight: 0, profile: "not_sure" },
      ],
    },
  ],
}

/**
 * Projects the seed into the runtime shape, using the stable seed keys as
 * synthetic ids.
 *
 * THIS IS WHAT LETS THE SEED BE GATED. `quizGate` and `scoreQuiz` speak
 * `QuizDefinition`, so running the seed through this in a unit test means the
 * seed cannot ship in a state the activation gate would reject.
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
      helpText: question.helpText ?? null,
      mediaUrl: question.mediaUrl ?? null,
      mediaPosterUrl: question.mediaPosterUrl ?? null,
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
    ctaLabel: tier.ctaLabel,
    ctaHref: tier.ctaHref,
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
