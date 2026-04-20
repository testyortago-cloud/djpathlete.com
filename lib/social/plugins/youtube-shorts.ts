// lib/social/plugins/youtube-shorts.ts
// Thin wrapper over the YouTube plugin that ensures the #Shorts tag is present
// on every upload (this is what YouTube uses to classify the video as a Short).

import { createYouTubePlugin, type YouTubeCredentials } from "./youtube"
import type { PublishPlugin, PublishInput, PublishResult } from "./types"

const SHORTS_TAG = "#Shorts"

export function createYouTubeShortsPlugin(credentials: YouTubeCredentials): PublishPlugin {
  const base = createYouTubePlugin(credentials)

  return {
    ...base,
    name: "youtube_shorts",
    displayName: "YouTube Shorts",

    async publish(input: PublishInput): Promise<PublishResult> {
      const content = input.content.includes(SHORTS_TAG)
        ? input.content
        : `${input.content}\n\n${SHORTS_TAG}`
      return base.publish({ ...input, content })
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## YouTube Shorts",
        "",
        "Shorts publish through the same YouTube channel you connected above — you do not need a separate connection.",
        "To publish a Short: upload a vertical video ≤ 60 seconds. The `#Shorts` tag is added automatically to the description.",
      ].join("\n")
    },
  }
}
