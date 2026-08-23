import { SiteNavbar } from "@/components/SiteNavbar"
import { Footer } from "@/components/Footer"
import { StickyApplyCTA } from "@/components/public/StickyApplyCTA"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getSetting } from "@/lib/db/system-settings"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"

/**
 * The chat launcher lives inside `StickyApplyCTA`, which is a client component
 * and therefore cannot read `system_settings` or `business_settings` itself.
 * This layout is its nearest server parent, so it reads both here and threads
 * them down — the same fetch-and-thread shape `components/public/InquiryForm`
 * already uses for the SMS consent wording, for the same reason.
 *
 * BOTH READS FAIL CLOSED. A settings outage must not open a feature nobody
 * switched on, so the flag degrades to `CHAT_ASSISTANT_FLAG_DEFAULT` (false)
 * and the name degrades to `''` — which is the value that makes the details
 * card draw no marketing tick, matching what `/api/ask/capture` would do with
 * the same input.
 *
 * These are read at render, so a statically generated page bakes them in until
 * its own `revalidate` comes round — exactly as the SMS consent checkbox
 * already does (see the note on `app/(marketing)/assessment/page.tsx`).
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [askEnabled, settings] = await Promise.all([
    getSetting<boolean>(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT).catch(() => CHAT_ASSISTANT_FLAG_DEFAULT),
    getBusinessSettings().catch(() => null),
  ])

  return (
    <>
      <SiteNavbar />
      <main className="min-h-screen">{children}</main>
      <Footer />
      <StickyApplyCTA askEnabled={askEnabled} displayName={settings?.display_name ?? ""} />
    </>
  )
}
