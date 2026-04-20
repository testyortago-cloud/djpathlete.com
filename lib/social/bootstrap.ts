// lib/social/bootstrap.ts
// Instantiate platform plugins from stored credentials and register them with
// the shared plugin registry. Call this once per request (or once at server
// startup) before invoking the registry to publish.

import type { PlatformConnection } from "@/types/database"
import { pluginRegistry } from "./registry"
import { createFacebookPlugin, type FacebookCredentials } from "./plugins/facebook"
import { createInstagramPlugin, type InstagramCredentials } from "./plugins/instagram"
import { createYouTubePlugin, type YouTubeCredentials } from "./plugins/youtube"
import { createYouTubeShortsPlugin } from "./plugins/youtube-shorts"
import { createTikTokPlugin, type TikTokHybridConfig } from "./plugins/tiktok"
import { createLinkedInPlugin, type LinkedInCredentials } from "./plugins/linkedin"

export interface BootstrapOptions {
  tiktokEmail: string
  tiktokFcmToken: string | null
  sendPush: TikTokHybridConfig["sendPush"]
  sendEmail: TikTokHybridConfig["sendEmail"]
}

function hasKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => typeof obj[k] === "string" && (obj[k] as string).length > 0)
}

export function bootstrapPlugins(connections: PlatformConnection[], options: BootstrapOptions): void {
  pluginRegistry.reset()

  for (const conn of connections) {
    if (conn.status !== "connected") continue
    const creds = conn.credentials as Record<string, unknown>

    switch (conn.plugin_name) {
      case "facebook":
        if (hasKeys(creds, ["access_token", "page_id"])) {
          pluginRegistry.register(createFacebookPlugin(creds as unknown as FacebookCredentials))
        }
        break

      case "instagram":
        if (hasKeys(creds, ["access_token", "ig_user_id"])) {
          pluginRegistry.register(createInstagramPlugin(creds as unknown as InstagramCredentials))
        }
        break

      case "youtube":
        if (hasKeys(creds, ["access_token", "refresh_token", "client_id", "client_secret"])) {
          pluginRegistry.register(createYouTubePlugin(creds as unknown as YouTubeCredentials))
        }
        break

      case "youtube_shorts":
        if (hasKeys(creds, ["access_token", "refresh_token", "client_id", "client_secret"])) {
          pluginRegistry.register(createYouTubeShortsPlugin(creds as unknown as YouTubeCredentials))
        }
        break

      case "tiktok":
        pluginRegistry.register(
          createTikTokPlugin({
            user_email: options.tiktokEmail,
            fcm_token: options.tiktokFcmToken,
            sendPush: options.sendPush,
            sendEmail: options.sendEmail,
          }),
        )
        break

      case "linkedin":
        if (hasKeys(creds, ["access_token", "organization_id"])) {
          pluginRegistry.register(createLinkedInPlugin(creds as unknown as LinkedInCredentials))
        }
        break
    }
  }
}
