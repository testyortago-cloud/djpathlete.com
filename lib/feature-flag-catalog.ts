// lib/feature-flag-catalog.ts
// DB-backed feature toggles (system_settings rows), distinct from CRON_CATALOG.
// Surfaced on /admin/automation and flippable via /api/admin/automation/toggle-cron.
// New flags MUST be DB-backed (never env-driven) — see project convention.

export interface FeatureFlag {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
}

export const FEATURE_FLAG_CATALOG: readonly FeatureFlag[] = [
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
    key: "feature_session_packs_enabled",
    label: "Session Packs (in-person)",
    description:
      "Track prepaid in-person session packs on each client: sell a pack (Stripe / cash / comp, optionally linked to a program), check clients in (one tap or QR), and credits deduct automatically. Adds the Session Packs panel on client pages and the 'Today' check-in screen. Off by default.",
    defaultEnabled: false,
  },
  {
    key: "feature_qr_checkin_enabled",
    label: "QR self check-in",
    description:
      "Lets clients scan the QR on the 'Today' screen and tap their name to check themselves in. Requires Session Packs to be on. Off by default.",
    defaultEnabled: false,
  },
] as const

export function isFeatureFlagKey(key: string): boolean {
  return FEATURE_FLAG_CATALOG.some((f) => f.key === key)
}
