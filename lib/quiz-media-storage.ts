// lib/quiz-media-storage.ts — demo clips for quiz questions, in Firebase Storage.
//
// ---------------------------------------------------------------------------
// THIS RETURNS A DURABLE PUBLIC URL, FOR THE SAME REASON funnel-storage.ts DOES.
// ---------------------------------------------------------------------------
// A quiz question's `media_url` is read by `publicQuizDefinition` and shipped
// to the browser of an ANONYMOUS VISITOR walking the quiz, for as long as that
// quiz is active. A signed URL there expires and the demo video vanishes from
// a running campaign with no error anyone sees — the visitor simply cannot
// tell what movement they were asked to perform, and grades themselves on a
// blank player.
//
// So quiz media are PUBLIC objects under a path `storage.rules` marks
// readable, addressed by the Firebase download URL, which never expires.
// See the repo's `signed_urls_durable_hrefs` rule.
//
// Uploads use the ADMIN SDK, which bypasses storage.rules entirely — the
// matching rule grants `read` only, and `write: if false` is deliberate: no
// browser may ever put a file here directly.

/** Matches the `match /quiz-media/{quizKey}/{fileName}` rule in storage.rules. */
export const QUIZ_MEDIA_PREFIX = "quiz-media"

/**
 * Both segments are constrained to the rule's own shape. A quiz key with a
 * slash in it would silently land a level deeper than the rule matches, and
 * the object would be uploaded, recorded and then 404 for every visitor.
 */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
}

export function quizMediaStoragePath(quizKey: string, filename: string): string {
  return `${QUIZ_MEDIA_PREFIX}/${safeSegment(quizKey)}/${safeSegment(filename)}`
}

/**
 * The public, non-expiring URL for an object in the default bucket.
 *
 * The path is percent-encoded WHOLE, slashes included (`%2F`) — that is the
 * form the Firebase download endpoint requires, and encoding the segments
 * individually produces a URL that 404s.
 */
export function quizMediaPublicUrl(bucketName: string, storagePath: string): string {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media`
  )
}
