// lib/lead-engine/placeholder-guard.ts — the one thing standing between
// unreviewed copy and a real athlete's inbox.
//
// The four quiz_* sequences (migration 00229) were seeded with bodies that
// open "PLACEHOLDER COPY — not reviewed. Do not activate this sequence until
// this line is gone." That instruction is addressed to a human, and a human
// is exactly who will be in a hurry: activating a sequence is one UPDATE, and
// nothing else in the system reads that sentence.
//
// The stakes are not "an embarrassing email". A quiz result sequence fires at
// someone who has just been told something personal about their own body, and
// the four archetypes are aimed at an injured athlete, a plateaued one, an
// ambitious one and a worried parent. Placeholder prose is the wrong thing to
// send any of them.
//
// This module is PURE so it can be asserted in the test suite, where it fails
// at build time while somebody can still fix it — rather than at 8am on a
// Tuesday when the tick claims the run and the copy is already gone.

export const PLACEHOLDER_MARKER = "PLACEHOLDER COPY"

/**
 * Keys of sequences that are live AND still carry the marker.
 *
 * Order follows the input, so a caller's error message lists offenders in a
 * stable order rather than whatever the database felt like returning that day.
 *
 * A null body is not an offence: a `wait` step has no body at all, and
 * treating "nothing to check" as "nothing wrong" is correct here — unlike a
 * missing READ, which this function never performs.
 */
export function findLivePlaceholders(
  rows: Array<{ key: string; status: string; body: string | null }>,
): string[] {
  return rows
    .filter((row) => row.status === "active" && (row.body ?? "").includes(PLACEHOLDER_MARKER))
    .map((row) => row.key)
}
