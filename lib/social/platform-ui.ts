// lib/social/platform-ui.ts
// Shared UI presentation data for SocialPlatform values. Keep this in sync
// with the SocialPlatform enum in types/database.ts. Previously the same
// icon and label tables were duplicated in
// components/admin/social/SocialPostCard.tsx,
// components/admin/calendar/WeekGrid.tsx, and
// components/admin/content-studio/drawer/PostsTabRow.tsx.

import { Facebook, Instagram, Linkedin, Music2, Youtube, type LucideIcon } from "lucide-react"
import type { SocialPlatform } from "@/types/database"

export const PLATFORM_ICONS: Record<SocialPlatform, LucideIcon> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  linkedin: "LinkedIn",
}
