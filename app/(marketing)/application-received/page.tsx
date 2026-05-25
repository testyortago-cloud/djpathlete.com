import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { ConversionTracker } from "@/components/shared/ConversionTracker"
import { getSendTo } from "@/lib/ads/conversion-registry"

export const metadata: Metadata = {
  title: "Application received",
  description: "Thanks — we review every application personally and respond within 48 hours.",
  // The thank-you page itself has no SEO value; keep it out of the index so
  // it never competes with the apply pages.
  robots: { index: false, follow: false },
  alternates: { canonical: "/application-received" },
}

/**
 * Dedicated post-submit landing for the inquiry form. The form redirects
 * here on a successful POST — so the Google Ads conversion (via
 * <ConversionTracker>) only fires when the application actually went
 * through, not on every button click. Easy to verify in Tag Assistant
 * because the conversion is tied to a stable URL.
 */
export default function ApplicationReceivedPage() {
  return (
    <>
      <ConversionTracker sendTo={getSendTo("lead_form")} currency="USD" />

      <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 py-24 text-center sm:px-8">
        <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
          Application received.
        </h1>
        <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
          Thanks — we review every application personally and respond within 48&nbsp;hours.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to homepage
          </Link>
          <Link
            href="/blog"
            className="text-sm font-medium text-primary hover:text-accent"
          >
            Read the blog while you wait →
          </Link>
        </div>
      </main>
    </>
  )
}
