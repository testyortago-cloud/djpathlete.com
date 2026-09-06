// app/(marketing)/ask/page.tsx — the full-page half of the chat surface.
//
// It exists so escalation emails, the FAQ page and the nav have somewhere to
// point, and so the widget is not the only way in (spec §6.2).
//
// THIS ROUTE GATES ITSELF. `middleware.ts` covers only `/admin/*` and
// `/client/*`, so nothing upstream will close this page when the feature is
// off. The gate fails CLOSED and answers 404 — never a redirect and never a
// 403, because "there is nothing here" is the honest answer for a feature that
// has not been switched on, and a redirect advertises that something exists.
//
// The key and the default are IMPORTED, never retyped: `/ask`, `POST /api/ask`
// and `POST /api/ask/capture` must agree, and a page defaulting open while the
// routes default closed is a public surface nobody knows is on.
//
// `force-dynamic` because the flag is the whole point. A statically generated
// copy of this page would bake the flag in at build time, so switching the
// assistant on would do nothing until the next deploy — and switching it OFF
// would leave the page up.

import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AskPanel } from "@/components/public/AskPanel"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getSetting } from "@/lib/db/system-settings"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"
import { resolvePublicTenant } from "@/lib/tenancy/public"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Ask a question",
  description:
    "Ask about coaching, camps and clinics, or how to get started. Answers come from what is published on this site.",
  alternates: { canonical: "/ask" },
  // Nothing here is a landing page and the answers are generated per visitor.
  robots: { index: false, follow: true },
}

export default async function AskPage() {
  const enabled = await getSetting<boolean>(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT)
  if (!enabled) notFound()

  // A FAILED READ AND A BLANK NAME COLLAPSE TO THE SAME VALUE, deliberately —
  // `hasChatConsentDisplayName` is the one verdict both this surface and
  // `/api/ask/capture` reach, so neither can end up showing a consent tick the
  // other would refuse to file. The rest of the assistant works either way;
  // it is one card that loses one optional line.
  //
  // PUBLIC, NO SESSION. The tenant is resolved from the request's Host by
  // lib/tenancy/public.ts: this page shows the Host's business. POST
  // /api/ask/capture does not read the Host at all — it files under the
  // conversation's business_id, decided once when POST /api/ask created the
  // conversation from this same origin. The two agree TRANSITIVELY, not
  // because they share one resolution: the name shown here and the wording
  // filed there both trace back to the same Host, one hop apart.
  const businessId = await resolvePublicTenant()
  const settings = await getBusinessSettings(businessId).catch(() => null)
  const displayName = settings?.display_name ?? ""

  return (
    <section className="px-4 pb-16 pt-28 sm:px-8 lg:pt-36">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
            Ask a question
          </h1>
          <p className="mt-3 text-muted-foreground">
            Coaching, camps and clinics, or how to get started. Answers come from what&apos;s published on this site —
            and when the answer isn&apos;t here, you get put to a person instead of a guess.
          </p>
        </div>

        <div className="h-[70vh] min-h-[480px]">
          <AskPanel displayName={displayName} variant="page" />
        </div>
      </div>
    </section>
  )
}
