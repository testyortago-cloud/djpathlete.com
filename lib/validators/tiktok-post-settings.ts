import { z } from "zod"

export const TIKTOK_PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const

export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number]

// Zod 4 runs superRefine even when a field already failed, so every check
// reads the (possibly partial) value defensively.
export const tiktokPostSettingsSchema = z
  .object({
    privacy_level: z.enum(TIKTOK_PRIVACY_LEVELS),
    allow_comment: z.boolean(),
    allow_duet: z.boolean(),
    allow_stitch: z.boolean(),
    disclose: z.boolean(),
    your_brand: z.boolean(),
    branded_content: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const brandBox = v?.your_brand === true || v?.branded_content === true
    if (v?.disclose === true && !brandBox) {
      ctx.addIssue({
        code: "custom",
        path: ["disclose"],
        message: "Indicate if your content promotes yourself, a third party, or both.",
      })
    }
    if (v?.disclose !== true && brandBox) {
      ctx.addIssue({
        code: "custom",
        path: ["disclose"],
        message: "Turn on the disclosure before choosing a brand option.",
      })
    }
    if (v?.branded_content === true && v?.privacy_level === "SELF_ONLY") {
      ctx.addIssue({
        code: "custom",
        path: ["privacy_level"],
        message: "Branded content can't be private.",
      })
    }
  })

export type TikTokPostSettings = {
  privacy_level: TikTokPrivacyLevel
  allow_comment: boolean
  allow_duet: boolean
  allow_stitch: boolean
  disclose: boolean
  your_brand: boolean
  branded_content: boolean
}
