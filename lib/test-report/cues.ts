import type { RadarCategory } from "@/lib/coach-intel/test-normalization"
import type { Band, FocalPoint } from "./scoring"

/**
 * Coaching cues, one per (category × band). Selected from the athlete's focal
 * points, so the report always closes on the thing that moves the needle most.
 * Deterministic on purpose: the same numbers produce the same sentence on every
 * render, and the copy is reviewable in one place rather than generated per view.
 *
 * Tone rule (owner decision): candid but constructive, athlete/parent-facing.
 * Name the gap, then give the instruction. No clinical language, no diagnosis.
 */
export const CUES: Record<RadarCategory, Record<Band, string>> = {
  Speed: {
    strength: "Keep sprint work early in the session while you're fresh, and treat full recovery between reps as part of the training.",
    developing: "The next gain is in your first three steps — push the ground back behind you rather than reaching forward.",
    priority: "Cut the volume and raise the intensity: short maximal efforts with long rest, and end the set the moment your times drop off.",
  },
  Power: {
    strength: "Keep it sharp with low-volume, high-intent jumps before your main lifts, and don't let heavy work crowd them out.",
    developing: "You're producing decent force — now produce it faster by treating the floor as hot and leaving it the instant you touch it.",
    priority: "Every jump at maximum effort, fully rested, with far fewer reps than feels natural — speed of movement is the whole point.",
  },
  Strength: {
    strength: "Top it up with heavy, low-rep work and spend the freed-up energy converting that strength into speed on the field.",
    developing: "Add load progressively on the main lifts and hold technique constant — small consistent jumps beat big inconsistent ones.",
    priority: "Get consistent on the main compound lifts and add a little weight each week; this is the most reliable thing on the page to fix.",
  },
  Endurance: {
    strength: "Maintain it with a steady weekly dose rather than occasional big efforts, so it never limits your late-game quality.",
    developing: "Build repeatability with intervals at a pace you can hold across every rep, not one you can only hit on the first.",
    priority: "Build the aerobic base first with consistent moderate work before adding harder intervals on top of it.",
  },
  Mobility: {
    strength: "Keep the routine that got you here — range takes far less work to maintain than it does to rebuild.",
    developing: "Add loaded stretching through the full range rather than passive holds, so the new range comes with control.",
    priority: "A short daily routine beats a long weekly one, because consistency is what actually changes tissue.",
  },
}

/** The instruction for a focal point. Pure matrix lookup, same input same output. */
export function cueFor(fp: FocalPoint): string {
  return CUES[fp.category][fp.band]
}
