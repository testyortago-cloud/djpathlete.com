import { ironStreak } from "./iron-streak"
import { prMachine } from "./pr-machine"
import { recoveryPro } from "./recovery-pro"
import { consistent } from "./consistent"
import type { Badge, BadgeInput } from "./types"

const RULES = [ironStreak, prMachine, recoveryPro, consistent] as const

export function computeBadges(input: BadgeInput): Badge[] {
  return RULES.map((r) => r(input)).filter((b): b is Badge => b !== null)
}

export type { Badge, BadgeInput } from "./types"
