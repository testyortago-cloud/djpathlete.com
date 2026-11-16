// Pure rules for the "Post to TikTok" screen. Client-safe: no server imports.
import type { TikTokPostSettings, TikTokPrivacyLevel } from "@/lib/validators/tiktok-post-settings"

export interface TikTokCreatorInfo {
  avatarUrl: string | null
  username: string
  nickname: string
  privacyLevelOptions: TikTokPrivacyLevel[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxVideoPostDurationSec: number
}

export type CreatorInfoResult = { ok: true; creator: TikTokCreatorInfo } | { ok: false; code: string; message: string }

export const PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
}

export type TikTokDraft = Omit<TikTokPostSettings, "privacy_level"> & {
  privacy_level: TikTokPrivacyLevel | null
}

export function emptyDraft(): TikTokDraft {
  return {
    privacy_level: null,
    allow_comment: false,
    allow_duet: false,
    allow_stitch: false,
    disclose: false,
    your_brand: false,
    branded_content: false,
  }
}

// Nothing is pre-chosen except what the coach saved last time, and only if
// this account still allows it.
export function prefillDraft(saved: TikTokPostSettings | null, creator: TikTokCreatorInfo): TikTokDraft {
  if (!saved) return emptyDraft()
  return {
    ...saved,
    privacy_level: creator.privacyLevelOptions.includes(saved.privacy_level) ? saved.privacy_level : null,
    allow_comment: saved.allow_comment && !creator.commentDisabled,
    allow_duet: saved.allow_duet && !creator.duetDisabled,
    allow_stitch: saved.allow_stitch && !creator.stitchDisabled,
  }
}

// First reason the Post button must stay off, or null. Order is deliberate.
export function submitBlocker(
  draft: TikTokDraft,
  creator: TikTokCreatorInfo,
  durationSec: number | null,
): string | null {
  if (durationSec === null) return "Loading the video…"
  if (durationSec > creator.maxVideoPostDurationSec) {
    return `This video is ${durationSec} seconds long. TikTok allows up to ${creator.maxVideoPostDurationSec} seconds for this account.`
  }
  if (draft.privacy_level === null) return "Choose who can view this video."
  if (draft.disclose && !draft.your_brand && !draft.branded_content) {
    return "You need to indicate if your content promotes yourself, a third party, or both."
  }
  if (draft.branded_content && draft.privacy_level === "SELF_ONLY") {
    return "Branded content can't be private. Choose another audience."
  }
  return null
}

export function disclosureLabel(draft: TikTokDraft): string | null {
  if (!draft.disclose) return null
  if (draft.branded_content) return 'Your photo/video will be labeled as "Paid partnership"'
  if (draft.your_brand) return 'Your photo/video will be labeled as "Promotional content"'
  return null
}

export function toSettings(draft: TikTokDraft): TikTokPostSettings {
  if (draft.privacy_level === null) throw new Error("Choose who can view this video.")
  return { ...draft, privacy_level: draft.privacy_level }
}

export function creatorInfoRefusal(code: string, message: string): string {
  switch (code) {
    case "spam_risk_too_many_posts":
      return "This TikTok account has reached today's posting limit. Try again tomorrow."
    case "spam_risk_user_banned_from_posting":
      return "TikTok has stopped this account from posting right now."
    case "reached_active_user_cap":
      return "TikTok's daily limit for this app has been reached. Try again tomorrow."
    case "token_invalid":
      return "The TikTok connection has expired. Reconnect TikTok on the Connections page."
    default:
      return `TikTok said: ${message || code}`
  }
}
