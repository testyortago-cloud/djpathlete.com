// lib/quizzes/report.ts — the mini-assessment on the results page.
//
// PURE, like score.ts: types plus score.ts's walk, nothing else, so its tests
// run with zero mocks. Runs on the SERVER after scoring. It is the only place
// a visitor's per-question points leave the server, and then only their own,
// only after they have submitted.
//
// Spec: docs/superpowers/specs/2026-10-04-rpi-video-quiz-gaps-design.md §6.1

import { walkedQuestions } from "@/lib/quizzes/score"
import type { QuizAnswer, QuizDefinition } from "@/lib/quizzes/types"

export type MapStatus = "solid" | "watch" | "leak" | "gap"

export interface MapRow {
  label: string
  left: number | null
  right: number | null
  single: number | null
  max: number
  status: MapStatus
}

export interface MirrorLine {
  prompt: string
  answer: string
}

export interface QuizReport {
  mirror: MirrorLine[]
  map: MapRow[]
}

/**
 * Status by FRACTION of the max, so a test scored 0–3 and one scored 0–5 read
 * the same. A gap needs both sides and half the scale between them: on 0–3,
 * a 3 against a 1 is a gap, a 3 against a 2 is not.
 */
function statusOf(row: Omit<MapRow, "status">): MapStatus {
  if (row.left !== null && row.right !== null && Math.abs(row.left - row.right) / row.max >= 0.5) return "gap"
  const fractions = [row.left, row.right, row.single]
    .filter((points): points is number => points !== null)
    .map((points) => points / row.max)
  if (fractions.some((fraction) => fraction < 0.5)) return "leak"
  if (fractions.some((fraction) => fraction < 1)) return "watch"
  return "solid"
}

export function buildReport(definition: QuizDefinition, answers: QuizAnswer[], branchId: string | null): QuizReport {
  const chosen = new Map(answers.map((answer) => [answer.questionId, answer.optionId]))
  const rows = new Map<string, Omit<MapRow, "status">>()
  const mirror: MirrorLine[] = []

  for (const question of walkedQuestions(definition, branchId)) {
    const option = question.options.find((candidate) => candidate.id === chosen.get(question.id))
    const max = Math.max(0, ...question.options.map((candidate) => candidate.weight))

    if (question.reportLabel) {
      const row = rows.get(question.reportLabel) ?? { label: question.reportLabel, left: null, right: null, single: null, max: 0 }
      row.max = Math.max(row.max, max)
      if (option) row[question.side ?? "single"] = option.weight
      rows.set(question.reportLabel, row)
      continue
    }

    // Unscored and not a profile vote: something the visitor TOLD us, which
    // is what "mirror back what they said" means. The profile vote surfaces
    // as the profile block instead.
    if (option && max === 0 && !question.options.some((candidate) => candidate.profileId)) {
      mirror.push({ prompt: question.prompt, answer: option.label })
    }
  }

  const map = [...rows.values()]
    .filter((row) => row.max > 0 && (row.left !== null || row.right !== null || row.single !== null))
    .map((row) => ({ ...row, status: statusOf(row) }))

  return { mirror, map }
}
