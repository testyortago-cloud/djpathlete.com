// GET /api/ask/config — "is the assistant on, and whose name goes on the
// consent line?", answered at REQUEST time.
//
// WHY THIS ROUTE EXISTS. The launcher lives in `StickyApplyCTA`, a client
// component, so its flag used to be read by `app/(marketing)/layout.tsx` and
// threaded down as a prop. That layout wraps the entire public site, and every
// marketing page under it is STATICALLY GENERATED — `.next/prerender-manifest`
// reports `initialRevalidateSeconds: false` for /faq, /testimonials,
// /philosophy, /services, /glossary, /education, /contact, /athletes/*,
// /privacy-policy, /terms-of-service and /sports. So the flag was baked into
// each page at build time and never re-read; one build even baked TWO
// different answers into two different pages.
//
// That made the flag not a switch but a build artefact: ON did nothing until
// the next deploy, and OFF could not take the launcher down — the visitor
// still saw "Ask a question", opened it, typed their question, and got an
// error back from a route that had correctly gated itself. For a public box
// that collects free text from strangers, an emergency stop that needs a
// deploy is not an emergency stop.
//
// Three things follow, and none of them is optional:
//
//   1. `force-dynamic` plus `no-store`. A cached copy of this answer is the
//      same bug one hop further out.
//   2. FAIL CLOSED. Any error — either read — answers `enabled:false` and a
//      blank name. A settings outage must never switch on a feature nobody
//      switched on, and the details card cannot honestly ask for consent on
//      behalf of a business it could not name. `hasChatConsentDisplayName`
//      reads `''` as "no name", which is also what production holds, so the
//      blank is a value this feature already handles rather than a break.
//   3. The key and its default are IMPORTED. The launcher, /ask, POST /api/ask
//      and POST /api/ask/capture must all read one row with one default; a
//      second typed copy of the key drifts invisibly.
//
// It answers nothing a visitor could not already learn by looking at the page,
// so it is public and unauthenticated like the rest of the surface.
//
// NO BRAND NAMES IN THIS FILE, comments included — `app/api/ask` is inside the
// Lead Engine's brand sweep. The business's name is a value read here, never a
// string typed here.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §6.1

import { NextResponse } from "next/server"

import { getBusinessSettings } from "@/lib/db/businesses"
import { getSetting } from "@/lib/db/system-settings"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"
import { resolvePublicTenant } from "@/lib/tenancy/public"

export const dynamic = "force-dynamic"

export type AskConfig = { enabled: boolean; displayName: string }

const CLOSED: AskConfig = { enabled: false, displayName: "" }

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" }

export async function GET() {
  try {
    // PUBLIC, NO SESSION. The tenant is resolved from the request's Host by
    // lib/tenancy/public.ts (business_domains); the platform's own only when
    // no domain row claims the host.
    const businessId = await resolvePublicTenant()
    const [flag, settings] = await Promise.all([
      getSetting<boolean>(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT),
      getBusinessSettings(businessId),
    ])

    return NextResponse.json(
      {
        // `system_settings.value` is a JSON column, so the row can hold the
        // STRING "false" — which is truthy. Only the boolean true is a yes.
        enabled: flag === true,
        displayName: typeof settings.display_name === "string" ? settings.display_name : "",
      } satisfies AskConfig,
      { headers: NO_STORE },
    )
  } catch {
    return NextResponse.json(CLOSED, { headers: NO_STORE })
  }
}
