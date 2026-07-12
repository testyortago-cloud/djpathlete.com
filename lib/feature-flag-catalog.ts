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
