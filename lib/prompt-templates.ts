/**
 * Prompt templates for AI program generation.
 * Coaches can select a template to pre-fill the "Coach Instructions" textarea.
 *
 * `scope` controls which dialog the template appears in:
 *   - "week" — only in the AI Generate Week dialog
 *   - "day"  — only in the AI Generate Day dialog
 *   - "both" — available in both dialogs
 */

export type TemplateScope = "week" | "day" | "both"

export interface PromptTemplate {
  id: string
  name: string
  category: "structure" | "periodization" | "sport" | "rehab" | "conditioning" | "specialty" | "session"
  scope: TemplateScope
  description: string
  prompt: string
}

export const PROMPT_TEMPLATE_CATEGORIES: Record<string, string> = {
  structure: "Program Structure",
  session: "Session Focus",
  periodization: "Periodization & Loading",
  sport: "Sport-Specific",
  rehab: "Rehab & Return-to-Play",
  conditioning: "Conditioning & Energy Systems",
  specialty: "Specialty Protocols",
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // ─── Structure ──────────────────────────────────────────────────────────────
  {
    id: "deload-week",
    name: "Deload Week",
    category: "structure",
    scope: "week",
    description: "Generate a recovery-focused deload week",
    prompt: `Make this a DELOAD WEEK. Reduce working volume by 40-50%:
- Keep main compound movements but reduce sets by half
- Drop most accessories and isolation work
- All RPE targets 5-6 (should feel easy and restorative)
- Rest periods can stay normal or slightly shorter
- Focus on movement quality and recovery, not stimulus`,
  },
  {
    id: "testing-week",
    name: "Testing / Baseline Week",
    category: "structure",
    scope: "week",
    description: "Program a testing week to establish baselines",
    prompt: `This is a TESTING WEEK to establish baseline numbers:
- Program work-up-to-max testing for main lifts (squat, bench/press, deadlift/hinge)
- Use "testing" role for the main test exercises
- Reps: work up to 3RM or 5RM (not true 1RM — safer for most athletes)
- Rest: 180-300 seconds between working sets
- Keep session volume LOW — testing is neurally demanding
- Include a proper warm-up with progressive loading (50%, 60%, 70%, then attempts)
- No accessories needed — just test the main lifts and a couple of supporting movements`,
  },
  {
    id: "recovery-day",
    name: "Active Recovery Day",
    category: "structure",
    scope: "day",
    description: "Light recovery session focused on mobility",
    prompt: `This is an ACTIVE RECOVERY DAY — not a training session:
- Use "activation" role for all exercises
- Focus: mobility work, foam rolling movements, light band activation, controlled breathing
- 3-4 exercises maximum
- All RPE 3-4 (should feel restorative, never challenging)
- Target areas that were heavily loaded earlier in the week
- Include hip mobility, thoracic rotation, and shoulder mobility
- 20-30 minutes total`,
  },
  {
    id: "custom-exercise-counts",
    name: "Custom Exercise Breakdown",
    category: "structure",
    scope: "both",
    description: "Specify exact exercise counts per category",
    prompt: `Use this exact exercise breakdown per session:
- 1 warm-up / activation
- 2 primary compound exercises
- 2 accessory exercises
- 1 isolation exercise
- 1 cool-down / mobility

Adjust the numbers above to match your needs.`,
  },
  {
    id: "bodyweight-only",
    name: "Bodyweight / No Equipment",
    category: "structure",
    scope: "both",
    description: "Program using only bodyweight exercises",
    prompt: `BODYWEIGHT ONLY — no equipment available:
- Select only bodyweight exercises from the library
- Focus on push-ups, pull-up variations, squats, lunges, planks, bridges
- Use tempo manipulation for difficulty progression (slow eccentrics)
- Use unilateral variations to increase challenge (single-leg, single-arm)
- Supersets are fine since no equipment transitions needed`,
  },
  {
    id: "travel-hotel",
    name: "Travel / Hotel Gym",
    category: "structure",
    scope: "both",
    description: "Program for limited hotel gym equipment",
    prompt: `HOTEL GYM — limited equipment (dumbbells and bodyweight only):
- Use only dumbbells and bodyweight exercises
- No barbells, cables, or machines
- Focus on unilateral dumbbell work for challenge with lighter loads
- Higher rep ranges (10-15) since loads will be lighter
- Can include circuit-style training for time efficiency
- 45-60 minute sessions`,
  },

  // ─── Session Focus (day only) ───────────────────────────────────────────────
  {
    id: "upper-push-day",
    name: "Upper Push Day",
    category: "session",
    scope: "day",
    description: "Chest, shoulders, and triceps emphasis",
    prompt: `UPPER PUSH DAY — chest, shoulders, and triceps:
- 1 primary compound press (bench, incline, or overhead press) at RPE 8 for 4-5 sets
- 1 secondary press (dumbbell press, landmine press, or dips) at RPE 7-8 for 3-4 sets
- 2 accessory movements: one shoulder (lateral raise, face pull), one chest (fly, cable crossover)
- 1 tricep isolation (pushdown, skull crusher, or overhead extension)
- Finish with scapular health work (band pull-apart or Y-T-W)
- 5-6 exercises total, 45-60 minutes`,
  },
  {
    id: "upper-pull-day",
    name: "Upper Pull Day",
    category: "session",
    scope: "day",
    description: "Back, lats, rear delts, and biceps emphasis",
    prompt: `UPPER PULL DAY — back, lats, rear delts, and biceps:
- 1 vertical pull (pull-up, chin-up, or lat pulldown) at RPE 8 for 4 sets
- 1 horizontal pull (barbell row, dumbbell row, or cable row) at RPE 7-8 for 3-4 sets
- 1 upper back accessory (face pull, reverse fly, or rear delt fly)
- 1 lat/mid-back accessory (straight-arm pulldown or pullover)
- 1 bicep isolation (curl variation)
- Optional: grip work (hangs or farmer carries) as a finisher
- 5-6 exercises total, 45-60 minutes`,
  },
  {
    id: "lower-leg-day",
    name: "Lower / Leg Day",
    category: "session",
    scope: "day",
    description: "Quads, hamstrings, glutes, and calves",
    prompt: `LOWER / LEG DAY — full lower body:
- 1 primary squat pattern (back squat, front squat, or goblet squat) at RPE 8 for 4-5 sets
- 1 primary hinge pattern (deadlift, RDL, or hip thrust) at RPE 7-8 for 3-4 sets
- 1 unilateral movement (split squat, lunge, or step-up) for 3 sets
- 1 posterior chain accessory (hamstring curl, good morning, or glute-ham raise)
- 1 calf movement (standing or seated calf raise)
- Optional: short core finisher (2-3 minutes)
- 5-6 exercises total, 50-70 minutes`,
  },
  {
    id: "full-body-day",
    name: "Full Body Day",
    category: "session",
    scope: "day",
    description: "Balanced session hitting every major pattern",
    prompt: `FULL BODY DAY — hit every major movement pattern once:
- 1 squat pattern (squat variation)
- 1 hinge pattern (deadlift or RDL variation)
- 1 upper push (horizontal or vertical)
- 1 upper pull (horizontal or vertical)
- 1 core / carry / anti-rotation
- Optional: 1 conditioning or power finisher
- Keep sets moderate (3 per exercise) to respect total session volume
- 5-6 exercises total, 50-60 minutes`,
  },
  {
    id: "mobility-movement-prep",
    name: "Mobility & Movement Prep",
    category: "session",
    scope: "day",
    description: "Pure mobility / movement-quality session",
    prompt: `MOBILITY & MOVEMENT PREP — no loaded strength work:
- Use "activation" and "warmup" roles throughout
- 6-8 exercises targeting: ankles, hips, thoracic spine, shoulders
- Include CARs (controlled articular rotations), 90/90 hip flow, thoracic rotations, wall slides
- All bodyweight or very light bands — RPE 3-5
- Breathe deeply and move deliberately
- 20-30 minutes total — quality over quantity`,
  },
  {
    id: "core-anti-rotation-session",
    name: "Core / Anti-Rotation Session",
    category: "session",
    scope: "day",
    description: "Dedicated core, bracing, and anti-rotation block",
    prompt: `CORE / ANTI-ROTATION SESSION:
- 5-6 exercises split across the 4 core functions:
  * Anti-extension: dead bug, plank variation, ab wheel
  * Anti-rotation: Pallof press, bird dog, side plank with reach
  * Anti-lateral flexion: suitcase carry, single-arm farmer walk
  * Flexion/rotation: cable woodchop, hanging leg raise (used sparingly)
- 3 sets per exercise, RPE 7
- No crunches or sit-ups as primary work
- Emphasize bracing and breathing patterns on every rep
- 25-35 minutes`,
  },

  // ─── Periodization & Loading ────────────────────────────────────────────────
  {
    id: "dup",
    name: "Daily Undulating Periodization",
    category: "periodization",
    scope: "week",
    description: "Same lifts, different loading across the week",
    prompt: `Use DAILY UNDULATING PERIODIZATION (DUP):
- Program the SAME main lifts across all training days this week
- Vary the loading scheme each day:
  * Day 1 (Heavy): 4x4-5 @ RPE 8-9, rest 180s — strength focus
  * Day 2 (Moderate): 3x8-10 @ RPE 7, rest 90s — hypertrophy focus
  * Day 3 (Light/Power): 5x3 @ RPE 7, rest 120s — speed/power focus
- Accessories can vary between days but main lifts stay the same
- This overrides the normal exercise rotation rules for main lifts`,
  },
  {
    id: "percentage-based",
    name: "Percentage-Based Loading",
    category: "periodization",
    scope: "week",
    description: "Program with specific 1RM percentages",
    prompt: `Use PERCENTAGE-BASED LOADING for all main compound lifts:
- Week 1: 70% x 4x8
- Week 2: 75% x 4x6
- Week 3: 80% x 5x5
- Week 4: 65% x 3x8 (deload)
Set the intensity_pct field on compound slots. Use RPE for accessories.`,
  },
  {
    id: "wave-loading",
    name: "Wave Loading Protocol",
    category: "periodization",
    scope: "both",
    description: "Ascending wave sets for strength development",
    prompt: `Use WAVE LOADING for primary compound lifts:
- Perform 2 waves per exercise: 3/2/1/3/2/1
- Wave 1: 3 reps @ 80%, 2 reps @ 85%, 1 rep @ 90%
- Wave 2: 3 reps @ 82%, 2 reps @ 87%, 1 rep @ 92%
- Use "wave_loading" technique
- Only apply to primary compounds — accessories use straight sets
- Rest: 180-240 seconds between wave sets`,
  },
  {
    id: "eccentric-emphasis",
    name: "Eccentric Emphasis Block",
    category: "periodization",
    scope: "both",
    description: "Slow tempo eccentrics throughout the program",
    prompt: `ECCENTRIC EMPHASIS BLOCK — all working exercises use controlled tempo:
- All compound lifts: 4-0-1-0 tempo (4-second eccentric)
- Accessories: 3-1-1-0 tempo (3-second eccentric with pause)
- Reduce load by 15-20% from normal to accommodate tempo
- Lower RPE targets (7-8) — tempo work is deceptively fatiguing
- Limit eccentric-heavy exercises to 2 per session to manage recovery
- This builds tendon strength, muscle control, and injury resilience`,
  },
  {
    id: "taper-competition",
    name: "Competition Taper",
    category: "periodization",
    scope: "week",
    description: "Taper for an upcoming competition or event",
    prompt: `COMPETITION TAPER — event is at the end of this program:
- Reduce volume progressively: 30% less than normal first week, 50% less final week
- MAINTAIN intensity on main lifts (same weight, fewer sets)
- Drop most accessories — keep only sport-specific movements
- Increase rest periods to ensure full neural recovery
- Final 2-3 days before competition: light activation work only
- Focus: feel sharp, fast, and fresh — NOT tired or sore`,
  },

  // ─── Sport-Specific ─────────────────────────────────────────────────────────
  {
    id: "rotational-sport",
    name: "Rotational Sport (Tennis, Golf, Baseball)",
    category: "sport",
    scope: "both",
    description: "Emphasis on rotational power and anti-rotation",
    prompt: `ROTATIONAL SPORT FOCUS (tennis/golf/baseball):
- At least 2 rotational exercises per session (med ball throws, cable rotation, Pallof press)
- Include anti-rotation work for injury prevention (Pallof press, bird dog, dead bug)
- Emphasize single-leg strength (split squat, lateral lunge)
- Include shoulder stability work (rotator cuff, scapular retraction)
- Power development: med ball throws, rotational slams
- Minimize bilateral pressing — focus on unilateral and anti-rotation patterns
- Frontal and transverse plane work must exceed sagittal plane`,
  },
  {
    id: "court-sport",
    name: "Court Sport (Basketball, Soccer, Lacrosse)",
    category: "sport",
    scope: "both",
    description: "Agility, deceleration, and reactive strength",
    prompt: `COURT SPORT FOCUS (basketball/soccer/lacrosse):
- Include plyometric work: box jumps, broad jumps, lateral bounds
- Deceleration training: eccentric-focused lunges, drop landings
- Single-leg emphasis: 50%+ of lower body work should be unilateral
- Hip mobility and ankle stability in every session
- Lateral movement: lateral lunges, cossack squats, lateral band walks
- Keep sessions under 60 minutes — athlete has practice on top of this
- Reduce heavy lower body volume on days before practice/games`,
  },
  {
    id: "in-season",
    name: "In-Season Maintenance",
    category: "sport",
    scope: "week",
    description: "Maintain strength during competitive season",
    prompt: `IN-SEASON MAINTENANCE — athlete is competing regularly:
- 2 sessions per week maximum
- Maintain intensity on main lifts (85%+ for low reps)
- Reduce volume significantly (50% of off-season volume)
- No exercises that create heavy DOMS (avoid heavy eccentrics, new exercises)
- Full body each session to maintain frequency for all patterns
- Sessions under 45 minutes
- Schedule training 48+ hours before competition
- Focus: maintain don't gain — fresh legs for competition`,
  },

  // ─── Rehab & Return-to-Play ─────────────────────────────────────────────────
  {
    id: "lower-body-rehab",
    name: "Lower Body Rehab Progression",
    category: "rehab",
    scope: "week",
    description: "Graduated return from knee/ankle/hip injury",
    prompt: `LOWER BODY REHAB PROGRESSION:
- Weeks 1-2: Isometric and activation only for lower body (wall sits, glute bridges, banded clam shells). Use "activation" role. Upper body can train normally.
- Weeks 3-4: Add controlled eccentric work (slow tempo step-ups, bodyweight squats with 3s eccentric). Use "accessory" role.
- Weeks 5-6: Introduce light compound loading (goblet squat, dumbbell RDL). Add single-leg balance work.
- Week 7+: Progress to normal loading with appropriate difficulty

Start conservative. Movement quality and pain-free range of motion are the priority, NOT load.`,
  },
  {
    id: "upper-body-rehab",
    name: "Upper Body Rehab (Shoulder Focus)",
    category: "rehab",
    scope: "week",
    description: "Graduated return from shoulder/elbow injury",
    prompt: `UPPER BODY REHAB (SHOULDER FOCUS):
- Weeks 1-2: Scapular stability and rotator cuff activation only (band pull-aparts, external rotation, scapular wall slides). No overhead or heavy pressing. Lower body trains normally.
- Weeks 3-4: Add light pressing in neutral grip (landmine press, floor press). Continue rotator cuff work as warm-up every session.
- Weeks 5-6: Progress to dumbbell pressing and light pulling. Introduce overhead mobility work (not loading).
- Week 7+: Full pressing menu available, maintain rotator cuff warm-up

Never push through shoulder pain. Stability before strength.`,
  },
  {
    id: "post-surgery",
    name: "Post-Surgery General",
    category: "rehab",
    scope: "week",
    description: "Conservative return-to-training after surgery",
    prompt: `POST-SURGERY RETURN — be extremely conservative:
- Weeks 1-2: Activation and mobility work ONLY for affected area. Train unaffected areas normally. All exercises bodyweight or light bands.
- Weeks 3-4: Introduce controlled range-of-motion exercises. Keep RPE at 4-5 maximum for affected area.
- Weeks 5-6: Begin light loading. Still no explosive or high-impact work on affected area.
- Week 7+: Gradual return to normal training with monitoring

The surgeon and physio's guidelines override everything. When in doubt, do less.`,
  },

  // ─── Conditioning & Energy Systems ──────────────────────────────────────────
  {
    id: "conditioning-finisher",
    name: "Conditioning Finisher",
    category: "conditioning",
    scope: "both",
    description: "Add a conditioning finisher to each session",
    prompt: `Add a CONDITIONING FINISHER at the end of every session:
- Use "conditioning" role with "conditioning" movement_pattern
- 8-12 minutes of work
- Options: EMOM (use "emom" technique), circuit (use "circuit" technique), or interval work
- Include: bike calories, sled push, battle ropes, burpees, or rowing
- Intensity: RPE 7-8 (hard but sustainable for the duration)
- Place AFTER all strength work, BEFORE cool-down
- If the athlete has competition coming, reduce conditioning intensity to RPE 6`,
  },
  {
    id: "emom-protocol",
    name: "EMOM Protocol",
    category: "conditioning",
    scope: "day",
    description: "Every-minute-on-the-minute conditioning block",
    prompt: `Include an EMOM BLOCK in the session:
- Use "emom" technique on conditioning slots
- 10-15 minutes total (sets = number of minutes)
- Alternate between 2-3 exercises each minute
- Example: Min 1: 10 KB swings, Min 2: 8 push-ups, Min 3: 12 cal bike (repeat)
- Exercises should be simple enough to maintain form under fatigue
- Work portion should take ~40-45 seconds (15-20 seconds rest per minute)
- Place at end of session or as standalone conditioning day`,
  },
  {
    id: "hybrid-strength-conditioning",
    name: "Hybrid Strength + Conditioning",
    category: "conditioning",
    scope: "both",
    description: "Combine strength and metabolic work in one session",
    prompt: `HYBRID STRENGTH + CONDITIONING session structure:
- First 30 minutes: Heavy strength work (2-3 compound exercises, straight sets, full rest)
- Last 15-20 minutes: Metabolic conditioning (circuits or EMOMs using lighter loads)
- Transition exercises: use the same movement patterns but lighter and faster
- Example: Heavy squats → Goblet squat circuit finisher
- This format maintains strength while building work capacity
- Keep total session under 50 minutes`,
  },

  // ─── Specialty Protocols ────────────────────────────────────────────────────
  {
    id: "cluster-sets",
    name: "Cluster Set Protocol",
    category: "specialty",
    scope: "day",
    description: "Intra-set rest for strength/power development",
    prompt: `Use CLUSTER SETS for primary compound lifts:
- Technique: "cluster_set"
- Protocol: 5 sets of (1+1+1) with 15-20 seconds intra-set rest between singles
- Load: 85-90% 1RM (heavier than normal sets because of rest between reps)
- Rest between clusters: 180-240 seconds
- Only apply to primary compounds (squat, bench, deadlift patterns)
- Accessories use normal straight sets
- This builds maximal strength with better technique than grinding rep sets`,
  },
  {
    id: "complex-training",
    name: "Complex / Contrast Training",
    category: "specialty",
    scope: "day",
    description: "Heavy lift paired with explosive movement",
    prompt: `Use COMPLEX/CONTRAST TRAINING for power development:
- Pair a heavy compound with an explosive bodyweight movement:
  * Heavy squat (3-5 reps) → Box jumps (3-5 reps)
  * Heavy bench press (3-5 reps) → Explosive push-ups (5 reps)
  * Heavy RDL (3-5 reps) → Broad jumps (3-5 reps)
- Use "complex" technique with matching group_tags
- Rest: 30s between the pair, 180s between complexes
- 3-4 sets per complex
- This leverages post-activation potentiation (PAP) for explosive performance`,
  },
  {
    id: "unilateral-focus",
    name: "Unilateral Focus",
    category: "specialty",
    scope: "both",
    description: "50%+ unilateral exercises for asymmetry correction",
    prompt: `UNILATERAL FOCUS — at least 60% of exercises must be single-limb:
- Lower body: split squats, single-leg RDL, step-ups, lunges (not bilateral squats/deadlifts)
- Upper body: single-arm press, single-arm row, one-arm carries
- Include lateral movement: lateral lunges, cossack squats
- Address bilateral deficit and left/right asymmetries
- Start with the weaker side first on all unilateral exercises
- Add notes: "Match the weaker side's performance — don't let the strong side do more"`,
  },
  {
    id: "power-development",
    name: "Power Development Block",
    category: "specialty",
    scope: "both",
    description: "Explosive training for athletic performance",
    prompt: `POWER DEVELOPMENT BLOCK:
- Start every session with "power" role exercises: plyometrics, med ball throws, or jumps
- Use "express" intent exercises when available
- Low reps (3-5), maximum intent, full recovery (120-180s rest)
- DO NOT train power in a fatigued state — always first in the session
- Strength work follows power work (compounds at RPE 7-8, not grinding)
- Reduce total volume — power quality > quantity
- Include: box jumps, broad jumps, med ball slams, rotational throws, explosive step-ups`,
  },
]
