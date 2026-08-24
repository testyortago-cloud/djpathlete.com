// lib/quizzes/public-definition.ts — the shape the browser is allowed to see.
//
// THIS MODULE MUST IMPORT NOTHING BUT TYPES, the same contract as score.ts
// and gate.ts.
//
// WHY IT EXISTS. The visitor's browser walks the quiz — it decides which
// question to show next, which means it must hold the questions, the options
// and the routing. It must NOT hold the weights, the profile votes, the tier
// bands or the profile copy. Scoring happens on the server against the
// definition the server read (§4.1); a browser that knows the weights can
// compute its own result, and the fact that it cannot is the only reason a
// result cannot be forged.
//
// EVERY FIELD IS COPIED EXPLICITLY. Never build this by cloning the private
// definition and deleting keys: a field added to QuizOption next year would
// then ship to the browser by default, and the failure is silent. Here, a new
// private field is invisible until somebody adds a line — the safe direction.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.1

import type { QuizDefinition } from "@/lib/quizzes/types"

export interface PublicQuizOption {
  id: string
  label: string
  /** Ships deliberately: the browser has to know which branch to walk. */
  routesToBranchId: string | null
}

export interface PublicQuizQuestion {
  id: string
  branchId: string | null
  position: number
  prompt: string
  helpText: string | null
  options: PublicQuizOption[]
}

export interface PublicQuizDefinition {
  id: string
  key: string
  introHeadline: string
  introBody: string
  gateHeadline: string
  gateBody: string
  resultHeadline: string
  branches: { id: string; key: string; name: string }[]
  questions: PublicQuizQuestion[]
}

export function publicQuizDefinition(definition: QuizDefinition): PublicQuizDefinition {
  return {
    id: definition.id,
    key: definition.key,
    introHeadline: definition.introHeadline,
    introBody: definition.introBody,
    gateHeadline: definition.gateHeadline,
    gateBody: definition.gateBody,
    resultHeadline: definition.resultHeadline,
    // `description` is an operator's note about the archetype, not visitor
    // copy, so it is not carried across.
    branches: definition.branches.map((branch) => ({
      id: branch.id,
      key: branch.key,
      name: branch.name,
    })),
    questions: definition.questions
      .filter((question) => question.isActive)
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((question) => ({
        id: question.id,
        branchId: question.branchId,
        position: question.position,
        prompt: question.prompt,
        helpText: question.helpText,
        options: question.options
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((option) => ({
            id: option.id,
            label: option.label,
            routesToBranchId: option.routesToBranchId,
          })),
      })),
  }
}
