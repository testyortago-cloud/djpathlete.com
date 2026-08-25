// lib/funnels/quiz-refs.ts -- which quizzes a funnel's pages point at.
//
// A LEAF: no database client, no Zod. The funnel's settings screen already
// holds its steps, so this answers the question from what is in hand.
//
// WHY THE WALK IS DEFENSIVE RATHER THAN A SCHEMA PARSE. `project_data` is
// `jsonb` typed `unknown` and holds three different things across the table: a
// real SectionDoc, a legacy GrapesJS blob from before 00203, and null for a
// step nobody has built. On top of that, a document can fail
// `sectionDocSchema` in one section and still point at a perfectly real quiz
// in another -- and "this funnel has no quiz" is the wrong answer to give the
// person looking for the quiz they can see on their own page.

/** Only what this module reads. `listSteps` rows satisfy it. */
export interface QuizRefStep {
  id: string
  name: string
  project_data: unknown
}

export interface QuizUse {
  quizId: string
  stepId: string
  stepName: string
}

/** The shape `quizIslandSchema` accepts. Anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sectionsOf(projectData: unknown): Record<string, unknown>[] {
  if (typeof projectData !== "object" || projectData === null) return []
  const sections = (projectData as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return []
  return sections.filter((section): section is Record<string, unknown> => typeof section === "object" && section !== null)
}

/**
 * Every quiz the funnel's steps point at, deduplicated, in step order.
 *
 * THE FIRST STEP WINS on a repeat. A quiz used twice is one quiz to edit, and
 * naming the step it first appears on is the more useful half of the answer.
 */
export function quizUsesInSteps(steps: QuizRefStep[]): QuizUse[] {
  const out: QuizUse[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    for (const section of sectionsOf(step.project_data)) {
      if (section.kind !== "quiz") continue
      const props = section.props
      if (typeof props !== "object" || props === null) continue
      const quizId = (props as { quizId?: unknown }).quizId
      if (typeof quizId !== "string" || !UUID.test(quizId)) continue
      if (seen.has(quizId)) continue
      seen.add(quizId)
      out.push({ quizId, stepId: step.id, stepName: step.name })
    }
  }

  return out
}

/**
 * The step whose page shows each quiz, keyed by quiz id — `quizUsesInSteps`
 * read the other way round.
 *
 * WHY BOTH DIRECTIONS EXIST. A funnel's settings screen holds its own steps and
 * asks "which quizzes do these pages use?". The quizzes SCREEN starts from the
 * quizzes and asks the inverse, because a quiz has no page of its own: the only
 * page it can show a preview of is the funnel page running it. Same defensive
 * walk, same `project_data` caveats — see the header.
 *
 * THE FIRST STEP IN THE GIVEN ORDER WINS, matching `quizUsesInSteps`. A quiz
 * block holds a pointer, so one quiz on two pages is a legitimate state and the
 * card needs exactly one page to preview. Ordering is the caller's business —
 * it is the one that knows which funnel and position came first.
 *
 * A QUIZ NO PAGE SHOWS IS SIMPLY ABSENT, never a placement with empty fields. A
 * card renders that absence as "No preview yet", which is the honest answer; a
 * zero-value entry would build a preview URL for a page that does not show it.
 *
 * STILL A LEAF. The funnel's slug, kind and status are what the URL is actually
 * built from, and they live on the `funnels` row rather than the step — so this
 * returns `funnelId` and leaves that join to the caller rather than growing a
 * database client.
 */
export interface QuizPlacementStep extends QuizRefStep {
  funnel_id: string
  slug: string
  is_entry: boolean
  published_version_id: string | null
}

export interface QuizPlacement {
  quizId: string
  funnelId: string
  stepId: string
  stepName: string
  stepSlug: string
  isEntry: boolean
  /** The step carries a compiled version, so the live route can serve it. */
  published: boolean
}

export function quizPlacements(steps: QuizPlacementStep[]): Map<string, QuizPlacement> {
  const placements = new Map<string, QuizPlacement>()

  for (const step of steps) {
    // `quizUsesInSteps` dedupes ACROSS the whole list it is given, which is one
    // funnel's steps. Here the list spans every funnel, so the dedupe must be
    // per quiz id and the walk per step — hence the reuse of the same section
    // scan rather than a call to that function.
    for (const use of quizUsesInSteps([step])) {
      if (placements.has(use.quizId)) continue
      placements.set(use.quizId, {
        quizId: use.quizId,
        funnelId: step.funnel_id,
        stepId: step.id,
        stepName: step.name,
        stepSlug: step.slug,
        isEntry: step.is_entry,
        published: step.published_version_id !== null,
      })
    }
  }

  return placements
}
