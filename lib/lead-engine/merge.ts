// lib/lead-engine/merge.ts
// The merge rule, as a pure function.
//
// The case that makes this feature work, and that most systems get wrong: a
// submission whose email matches contact X and whose phone matches a different
// contact Y is not a new person. It is evidence that X and Y are the same human.

export type MatchCandidate = {
  id: string
  email: string | null
  phone_e164: string | null
  created_at: string
}

export type MergeDecision =
  | { kind: "create" }
  | { kind: "update"; contactId: string }
  | { kind: "merge"; survivorId: string; mergedId: string }

function sameEmail(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

export function decideMerge(
  candidates: MatchCandidate[],
  email: string | null,
  phone: string | null,
): MergeDecision {
  const byEmail = candidates.find((c) => sameEmail(c.email, email)) ?? null
  const byPhone = phone ? (candidates.find((c) => c.phone_e164 === phone) ?? null) : null

  if (!byEmail && !byPhone) return { kind: "create" }
  if (byEmail && !byPhone) return { kind: "update", contactId: byEmail.id }
  if (!byEmail && byPhone) return { kind: "update", contactId: byPhone.id }
  if (byEmail && byPhone && byEmail.id === byPhone.id) {
    return { kind: "update", contactId: byEmail.id }
  }

  // Two different contacts, one human. Oldest record survives.
  const [survivor, merged] = [byEmail!, byPhone!].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
  )
  return { kind: "merge", survivorId: survivor.id, mergedId: merged.id }
}
