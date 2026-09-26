import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BusinessFrame } from "@/components/public/BusinessFrame"
import { loadBusinessPageIdentity } from "@/lib/lead-engine/business-page"
import { processUnsubscribe } from "@/lib/lead-engine/unsubscribe"

// This page writes on every render, so it must never be statically cached.
export const dynamic = "force-dynamic"

// A fixed title: naming the business here would mean resolving the token in
// generateMetadata too, and this page WRITES when it resolves one.
export const metadata: Metadata = { title: "Unsubscribed" }

/**
 * The unsubscribe landing page reached from a sequence email's footer link.
 *
 * The whole revocation — consent row, suppression, run exits, timeline event —
 * lives in `processUnsubscribe` (lib/lead-engine/unsubscribe.ts) because the
 * RFC 8058 one-click endpoint at `app/api/unsubscribe/[token]/route.ts` has to
 * perform exactly the same flow. Two copies of a consent-revocation path is
 * how one surface ends up suppressing an address while the other only exits a
 * run.
 *
 * It is framed as the business the token was signed for (G49), the one whose
 * emails the person just stopped, not as this platform's site.
 */
export default async function UnsubscribeTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const outcome = await processUnsubscribe(token)
  if (!outcome.ok) notFound()

  const identity = await loadBusinessPageIdentity(outcome.businessId)

  return (
    <BusinessFrame identity={identity}>
      <div className="text-center">
        <h1 className="text-2xl font-heading font-semibold text-primary mb-4">Unsubscribed</h1>
        <p className="text-muted-foreground">You won&apos;t receive any further emails in this sequence.</p>
      </div>
    </BusinessFrame>
  )
}
