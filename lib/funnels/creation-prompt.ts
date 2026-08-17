// lib/funnels/creation-prompt.ts — the first instruction a never-touched step
// gets.
//
// IT LIVES HERE, NOT IN THE ROUTE, BECAUSE TWO CALLERS NEED IT.
// `[stepId]/page.tsx` composes it when the owner opens a blank page, and the
// edit LAYOUT composes it for every step the background draft queue is about
// to build. Those two must write the same page from the same template, and the
// only way to guarantee that is one definition — this repo has already shipped
// three defects from restating a rule instead of importing it.

import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { Funnel, FunnelStep } from "@/types/database"

/**
 * The first instruction for a page that has just been created.
 *
 * Rebuilt from stored columns every time rather than carried in the URL: a
 * prompt in the query string survives a refresh, a share and a back button, and
 * would replay over work the owner has since done. `?start=1` therefore carries
 * no content at all — it is a nudge, and the guards below (and inside the
 * builder) are what actually decide.
 *
 * Returns null when the page has no goal, which is every row created before
 * goals existed. Those pages open the way they always did.
 */
export function creationPrompt(
  funnel: Funnel,
  step: FunnelStep,
  siblings: FunnelStep[],
): string | null {
  // A STEP'S OWN GOAL WINS. `funnel.goal` describes a landing page, which has
  // exactly one job; a funnel's steps have different ones, and reading the
  // container's goal here would tell the payment step it is a lead form.
  const goal = FUNNEL_GOALS.find((option) => option.value === (step.goal ?? funnel.goal))

  // A funnel created before templates, or a page created before goals, has
  // nothing to say — and must open exactly as it always did rather than have
  // this feature start drafting over old work.
  if (!goal && funnel.template === null) return null

  // Landing pages keep their prompt verbatim. It is a shipped, tuned behaviour
  // and this change is explicitly not in scope for it.
  if (funnel.kind === "page") {
    if (!goal) return null
    const lines = [
      `Build a landing page called "${funnel.name}".`,
      `Its job: ${goal.label.toLowerCase()} — ${goal.hint.toLowerCase()}.`,
    ]
    // Appended, never inserted above the existing lines: the two-then-
    // description shape is the tuned behaviour, and a page created before the
    // audience field existed composes exactly the string it always did.
    if (funnel.audience) lines.push(`Who it is for: ${funnel.audience}`)
    if (funnel.description) lines.push(`What it is for: ${funnel.description}`)
    return lines.join("\n")
  }

  // `siblings` is the whole ordered list, so the model knows what comes before
  // and after — a checkout page written without knowing a confirmation follows
  // it tends to write the confirmation into itself.
  const ordered = [...siblings].sort((a, b) => a.position - b.position)
  const position = ordered.findIndex((candidate) => candidate.id === step.id)
  const lines: string[] = []

  lines.push(
    position >= 0 && ordered.length > 1
      ? `Build step ${position + 1} of ${ordered.length} of the "${funnel.name}" funnel, called "${step.name}".`
      : `Build the "${step.name}" page of the "${funnel.name}" funnel.`,
  )
  if (goal) lines.push(`Its job: ${goal.label.toLowerCase()} — ${goal.hint.toLowerCase()}.`)
  if (funnel.audience) lines.push(`Who it is for: ${funnel.audience}`)
  if (funnel.description) lines.push(`What the funnel is for: ${funnel.description}`)
  if (funnel.offer_kind && funnel.offer_ref) {
    // Named so the CTA can point at something real. The ref came from the
    // catalogue picker, so `resolve.ts` matches it exactly instead of guessing
    // at a name the model invented.
    lines.push(`The offer is the ${funnel.offer_kind.replace("_", " ")} "${funnel.offer_ref}".`)
  }
  if (ordered.length > 1) {
    lines.push(`The full sequence is: ${ordered.map((entry) => entry.name).join(", ")}.`)
  }

  return lines.join("\n")
}
