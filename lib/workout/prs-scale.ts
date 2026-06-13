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

export const PRS_TITLE = "How recovered do you feel today?"
export const PRS_HELP = "Quick gut check before you start. You can skip it."
