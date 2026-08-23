// lib/feature-flag-catalog.ts
// DB-backed feature toggles (system_settings rows), distinct from CRON_CATALOG.
// Surfaced on /admin/automation and flippable via /api/admin/automation/toggle-cron.
// New flags MUST be DB-backed (never env-driven) — see project convention.
//
// `lib/funnels/checkout/flag.ts` is a LEAF WITH NO IMPORTS, by its own header, so
// importing FROM it here costs nothing and keeps that promise intact: this file
// depends on it, never the reverse.

import { FUNNEL_CHECKOUT_DEFAULT, FUNNEL_CHECKOUT_FLAG } from "@/lib/funnels/checkout/flag"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT } from "@/lib/lead-engine/chat/constants"

export interface FeatureFlag {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
}

export const FEATURE_FLAG_CATALOG: readonly FeatureFlag[] = [
  {
    // Same discipline as the funnel flag above: the key and the default are
    // IMPORTED, never retyped. Four surfaces read them — the marketing
    // launcher, /ask, POST /api/ask and POST /api/ask/capture — and a switch
    // here that flipped a row none of them read would look like it worked.
    //
    // REGISTERED BECAUSE THE ALTERNATIVE WAS A HAND-WRITTEN DATABASE ROW.
    // `toggle-cron` rejects any key outside this catalog and CRON_CATALOG, so
    // without this entry the only way to launch the assistant — or to KILL it —
    // was to write system_settings by hand. For a public surface that collects
    // free text from strangers, the off switch has to be reachable by the
    // person who needs it at the time they need it.
    key: CHAT_ASSISTANT_FLAG,
    label: "Chat assistant",
    description:
      "Shows the 'Ask a question' launcher on the public site and opens the /ask page. The assistant answers " +
      "only from what is published here — FAQs, the public programme, camps and clinics — and hands over to a " +
      "person when it cannot. It stores what visitors type, so leave it off until you are ready for that. Off by default.",
    defaultEnabled: CHAT_ASSISTANT_FLAG_DEFAULT,
  },
  {
    // THE KEY AND THE DEFAULT ARE IMPORTED, NEVER RETYPED. Both the submit route
    // and the programs checkout route read `FUNNEL_CHECKOUT_FLAG` and pass
    // `FUNNEL_CHECKOUT_DEFAULT` explicitly at every call site. A copied string
    // here with one character wrong would render a switch that flips a row
    // nothing reads — and a copied default that disagreed would show "on" while
    // every checkout 404s, which is worse than no switch at all because it looks
    // like it worked. feature-flag-catalog.test.ts pins both against the source.
    key: FUNNEL_CHECKOUT_FLAG,
    label: "Funnels can take payment",
    description:
      "Lets a funnel's own form charge a card — a Register step creates the signup and sends the visitor " +
      "straight to Stripe Checkout, instead of handing them off to the camp's page to enter everything again. " +
      "This is the only flag here that moves money, so it stays off until a camp has a Stripe price, an active " +
      "liability waiver exists, and the form has been set to 'Take payment for a camp' in the builder. Off by default.",
    defaultEnabled: FUNNEL_CHECKOUT_DEFAULT,
  },
  {
    key: "feature_captioned_cut_enabled",
    label: "Captioned video cuts",
    description:
      "Adds a 'Generate Captioned Cut' button to videos in Content Studio. Renders a vertical 9:16 clip with TikTok-style word-pop captions burned in, ready to post. Off by default.",
    defaultEnabled: false,
  },
  {
    key: "feature_split_reel_enabled",
    label: "Split Reel (AI b-roll cuts)",
    description:
      "Dynamic two-row reels: full-frame talking head that cuts to a face-tracked split with fal.ai b-roll at AI-selected moments.",
    defaultEnabled: false,
  },
  {
    key: "feature_program_excel_import_enabled",
    label: "Import program from Excel",
    description:
      "Adds an 'Import from Excel' button to /admin/programs. Coaches upload a spreadsheet (full, partial, or messy); the AI reads it, matches exercises to the library, fills gaps, and creates a private review-ready program. Includes a downloadable template.",
    defaultEnabled: true,
  },
] as const

export function isFeatureFlagKey(key: string): boolean {
  return FEATURE_FLAG_CATALOG.some((f) => f.key === key)
}
