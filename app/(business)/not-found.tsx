/**
 * What a bad or outdated unsubscribe / consent link shows (G49): a token that
 * does not verify, or one for a contact that no longer exists. Both pages call
 * `notFound()` for those, deliberately, so a bad token looks like no page at all.
 *
 * Without this file that 404 fell through to app/not-found.tsx, whose only
 * button is "Back to home" on this platform's site: the one place these pages
 * exist to stop sending a coach's contact. The token cannot be trusted here, so
 * there is no business to name either. The page is plain and names nobody, and
 * it points the person at the one channel that always works: replying to the
 * email they got.
 */
export default function BusinessPageNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="font-heading mb-4 text-2xl font-semibold text-foreground">This link does not work</h1>
        <p className="text-muted-foreground">
          It may be out of date, or it may not have been copied in full. Nothing has been changed.
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          If you were trying to stop emails or answer a question about texts, reply to the email you got, and a person
          will take care of it.
        </p>
      </div>
    </div>
  )
}
