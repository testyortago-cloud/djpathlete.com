// lib/social/platform-mapping.ts
// Typed converter from `PlatformPluginName` (used on `platform_connections.plugin_name`)
// to `SocialPlatform` (used on `social_posts.platform`). Plugin names cover a
// superset of social platforms (Google Ads, Gmail, etc.) so non-social plugins
// resolve to `null`.
//
// The `Record<PlatformPluginName, SocialPlatform | null>` annotation forces
// exhaustiveness at compile time — adding a new `PlatformPluginName` member
// without updating this map will fail `tsc --noEmit`.

import type { PlatformPluginName, SocialPlatform } from "@/types/database"

const MAP: Record<PlatformPluginName, SocialPlatform | null> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
  youtube_shorts: "youtube_shorts",
  google_ads: null,
  gmail: null,
}

/**
 * Translate a `platform_connections.plugin_name` value to its corresponding
 * `SocialPlatform`. Returns `null` for plugin names that don't represent a
 * social posting destination (e.g. `google_ads`, `gmail`).
 */
export function pluginNameToPlatform(name: PlatformPluginName): SocialPlatform | null {
  return MAP[name] ?? null
}
