import { notFound } from "next/navigation"
import { processUnsubscribe } from "@/lib/lead-engine/unsubscribe"

// This page writes on every render, so it must never be statically cached.
export const dynamic = "force-dynamic"

/**
 * The unsubscribe landing page reached from a sequence email's footer link.
 *
 * The whole revocation — consent row, suppression, run exits, timeline event —
 * lives in `processUnsubscribe` (lib/lead-engine/unsubscribe.ts) because the
 * RFC 8058 one-click endpoint at `app/api/unsubscribe/[token]/route.ts` has to
 * perform exactly the same flow. Two copies of a consent-revocation path is
 * how one surface ends up suppressing an address while the other only exits a
 * run.
 */
export default async function UnsubscribeTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const outcome = await processUnsubscribe(token)
  if (!outcome.ok) notFound()

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-heading font-semibold text-primary mb-4">Unsubscribed</h1>
        <p className="text-muted-foreground">You won&apos;t receive any further emails in this sequence.</p>
      </div>
    </div>
  )
}
