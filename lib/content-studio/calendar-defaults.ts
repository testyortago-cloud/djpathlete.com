import type { SocialPlatform } from "@/types/database"

const DEFAULT_UTC_HOURS: Record<SocialPlatform, number> = {
  instagram: 12,
  tiktok: 19,
  facebook: 15,
  youtube: 17,
  youtube_shorts: 17,
  linkedin: 9,
}

/**
 * Returns a Date on the given day at the platform's default publish hour.
 * If the requested time is already in the past, rolls forward one day at
 * a time until it's in the future — so we never schedule in the past.
 */
export function defaultPublishTimeForPlatform(platform: SocialPlatform, day: Date): Date {
  const t = new Date(day)
  t.setUTCHours(DEFAULT_UTC_HOURS[platform], 0, 0, 0)
  while (t.getTime() <= Date.now()) {
    t.setUTCDate(t.getUTCDate() + 1)
  }
  return t
}
