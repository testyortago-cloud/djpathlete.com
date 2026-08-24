// Server wrapper for the quiz. Mirrors FormIsland: read what the client needs,
// strip what it must not have, and hand the interactive shell a rendered prop.

import { getQuizDefinition } from "@/lib/db/quizzes"
import { getBusinessSettings } from "@/lib/db/businesses"
import { publicQuizDefinition } from "@/lib/quizzes/public-definition"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { QuizRunner } from "./QuizRunner"
import type { FunnelRenderContext } from "./index"

interface QuizIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function QuizIsland({ props, context }: QuizIslandProps) {
  const quizId = typeof props.quizId === "string" ? props.quizId : ""
  if (!quizId) return null

  const definition = await getQuizDefinition(quizId).catch(() => null)
  // A quiz that cannot be read renders NOTHING rather than an empty shell that
  // takes answers into the void. The publish gate should have stopped this
  // page reaching a visitor at all; if it is here anyway, silence is the
  // honest failure.
  if (!definition) return null

  // On the live page a non-active quiz must not collect answers. A preview is
  // exactly where a draft is supposed to be tried, so it is allowed through.
  const previewing = context.testRun === true || context.isPreview === true
  if (definition.status !== "active" && !previewing) return null

  // THE WEIGHTS, THE TIER BANDS AND THE PROFILE COPY STOP HERE. The browser is
  // handed only what it needs to walk the quiz; a client that knew the weights
  // could compute its own result, and the fact that it cannot is the only
  // reason a result cannot be forged.
  const publicDefinition = publicQuizDefinition(definition)

  // Read only for the phone field's checkbox, and only to render the wording —
  // same reasoning and the same gate as FormIsland. A blank or unreadable name
  // degrades to NO checkbox, never to a checkbox whose sentence cannot name
  // the business, and `hasSmsConsentDisplayName` is the same gate the submit
  // route checks before filing the row, so "the name was unusable" cannot mean
  // one thing here and another there.
  const settings = await getBusinessSettings().catch(() => null)
  const displayName = settings?.display_name
  const smsConsentWording = hasSmsConsentDisplayName(displayName) ? renderSmsConsentWording(displayName) : undefined

  return (
    <QuizRunner
      definition={publicDefinition}
      submitLabel={typeof props.submitLabel === "string" ? props.submitLabel : "See my result"}
      consentText={typeof props.consentText === "string" ? props.consentText : undefined}
      smsConsentWording={smsConsentWording}
      isPreview={context.isPreview}
      testRun={context.testRun === true}
    />
  )
}
