import type { SocialPlatform, PostType } from "@/types/database"

// Phase 1a support matrix. Update when later sub-phases land:
//   Phase 1c → linkedin.image = true
//   Phase 1d → tiktok.image = true
//   Phase 2  → instagram.carousel, facebook.carousel, linkedin.carousel, tiktok.carousel = true
//   Phase 3  → instagram.story, facebook.story = true
const SUPPORT: Record<SocialPlatform, Partial<Record<PostType, boolean>>> = {
  instagram: { video: true, image: true },
  facebook: { video: true, image: true, text: true },
  linkedin: { video: true, text: true },
  tiktok: { video: true },
  youtube: { video: true },
  youtube_shorts: { video: true },
}

export function isPlatformPostTypeSupported(
  platform: SocialPlatform,
  postType: PostType,
): boolean {
  return SUPPORT[platform]?.[postType] === true
}
