export const PRS_MIN = 0
export const PRS_MAX = 10

/**
 * Perceived Recovery Status (PRS) — subjective readiness check at the start of a
 * session. This is the standard published 0–10 scale (Laurent et al., 2011).
 *
 * EDIT THIS CONSTANT to drop in the coach's exact wording — nothing else needs
 * to change; the prompt UI renders straight from these anchors.
 */
export const PRS_SCALE: Array<{ value: number; label: string }> = [
  { value: 0, label: "Very poorly recovered — extremely tired" },
  { value: 2, label: "Poorly recovered — very tired" },
  { value: 4, label: "Somewhat recovered" },
  { value: 6, label: "Adequately recovered" },
  { value: 8, label: "Well recovered — somewhat energetic" },
  { value: 10, label: "Very well recovered — highly energetic" },
]

export const PRS_TITLE = "How recovered do you feel before starting this session?"
export const PRS_HELP = "Drag to your number. Quick gut check — you can skip it."

export interface PrsBand {
  /** Descriptive label for the picked value's band. */
  label: string
  /** Performance expectation for this recovery level (mirrors the coach's scale chart). */
  expectation: string
  /** Hex colour for the slider accent + number, green → red like the chart. */
  color: string
}

/**
 * Map a 0–10 PRS value to its label, performance expectation, and colour.
 * Label, colour, and expectation move together band-by-band (mirrors the coach's
 * scale chart) so they never disagree at a boundary.
 */
export function prsBand(value: number): PrsBand {
  if (value >= 8)
    return { label: "Well recovered — energetic", expectation: "Expect improved performance", color: "#16a34a" } // green-600
  if (value === 7)
    return { label: "Well recovered", expectation: "Expect improved performance", color: "#4ade80" } // green-400
  if (value >= 4)
    return { label: "Adequately recovered", expectation: "Expect similar performance", color: "#eab308" } // yellow-500
  if (value === 3)
    return { label: "Not fully recovered", expectation: "Expect declined performance", color: "#ec4899" } // pink-500
  return { label: "Poorly recovered — tired", expectation: "Expect declined performance", color: "#dc2626" } // red-600
}
