// lib/social/plugins/tiktok.ts
// TikTok hybrid plugin. Does not post directly to the TikTok API — instead
// sends the coach a push notification + email with the caption on their
// clipboard so they can paste-and-post natively (native posts perform better
// in the TikTok algorithm than third-party-API posts).

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"

export interface TikTokHybridConfig {
  user_email: string
  fcm_token: string | null
  sendPush: (args: { token: string; title: string; body: string; data: Record<string, string> }) => Promise<void>
  sendEmail: (args: { to: string; subject: string; html: string }) => Promise<void>
}

function generatePendingId(): string {
  return `tiktok_pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTikTokPlugin(config: TikTokHybridConfig): PublishPlugin {
  return {
    name: "tiktok",
    displayName: "TikTok",

    async connect(): Promise<ConnectResult> {
      // No API connection — the user is the "connection".
      return { status: "connected", account_handle: config.user_email }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const pendingId = generatePendingId()
      const caption = input.content
      const mediaUrl = input.mediaUrl ?? ""

      // Attempt push (best-effort). If it fails, email is the reliable channel.
      if (config.fcm_token) {
        try {
          await config.sendPush({
            token: config.fcm_token,
            title: "TikTok post ready",
            body: "Your caption is ready — tap to paste in TikTok",
            data: { caption, mediaUrl, pendingId },
          })
        } catch {
          // Silent fallback to email
        }
      }

      try {
        await config.sendEmail({
          to: config.user_email,
          subject: "TikTok post ready to paste",
          html: buildEmailHtml(caption, mediaUrl),
        })
      } catch (error) {
        return {
          success: false,
          error: `Both TikTok notification channels failed: ${(error as Error).message}`,
        }
      }

      return { success: true, platform_post_id: pendingId }
    },

    async fetchAnalytics(_postId: string): Promise<AnalyticsResult> {
      return {}
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your TikTok account (hybrid)",
        "",
        "TikTok's algorithm favors posts made natively in the TikTok app. So we don't auto-post —",
        "instead, you'll get a push notification and email with the AI-generated caption whenever it's ready.",
        "",
        "1. Install DJP Athlete on your phone so you can receive push notifications (optional but recommended).",
        "2. Keep your notification email up to date in your profile.",
        "3. When a notification arrives: tap it → caption is on your clipboard → open TikTok → record/upload → paste → post.",
        "",
        "Total time: about 30 seconds per post. The AI does all the writing.",
      ].join("\n")
    },
  }
}

function buildEmailHtml(caption: string, mediaUrl: string): string {
  return `
    <h2>TikTok post ready</h2>
    <p>The AI generated this caption for your next TikTok post.</p>
    <pre style="background:#f6f6f6;padding:12px;border-radius:8px;white-space:pre-wrap;font-family:inherit">${escapeHtml(caption)}</pre>
    ${mediaUrl ? `<p>Video: <a href="${escapeHtml(mediaUrl)}">${escapeHtml(mediaUrl)}</a></p>` : ""}
    <p><strong>Next step:</strong> Copy the caption above, open TikTok, paste, and post.</p>
  `.trim()
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  )
}
