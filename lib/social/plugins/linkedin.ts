// lib/social/plugins/linkedin.ts
// LinkedIn UGC Posts API for Company Pages.
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"

const UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts"
const URL_PATTERN = /^https?:\/\//i

export interface LinkedInCredentials {
  access_token: string
  organization_id: string
}

export function createLinkedInPlugin(credentials: LinkedInCredentials): PublishPlugin {
  const { access_token, organization_id } = credentials

  return {
    name: "linkedin",
    displayName: "LinkedIn",

    async connect(): Promise<ConnectResult> {
      const response = await fetch(`https://api.linkedin.com/v2/organizations/${organization_id}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return { status: "error", error: extractLiError(text) }
      }
      const data = (await response.json()) as { localizedName?: string }
      return { status: "connected", account_handle: data.localizedName }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl } = input

      const isLink = Boolean(mediaUrl && URL_PATTERN.test(mediaUrl))

      const specificContent: Record<string, unknown> = {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: isLink ? "ARTICLE" : "NONE",
          ...(isLink
            ? { media: [{ status: "READY", originalUrl: mediaUrl as string }] }
            : {}),
        },
      }

      const body = {
        author: `urn:li:organization:${organization_id}`,
        lifecycleState: "PUBLISHED",
        specificContent,
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }

      const response = await fetch(UGC_POSTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return { success: false, error: extractLiError(text) }
      }
      const rawText = await response.text()
      const data = JSON.parse(rawText) as { id?: string }
      if (!data.id) return { success: false, error: "LinkedIn response missing post id" }
      return { success: true, platform_post_id: data.id }
    },

    async fetchAnalytics(_postId: string): Promise<AnalyticsResult> {
      return {}
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your LinkedIn Company Page",
        "",
        "LinkedIn posting requires a LinkedIn Company Page (not a personal profile) and an approved developer app.",
        "",
        "1. Create a Company Page at https://www.linkedin.com/company/setup/new (free, 20 minutes + verification).",
        "2. Apply to LinkedIn's Marketing Developer Platform for your app (free, 5–10 business days).",
        "3. Once approved, request the `w_organization_social` scope for the Page admin.",
        "4. Paste your organization id and the page access token into the Connect dialog.",
        "",
        "Phase 2a note: automated posting works once the token is present. Phase 2b adds the full OAuth flow.",
      ].join("\n")
    },
  }
}

function extractLiError(raw: string): string {
  if (!raw) return "LinkedIn publish failed"
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string }
    return parsed.message ?? parsed.error ?? raw
  } catch {
    return raw
  }
}
