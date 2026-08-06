import type { RadarCategory } from "@/lib/coach-intel/test-normalization"
import type { Band, CategoryScore } from "./scoring"

/**
 * Coaching cues, one per (category × band). Selected from the athlete's WEAKEST
 * scorable category, so the report always closes on the thing that moves the
 * needle most. Deterministic on purpose: the same numbers produce the same
 * sentence on every render, and the copy is reviewable in one place rather than
 * generated per view.
 *
 * Tone rule (owner decision): candid but constructive, athlete/parent-facing.
 * Name the gap, then give the instruction. No clinical language, no diagnosis.
 */
export const CUES: Record<RadarCategory, Record<Band, string>> = {
  Speed: {
    strength:
      "Speed is your weapon — protect it. Keep sprint work early in the session while you're fresh, and treat full recovery between reps as part of the training, not a break from it.",
    developing:
      "Your top-end is coming along. The next gain is in the first three steps: push the ground back hard behind you rather than reaching forward, and hold a strong forward lean out of the start.",
    priority:
      "Speed is your biggest opportunity right now. Cut the volume and raise the intensity — short maximal efforts with long rest beat long tired ones. Quality reps only; end the set the moment your times start dropping off.",
  },
  Power: {
    strength:
      "Your power output is a real strength. Keep it sharp with low-volume, high-intent jumps before your main lifts, and don't let heavy strength work crowd it out of the week.",
    developing:
      "You're producing decent force — now produce it faster. Focus on cutting ground-contact time: treat the floor as hot, and aim to leave it the instant you touch it.",
    priority:
      "Power is where the gap is. Prioritise intent over load — every jump and throw at maximum effort, fully rested, with far fewer reps than feels natural. Speed of movement is the whole point.",
  },
  Strength: {
    strength:
      "Your strength base is well built. Keep it topped up with heavy, low-rep work and spend the freed-up energy converting that strength into speed and power on the field.",
    developing:
      "Your base is solid but there's room above it. Add load progressively on the main lifts and hold technique constant — small consistent jumps beat big inconsistent ones.",
    priority:
      "Strength is your limiting factor, and it's the most reliable thing to fix. Get consistent on the main compound lifts, add a little weight each week, and give this block the time it needs before chasing anything flashier.",
  },
  Endurance: {
    strength:
      "Your engine holds up well. Maintain it with a steady weekly dose rather than occasional big efforts, so it never becomes the thing that limits your late-game quality.",
    developing:
      "Your conditioning is respectable but fades under repeat efforts. Build the repeatability: intervals at a pace you can hold across every rep, not one you can only hit on the first.",
    priority:
      "Conditioning is holding back everything else you do — technique and power both fall away once you're tired. Build the aerobic base first with consistent moderate work before adding harder intervals on top.",
  },
  Mobility: {
    strength:
      "Your range of motion is a genuine asset — it's what lets you get into strong positions safely. Keep the routine that got you here; it takes far less to maintain than to rebuild.",
    developing:
      "You've got workable range but it runs out at end positions. Add loaded stretching through the full range rather than passive holds, so the new range comes with control.",
    priority:
      "Restricted range is limiting the positions you can train in, which caps everything else. A short daily routine beats a long weekly one — consistency is what changes tissue.",
  },
}

/**
 * The athlete's cue: the weakest scorable category decides. Returns null when no
 * category is scorable, in which case the quote block is omitted rather than
 * rendered empty.
 */
export function selectCue(focus: CategoryScore | null): string | null {
  if (!focus) return null
  return CUES[focus.category]?.[focus.band] ?? null
}
