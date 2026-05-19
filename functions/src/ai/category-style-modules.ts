export const KNOWN_CATEGORIES = ["rotational", "comeback", "strength", "mobility", "youth", "recovery"] as const
type KnownCategory = (typeof KNOWN_CATEGORIES)[number]

const MODULES: Record<KnownCategory, string> = {
  rotational: `
CATEGORY MODULE — Rotational training (golf, baseball, tennis, hockey, MMA):
- Settings: indoor performance facilities with turf, batting cages, golf simulators, on-course practice tees, baseball/softball fields.
- Equipment in frame: medicine balls (especially rotational throws against rebounders), cable columns set for chops/lifts, landmine attachments, weighted bats, club, racquet.
- Movements: rotational med-ball throws, cable chops, landmine rotations, anti-rotation press-outs, hip-shoulder dissociation drills, mound work, swing repetition.
- Casting: adult rotational-sport athletes — golfer builds, baseball/softball builds, tennis/MMA leans. Not powerlifter or bodybuilder physiques.`.trim(),

  comeback: `
CATEGORY MODULE — Comeback / return-to-play / post-injury:
- Settings: clinical-feeling rehab gyms, physical therapy studios with parallel bars, low-stim performance facilities. Soft natural light through clinic windows.
- Equipment in frame: resistance bands, light dumbbells, BFR cuffs, foam rollers, balance pads, low boxes, controlled-tempo rigs. Sometimes a coach or PT in the frame guiding form.
- Movements: low-load controlled tempo work, single-leg balance, banded rehab progressions, slow eccentric loading, isometric holds. Never max-effort.
- Mood: focused, patient, methodical. Not "rocky training montage" energy. The athlete is rebuilding, not peaking.
- Casting: adults of any sport, often visibly recovering (subtle tape, sleeves, brace cues — never gory or medical-prop heavy).`.trim(),

  strength: `
CATEGORY MODULE — Strength training:
- Settings: real strength gyms with platforms, dead patches, chalk bowls, deadlift bars sitting on jacks. NOT chrome commercial-gym aesthetics.
- Equipment in frame: barbells with knurling visible, bumper plates, squat racks, monolifts, trap bars, dumbbells, chalk dust in the air.
- Movements: deadlifts, squats, bench press, rows, overhead press, loaded carries. Mid-rep mid-action, never racked-and-posing.
- Casting: adults with realistic strength athlete builds across weight classes. Show effort — gritted teeth, tension, chalked hands.`.trim(),

  mobility: `
CATEGORY MODULE — Mobility and warm-up:
- Settings: turf areas, open gym floor, yoga-style spaces. Natural side light.
- Equipment in frame: bands, foam rollers, lacrosse balls, dowels, light kettlebells, agility ladders.
- Movements: dynamic warm-ups, hip openers, thoracic rotations, deep squats holds, lunges with reach, banded distractions. Slow, controlled, range-of-motion focused.
- Mood: warm-up energy — preparing, not peaking.`.trim(),

  youth: `
CATEGORY MODULE — Youth development:
- Settings: school gyms, community sport facilities, outdoor youth practice fields. Bright natural light.
- Equipment in frame: age-appropriate tools — light medicine balls, bodyweight stations, mini-bands, agility cones, low boxes. NEVER loaded barbells with young athletes.
- Movements: bodyweight squats, jump-rope, broad jumps, throwing drills, sport-specific skill work. Coordination, not load.
- Casting: adolescents and teens (12–17). Coach in frame is appropriate and welcome.`.trim(),

  recovery: `
CATEGORY MODULE — Recovery and sleep:
- Settings: quiet recovery spaces, home environments, soft-light bedrooms (for sleep posts), recovery lounges.
- Equipment in frame: percussion guns, foam rollers, ice baths, compression boots, sauna doors, simple stretching mats. Not gym equipment.
- Mood: calm, low-stimulation, recovery-focused. Often a single subject in a quiet moment.
- Casting: adult athletes in recovery wear (joggers, hoodies, robes for ice-bath shots) — not gym performance attire.`.trim(),
}

const GENERIC = `
CATEGORY MODULE — General athletic performance:
- Mix gym, track, and field settings. Mid-action work across multiple modalities.
- Equipment in frame should reflect the post topic.`.trim()

function normalize(category: string): KnownCategory | null {
  const lc = category.toLowerCase().replace(/[\s\-_]+/g, "")
  for (const key of KNOWN_CATEGORIES) {
    if (lc.includes(key)) return key
  }
  return null
}

export function getCategoryStyleModule(category: string): string {
  const key = normalize(category)
  if (!key) return GENERIC
  return MODULES[key]
}
